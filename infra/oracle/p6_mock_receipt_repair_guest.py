"""One bounded receipt-fixture repair handover, retaining all earlier runtime artifacts."""
import json
import os
from pathlib import Path
import re
import subprocess
import time

from immutable_artifacts import digest
from p4_recovery_guest import Recovery, RecoveryError
from p6_mock_guest import ROOT, prepared, prerequisites, check_containment, validate_config
from p6_mock_update_guest import NEW_NAME as OLD_NAME, NEW_COMPOSE as OLD_COMPOSE, compose_two
from p6_health_repair_guest import SYSTEMD, UPDATE_UNIT, RECEIPT_UNIT, units, write_unit, isolation, validate_proxy
from p6_mock_control import Control
from p6_queue_boundary_gate import anchored_result, verify_live
from p6_queue_function_scope import audit as function_scope
from p6_roles_guest import no_customer_access
from web_edge_guest import private_env

NAME = 'ir35-p6-mock-worker-v3'
COMPOSE = ROOT / 'p6-mock-compose-v3.yml'


def configuration(image, source, *, owner_resume=False,pause_repair=False,schedule_repair=False):
    if type(schedule_repair)is not bool or schedule_repair and (not owner_resume or pause_repair):raise RecoveryError('DistinctFinalScheduleRepairRequired')
    if type(pause_repair)is not bool or pause_repair and not owner_resume:raise RecoveryError('DistinctPauseRepairRequired')
    value = compose_two(image, source)
    value['name'] = 'ir35-p6-mock-v4' if owner_resume else 'ir35-p6-mock-v3'
    value['services']['worker']['container_name'] = 'ir35-p6-mock-worker-v4' if owner_resume else NAME
    if owner_resume:
        entry = value['services']['worker']['entrypoint']
        entry.insert(entry.index('node'),'IR35_MOCK_START_PAUSED=true' if pause_repair or schedule_repair else 'IR35_READ_ONLY=true')
    if pause_repair:
        value['name']='ir35-p6-mock-v5'
        value['services']['worker']['container_name']='ir35-p6-mock-worker-v5'
    if schedule_repair:
        value['name']='ir35-p6-mock-v6'
        value['services']['worker']['container_name']='ir35-p6-mock-worker-v6'
    return value


def paused_rollback(data,runtime,store,stage,prior,*,pause_repair=False,schedule_repair=False):
    """Restore old immutable image WITHOUT briefly enabling its consumer."""
    from p6_health_repair_guest import ROLLBACK_UNIT,PAUSE_ROLLBACK_UNIT,FINAL_ROLLBACK_UNIT
    if type(schedule_repair)is not bool or schedule_repair and pause_repair:raise RecoveryError('DistinctFinalScheduleRollbackRequired')
    if type(pause_repair)is not bool:raise RecoveryError('ExplicitPauseRollbackRequired')
    unit=PAUSE_ROLLBACK_UNIT if pause_repair else ROLLBACK_UNIT
    name = 'ir35-p6-mock-worker-v5-rollback' if pause_repair else 'ir35-p6-mock-worker-v4-rollback'
    path = ROOT/('p6-mock-compose-v5-rollback.yml' if pause_repair else 'p6-mock-compose-v4-rollback.yml')
    if schedule_repair:
        unit=FINAL_ROLLBACK_UNIT
        name='ir35-p6-mock-worker-v6-rollback'
        path=ROOT/'p6-mock-compose-v6-rollback.yml'
    value = configuration(prior['image'],prior['sourceSHA'],owner_resume=True)
    value['name'] = 'ir35-p6-mock-v5-rollback' if pause_repair else 'ir35-p6-mock-v4-rollback'
    if schedule_repair:value['name']='ir35-p6-mock-v6-rollback'
    value['services']['worker']['container_name'] = name
    store.put(stage,'rollback-intent.json',json.dumps({'image':prior['image'],'sourceSHA':prior['sourceSHA'],
        'processingPausedFromStart':True,'originalSecretsUnchanged':True}).encode())
    names = runtime['run'](['docker','ps','-a','--format','{{.Names}}']).splitlines()
    if path.exists() or name in names:raise RecoveryError('RollbackAlreadyExists_NoBlindReplay')
    with path.open('x') as output:json.dump(value,output,indent=2)
    os.chmod(path,0o644)
    with store.sink(stage,'rollback-start.log') as log:
        command = ['docker','compose','--env-file',str(ROOT/'.env'),'-f',str(path)]
        if subprocess.run(command+['config','--quiet'],stdout=log,stderr=log,timeout=30).returncode:
            raise RecoveryError('RollbackComposeInvalid')
        if subprocess.run(command+['up','-d','--no-deps','worker'],stdout=log,stderr=log,timeout=120).returncode:
            raise RecoveryError('RollbackStartFailed')
    item = json.loads(runtime['run'](['docker','inspect',name]))[0]
    network = json.loads(runtime['run'](['docker','inspect','--type','network','ir35-staging_backend']))[0]
    address = isolation(item,prior['image'],network)
    bodies = units(address,unit=unit)
    for filename,body in bodies.items():
        write_unit(SYSTEMD/filename,body,unit=unit)
        store.put(stage,filename,body.encode())
    runtime['run'](['systemctl','daemon-reload'])
    runtime['run'](['systemctl','enable','--now',unit+'.socket'])
    control = Control(private_env(ROOT/'.env.p6-mock-control')['APPLICATION_WORKER_SECRET'])
    deadline = time.monotonic()+90
    while True:
        try:
            observed = control.request('GET','/health')[1]
            if observed.get('ok') is True:break
        except RecoveryError:pass
        if time.monotonic() >= deadline:raise RecoveryError('RollbackHealthDeadline')
        time.sleep(1)
    if observed.get('paused') is not True or observed.get('buildSHA') != prior['sourceSHA'] or observed.get('realAcceptance') is not False:
        raise RecoveryError('RollbackMustBeOldImagePausedMock')
    validate_proxy(runtime,bodies,unit=unit)
    return {'status':'PASS','image':prior['image'],'processingPaused':True,'realAcceptance':False,
            'originalContainerAndImagesRetained':True,'containerName':name}


