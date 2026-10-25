"""Explicit bounded image3 handover after actual receipt repair proof."""
import json
import subprocess
import sys
import cloud_schema as schema
import p6_context
import p6_worker_build
from p6_hba import credential_gate
from web_build import git_command


def main():
    if sys.argv[1:] != ['--activate-receipt-repair-one']:
        raise RuntimeError('ExplicitReceiptRepairHandoverRequired')
    directory = schema.REPO / 'docs/evidence/p6'
    destination = directory / 'mock-receipt-repair-one-handover.json'
    if destination.exists():
        raise RuntimeError('ReceiptRepairHandoverRecorded_NoReplay')
    build = json.loads((directory / 'worker-build-3-source-repair-one.json').read_text())
    if build.get('status') != 'PASS' or build.get('attempt') != 3:
        raise RuntimeError('VerifiedFinalBuildThreeRequired')
    credential_gate()
    data = p6_context.context()
    git = git_command(schema.REPO)
    if subprocess.run(git + ['diff', '--quiet', build['sourceSHA'], 'HEAD', '--', 'src/lib/queue', 'services/application-worker',
                            'package.json', 'package-lock.json', 'supabase/operations/pgboss-producer-grants.sql']).returncode:
        raise RuntimeError('RuntimeChangedSinceFinalBuild_NoActivation')
    for name, path in [('p6Inventory', 'p6-inventory.json'), ('rolePreflight', 'p6-role-preflight.json'), ('roleInstall', 'p6-role-install.json')]:
        data[name] = json.loads((schema.REPO / 'docs/evidence' / path).read_text())
    data['workerBuild'] = build
    for name, filename in [('mockPrepare', 'mock-prepare.json'), ('ownerHBABoundary', 'queue-hba-owner-boundary.json'),
                           ('scopeFailure', 'mock-runtime-update-two.json'), ('runtimeProof', 'mock-runtime-update-two-owner-boundary.json'),
                           ('failureLifecycle', 'native-mock-lifecycle.json'), ('receiptRepairProbe', 'isolated-receipt-repair-one.json')]:
        data[name] = json.loads((directory / filename).read_text())
    script = p6_worker_build.bundle()
    for name in ('p6_roles_guest', 'p6_mock_guest', 'p6_health_repair_guest', 'p6_mock_control', 'p6_queue_function_scope',
                 'p6_queue_hba', 'p6_hba_guest', 'p6_queue_boundary_gate', 'p6_mock_update_guest', 'p6_mock_receipt_repair_guest'):
        code = (schema.REPO / 'infra/oracle' / (name + '.py')).read_text()
        script += 'module=types.ModuleType(' + repr(name) + ');sys.modules[' + repr(name) + ']=module\nexec(' + repr(code) + ',module.__dict__)\n'
    script += 'result=sys.modules["p6_mock_receipt_repair_guest"].run(' + repr(data) + ',runtime)\nprint(json.dumps(result))\n'
    result = schema.run_guest(script, timeout=600)
    with destination.open('x', encoding='utf-8') as output:
        json.dump(result, output, indent=2)
    print(json.dumps({key: result.get(key) for key in ('status', 'code', 'containment', 'failureContainment', 'manifestSHA256')}))
    if result['status'] != 'PASS':
        raise SystemExit(1)


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(json.dumps({'status': 'STOP', 'code': str(error) if isinstance(error, RuntimeError) else type(error).__name__}))
        raise SystemExit(1)
