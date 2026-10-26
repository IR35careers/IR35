"""Owner-requested read-only pause/activity proof BEFORE the PID/status repairs."""
import json
import sys

import cloud_schema as schema
import p6_context
import p6_worker_build
from p6_audit_log import AuditFailure, Journal
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
    if sys.argv[1:] != ['--read-only']:
        raise AuditFailure('ExplicitReadOnlyPauseReconciliationRequired')
    root = schema.REPO / 'docs/evidence/p6/pause-reconciliation-20261026-01'
    if root.exists():
        raise AuditFailure('ReconciliationAlreadyRecorded_NoOverwrite')
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
    result = {'status': 'FAIL', 'phaseComplete': False, 'vmWrites': 0, 'repairsStarted': 0,
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


if __name__ == '__main__':
    main()