def run(data, runtime, *, owner_resume=False,pause_repair=False,schedule_repair=False):
    if type(schedule_repair)is not bool or schedule_repair and (not owner_resume or pause_repair):raise RecoveryError('DistinctFinalScheduleRepairRequired')
    if type(pause_repair)is not bool or pause_repair and not owner_resume:raise RecoveryError('DistinctPauseRepairRequired')
    if type(owner_resume) is not bool:raise RecoveryError('ExplicitResumeBooleanRequired')
    # Fixed identities, not caller-supplied names; historical three generations
    # and their failed journals are never overwritten or silently replayed.
    worker_name = 'ir35-p6-mock-worker-v4' if owner_resume else NAME
    worker_compose = ROOT/'p6-mock-compose-v4.yml' if owner_resume else COMPOSE
    old_name = NAME if owner_resume else OLD_NAME
    old_compose = COMPOSE if owner_resume else OLD_COMPOSE
    new_unit = 'ir35-p6-health-proxy-r4' if owner_resume else RECEIPT_UNIT
    old_unit = RECEIPT_UNIT if owner_resume else UPDATE_UNIT
    if pause_repair:
        worker_name='ir35-p6-mock-worker-v5'
        worker_compose=ROOT/'p6-mock-compose-v5.yml'
        old_name='ir35-p6-mock-worker-v4-rollback'
        old_compose=ROOT/'p6-mock-compose-v4-rollback.yml'
        new_unit='ir35-p6-health-proxy-r4-pause-repair1'
        old_unit='ir35-p6-health-proxy-r4-rollback'
    if schedule_repair:
        worker_name='ir35-p6-mock-worker-v6'
        worker_compose=ROOT/'p6-mock-compose-v6.yml'
        old_name='ir35-p6-mock-worker-v5'
        old_compose=ROOT/'p6-mock-compose-v5.yml'
        new_unit='ir35-p6-health-proxy-r4-final-repair2'
        old_unit='ir35-p6-health-proxy-r4-drain23'
    prerequisites(data, runtime)
    store = prepared(data)
    prior = data['runtimeProof']
    failure = data['failureLifecycle']
    probe = data['receiptRepairProbe']
    for report in (prior, failure, probe):
        anchored_result(store, report)
    if pause_repair:
        failed=data['resumeFailure']
        anchored_result(store,{k:v for k,v in failed.items() if k!='imageRollback'})
        anchored_result(store,failed['imageRollback'])
        if failed.get('code')!='NativeMockCaseFailed_mock-health' or failed['imageRollback'].get('status')!='PASS':
            raise RecoveryError('ActualPauseFailureAndRollbackRequired')
        old_item=json.loads(runtime['run'](['docker','inspect',old_name]))[0]
        old_address=old_item['NetworkSettings']['Networks']['ir35-staging_backend']['IPAddress']
        expected=configuration(prior['image'],prior['sourceSHA'],owner_resume=True)
        expected['name']='ir35-p6-mock-v4-rollback'
        expected['services']['worker']['container_name']=old_name
        if json.loads(old_compose.read_bytes())!=expected:raise RecoveryError('SealedRollbackConfigurationMismatch')
        prior=prior|{'composeSHA256':digest(old_compose.read_bytes()),'unitSHA256':{k:digest(v.encode()) for k,v in units(old_address,unit=old_unit).items()}}
    if (prior.get('status') != 'PASS' or failure.get('code') != 'NativeMockTerminalOrHistoryMismatch_NoReadyFallback'
            or failure.get('failureContainment', {}).get('status') != 'PASS'
            or failure.get('failurePause') != {'paused': True, 'realAcceptance': False}
            or probe.get('status') != 'PASS' or probe.get('repairAttempt') != 1
            or probe.get('parentOneSubmissionGuardUnchanged') is not True):
        raise RecoveryError('ExactRetainedFailureAndSixScenarioProbeRequired')
    build = data['workerBuild']
    if (not owner_resume and build.get('attempt') != 3) or build.get('image') == prior.get('image'):
        raise RecoveryError('FinalVerifiedBuildThreeRequired')
    if owner_resume:
        from p6_status_audit_guest import history
        history(data)
        if build.get('ownerResume') is not True:raise RecoveryError('VerifiedOwnerResumeBuildRequired')
    if schedule_repair:
        from p6_schedule_repair_guest import observe
        observed,_=observe(data,runtime)
        if (build.get('resumeScheduleRepair')is not True or prior.get('drainedExistingSchedule')!=1
                or observed['pendingScheduleJobs']!=0 or observed['ledgerSHA256']!=prior.get('observation',{}).get('ledgerSHA256')):
            raise RecoveryError('ExactDrainedScheduleLedgerRequired')
        stage=store.stage('24-owner-final-repair-handover')
    elif pause_repair:
        stage=store.stage('20-owner-pause-repair-handover')
    elif owner_resume:
        stage = store.stage('17-owner-resume-handover')
    else:
        stage = store.stage('15-receipt-repair-one-handover')
    recovery = Recovery(data['p4'], runtime)
    control = Control(private_env(ROOT / '.env.p6-mock-control')['APPLICATION_WORKER_SECRET'])
    result = {'status': 'FAIL', 'repairAttempt': 1, 'newWorkerStarts': 0, 'realAcceptance': False,
              'customerWrites': 0, 'productionChanges': False, 'networkChanges': 0, 'secretChanges': 0, 'roleChanges': 0}
    if owner_resume:
        result.update(repairAttempt=2 if schedule_repair else 1 if pause_repair else 0,
            resumedLifecycleAttempt=3 if schedule_repair else 2 if pause_repair else 1,historicalCountersPreserved=True)
    requested = proxy_switched = old_stopped = False
    installed = []
    old_address = None

    def rollback():
        if requested:
            names = runtime['run'](['docker', 'ps', '-a', '--format', '{{.Names}}']).splitlines()
            if worker_name in names:
                current = json.loads(runtime['run'](['docker', 'inspect', worker_name]))[0]
                if current['Image'] != build['image']:
                    raise RecoveryError('NewRepairContainerIdentityMismatch_NoSignal')
                runtime['run'](['docker', 'stop', '--time', '30', worker_name], timeout=45)
                result['newWorkerStoppedAfterFailure'] = True
        if installed:
            runtime['run'](['systemctl', 'disable', '--now', new_unit + '.socket'])
            runtime['run'](['systemctl', 'stop', new_unit + '.service'])
        if proxy_switched and not old_stopped:
            old = json.loads(runtime['run'](['docker', 'inspect', old_name]))[0]
            if (old['State']['Running'] is not True or old['Image'] != prior['image']
                    or old['NetworkSettings']['Networks']['ir35-staging_backend']['IPAddress'] != old_address):
                raise RecoveryError('OriginalPausedRuntimeChanged_NoProxyFallback')
            runtime['run'](['systemctl', 'enable', '--now', old_unit + '.socket'])
            result['oldPausedProxyRestored'] = True
        elif proxy_switched and old_stopped and owner_resume:
            result['rollback'] = paused_rollback(data,runtime,store,stage,prior,pause_repair=pause_repair,schedule_repair=schedule_repair)

    try:
        result['preContainment'] = check_containment(data, runtime, store, stage, 'pre')
        result['preQueueBoundary'] = verify_live(data, recovery, store, function_scope(recovery))
        names = runtime['run'](['docker', 'ps', '-a', '--format', '{{.Names}}']).splitlines()
        if worker_name in names or worker_compose.exists() or any((SYSTEMD / name).exists() for name in units('10.0.0.1', unit=new_unit)):
            raise RecoveryError('ReceiptRepairRuntimeExists_NoReplay')
        original = json.loads(runtime['run'](['docker', 'inspect', old_name]))[0]
        network = json.loads(runtime['run'](['docker', 'inspect', '--type', 'network', 'ir35-staging_backend']))[0]
        old_address = isolation(original, prior['image'], network)
        if not original['State']['Running'] or digest(old_compose.read_bytes()) != prior['composeSHA256']:
            raise RecoveryError('PausedOriginalImageAndComposeMustRemainIntact')
        for filename, expected in prior['unitSHA256'].items():
            path = SYSTEMD / filename
            if path.is_symlink() or digest(path.read_bytes()) != expected:
                raise RecoveryError('OriginalProxyUnitsChanged_NoOverwrite')
        validate_config(private_env(ROOT / '.env.p6-mock-worker'))
        old_health = control.request('GET', '/health')[1]
        if (old_health.get('ok') is not True or old_health.get('buildSHA') != prior['sourceSHA']
                or old_health.get('paused') is not True or old_health.get('active') != 0):
            raise RecoveryError('FailedLifecycleMustRemainPausedAndIdle')
        counts = json.loads(recovery.query("""SELECT jsonb_build_object(
         'pendingApplications',(SELECT count(*) FROM pgboss.ir35_mock_application WHERE state IN ('queued','running','submitting')),
         'pendingJobs',(SELECT count(*) FROM pgboss.job WHERE name IN ('ir35-staging-mock-apply','ir35-staging-mock-schedule') AND state IN ('created','retry','active')),
         'ownerConnections',(SELECT count(*) FROM pg_stat_activity WHERE usename='ir35_queue'),
         'producerConnections',(SELECT count(*) FROM pg_stat_activity WHERE usename='ir35_queue_producer'));""", 'postgres'))
        if counts['pendingApplications'] or counts['pendingJobs'] or counts['ownerConnections'] > 2 or counts['producerConnections'] > 1:
            raise RecoveryError('IdleQueueAndExistingConnectionBudgetRequired')
        result['preflightQueueCounts'] = counts
        preview = units('10.0.0.1', unit=new_unit + '-preflight')
        for name, body in preview.items():
            store.put(stage, name, body.encode())
        with store.sink(stage, 'preflight-systemd.log') as log:
            if subprocess.run(['systemd-analyze', 'verify', *[str(stage / name) for name in preview]], stdout=log, stderr=log, timeout=20).returncode:
                raise RecoveryError('ReceiptProxyPreflightFailed_NoRuntimeChange')
        value = configuration(build['image'], build['sourceSHA'],owner_resume=owner_resume,pause_repair=pause_repair,schedule_repair=schedule_repair)
        store.put(stage, 'intent.json', json.dumps({'newImage': build['image'], 'sourceSHA': build['sourceSHA'],
            'repairAttempt': 1, 'newStartsAllowed': 1, 'oldImageAndFailedJournalsRetained': True, 'newSecrets': False}).encode())
        if owner_resume:
            with worker_compose.open('x') as output:json.dump(value,output,indent=2)
        else:
            with COMPOSE.open('x') as output:
                json.dump(value,output,indent=2)
        os.chmod(worker_compose, 0o644)
        result['composeSHA256'] = digest(worker_compose.read_bytes())
        with store.sink(stage, 'compose-validation.log') as log:
            if subprocess.run(['docker', 'compose', '--env-file', str(ROOT / '.env'), '-f', str(worker_compose), 'config', '--quiet'], stdout=log, stderr=log, timeout=30).returncode:
                raise RecoveryError('ReceiptComposeValidationFailed_NoRuntimeChange')
        proxy_switched = True
        runtime['run'](['systemctl', 'stop', old_unit + '.socket', old_unit + '.service'])
        requested = True
        with store.sink(stage, 'start-new-worker.log') as log:
            if subprocess.run(['docker', 'compose', '--env-file', str(ROOT / '.env'), '-f', str(worker_compose), 'up', '-d', '--no-deps', 'worker'], stdout=log, stderr=log, timeout=120).returncode:
                raise RecoveryError('ReceiptWorkerStartFailed_PrivateLog')
        result['newWorkerStarts'] = 1
        item = json.loads(runtime['run'](['docker', 'inspect', worker_name]))[0]
        address = isolation(item, build['image'], network)
        if item['HostConfig'].get('Init') is not True or item['Config']['Entrypoint'] != value['services']['worker']['entrypoint']:
            raise RecoveryError('ReceiptWorkerInitOrPublicSHAOverrideMismatch')
        bodies = units(address, unit=new_unit)
        for filename, body in bodies.items():
            write_unit(SYSTEMD / filename, body, unit=new_unit)
            installed.append(filename)
            store.put(stage, filename, body.encode())
        result['unitSHA256'] = {name: digest(body.encode()) for name, body in bodies.items()}
        with store.sink(stage, 'installed-systemd.log') as log:
            if subprocess.run(['systemd-analyze', 'verify', *[str(SYSTEMD / name) for name in bodies]], stdout=log, stderr=log, timeout=20).returncode:
                raise RecoveryError('ReceiptProxyValidationFailed')
        runtime['run'](['systemctl', 'daemon-reload'])
        runtime['run'](['systemctl', 'enable', '--now', new_unit + '.socket'])
        deadline = time.monotonic() + 90
        while True:
            try:
                health = control.request('GET', '/health')[1]
                if health.get('ok') is True:
                    break
            except RecoveryError:
                pass
            if time.monotonic() >= deadline:
                raise RecoveryError('ReceiptWorkerHealthDeadline')
            time.sleep(1)
        if (health.get('buildSHA') != build['sourceSHA'] or any(health.get(key) is not True for key in ('ok', 'browserReady', 'databaseReady'))
                or health.get('mode') != 'staging-mock-only' or health.get('realAcceptance') is not False):
            raise RecoveryError('ReceiptWorkerHealthIdentityMismatch')
        if owner_resume and health.get('paused') is not True:raise RecoveryError('ResumedHandoverMustStartProcessingPaused')
        validate_proxy(runtime, bodies, unit=new_unit)
        runtime['run'](['docker', 'stop', '--time', '30', old_name], timeout=45)
        old_stopped = True
        runtime['run'](['systemctl', 'disable', old_unit + '.socket'])
        until = time.monotonic() + 30
        while True:
            heartbeat = json.loads(recovery.query("SELECT jsonb_build_object('sourceSHA',build_sha,'fresh',seen_at>clock_timestamp()-interval '45 seconds','active',active) FROM pgboss.ir35_mock_heartbeat WHERE id='staging_mock_worker';", 'postgres'))
            if heartbeat == {'sourceSHA': build['sourceSHA'], 'fresh': True, 'active': 0}:
                break
            if time.monotonic() >= until:
                raise RecoveryError('ReceiptRepairHeartbeatNotConfirmed')
            time.sleep(1)
        available = int(re.search(r'^MemAvailable:\s+(\d+)', Path('/proc/meminfo').read_text(), re.M)[1])
        if available < 2 * 1024 * 1024:
            raise RecoveryError('ReceiptRepairOSHeadroomBelowTwoGiB')
        prepared(data)
        result['queueRoleCustomerAccess'] = no_customer_access(recovery)
        result['postQueueBoundary'] = verify_live(data, recovery, store, function_scope(recovery))
        result['containment'] = check_containment(data, runtime, store, stage, 'post')
        result.update(status='PASS', sourceSHA=build['sourceSHA'], image=build['image'], health=health,
            durableHeartbeat=heartbeat, hostMemoryAvailableKiB=available, containerName=worker_name, composePath=str(worker_compose),ownerResume=owner_resume,
            oldWorkerStopped=True, oldArtifactsRetained=True, originalEnvUnchanged=True, loopbackOnly=True,pauseRepair=pause_repair,scheduleRepair=schedule_repair)
    except Exception as error:
        result['code'] = str(error) if isinstance(error, RecoveryError) else type(error).__name__
        try:
            rollback()
        except Exception as rollback_error:
            result['rollbackError'] = str(rollback_error) if isinstance(rollback_error, RecoveryError) else type(rollback_error).__name__
        try:
            result['failureContainment'] = check_containment(data, runtime, store, stage, 'failure')
        except Exception as containment_error:
            result['failureContainment'] = {'status': 'FAIL', 'code': type(containment_error).__name__}
    store.put(stage, 'result.json', json.dumps(result, sort_keys=True).encode())
    return result | {'stage': stage.name, 'manifestSHA256': store.seal(stage)}
