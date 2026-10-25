"""Guarded image-two handover. Old image/env/unit files remain immutable."""
import json
import os
from pathlib import Path
import re
import subprocess
import time
import urllib.error

from immutable_artifacts import digest
from p4_recovery_guest import Recovery, RecoveryError
from p6_mock_guest import ROOT, NAME, compose, prerequisites, prepared, check_containment, health, validate_config
from p6_health_repair_guest import SYSTEMD, UNIT, UPDATE_UNIT, units, write_unit, isolation, validate_proxy
from p6_mock_control import Control
from p6_roles_guest import no_customer_access
from web_edge_guest import private_env
from p6_queue_function_scope import audit as function_scope

NEW_NAME = 'ir35-p6-mock-worker-v2'
NEW_COMPOSE = ROOT / 'p6-mock-compose-v2.yml'


def compose_two(image, sha):
    if not re.fullmatch(r'[a-f0-9]{40}', sha):
        raise RecoveryError('ImmutableBuildTwoSourceRequired')
    value = compose(image)
    value['name'] = 'ir35-p6-mock-v2'
    service = value['services']['worker']
    service.update(container_name=NEW_NAME, init=True)
    # Only the PUBLIC build SHA is overridden. Original mode600 env/HMAC/DB
    # credentials stay unchanged on the VM; no secret copying or rotation.
    service['entrypoint'] = ['/run/ir35/env-exec', '/opt/ir35/.env.p6-mock-worker', '/usr/bin/env',
                            'IR35_BUILD_SHA=' + sha, 'node', '--import', 'tsx', 'services/application-worker/mock-main.ts', '--run']
    return value


