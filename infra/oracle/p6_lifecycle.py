"""Explicit one-run native mock lifecycle, no production/real submissions."""
import json
import sys
import cloud_schema as schema
import p6_context
import p6_worker_build
from p6_hba import credential_gate


def main():
    if sys.argv[1:] != ['--run-mock-lifecycle']:
        raise RuntimeError('ExplicitNativeMockLifecycleRequired')
    directory = schema.REPO / 'docs/evidence/p6'
    destination = directory / 'native-mock-lifecycle.json'
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
    script = p6_worker_build.bundle()
    for name in ('p6_roles_guest', 'p6_mock_guest', 'p6_health_repair_guest', 'p6_mock_control', 'p6_queue_function_scope',
                 'p6_queue_hba', 'p6_hba_guest', 'p6_queue_boundary_gate', 'p6_mock_update_guest', 'p6_lifecycle_guest'):
        code = (schema.REPO / 'infra/oracle' / (name + '.py')).read_text()
        script += 'module=types.ModuleType(' + repr(name) + ');sys.modules[' + repr(name) + ']=module\nexec(' + repr(code) + ',module.__dict__)\n'
    script += 'result=sys.modules["p6_lifecycle_guest"].run(' + repr(data) + ',runtime)\nprint(json.dumps(result))\n'
    result = schema.run_guest(script, timeout=900)
    with destination.open('x', encoding='utf-8') as output:
        json.dump(result, output, indent=2)
    print(json.dumps({key: result.get(key) for key in ('status', 'code', 'scenarios', 'workerRestarts', 'containment', 'failureContainment', 'manifestSHA256')}))
    if result['status'] != 'PASS':
        raise SystemExit(1)


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(json.dumps({'status': 'STOP', 'code': str(error) if isinstance(error, RuntimeError) else type(error).__name__}))
        raise SystemExit(1)
