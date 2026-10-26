"""Native mock-only lifecycle evidence; never writes an application database."""
from datetime import datetime, timezone
import json
import re
import subprocess
import time
import uuid

from immutable_artifacts import digest
from p4_recovery_guest import Recovery, RecoveryError
from p6_mock_guest import ROOT, prepared, check_containment
from p6_mock_update_guest import NEW_NAME, NEW_COMPOSE
from p6_health_repair_guest import isolation
from p6_mock_control import Control
from p6_queue_boundary_gate import anchored_result, verify_live
from p6_queue_function_scope import audit as function_scope
from p6_processes import PS_FIELDS, process_rows
from web_edge_guest import private_env

ACCOUNT = 'anvesh.mannuru+ir35test@gmail.com'
EXPECTED = {'success': ('submitted', None), 'server_error': ('failed', 'mock_ats_http_500'),
            'timeout': ('failed', 'mock_ats_timeout'), 'lost_ack': ('failed', 'mock_unknown_outcome'),
            'captcha': ('failed', 'mock_captcha_required'), 'unknown_answer': ('failed', 'mock_input_required')}


def work(scenario):
    if scenario not in EXPECTED:
        raise RecoveryError('ExplicitMockScenarioOnly')
    return {'kind': 'staging_mock_application', 'applicationId': str(uuid.uuid4()), 'actorEmail': ACCOUNT,
            'scenario': scenario, 'requestedAt': datetime.now(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')}


def terminal(receipt, scenario):
    state, error = EXPECTED[scenario]
    expected_states = ['queued', 'running', 'submitting', state]
    if (receipt.get('state') != state or receipt.get('errorCode') != error
            or receipt.get('receiptConfirmed') is not (state == 'submitted')
            or [event['state'] for event in receipt.get('events', [])] != expected_states):
        raise RecoveryError('NativeMockTerminalOrHistoryMismatch_NoReadyFallback')
    return {'status': 'PASS', 'scenario': scenario, 'states': expected_states, 'state': state,
            'errorCode': error, 'receiptConfirmed': state == 'submitted', 'realSideEffects': 0}


def producer_script(value, *, orphan=False):
    # Fixed methods and validated synthetic input only. This child uses the
    # existing producer env on the VM; no DB/HMAC/provider values in JS/argv.
    if set(value) != {'kind', 'applicationId', 'actorEmail', 'scenario', 'requestedAt'} or value['actorEmail'] != ACCOUNT or value['scenario'] not in EXPECTED:
        raise RecoveryError('NamedTestActorAndStrictMockInputRequired')
    uuid.UUID(value['applicationId'])
    script = """import { PgBoss } from 'pg-boss';
import { mockOptions } from './services/application-worker/mock-runtime.ts';
import { MockStore } from './services/application-worker/mock-store.ts';
const producer = new PgBoss(await mockOptions('producer')); producer.on('error',()=>{});
try { await producer.start();
const value = VALUE;
OPERATION
} finally { await producer.stop({graceful:false}); }
""".replace('VALUE', json.dumps(value, separators=(',', ':')))
    if not orphan:
        operation = "console.log(JSON.stringify(await new MockStore(producer,producer).enqueue(value)));"
    else:
        # Synthetic orphan at an already-expired timestamp, never UPDATE a
        # source/customer row or alter the watchdog's 45-second condition.
        operation = """await producer.getDb().executeSql(`INSERT INTO pgboss.ir35_mock_application
 (id,actor_email,scenario,state,requested_at,updated_at,events)
 VALUES($1,$2,$3,'queued',clock_timestamp()-interval '60 seconds',clock_timestamp()-interval '60 seconds',
 jsonb_build_array(jsonb_build_object('state','queued','at',clock_timestamp()-interval '60 seconds','errorCode',NULL)))`,
 [value.applicationId,value.actorEmail,value.scenario]);
console.log(JSON.stringify({inserted:true,mock:true}));"""
    return script.replace('OPERATION', operation)


def producer(value, *, orphan=False, worker_name=NEW_NAME):
    if worker_name not in (NEW_NAME, 'ir35-p6-mock-worker-v3','ir35-p6-mock-worker-v4','ir35-p6-mock-worker-v5','ir35-p6-mock-worker-v6'):
        raise RecoveryError('FixedMockRuntimeIdentityRequired')
    script = producer_script(value, orphan=orphan)
    args = ['docker', 'exec', '-i', '--user', '1002:1002', worker_name, '/run/ir35/env-exec',
            '/opt/ir35/.env.p6-mock-worker', 'node', '--import', 'tsx', '--input-type=module', '-']
    observed = subprocess.run(args, input=script.encode(), capture_output=True, timeout=45)
    if observed.returncode or len(observed.stdout) > 16384:
        raise RecoveryError('NativeMockProducerFixtureFailed_RawSuppressed')
    return json.loads(observed.stdout)


def probe_lost_ack(data, runtime, *, repair_one=False):
    if type(repair_one) is not bool:
        raise RecoveryError('ExplicitRepairBooleanRequired')
    store = prepared(data)
    failed = data['failureLifecycle']
    anchored_result(store, failed)
    if (failed.get('code') != 'NativeMockTerminalOrHistoryMismatch_NoReadyFallback'
            or failed.get('failureContainment', {}).get('status') != 'PASS'
            or failed.get('failurePause') != {'paused': True, 'realAcceptance': False}):
        raise RecoveryError('ExactPausedLifecycleFailureRequired_NoReplay')
    stage = store.stage('14-isolated-receipt-repair-one' if repair_one else '13-isolated-lost-ack-probe')
    result = {'status': 'FAIL', 'queueWrites': 0, 'customerWrites': 0, 'workerStarts': 0,
              'secretMounts': 0, 'publicPorts': 0, 'network': 'none', 'realAcceptance': False}
    try:
        result['preContainment'] = check_containment(data, runtime, store, stage, 'pre')
        mounts = []
        if repair_one:
            previous = data['originalBrowserProbe']
            anchored_result(store, previous)
            if previous.get('status') != 'OBSERVED' or previous.get('lost_ack') != {'exitCode': 0, 'ok': False, 'errorCode': 'mock_unknown_outcome', 'submissions': 2}:
                raise RecoveryError('ActualPreHeaderRetryReproductionRequired')
            sources = data['publicRepairSources']
            if set(sources) != {'mock-browser.ts', 'mock-ats.ts'} or not all(isinstance(code, str) and 0 < len(code) < 50000 for code in sources.values()):
                raise RecoveryError('TwoPublicMockSourceFilesOnly')
            result['publicSourceSHA256'] = {}
            for filename, code in sources.items():
                store.put(stage, filename, code.encode())
                result['publicSourceSHA256'][filename] = digest(code.encode())
                mounts += ['--volume', str(stage / filename) + ':/app/services/application-worker/' + filename + ':ro']
        for scenario in EXPECTED if repair_one else ('success', 'lost_ack'):
            store.put(stage, scenario + '-intent.json', json.dumps({'operation': 'apply', 'scenario': scenario,
                      'noCredentialsOrSecretMounts': True, 'publicSourceMounts': len(mounts) // 2,
                      'workerImage': data['runtimeProof']['image']}).encode())
            args = ['docker', 'run', '--rm', '-i', '--init', '--network', 'none', '--read-only', '--user', '1002:1002',
                    '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true', '--log-driver', 'none',
                    '--memory', '512m', '--pids-limit', '256', '--tmpfs', '/tmp:rw,size=512m,uid=1002,gid=1002,mode=1777',
                    *mounts, '--entrypoint', 'node', data['runtimeProof']['image'], '--import', 'tsx', 'services/application-worker/mock-browser.ts']
            observed = subprocess.run(args, input=json.dumps({'operation': 'apply', 'scenario': scenario}).encode(),
                                      capture_output=True, timeout=75)
            if len(observed.stdout) > 4096 or len(observed.stderr) > 16384:
                raise RecoveryError('BoundedCredentialFreeProbeOutputRequired')
            store.put(stage, scenario + '-stdout.json', observed.stdout)
            store.put(stage, scenario + '-stderr.log', observed.stderr)
            parsed = json.loads(observed.stdout)
            result[scenario] = {'exitCode': observed.returncode, **parsed}
            if repair_one:
                expected_error = EXPECTED[scenario][1]
                expected_submissions = 0 if scenario in ('captcha', 'unknown_answer') else 1
                if (observed.returncode != 0 or parsed.get('ok') is not (scenario == 'success')
                        or parsed.get('submissions') != expected_submissions or parsed.get('errorCode') != expected_error
                        or (scenario == 'success' and parsed.get('receiptConfirmed') is not True)):
                    raise RecoveryError('PrivateReceiptRepairScenarioMismatch_' + scenario)
        result['containment'] = check_containment(data, runtime, store, stage, 'post')
        result.update(status='PASS' if repair_one else 'OBSERVED', phaseComplete=False,
                      repairAttempt=1 if repair_one else 0, originalFailedJournalRetained=True,
                      parentOneSubmissionGuardUnchanged=True)
    except Exception as error:
        result['code'] = str(error) if isinstance(error, RecoveryError) else type(error).__name__
    store.put(stage, 'result.json', json.dumps(result, sort_keys=True).encode())
    return result | {'stage': stage.name, 'manifestSHA256': store.seal(stage)}


def retained_receipts(store, failed):
    anchored_result(store, failed)
    if (failed.get('status') != 'FAIL' or failed.get('stage') != '12-native-mock-lifecycle'
            or failed.get('failureContainment', {}).get('status') != 'PASS'
            or failed.get('code') != 'NativeMockTerminalOrHistoryMismatch_NoReadyFallback'):
        raise RecoveryError('ExactPriorLifecycleFailureRequired')
    manifest = store.verify(failed['stage'], failed['manifestSHA256'])
    found = {}
    for item in manifest['artifacts']:
        match = re.fullmatch(r'[0-9]{3}-terminal-(success|server_error|timeout|lost_ack)\.json', item['name'])
        if not match:
            continue
        value = json.loads((store.root / failed['stage'] / item['name']).read_bytes())
        if match[1] in found:
            raise RecoveryError('DuplicateOriginalTerminalArtifact')
        expected = {'success': ('submitted', None), 'server_error': ('failed', 'mock_ats_http_500'),
                    'timeout': ('failed', 'mock_ats_timeout'), 'lost_ack': ('failed', 'mock_browser_failed')}[match[1]]
        if (value.get('state'), value.get('errorCode')) != expected:
            raise RecoveryError('OriginalReceiptEvidenceChanged')
        uuid.UUID(value['applicationId'])
        found[match[1]] = value
    if set(found) != {'success', 'server_error', 'timeout', 'lost_ack'} or len({row['applicationId'] for row in found.values()}) != 4:
        raise RecoveryError('FourOriginalReceiptsMustRemainExact')
    return {row['applicationId']: row for row in found.values()}


def run(data, runtime, *, repair_one=False,owner_resume=False,pause_repair=False,schedule_repair=False):
    if type(schedule_repair)is not bool or schedule_repair and (not owner_resume or pause_repair):raise RecoveryError('DistinctFinalScheduleLifecycleRequired')
    if type(pause_repair)is not bool or pause_repair and not owner_resume:raise RecoveryError('DistinctPauseLifecycleRequired')
    if type(owner_resume) is not bool or owner_resume and repair_one:
        raise RecoveryError('DistinctOwnerLifecycleResumeRequired')
    if type(repair_one) is not bool:
        raise RecoveryError('ExplicitLifecycleRepairBooleanRequired')
    store = prepared(data)
    anchor = data['runtimeProof']
    anchored_result(store, anchor)
    if anchor.get('status') != 'PASS' or anchor.get('containment', {}).get('status') != 'PASS':
        raise RecoveryError('ActualNativeHandoverPassRequired')
    prior_receipts = retained_receipts(store, data['failureLifecycle']) if repair_one else {}
    worker_name = 'ir35-p6-mock-worker-v3' if repair_one else NEW_NAME
    worker_compose = ROOT / 'p6-mock-compose-v3.yml' if repair_one else NEW_COMPOSE
    if owner_resume:
        from p6_status_audit_guest import history
        _,prior_receipts = history(data)
        worker_name = 'ir35-p6-mock-worker-v6' if schedule_repair else 'ir35-p6-mock-worker-v5' if pause_repair else 'ir35-p6-mock-worker-v4'
        worker_compose = ROOT/('p6-mock-compose-v6.yml' if schedule_repair else 'p6-mock-compose-v5.yml' if pause_repair else 'p6-mock-compose-v4.yml')
        if anchor.get('ownerResume') is not True or anchor.get('containerName') != worker_name:
            raise RecoveryError('ActualResumeRuntimeRequired')
    if repair_one and (anchor.get('repairAttempt') != 1 or anchor.get('containerName') != worker_name):
        raise RecoveryError('ActualReceiptRepairRuntimeRequired')
    if schedule_repair:
        from p6_schedule_repair_guest import retained,observe
        _,prior_receipts,_=retained(data)
        before,_=observe(data,runtime)
        anchored_result(store,data['scheduleDrain'])
        if before['ledgerSHA256']!=data['scheduleDrain']['observation']['ledgerSHA256'] or before['pendingScheduleJobs']!=0:
            raise RecoveryError('FinalLifecycleRequiresExactDrainedLedger')
        worker_name='ir35-p6-mock-worker-v6'
        worker_compose=ROOT/'p6-mock-compose-v6.yml'
        if anchor.get('scheduleRepair')is not True or anchor.get('containerName')!=worker_name:
            raise RecoveryError('ActualFinalScheduleHandoverRequired')
    stage = store.stage('25-owner-final-repair-lifecycle' if schedule_repair else '21-owner-pause-repair-lifecycle' if pause_repair else '18-owner-resume-lifecycle' if owner_resume else '16-native-mock-lifecycle-repair-one' if repair_one else '12-native-mock-lifecycle')
    original = Recovery(data['p4'], runtime)
    control = Control(private_env(ROOT / '.env.p6-mock-control')['APPLICATION_WORKER_SECRET'])
    result = {'status': 'FAIL', 'realAcceptance': False, 'customerWrites': 0, 'productionChanges': False,
              'networkChanges': 0, 'secretChanges': 0, 'roleChanges': 0, 'workerRestarts': 0, 'cases': []}
    if owner_resume:
        result.update(resumedLifecycleAttempt=3 if schedule_repair else 2 if pause_repair else 1,
            repairAttempt=2 if schedule_repair else 1 if pause_repair else 0,historicalCountersPreserved=True)
    sequence = 0

    def record(name, observed):
        nonlocal sequence
        sequence += 1
        store.put(stage, f'{sequence:03d}-{name}.json', json.dumps(observed, sort_keys=True).encode())

    def checked(name, observed, valid):
        record(name, observed)
        result['cases'].append({'case': name, 'passed': bool(valid)})
        if not valid:
            raise RecoveryError('NativeMockCaseFailed_' + name)

    def poll(identifier, *, wanted=None, timeout=45):
        end = time.monotonic() + timeout
        while True:
            receipt = control.request('GET', '/mock/applications/' + identifier)[1]
            record('receipt', receipt)
            if receipt.get('state') in ('submitted', 'failed') or receipt.get('state') == wanted:
                return receipt
            if time.monotonic() >= end:
                raise RecoveryError('NativeMockReceiptDeadline')
            time.sleep(0.4)

    def idle():
        end = time.monotonic() + 10
        while True:
            current = control.request('GET', '/health')[1]
            if current.get('active') == 0:
                return current
            if time.monotonic() >= end:
                raise RecoveryError('NativeMockBrowserDidNotDrain')
            time.sleep(0.2)

    def expect_http(name, method, path, value, expected):
        try:
            actual = control.request(method, path, value)[0]
        except RecoveryError as error:
            match = re.fullmatch(r'MockControlHTTP_([0-9]{3})', str(error))
            if not match:
                raise
            actual = int(match[1])
        checked(name, {'expected': expected, 'actual': actual}, actual == expected)

    try:
        result['preContainment'] = check_containment(data, runtime, store, stage, 'pre')
        result['preQueueBoundary'] = verify_live(data, original, store, function_scope(original))
        empty = json.loads(original.query("""SELECT jsonb_build_object(
          'applications',(SELECT count(*) FROM pgboss.ir35_mock_application),
          'schedules',(SELECT count(*) FROM pgboss.ir35_mock_schedule),
          'applyJobs',(SELECT count(*) FROM pgboss.job WHERE name='ir35-staging-mock-apply'));""", 'postgres'))
        if schedule_repair:
            checked('retained-all-twenty-three-counts',empty,empty=={'applications':23,'schedules':1,'applyJobs':22})
            for identifier,before in prior_receipts.items():
                actual_receipt=control.request('GET','/mock/applications/'+identifier)[1]
                checked('retained-all-twenty-three-receipt',{'idSHA256':digest(identifier.encode()),'sameReceipt':actual_receipt==before},actual_receipt==before)
            paused=control.request('GET','/health')[1]
            checked('final-start-paused',paused,paused.get('paused')is True and paused.get('active')==0)
            record('resume-final-mock-consumer-intent',{'realAcceptance':False,'mockOnly':True})
            control.request('POST','/mock/maintenance',{'action':'resume'})
        elif owner_resume:
            checked('retained-all-twelve-counts',empty,empty == {'applications':12,'schedules':0,'applyJobs':12})
            for identifier,before in prior_receipts.items():
                actual_receipt = control.request('GET','/mock/applications/'+identifier)[1]
                checked('retained-all-twelve-receipt',{'idSHA256':digest(identifier.encode()),'sameReceipt':actual_receipt == before},actual_receipt == before)
            paused = control.request('GET','/health')[1]
            checked('resumed-start-paused',paused,paused.get('paused') is True and paused.get('active') == 0)
            record('resume-mock-consumer-intent',{'realAcceptance':False,'mockOnly':True})
            control.request('POST','/mock/maintenance',{'action':'resume'})
        elif repair_one:
            checked('retained-failure-fixture-counts', empty, empty == {'applications': 4, 'schedules': 0, 'applyJobs': 4})
            for identifier, before in prior_receipts.items():
                actual_receipt = control.request('GET', '/mock/applications/' + identifier)[1]
                checked('retained-original-receipt', {'idSHA256': digest(identifier.encode()), 'sameReceipt': actual_receipt == before}, actual_receipt == before)
        else:
            checked('fresh-lifecycle-fixture', empty, empty == {'applications': 0, 'schedules': 0, 'applyJobs': 0})
        worker = json.loads(runtime['run'](['docker', 'inspect', worker_name]))[0]
        network = json.loads(runtime['run'](['docker', 'inspect', '--type', 'network', 'ir35-staging_backend']))[0]
        address = isolation(worker, anchor['image'], network)
        if digest(worker_compose.read_bytes()) != anchor['composeSHA256'] or not worker['State']['Running'] or worker['HostConfig'].get('Init') is not True:
            raise RecoveryError('ImmutableNativeMockRuntimeRequired')
        health = control.request('GET', '/health')[1]
        checked('mock-health', health, health.get('ok') is True and health.get('realAcceptance') is False
                and health.get('buildSHA') == anchor['sourceSHA'] and health.get('active') == 0 and health.get('paused') is False)
        snapshots = dict(prior_receipts)
        for scenario in EXPECTED:
            value = work(scenario)
            record('publication-intent', value)
            accepted = control.request('POST', '/mock/applications', value)
            checked('enqueue-' + scenario, {'status': accepted[0], 'receipt': accepted[1]},
                    accepted[0] == 202 and accepted[1].get('applicationId') == value['applicationId'])
            receipt = poll(value['applicationId'])
            record('terminal-' + scenario, receipt)  # Before semantic assertion.
            proof = terminal(receipt, scenario)
            checked('outcome-' + scenario, proof, proof['status'] == 'PASS')
            duplicate = control.request('POST', '/mock/applications', value)
            checked('duplicate-' + scenario, {'status': duplicate[0], 'sameReceipt': duplicate[1] == receipt},
                    duplicate[0] == 202 and duplicate[1] == receipt)
            job_deadline = time.monotonic() + 10
            while True:
                actual_job = json.loads(original.query("SELECT jsonb_build_object('count',count(*),'states',jsonb_agg(state ORDER BY state)) FROM pgboss.job WHERE name='ir35-staging-mock-apply' AND id='" + str(uuid.UUID(value['applicationId'])) + "';", 'postgres'))
                job_expected = {'count': 1, 'states': ['completed' if scenario == 'success' else 'failed']}
                if actual_job == job_expected or time.monotonic() >= job_deadline:
                    break
                time.sleep(0.2)
            checked('durable-job-' + scenario, actual_job, actual_job == job_expected)
            snapshots[value['applicationId']] = receipt
            idle()
        concurrent = [work('success'), work('success')]
        intervals = []
        for value in concurrent:
            record('concurrent-intent', value)
            control.request('POST', '/mock/applications', value)
        for value in concurrent:
            receipt = poll(value['applicationId'])
            record('concurrent-terminal', receipt)
            checked('concurrent-outcome', terminal(receipt, 'success'), True)
            intervals.append((datetime.fromisoformat(receipt['events'][1]['at']), datetime.fromisoformat(receipt['events'][-1]['at'])))
            snapshots[value['applicationId']] = receipt
        checked('concurrent-browser-exclusion', {'intervalsDoNotOverlap': intervals[0][1] <= intervals[1][0] or intervals[1][1] <= intervals[0][0]},
                intervals[0][1] <= intervals[1][0] or intervals[1][1] <= intervals[0][0])
        invalid = work('success') | {'employerURL': 'https://forbidden.invalid/apply'}
        expect_http('reject-employer-url', 'POST', '/mock/applications', invalid, 400)
        expect_http('reject-non-test-actor', 'POST', '/mock/applications', work('success') | {'actorEmail': 'not-the-approved-actor@invalid.test'}, 400)
        paused = control.request('POST', '/mock/maintenance', {'action': 'pause'})[1]
        checked('maintenance-pause', paused, paused == {'paused': True, 'realAcceptance': False})
        expect_http('maintenance-reject-apply', 'POST', '/mock/applications', work('success'), 503)
        scheduled = {'kind': 'staging_mock_schedule', 'operation': 'watchdog', 'requestedAt': work('success')['requestedAt']}
        expect_http('maintenance-reject-schedule', 'POST', '/mock/schedule', scheduled, 503)
        queued = work('success')
        record('queued-cancel-intent', queued)
        queued_receipt = producer(queued, worker_name=worker_name)
        checked('queued-before-cancel', queued_receipt, queued_receipt.get('state') == 'queued')
        cancelled = control.request('POST', '/mock/applications/' + queued['applicationId'] + '/cancel', {})[1]
        checked('queued-cancel', cancelled, cancelled.get('state') == 'failed' and cancelled.get('errorCode') == 'mock_cancelled'
                and [event['state'] for event in cancelled['events']] == ['queued', 'failed'])
        repeated = control.request('POST', '/mock/applications/' + queued['applicationId'] + '/cancel', {})[1]
        checked('cancel-idempotent', {'sameReceipt': repeated == cancelled}, repeated == cancelled)
        snapshots[queued['applicationId']] = cancelled
        control.request('POST', '/mock/maintenance', {'action': 'resume'})
        active = work('timeout')
        record('active-cancel-intent', active)
        control.request('POST', '/mock/applications', active)
        started = poll(active['applicationId'], wanted='submitting')
        checked('submitting-before-cancel', started, started.get('state') == 'submitting')
        cancelled = control.request('POST', '/mock/applications/' + active['applicationId'] + '/cancel', {})[1]
        checked('active-cancel', cancelled, cancelled.get('state') == 'failed' and cancelled.get('errorCode') == 'mock_cancelled')
        idle()
        snapshots[active['applicationId']] = cancelled
        # Record synthetic orphan intent first; INSERT private queue fixture only.
        orphan = work('success')
        record('orphan-queued-intent', orphan)
        inserted = producer(orphan, orphan=True, worker_name=worker_name)
        checked('orphan-insert', inserted, inserted == {'inserted': True, 'mock': True})
        expired = poll(orphan['applicationId'], timeout=30)
        checked('orphan-watchdog', expired, expired.get('state') == 'failed' and expired.get('errorCode') == 'runner_timeout'
                and [event['state'] for event in expired['events']] == ['queued', 'failed'])
        snapshots[orphan['applicationId']] = expired
        for operation in ('mock_ingest', 'mock_automation', 'watchdog'):
            command = {'kind': 'staging_mock_schedule', 'operation': operation, 'requestedAt': work('success')['requestedAt']}
            record('schedule-intent', command)
            accepted = control.request('POST', '/mock/schedule', command)
            checked('schedule-' + operation, {'status': accepted[0], 'value': accepted[1]},
                    accepted == (202, {'mock': True, 'queued': True}))
        deadline = time.monotonic() + 15
        while True:
            schedules = json.loads(original.query("SELECT COALESCE(jsonb_agg(DISTINCT operation ORDER BY operation),'[]') FROM pgboss.ir35_mock_schedule;", 'postgres'))
            if schedules == ['mock_automation', 'mock_ingest', 'watchdog'] or time.monotonic() >= deadline:
                break
            time.sleep(0.4)
        checked('durable-mock-schedules', schedules, schedules == ['mock_automation', 'mock_ingest', 'watchdog'])
        before_restart = idle()
        checked('one-browser-max', before_restart, before_restart.get('peakActive') == 1)
        record('restart-intent', {'container': worker_name, 'image': anchor['image'], 'queueJobsTerminal': True, 'realAcceptance': False})
        runtime['run'](['docker', 'restart', '--time', '30', worker_name], timeout=60)
        result['workerRestarts'] = 1
        end = time.monotonic() + 90
        while True:
            try:
                healthy = control.request('GET', '/health')[1]
                if healthy.get('ok') is True:
                    break
            except RecoveryError:
                pass
            if time.monotonic() >= end:
                raise RecoveryError('NativeMockRestartHealthDeadline')
            time.sleep(1)
        checked('restart-health', healthy, healthy.get('buildSHA') == anchor['sourceSHA'] and healthy.get('realAcceptance') is False)
        for identifier, before in snapshots.items():
            after = control.request('GET', '/mock/applications/' + identifier)[1]
            checked('durable-after-restart', {'idSHA256': digest(identifier.encode()), 'sameReceipt': after == before}, after == before)
        actual = json.loads(runtime['run'](['docker', 'inspect', worker_name]))[0]
        if isolation(actual, anchor['image'], network) != address:
            raise RecoveryError('MockRuntimeIsolationChangedAfterRestart')
        processes = process_rows(runtime['run'](['docker', 'top', worker_name, '-eo', PS_FIELDS]))
        chromium = [line for line in processes if re.search(r'\b(?:chrome|chromium|chrome_crashpad)\b', line)]
        checked('no-browser-orphans', {'chromiumProcessCount': len(chromium)}, not chromium)
        result['postQueueBoundary'] = verify_live(data, original, store, function_scope(original))
        result['containment'] = check_containment(data, runtime, store, stage, 'post')
        result.update(status='PASS', phaseComplete=False, scenarios=len(EXPECTED), persistedReceipts=len(snapshots),
                      repairAttempt=2 if schedule_repair else 1 if pause_repair or repair_one else 0, originalFailedReceiptsPreserved=len(prior_receipts),
                      scope='private mock lifecycle only; app/Realtime/timer integration still required')
    except Exception as error:
        result['code'] = str(error) if isinstance(error, RecoveryError) else type(error).__name__
        try:
            result['failurePause'] = control.request('POST', '/mock/maintenance', {'action': 'pause'})[1]
        except Exception:
            result['failurePause'] = {'status': 'UNCONFIRMED'}
        try:
            result['failureContainment'] = check_containment(data, runtime, store, stage, 'failure')
        except Exception as failure:
            result['failureContainment'] = {'status': 'FAIL', 'code': type(failure).__name__}
    store.put(stage, 'result.json', json.dumps(result, sort_keys=True).encode())
    return result | {'stage': stage.name, 'manifestSHA256': store.seal(stage)}