def run(data, runtime):
    prerequisites(data, runtime)
    store = prepared(data)
    health_proof = data['healthRepair']
    store.verify(health_proof['stage'], health_proof['manifestSHA256'])
    build = data['workerBuild']
    old_build = data['originalWorkerBuild']
    if (build.get('attempt') != 2 or build.get('status') != 'PASS' or build.get('image') == old_build.get('image')
            or health_proof.get('status') != 'PASS' or health_proof.get('containment', {}).get('status') != 'PASS'):
        raise RecoveryError('VerifiedDistinctBuildTwoAndHealthyOriginalRequired')
    stage = store.stage('09-mock-runtime-update-two')
    result = {'status': 'FAIL', 'newWorkerStarts': 0, 'networkChanges': 0, 'secretChanges': 0,
              'sourceRoleChanges': 0, 'customerWrites': 0, 'productionChanges': False, 'realAcceptance': False}
    new_requested = False
    old_proxy_stopped = False
    old_stopped = False
    new_units = []
    old_address = None
    control = None

    def rollback():
        # No retry of the new runtime and no deletion/recreation of either
        # container, env, old Compose or old units. Stop only exact owned image.
        names = runtime['run'](['docker', 'ps', '-a', '--format', '{{.Names}}']).splitlines()
        if new_requested and NEW_NAME in names:
            item = json.loads(runtime['run'](['docker', 'inspect', NEW_NAME]))[0]
            if item['Image'] != build['image']:
                result['rollbackError'] = 'NewContainerIdentityMismatch_NoSignal'
                return
            with store.sink(stage, 'stop-new-worker.log') as log:
                result['newWorkerStoppedAfterFailure'] = subprocess.run(['docker', 'stop', '--time', '30', NEW_NAME],
                    stdout=log, stderr=log, timeout=45).returncode == 0
        if new_units:
            with store.sink(stage, 'disable-new-proxy.log') as log:
                subprocess.run(['systemctl', 'disable', '--now', UPDATE_UNIT + '.socket'], stdout=log, stderr=log, timeout=25)
                subprocess.run(['systemctl', 'stop', UPDATE_UNIT + '.service'], stdout=log, stderr=log, timeout=20)
        if old_proxy_stopped and not old_stopped:
            item = json.loads(runtime['run'](['docker', 'inspect', NAME]))[0]
            if (item['State']['Running'] is True and item['Image'] == old_build['image']
                    and item['NetworkSettings']['Networks']['ir35-staging_backend']['IPAddress'] == old_address):
                runtime['run'](['systemctl', 'enable', '--now', UNIT + '.socket'])
                result['oldPausedProxyRestored'] = True
                # It remains PAUSED, not silently accepting more mock work.

    def safe_rollback():
        try:
            rollback()
        except Exception as error:
            result['rollbackError'] = str(error) if isinstance(error, RecoveryError) else type(error).__name__
        result['oldWorkerStoppedAfterFailure'] = old_stopped

    try:
        result['preContainment'] = check_containment(data, runtime, store, stage, 'pre')
        names = runtime['run'](['docker', 'ps', '-a', '--format', '{{.Names}}']).splitlines()
        if NEW_NAME in names or NEW_COMPOSE.exists() or any((SYSTEMD / name).exists() for name in units('10.0.0.1', unit=UPDATE_UNIT)):
            raise RecoveryError('BuildTwoActivationAlreadyExists_NoReplay')
        original = json.loads(runtime['run'](['docker', 'inspect', NAME]))[0]
        network = json.loads(runtime['run'](['docker', 'network', 'inspect', 'ir35-staging_backend']))[0]
        old_address = isolation(original, old_build['image'], network)
        if original['State']['Running'] is not True:
            raise RecoveryError('HealthyOriginalMustRemainAvailableForRollback')
        for name, expected in health_proof['unitSHA256'].items():
            path = SYSTEMD / name
            if path.is_symlink() or digest(path.read_bytes()) != expected:
                raise RecoveryError('OriginalProxyUnitChanged_NoOverwrite')
        environment = private_env(ROOT / '.env.p6-mock-worker')
        validate_config(environment)
        control = Control(private_env(ROOT / '.env.p6-mock-control')['APPLICATION_WORKER_SECRET'])
        original_health = control.request('GET', '/health')[1]
        if original_health.get('ok') is not True or original_health.get('buildSHA') != old_build['sourceSHA'] or original_health.get('active') != 0:
            raise RecoveryError('OriginalHealthyIdleMockRuntimeRequired')
        recovery = Recovery(data['p4'], runtime)
        result['queueFunctionScope'] = function_scope(recovery)
        store.put(stage, 'queue-function-scope.json', json.dumps(result['queueFunctionScope'], sort_keys=True).encode())
        if result['queueFunctionScope']['status'] != 'PASS':
            raise RecoveryError('QueueRoleDefinerAccessOutsideQueueSchema_SecurityStop')
        counts = json.loads(recovery.query("""SELECT jsonb_build_object(
          'ownerConnections',(SELECT count(*) FROM pg_stat_activity WHERE usename='ir35_queue'),
          'producerConnections',(SELECT count(*) FROM pg_stat_activity WHERE usename='ir35_queue_producer'),
          'pendingApplications',(SELECT count(*) FROM pgboss.ir35_mock_application WHERE state IN ('queued','running','submitting')),
          'pendingJobs',(SELECT count(*) FROM pgboss.job WHERE name IN ('ir35-staging-mock-apply','ir35-staging-mock-schedule') AND state IN ('created','retry','active'))
        );""", 'postgres').strip())
        if counts['ownerConnections'] > 2 or counts['producerConnections'] > 1 or counts['pendingApplications'] or counts['pendingJobs']:
            raise RecoveryError('HandoverNeedsIdleQueueAndExistingConnectionBudget_NoRoleChange')
        result['preflightQueueCounts'] = counts
        preview = units('10.0.0.1', unit=UPDATE_UNIT + '-preflight')
        for name, body in preview.items():
            store.put(stage, name, body.encode())
        with store.sink(stage, 'preflight-systemd-verify.log') as log:
            if subprocess.run(['systemd-analyze', 'verify', *[str(stage / name) for name in preview]], stdout=log, stderr=log, timeout=20).returncode:
                raise RecoveryError('BuildTwoProxyValidationFailed_NoServiceChange')
        value = compose_two(build['image'], build['sourceSHA'])
        store.put(stage, 'intent.json', json.dumps({'oldImage': old_build['image'], 'newImage': build['image'],
            'sourceSHA': build['sourceSHA'], 'newWorkerStartsAllowed': 1, 'existingEnvUnchanged': True,
            'oldWorkerPausedUntilNewHealthy': True, 'newNetworkOrSecrets': False}).encode())
        with NEW_COMPOSE.open('x') as output:
            json.dump(value, output, indent=2)
        os.chmod(NEW_COMPOSE, 0o644)
        result['composeSHA256'] = digest(NEW_COMPOSE.read_bytes())
        with store.sink(stage, 'compose-config-verify.log') as log:
            if subprocess.run(['docker', 'compose', '--env-file', str(ROOT / '.env'), '-f', str(NEW_COMPOSE),
                    'config', '--quiet'], stdout=log, stderr=log, timeout=30).returncode:
                raise RecoveryError('NewComposeValidationFailed_NoServiceChange')
        paused = control.request('POST', '/mock/maintenance', {'action': 'pause'})[1]
        old_health = control.request('GET', '/health')[1]
        if paused != {'paused': True, 'realAcceptance': False} or old_health.get('active') != 0 or old_health.get('paused') is not True:
            raise RecoveryError('OriginalMockDrainNotConfirmed')
        result['oldWorkerDrained'] = True
        old_proxy_stopped = True
        runtime['run'](['systemctl', 'stop', UNIT + '.socket', UNIT + '.service'])
        new_requested = True
        with store.sink(stage, 'compose-new-runtime.log') as log:
            if subprocess.run(['docker', 'compose', '--env-file', str(ROOT / '.env'), '-f', str(NEW_COMPOSE),
                    'up', '-d', '--no-deps', 'worker'], stdout=log, stderr=log, timeout=120).returncode:
                raise RecoveryError('NewMockContainerStartFailed_PrivateLog')
        result['newWorkerStarts'] = 1
        item = json.loads(runtime['run'](['docker', 'inspect', NEW_NAME]))[0]
        address = isolation(item, build['image'], network)
        if item['HostConfig'].get('Init') is not True or item['Config'].get('Entrypoint') != value['services']['worker']['entrypoint']:
            raise RecoveryError('NewWorkerMustUseInitAndOnlyPublicSHAOverride')
        bodies = units(address, unit=UPDATE_UNIT)
        for name, body in bodies.items():
            write_unit(SYSTEMD / name, body, unit=UPDATE_UNIT)
            new_units.append(name)
            store.put(stage, name, body.encode())
        result['unitSHA256'] = {name: digest(body.encode()) for name, body in bodies.items()}
        with store.sink(stage, 'active-systemd-verify.log') as log:
            if subprocess.run(['systemd-analyze', 'verify', *[str(SYSTEMD / name) for name in bodies]], stdout=log, stderr=log, timeout=20).returncode:
                raise RecoveryError('NewProxyValidationFailed_PrivateLog')
        runtime['run'](['systemctl', 'daemon-reload'])
        runtime['run'](['systemctl', 'enable', '--now', UPDATE_UNIT + '.socket'])
        observed = None
        deadline = time.monotonic() + 90
        while time.monotonic() < deadline:
            try:
                observed = health()
                if observed.get('ok') is True:
                    break
            except (urllib.error.URLError, TimeoutError, ConnectionError):
                pass
            time.sleep(2)
        if (not observed or any(observed.get(key) is not True for key in ('ok', 'browserReady', 'databaseReady'))
                or observed.get('realAcceptance') is not False or observed.get('mode') != 'staging-mock-only'
                or observed.get('buildSHA') != build['sourceSHA']):
            raise RecoveryError('NativeBuildTwoHealthMismatch')
        validate_proxy(runtime, bodies, unit=UPDATE_UNIT)
        item = json.loads(runtime['run'](['docker', 'inspect', NEW_NAME]))[0]
        if isolation(item, build['image'], network) != address:
            raise RecoveryError('NewMockIsolationChangedDuringHandover')
        available = int(re.search(r'^MemAvailable:\s+(\d+)', Path('/proc/meminfo').read_text(), re.M)[1])
        if available < 2 * 1024 * 1024:
            raise RecoveryError('MockHandoverOSHeadroomBelowTwoGiB')
        # Only after the new runtime is healthy, stop (never remove) the old
        # paused container, retaining its immutable image/env/Compose/units.
        runtime['run'](['docker', 'stop', '--time', '30', NAME])
        old_stopped = True
        runtime['run'](['systemctl', 'disable', UNIT + '.socket'])
        heartbeat = None
        heartbeat_deadline = time.monotonic() + 30
        while time.monotonic() < heartbeat_deadline:
            heartbeat = json.loads(recovery.query("""SELECT jsonb_build_object('sourceSHA',build_sha,
              'fresh',seen_at>clock_timestamp()-interval '45 seconds','active',active)
              FROM pgboss.ir35_mock_heartbeat WHERE id='staging_mock_worker';""", 'postgres').strip())
            if heartbeat.get('sourceSHA') == build['sourceSHA'] and heartbeat.get('fresh') is True and heartbeat.get('active') == 0:
                break
            time.sleep(1)
        if not heartbeat or heartbeat.get('sourceSHA') != build['sourceSHA'] or heartbeat.get('fresh') is not True or heartbeat.get('active') != 0:
            raise RecoveryError('NewRuntimeDurableHeartbeatNotConfirmed')
        prepared(data)  # Original env, credentials and old Compose still match.
        result['queueRoleCustomerAccess'] = no_customer_access(recovery)
        result.update(status='PASS', health=observed, oldWorkerStopped=True, oldArtifactsRetained=True,
                      loopbackOnly=True, noNewEgress=True, initReapsOrphans=True, originalEnvUnchanged=True,
                      hostMemoryAvailableKiB=available, oldImage=old_build['image'], image=build['image'], sourceSHA=build['sourceSHA'],
                      durableHeartbeat=heartbeat)
    except Exception as error:
        result.update(status='FAIL', code=str(error) if isinstance(error, RecoveryError) else type(error).__name__)
        safe_rollback()
    try:
        result['containment'] = check_containment(data, runtime, store, stage, 'post')
    except Exception as error:
        if result['status'] == 'PASS':
            safe_rollback()
        result.update(status='FAIL', containmentError=str(error) if isinstance(error, RecoveryError) else type(error).__name__)
    store.put(stage, 'result.json', json.dumps(result, sort_keys=True).encode())
    return result | {'stage': stage.name, 'manifestSHA256': store.seal(stage)}
