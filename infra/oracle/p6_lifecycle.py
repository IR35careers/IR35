"""Explicit one-run native mock lifecycle, no production/real submissions."""
import json
import sys
import cloud_schema as schema
import p6_context
import p6_worker_build
from p6_hba import credential_gate


def main():
    if sys.argv[1:] not in (['--run-mock-lifecycle'], ['--probe-lost-ack'], ['--probe-receipt-repair-one'], ['--run-lifecycle-repair-one']):
        raise RuntimeError('ExplicitNativeMockLifecycleRequired')
    repair_one = sys.argv[1:] == ['--probe-receipt-repair-one']
    lifecycle_repair = sys.argv[1:] == ['--run-lifecycle-repair-one']
    probing = sys.argv[1:] in (['--probe-lost-ack'], ['--probe-receipt-repair-one'])
    directory = schema.REPO / 'docs/evidence/p6'
    destination = directory / ('native-mock-lifecycle-repair-one.json' if lifecycle_repair else 'isolated-receipt-repair-one.json' if repair_one else
                               'isolated-lost-ack-probe.json' if probing else 'native-mock-lifecycle.json')
    if destination.exists():
        raise RuntimeError('NativeMockLifecycleRecorded_NoReplay')
    credential_gate()
    data = p6_context.context()
    for name, path in [('p6Inventory', 'p6-inventory.json'), ('rolePreflight', 'p6-role-preflight.json'), ('roleInstall', 'p6-role-install.json')]:
        data[name] = json.loads((schema.REPO / 'docs/evidence' / path).read_text())
    for name, filename in [('mockPrepare', 'mock-prepare.json'), ('ownerHBABoundary', 'queue-hba-owner-boundary.json'),
                           ('scopeFailure', 'mock-runtime-update-two.json'), ('runtimeProof', 'mock-runtime-update-two-owner-boundary.json')]:
        data[name] = json.loads((directory / filename).read_text())
    if data['runtimeProof'].get('status') != 'PASS':
        raise RuntimeError('ActualMockHandoverPassRequired')
    if probing or lifecycle_repair:
        data['failureLifecycle'] = json.loads((directory / 'native-mock-lifecycle.json').read_text())
    if lifecycle_repair:
        data['runtimeProof'] = json.loads((directory / 'mock-receipt-repair-one-handover.json').read_text())
    if repair_one:
        data['originalBrowserProbe'] = json.loads((directory / 'isolated-lost-ack-probe.json').read_text())
        data['publicRepairSources'] = {name: (schema.REPO / 'services/application-worker' / name).read_text()
                                      for name in ('mock-browser.ts', 'mock-ats.ts')}
    script = p6_worker_build.bundle()
    for name in ('p6_roles_guest', 'p6_mock_guest', 'p6_health_repair_guest', 'p6_mock_control', 'p6_queue_function_scope',
                 'p6_queue_hba', 'p6_hba_guest', 'p6_queue_boundary_gate', 'p6_mock_update_guest', 'p6_lifecycle_guest'):
        code = (schema.REPO / 'infra/oracle' / (name + '.py')).read_text()
        script += 'module=types.ModuleType(' + repr(name) + ');sys.modules[' + repr(name) + ']=module\nexec(' + repr(code) + ',module.__dict__)\n'
    operation = 'probe_lost_ack' if probing else 'run'
    script += 'result=sys.modules["p6_lifecycle_guest"].' + operation + '(' + repr(data) + ',runtime' + (',repair_one=True' if repair_one or lifecycle_repair else '') + ')\nprint(json.dumps(result))\n'
    result = schema.run_guest(script, timeout=900)
    with destination.open('x', encoding='utf-8') as output:
        json.dump(result, output, indent=2)
    print(json.dumps(result if probing else {key: result.get(key) for key in ('status', 'code', 'scenarios', 'workerRestarts', 'containment', 'failureContainment', 'manifestSHA256')}))
    if result['status'] not in ('PASS', 'OBSERVED'):
        raise SystemExit(1)


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(json.dumps({'status': 'STOP', 'code': str(error) if isinstance(error, RuntimeError) else type(error).__name__}))
        raise SystemExit(1)
