"""Explicit build-two activation only; never a production/real-runner switch."""
import json
import subprocess
import sys
import cloud_schema as schema
import p6_context
import p6_worker_build
from web_build import git_command


def main():
    if sys.argv[1:] not in (['--activate-build-two'], ['--activate-build-two-after-owner-boundary']):
        raise RuntimeError('ExplicitBuildTwoMockActivationRequired')
    owner_boundary = sys.argv[1:] == ['--activate-build-two-after-owner-boundary']
    directory = schema.REPO / 'docs/evidence/p6'
    destination = directory / ('mock-runtime-update-two-owner-boundary.json' if owner_boundary else 'mock-runtime-update-two.json')
    if destination.exists():
        raise RuntimeError('BuildTwoActivationRecorded_NoReplay')
    if owner_boundary:
        # No new native slot is available until the actual owner-approved HBA
        # repair AND full native containment pass. Old failed09 is never reset.
        proof_path = directory / 'queue-hba-owner-boundary.json'
        if not proof_path.exists():
            raise RuntimeError('OwnerHBAActualProofRequiredBeforeActivationContext')
        proof = json.loads(proof_path.read_text())
        if proof.get('status') != 'PASS' or proof.get('containment', {}).get('status') != 'PASS':
            raise RuntimeError('OwnerHBAActualProofRequiredBeforeActivationContext')
        from p6_hba import credential_gate
        credential_gate()
    data = p6_context.context()
    if owner_boundary:
        data.update(ownerHBABoundary=proof, scopeFailure=json.loads((directory / 'mock-runtime-update-two.json').read_text()))
    build = json.loads((directory / 'worker-build-2.json').read_text())
    if build.get('status') != 'PASS' or build.get('attempt') != 2:
        raise RuntimeError('NativeBuildTwoMustPassBeforeActivation')
    git = git_command(schema.REPO)
    if subprocess.run(git + ['diff', '--quiet', build['sourceSHA'], 'HEAD', '--', 'src/lib/queue',
            'services/application-worker', 'package.json', 'package-lock.json', 'supabase/operations/pgboss-producer-grants.sql']).returncode:
        raise RuntimeError('RuntimeChangedSinceBuildTwo_NoUnverifiedImage')
    for name, path in [('p6Inventory', 'p6-inventory.json'), ('rolePreflight', 'p6-role-preflight.json'), ('roleInstall', 'p6-role-install.json')]:
        data[name] = json.loads((schema.REPO / 'docs/evidence' / path).read_text())
    data.update(workerBuild=build, originalWorkerBuild=json.loads((directory / 'worker-build-1.json').read_text()),
                mockPrepare=json.loads((directory / 'mock-prepare.json').read_text()),
                healthRepair=json.loads((directory / 'mock-health-repair-one.json').read_text()))
    recovery = json.loads((directory / 'bastion-owner1-session-four-hour.json').read_text())
    if recovery.get('status') != 'PASS' or recovery.get('sessionClosed') is not True or recovery.get('postCloseContainment', {}).get('containment', {}).get('status') != 'PASS':
        raise RuntimeError('ClosedRecoveryAndPostCloseContainmentRequired')
    script = p6_worker_build.bundle()
    for name in ('p6_roles_guest', 'p6_mock_guest', 'p6_health_repair_guest', 'p6_mock_control', 'p6_queue_function_scope',
                 'p6_queue_hba', 'p6_hba_guest', 'p6_queue_boundary_gate', 'p6_mock_update_guest'):
        code = (schema.REPO / 'infra/oracle' / (name + '.py')).read_text()
        script += 'module=types.ModuleType(' + repr(name) + ');sys.modules[' + repr(name) + ']=module\nexec(' + repr(code) + ',module.__dict__)\n'
    script += 'result=sys.modules["p6_mock_update_guest"].run(' + repr(data) + ',runtime,owner_boundary=' + repr(owner_boundary) + ')\nprint(json.dumps(result))\n'
    result = schema.run_guest(script, timeout=600)
    with destination.open('x', encoding='utf-8') as output:
        json.dump(result, output, indent=2)
    print(json.dumps({'status': result['status'], 'code': result.get('code'), 'containment': result.get('containment', {}).get('status'),
                      'manifestSHA256': result['manifestSHA256'], 'realAcceptance': False}))
    if result['status'] != 'PASS':
        raise SystemExit(1)


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(json.dumps({'status': 'STOP', 'code': str(error) if type(error) is RuntimeError else type(error).__name__}))
        raise SystemExit(1)
