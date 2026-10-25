"""Read-only probe reconciliation + full containment. No restart/create/delete."""
import json
import os
from pathlib import Path
import stat

from immutable_artifacts import Store, digest
from p4_recovery_guest import Recovery, RecoveryError
from p6_mock_guest import prerequisites, prepared, check_containment, ROOT, NAME
from p6_port_probe_guest import PROBE
from p6_roles_guest import no_customer_access

JOURNAL = ROOT / '.env.p6-bastion-owner1-20261025'


def run(data, runtime):
    original = prerequisites(data, runtime)
    prepared(data)
    failed = data['failedStart']
    original.verify(failed['stage'], failed['manifestSHA256'])
    if failed.get('status') != 'FAIL' or failed.get('stoppedAfterFailure') is not True:
        raise RecoveryError('OriginalStoppedHealthFailureRequired')
    journal = ROOT / '.env.p6-bastion-after-exact-20261025' if data.get('ownerSessionAfterExact') is True else JOURNAL
    if data.get('ownerTokenReopen') is True:
        journal = ROOT / ('.env.p6-bastion-token-post-close-20261025' if data.get('ownerContainmentAfterClose') is True else '.env.p6-bastion-token-reopen-20261025')
    journal.mkdir(mode=0o700)
    os.chown(journal, 1002, 1002)
    store = Store(journal, uid=1002)
    stage = store.stage('01-reconcile')
    result = {'status': 'FAIL', 'workerRestarts': 0, 'probeCreates': 0, 'probeDeletes': 0,
              'secretChanges': 0, 'customerWrites': 0, 'productionChanges': False, 'realAcceptance': False}
    try:
        store.put(stage, 'intent.json', json.dumps({'operation': 'read-only reconcile 23:40 intent then full containment',
                  'unknownStage': '07-network-diagnose', 'probe': PROBE, 'worker': NAME}).encode())
        names = runtime['run'](['docker', 'ps', '-a', '--format', '{{.Names}}']).splitlines()
        unknown = original.root / '07-network-diagnose'
        probe_exists = PROBE in names
        state = {'stageExists': unknown.exists(), 'probeExists': probe_exists}
        if unknown.is_symlink():
            raise RecoveryError('ProbeJournalSymlinkMismatch')
        if unknown.exists():
            manifest = unknown / 'manifest.json'
            if not manifest.is_file() or stat.S_IMODE(unknown.stat().st_mode) != 0o500:
                store.put(stage, 'probe-observation.json', json.dumps(state | {'execution': 'PARTIAL_UNKNOWN'}).encode())
                raise RecoveryError('ProbeIntentPartial_ReconcileWithoutReplay')
            anchor = digest(manifest.read_bytes())
            original.verify('07-network-diagnose', anchor)
            previous = json.loads((unknown / 'result.json').read_bytes())
            state.update(execution='RAN', manifestSHA256=anchor, priorStatus=previous.get('status'),
                         priorCode=previous.get('code'), newlyAuthenticatedReadback=True)
            store.put(stage, 'probe-observation.json', json.dumps(state).encode())
            if previous.get('status') != 'PASS' or previous.get('containment', {}).get('status') != 'PASS' or probe_exists:
                raise RecoveryError('RecordedProbeFailedOrNotCleaned_NoRetry')
            result['probe'] = state
        else:
            state['execution'] = 'NOT_RUN' if not probe_exists else 'UNKNOWN_ORPHAN'
            store.put(stage, 'probe-observation.json', json.dumps(state).encode())
            if probe_exists:
                raise RecoveryError('ProbeWithoutOwnedIntent_NoReplayOrDelete')
            # The old helper creates this durable stage BEFORE any Docker
            # mutation and never removes it. Both absence checks are required.
            result['probe'] = state | {'reachedProbeCreate': False, 'replayed': False}
        worker = json.loads(runtime['run'](['docker', 'inspect', NAME]))[0]
        observation = {'state': worker['State']['Status'], 'running': worker['State']['Running'],
                       'imageMatches': worker['Image'] == data['workerBuild']['image'], 'restarts': worker['RestartCount']}
        store.put(stage, 'worker-observation.json', json.dumps(observation).encode())
        if observation != {'state': 'exited', 'running': False, 'imageMatches': True, 'restarts': 0}:
            raise RecoveryError('StoppedWorkerIdentityOrStateMismatch')
        result['worker'] = observation
        result['queueRoleCustomerAccess'] = no_customer_access(Recovery(data['p4'], runtime))
        result['status'] = 'PASS'
    except Exception as error:
        result['code'] = str(error) if isinstance(error, RecoveryError) else type(error).__name__
    try:
        result['containment'] = check_containment(data, runtime, store, stage, 'post')
    except Exception as error:
        result.update(status='FAIL', containmentError=str(error) if isinstance(error, RecoveryError) else type(error).__name__)
    store.put(stage, 'result.json', json.dumps(result, sort_keys=True).encode())
    return result | {'stage': stage.name, 'manifestSHA256': store.seal(stage)}
