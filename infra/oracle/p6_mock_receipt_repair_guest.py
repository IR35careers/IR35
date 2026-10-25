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


def configuration(image, source):
    value = compose_two(image, source)
    value['name'] = 'ir35-p6-mock-v3'
    value['services']['worker']['container_name'] = NAME
    return value


def run(data, runtime):
    prerequisites(data, runtime)
    store = prepared(data)
    prior = data['runtimeProof']
    failure = data['failureLifecycle']
    probe = data['receiptRepairProbe']
    for report in (prior, failure, probe):
        anchored_result(store, report)
    if (prior.get('status') != 'PASS' or failure.get('code') != 'NativeMockTerminalOrHistoryMismatch_NoReadyFallback'
            or failure.get('failureContainment', {}).get('status') != 'PASS'
            or failure.get('failurePause') != {'paused': True, 'realAcceptance': False}
            or probe.get('status') != 'PASS' or probe.get('repairAttempt') != 1
            or probe.get('parentOneSubmissionGuardUnchanged') is not True):
        raise RecoveryError('ExactRetainedFailureAndSixScenarioProbeRequired')
    build = data['workerBuild']
    if build.get('attempt') != 3 or build.get('image') == prior.get('image'):
        raise RecoveryError('FinalVerifiedBuildThreeRequired')
    stage = store.stage('15-receipt-repair-one-handover')
    recovery = Recovery(data['p4'], runtime)
    control = Control(private_env(ROOT / '.env.p6-mock-control')['APPLICATION_WORKER_SECRET'])
    result = {'status': 'FAIL', 'repairAttempt': 1, 'newWorkerStarts': 0, 'realAcceptance': False,
              'customerWrites': 0, 'productionChanges': False, 'networkChanges': 0, 'secretChanges': 0, 'roleChanges': 0}
    requested = proxy_switched = old_stopped = False
    installed = []
    old_address = None

    def rollback():
        if requested:
            names = runtime['run'](['docker', 'ps', '-a', '--format', '{{.Names}}']).splitlines()
            if NAME in names:
                current = json.loads(runtime['run'](['docker', 'inspect', NAME]))[0]
                if current['Image'] != build['image']:
                    raise RecoveryError('NewRepairContainerIdentityMismatch_NoSignal')
                runtime['run'](['docker', 'stop', '--time', '30', NAME], timeout=45)
                result['newWorkerStoppedAfterFailure'] = True
        if installed:
            runtime['run'](['systemctl', 'disable', '--now', RECEIPT_UNIT + '.socket'])
            runtime['run'](['systemctl', 'stop', RECEIPT_UNIT + '.service'])
        if proxy_switched and not old_stopped:
            old = json.loads(runtime['run'](['docker', 'inspect', OLD_NAME]))[0]
            if (old['State']['Running'] is not True or old['Image'] != prior['image']
                    or old['NetworkSettings']['Networks']['ir35-staging_backend']['IPAddress'] != old_address):
                raise RecoveryError('OriginalPausedRuntimeChanged_NoProxyFallback')
            runtime['run'](['systemctl', 'enable', '--now', UPDATE_UNIT + '.socket'])
            result['oldPausedProxyRestored'] = True

    try:
        result['preContainment'] = check_containment(data, runtime, store, stage, 'pre')
        result['preQueueBoundary'] = verify_live(data, recovery, store, function_scope(recovery))
        names = runtime['run'](['docker', 'ps', '-a', '--format', '{{.Names}}']).splitlines()
        if NAME in names or COMPOSE.exists() or any((SYSTEMD / name).exists() for name in units('10.0.0.1', unit=RECEIPT_UNIT)):
            raise RecoveryError('ReceiptRepairRuntimeExists_NoReplay')
        original = json.loads(runtime['run'](['docker', 'inspect', OLD_NAME]))[0]
        network = json.loads(runtime['run'](['docker', 'inspect', '--type', 'network', 'ir35-staging_backend']))[0]
        old_address = isolation(original, prior['image'], network)
        if not original['State']['Running'] or digest(OLD_COMPOSE.read_bytes()) != prior['composeSHA256']:
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
        preview = units('10.0.0.1', unit=RECEIPT_UNIT + '-preflight')
        for name, body in preview.items():
            store.put(stage, name, body.encode())
        with store.sink(stage, 'preflight-systemd.log') as log:
            if subprocess.run(['systemd-analyze', 'verify', *[str(stage / name) for name in preview]], stdout=log, stderr=log, timeout=20).returncode:
                raise RecoveryError('ReceiptProxyPreflightFailed_NoRuntimeChange')
        value = configuration(build['image'], build['sourceSHA'])
        store.put(stage, 'intent.json', json.dumps({'newImage': build['image'], 'sourceSHA': build['sourceSHA'],
            'repairAttempt': 1, 'newStartsAllowed': 1, 'oldImageAndFailedJournalsRetained': True, 'newSecrets': False}).encode())
        with COMPOSE.open('x') as output:
            json.dump(value, output, indent=2)
        os.chmod(COMPOSE, 0o644)
        result['composeSHA256'] = digest(COMPOSE.read_bytes())
        with store.sink(stage, 'compose-validation.log') as log:
            if subprocess.run(['docker', 'compose', '--env-file', str(ROOT / '.env'), '-f', str(COMPOSE), 'config', '--quiet'], stdout=log, stderr=log, timeout=30).returncode:
                raise RecoveryError('ReceiptComposeValidationFailed_NoRuntimeChange')
        proxy_switched = True
        runtime['run'](['systemctl', 'stop', UPDATE_UNIT + '.socket', UPDATE_UNIT + '.service'])
        requested = True
        with store.sink(stage, 'start-new-worker.log') as log:
            if subprocess.run(['docker', 'compose', '--env-file', str(ROOT / '.env'), '-f', str(COMPOSE), 'up', '-d', '--no-deps', 'worker'], stdout=log, stderr=log, timeout=120).returncode:
                raise RecoveryError('ReceiptWorkerStartFailed_PrivateLog')
        result['newWorkerStarts'] = 1
        item = json.loads(runtime['run'](['docker', 'inspect', NAME]))[0]
        address = isolation(item, build['image'], network)
        if item['HostConfig'].get('Init') is not True or item['Config']['Entrypoint'] != value['services']['worker']['entrypoint']:
            raise RecoveryError('ReceiptWorkerInitOrPublicSHAOverrideMismatch')
        bodies = units(address, unit=RECEIPT_UNIT)
        for filename, body in bodies.items():
            write_unit(SYSTEMD / filename, body, unit=RECEIPT_UNIT)
            installed.append(filename)
            store.put(stage, filename, body.encode())
        result['unitSHA256'] = {name: digest(body.encode()) for name, body in bodies.items()}
        with store.sink(stage, 'installed-systemd.log') as log:
            if subprocess.run(['systemd-analyze', 'verify', *[str(SYSTEMD / name) for name in bodies]], stdout=log, stderr=log, timeout=20).returncode:
                raise RecoveryError('ReceiptProxyValidationFailed')
        runtime['run'](['systemctl', 'daemon-reload'])
        runtime['run'](['systemctl', 'enable', '--now', RECEIPT_UNIT + '.socket'])
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
        validate_proxy(runtime, bodies, unit=RECEIPT_UNIT)
        runtime['run'](['docker', 'stop', '--time', '30', OLD_NAME], timeout=45)
        old_stopped = True
        runtime['run'](['systemctl', 'disable', UPDATE_UNIT + '.socket'])
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
            durableHeartbeat=heartbeat, hostMemoryAvailableKiB=available, containerName=NAME, composePath=str(COMPOSE),
            oldWorkerStopped=True, oldArtifactsRetained=True, originalEnvUnchanged=True, loopbackOnly=True)
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
