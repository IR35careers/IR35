"""ONE owner-reopened read-only audit; each step sealed locally before proceeding."""
import json
import sys

import cloud_schema as schema
import p6_context
import p6_worker_build
from p6_audit_log import AuditFailure, Journal
from p6_hba import credential_gate

CASES = ('sealed-history', 'queue-before', 'worker-idle', 'smtp-empty', 'full-containment', 'queue-after')
MODULES = ('p6_roles_guest', 'p6_mock_guest', 'p6_health_repair_guest', 'p6_mock_control', 'p6_queue_function_scope',
           'p6_queue_hba', 'p6_hba_guest', 'p6_queue_boundary_gate', 'p6_mock_update_guest', 'p6_lifecycle_guest', 'p6_status_audit_guest')


def remote_case(name, data):
    logging = (schema.REPO / 'infra/oracle/p6_audit_log.py').read_text()
    script = 'import json,types,sys,subprocess\n'
    script += 'audit_log=types.ModuleType("p6_audit_log");exec(' + repr(logging) + ',audit_log.__dict__)\n'
    script += 'trace=audit_log.CommandTrace(subprocess.run)\nsubprocess.run=trace\n'
    bootstrap = p6_worker_build.bundle()
    for module in MODULES:
        bootstrap += 'module=types.ModuleType(' + repr(module) + ');sys.modules[' + repr(module) + ']=module\nexec(' + repr((schema.REPO / 'infra/oracle' / (module + '.py')).read_text()) + ',module.__dict__)\n'
    script += 'try:\n exec(' + repr(bootstrap) + ')\n result=sys.modules["p6_status_audit_guest"].run_case(' + repr(name) + ',' + repr(data) + ',runtime)\n'
    script += 'except Exception as error:\n result={"status":"FAIL","exceptionType":type(error).__name__,"rawErrorWithheld":True}\n'
    script += 'result.update(operation=' + repr(name) + ',commands=trace.observations,mutations=0)\nprint(json.dumps(result))\n'
    return schema.run_guest(script, timeout=360 if name == 'full-containment' else 120)


def main():
    if sys.argv[1:] != ['--owner-read-only-once']:
        raise AuditFailure('ExplicitOwnerReadOnlyAuditRequired')
    root = schema.REPO / 'docs/evidence/p6/status-owner-audit-two'
    if root.exists():
        raise AuditFailure('OwnerReadOnlyAuditAlreadyRecorded_NoRetry')
    credential_gate()
    data = p6_context.context()
    directory = schema.REPO / 'docs/evidence/p6'
    for key, name in [('mockPrepare', 'mock-prepare.json'), ('currentFailure', 'native-mock-lifecycle-repair-one.json'),
                      ('failureLifecycle', 'native-mock-lifecycle.json'), ('runtimeProof', 'mock-receipt-repair-one-handover.json'),
                      ('ownerHBABoundary', 'queue-hba-owner-boundary.json'), ('scopeFailure', 'mock-runtime-update-two.json')]:
        data[key] = json.loads((directory / name).read_text())
    journal = Journal(root)
    result = {'status': 'FAIL', 'auditAttempt': 2, 'retries': 0, 'vmWrites': 0, 'sourceWrites': 0,
              'workerRestarts': 0, 'configChanges': 0, 'newImageBuilds': 0, 'p6Reruns': 0, 'productionChanges': False,
              'steps': [], 'phaseComplete': False}
    try:
        for number, name in enumerate(CASES, 1):
            observed = journal.step(number, name, lambda: remote_case(name, data))
            result['steps'].append({'case': name, 'status': observed['status']})
            if name == 'queue-before':
                before = observed['ledgerSHA256']
            if name == 'queue-after' and observed['ledgerSHA256'] != before:
                raise AuditFailure('QueueLedgerChangedDuringReadOnlyAudit')
        result['status'] = 'PASS'
    except AuditFailure as error:
        result['code'] = str(error)
    result['manifestSHA256'] = journal.seal(result)
    print(json.dumps(result))
    if result['status'] != 'PASS':
        raise SystemExit(1)


if __name__ == '__main__':
    try:
        main()
    except (AuditFailure, RuntimeError) as error:
        print(json.dumps({'status': 'STOP', 'exceptionType': type(error).__name__, 'rawErrorWithheld': True}))
        raise SystemExit(1)
