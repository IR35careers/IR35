"""Owner-requested read-only pause/activity proof BEFORE the PID/status repairs."""
import json
import sys

import cloud_schema as schema
import p6_context
import p6_worker_build
from p6_audit_log import AuditFailure, Journal, sha
from p6_status_audit import MODULES
from p6_pause_reconcile_guest import CASES
from ssh_agent_session import ensure_agent


def remote_case(name, data):
    script = 'import json,types,sys,subprocess\n'
    script += 'audit_log=types.ModuleType("p6_audit_log");exec(' + repr((schema.REPO / 'infra/oracle/p6_audit_log.py').read_text()) + ',audit_log.__dict__)\n'
    script += 'trace=audit_log.CommandTrace(subprocess.run)\nsubprocess.run=trace\n'
    bootstrap = p6_worker_build.bundle()
    for module in (*MODULES, 'p6_pause_reconcile_guest'):
        bootstrap += 'module=types.ModuleType(' + repr(module) + ');sys.modules[' + repr(module) + ']=module\nexec(' + repr((schema.REPO / 'infra/oracle' / (module + '.py')).read_text()) + ',module.__dict__)\n'
    script += 'try:\n exec(' + repr(bootstrap) + ')\n result=sys.modules["p6_pause_reconcile_guest"].run_case(' + repr(name) + ',' + repr(data) + ',runtime)\n'
    script += 'except Exception as error:\n result={"status":"ERROR","exceptionType":type(error).__name__,"rawErrorWithheld":True}\n'
    script += 'result.update(operation=' + repr(name) + ',commands=trace.observations,vmWrites=0)\nprint(json.dumps(result))\n'
    return schema.run_guest(script, timeout=360 if name == 'full-containment' else 120)


def main():
    if sys.argv[1:] not in (['--read-only'], ['--read-only', '--attempt', '2']):
        raise AuditFailure('ExplicitReadOnlyPauseReconciliationRequired')
    attempt = 2 if sys.argv[1:] == ['--read-only', '--attempt', '2'] else 1
    root = schema.REPO / ('docs/evidence/p6/pause-reconciliation-20261026-' + f'{attempt:02d}')
    if root.exists():
        raise AuditFailure('ReconciliationAlreadyRecorded_NoOverwrite')
    previous = None
    if attempt == 2:
        previous = verify_first_tooling_failure(root.with_name('pause-reconciliation-20261026-01'))
    if ensure_agent().get('keyLoaded') is not True:
        raise AuditFailure('ExistingMatchingSSHIdentityRequired_NoAutomaticPrompt')
    data = p6_context.context()
    directory = schema.REPO / 'docs/evidence/p6'
    for key, filename in [('mockPrepare', 'mock-prepare.json'), ('currentFailure', 'native-mock-lifecycle-repair-one.json'),
                          ('failureLifecycle', 'native-mock-lifecycle.json'), ('runtimeProof', 'mock-receipt-repair-one-handover.json'),
                          ('ownerHBABoundary', 'queue-hba-owner-boundary.json'), ('scopeFailure', 'mock-runtime-update-two.json'),
                          ('priorDiagnosis', 'docker-top-owner-diagnosis-one-observed.json')]:
        data[key] = json.loads((directory / filename).read_text())
    journal = Journal(root)
    result = {'status': 'FAIL', 'phaseComplete': False, 'vmWrites': 0, 'repairsStarted': 0, 'attempt': attempt,
              'previousFailureManifestSHA256': previous,
              'processingFlagChanges': 0, 'productionChanges': False, 'steps': []}
    try:
        for index, name in enumerate(CASES, 1):
            def action():
                return remote_case(name, data)
            observed = journal.step(index, name, action)
            result['steps'].append({'case': name, 'status': observed['status']})
            if name == 'application-ledger':
                before = observed['ledgerSHA256']
            if name == 'ledger-after' and observed['ledgerSHA256'] != before:
                raise AuditFailure('PauseReconciliationLedgerChanged_SecurityStop')
        result['status'] = 'PASS'
    except AuditFailure as error:
        result['code'] = str(error)
    result['manifestSHA256'] = journal.seal(result)
    print(json.dumps(result))
    if result['status'] != 'PASS':
        raise SystemExit(1)


def verified_manifest(root):
    body = (root / 'manifest.json').read_bytes()
    manifest = json.loads(body)
    expected = {'manifest.json'}
    for row in manifest['artifacts']:
        if row['name'] in expected or not row['name'].endswith('.json') or '/' in row['name'] or '\\' in row['name']:
            raise AuditFailure('PreviousReconciliationManifestInvalid')
        expected.add(row['name'])
        path = root / row['name']
        if path.is_symlink() or sha(path.read_bytes()) != row['sha256']:
            raise AuditFailure('PreviousReconciliationArtifactMismatch')
    if {p.name for p in root.iterdir()} != expected:
        raise AuditFailure('PreviousReconciliationUnmanifestedArtifact')
    return sha(body)


def verify_first_tooling_failure(root):
    anchor = verified_manifest(root)
    prior = json.loads((root / 'result.json').read_bytes())
    failed = json.loads((root / '05-full-containment-result.json').read_bytes())
    if (prior.get('status') != 'FAIL' or prior.get('code') != 'ReadOnlyAuditFailed_full-containment'
            or failed.get('status') != 'ERROR' or failed.get('exceptionType') != 'AuditFailure'
            or failed.get('commands', [{}])[-1] != {'code': 'ReadOnlyCommandNotAllowed', 'operation': 'rejected-before-execution', 'status': 'FAIL'}):
        raise AuditFailure('PreviousReconciliationNotExactReadOnlyToolingFailure_Stop')
    return anchor


def verify_passed_reconciliation(root):
    anchor = verified_manifest(root)
    result = json.loads((root / 'result.json').read_bytes())
    if (anchor != '5cc51791a86c13913296bd2707c54e279728822e67911b81bd6ff57d81f4d23a'
            or result.get('status') != 'PASS' or result.get('vmWrites') != 0
            or result.get('steps') != [{'case': case, 'status': 'PASS'} for case in CASES]):
        raise AuditFailure('ActualReadOnlyPauseReconciliationPassRequired')
    return anchor


if __name__ == '__main__':
    main()
