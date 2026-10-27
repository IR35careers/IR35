"""Bounded025 rehearsal on a NEW owned clone; never current staging or cloud."""
import hashlib
import inspect
import json
import subprocess
import sys
import cloud_schema as schema
import p6_capture_repair
import p8_staging_readonly as staging
import p8_app_readiness as capabilities
from p6_audit_log import Journal
from p6_pause_reconcile import verified_manifest
from web_build import git_command

MIGRATION_SHA256 = '39fa06a4da6a8528ee0419d5fad65e36f759fd51581ec90182e6082bfce1a8e1'


def program(data, migration):
    if hashlib.sha256(migration.encode()).hexdigest() != MIGRATION_SHA256:
        raise RuntimeError('ExactReviewed025GitBytesRequired')
    code = p6_capture_repair.bundle()
    code += "module=types.ModuleType('p8_app_readiness');sys.modules['p8_app_readiness']=module\nexec(" + repr(
        'COLUMNS=' + repr(capabilities.COLUMNS) + '\nFUNCTIONS=' + repr(capabilities.FUNCTIONS)
        + '\nSQL=' + repr(capabilities.SQL) + '\n' + inspect.getsource(capabilities.readiness)) + ',module.__dict__)\n'
    for name in ('upgrade_review', 'p8_upgrade_guest'):
        code += 'module=types.ModuleType(' + repr(name) + ');sys.modules[' + repr(name) + ']=module\nexec(' + repr(
            (schema.REPO / 'infra/oracle' / (name + '.py')).read_text()) + ',module.__dict__)\n'
    code += "result=sys.modules['p8_upgrade_guest'].run(" + repr(data) + ',runtime,' + repr(migration) + ')\nprint(json.dumps(result))\n'
    compile(code, '<disposable-upgrade025>', 'exec')
    return code


def main():
    if sys.argv[1:] != ['--disposable-staging-only']:
        raise RuntimeError('ExplicitDisposableUpgradeOnlyRequired')
    prior = schema.REPO / 'docs/evidence/p8/snapshot-app-readiness-01'
    if verified_manifest(prior) != '3795578c54b5710510b56b6c4edb9533051a41a342b95864f47715d205531b37':
        raise RuntimeError('ExactSnapshotInventoryRequired')
    proof = json.loads((prior / '01-snapshot-capabilities-containment-result.json').read_bytes())
    if (proof.get('status') != 'PASS' or proof.get('fullContainment', {}).get('status') != 'PASS'
            or len(proof['capabilities']['missingColumns']) != 10
            or len(proof['capabilities']['missingFunctions']) != 10):
        raise RuntimeError('ExactUnmodifiedSnapshotCapabilitiesRequired')
    data = staging.context()
    migration = subprocess.check_output(git_command(schema.REPO) +
        ['show', 'HEAD:supabase/migrations/025_application_delivery_lifecycle.sql']).decode('utf-8')
    code = program(data, migration)
    journal = Journal(schema.REPO / 'docs/evidence/p8/disposable-upgrade025-01')
    journal.put('intent.json', {'operation': 'separate-clone-upgrade025', 'nativeAttempt': 1,
        'originalFixturesRemainUnchanged': True, 'sourceWrites': 0, 'cloudRequests': 0,
        'newCredentials': 0, 'newServices': 0, 'migrationSHA256': MIGRATION_SHA256,
        'appQAProven': False, 'fullMigrationFidelityClaimed': False})
    result = {'status': 'FAIL', 'phaseComplete': False, 'cutover': False}
    try:
        result['upgrade'] = schema.run_guest(code, timeout=900)
        journal.put('upgrade-result.json', result['upgrade'])
        result['status'] = result['upgrade']['status']
    except Exception as error:
        result['code'] = type(error).__name__
    finally:
        result['manifestSHA256'] = journal.seal(result)
    print(json.dumps({key: value for key, value in result.items() if key != 'upgrade'}))
    if result['status'] != 'PASS':
        raise SystemExit(1)


if __name__ == '__main__':
    main()
