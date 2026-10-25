"""ONE explicit owner-approved staging HBA repair; never replay stage09."""
import json
import sys

import cloud_schema as schema
import p6_context
import p6_worker_build


def main():
    if sys.argv[1:] not in (['--apply-owner-queue-boundary'], ['--inspect-owner-boundary']):
        raise RuntimeError('ExplicitOwnerQueueBoundaryRequired')
    inspecting = sys.argv[1:] == ['--inspect-owner-boundary']
    directory = schema.REPO / 'docs/evidence/p6'
    destination = directory / ('queue-hba-owner-inspect.json' if inspecting else 'queue-hba-owner-boundary.json')
    if destination.exists():
        raise RuntimeError('QueueBoundaryAlreadyRecorded_NoReplay')
    data = p6_context.context()
    for name, path in [('p6Inventory', 'p6-inventory.json'), ('rolePreflight', 'p6-role-preflight.json'), ('roleInstall', 'p6-role-install.json')]:
        data[name] = json.loads((schema.REPO / 'docs/evidence' / path).read_text())
    data.update(mockPrepare=json.loads((directory / 'mock-prepare.json').read_text()),
                scopeFailure=json.loads((directory / 'mock-runtime-update-two.json').read_text()))
    script = p6_worker_build.bundle()
    for name in ('p6_roles_guest', 'p6_mock_guest', 'p6_queue_function_scope', 'p6_queue_hba', 'p6_hba_guest'):
        code = (schema.REPO / 'infra/oracle' / (name + '.py')).read_text()
        script += 'module=types.ModuleType(' + repr(name) + ');sys.modules[' + repr(name) + ']=module\nexec(' + repr(code) + ',module.__dict__)\n'
    operation = 'inspect_only' if inspecting else 'run'
    script += 'result=sys.modules["p6_hba_guest"].' + operation + '(' + repr(data) + ',runtime)\nprint(json.dumps(result))\n'
    result = schema.run_guest(script, timeout=900)
    with destination.open('x', encoding='utf-8') as output:
        json.dump(result, output, indent=2)
    print(json.dumps(result if inspecting else {key: result.get(key) for key in ('status', 'code', 'manifestSHA256', 'queueOnlyConnectionBoundary', 'rollback', 'containment')}))
    if result['status'] != 'PASS':
        raise SystemExit(1)


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(json.dumps({'status': 'STOP', 'code': str(error) if type(error) is RuntimeError else type(error).__name__}))
        raise SystemExit(1)
