"""New P8 native images only; checks/manifest custody BEFORE one SSH build."""
import argparse
import base64
import hashlib
import json
import re
import subprocess
import sys
import cloud_schema as schema
import p6_capture_repair
import p8_staging_readonly as staging
from p6_audit_log import Journal
from p6_pause_reconcile import verified_manifest
from web_build import git_command
from p8_image_policy import hosted_checks


def public_hosted_input(stream, sha):
    """Only public GET metadata crosses Windows -> WSL, never CLI credentials."""
    body = stream.read(1_000_001)
    if type(body) is not bytes or not body or len(body) > 1_000_000:
        raise RuntimeError('BoundedPublicHostedCheckInputRequired')
    try: value = json.loads(body.decode('utf-8'))
    except (ValueError, UnicodeError): raise RuntimeError('InvalidPublicHostedCheckInput_RawWithheld') from None
    return hosted_checks(value, sha), hashlib.sha256(body).hexdigest()


def program(data):
    code = p6_capture_repair.bundle()
    for name in ('web_build_guest', 'p8_image_policy', 'p8_images_guest'):
        code += 'module=types.ModuleType(' + repr(name) + ');sys.modules[' + repr(name) + ']=module\nexec(' + repr(
            (schema.REPO / 'infra/oracle' / (name + '.py')).read_text()) + ',module.__dict__)\n'
    code += "p8_native_images_result=sys.modules['p8_images_guest'].run(" + repr(data) + ',runtime)\nprint(json.dumps(p8_native_images_result))\n'
    compile(code, '<p8-new-native-images>', 'exec')
    return code


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--build-staging-only', action='store_true', required=True)
    parser.add_argument('--hosted-checks-stdin', action='store_true', required=True)
    parser.parse_args()
    git = git_command(schema.REPO)
    if subprocess.check_output(git + ['branch', '--show-current'], text=True).strip() != 'codex/oracle-migration-p8': raise RuntimeError('P8BranchRequired')
    if subprocess.check_output(git + ['status', '--porcelain'], text=True).strip(): raise RuntimeError('CleanCommittedP8Required')
    sha = subprocess.check_output(git + ['rev-parse', 'HEAD'], text=True).strip()
    checked, check_input_sha256 = public_hosted_input(sys.stdin.buffer, sha)
    upgrade = schema.REPO / 'docs/evidence/p8/disposable-upgrade025-01'
    if verified_manifest(upgrade) != '128bea3d6c66e67bdf1b6483503fccf079c6262951dd41654fa6fec2aaf8237d': raise RuntimeError('ExactPriorDisposableUpgradeProofRequired')
    data = staging.context()
    body = subprocess.check_output(git + ['archive', '--format=tar', sha])
    if len(body) > 100_000_000: raise RuntimeError('SourceArchiveLimit')
    data.update(sourceSHA=sha, hostedChecks={'check_runs': [dict(row, head_sha=sha) for row in checked['checks']]},
                archive=base64.b64encode(body).decode(), archiveSHA256=hashlib.sha256(body).hexdigest())
    code = program(data)
    journal = Journal(schema.REPO / 'docs/evidence/p8/native-webmock-images-01')
    journal.put('intent.json', {'operation': 'new-native-webmock-images', 'sourceSHA': sha, 'hosted': checked,
        'publicHostedInputSHA256': check_input_sha256, 'archiveSHA256': data['archiveSHA256'],
        'newOCIResources': 0, 'runtimeActivation': False, 'oldSlotsReplayed': False})
    result = {'status': 'FAIL', 'sourceSHA': sha, 'runtimeDeployed': False, 'phaseComplete': False, 'cutover': False}
    try:
        observed = schema.run_guest(code, timeout=3000)
        journal.put('native-result.json', observed)
        result.update(status=observed['status'], native=observed)
    except Exception as error: result['code'] = type(error).__name__
    finally: result['manifestSHA256'] = journal.seal({key: value for key, value in result.items() if key != 'native'})
    print(json.dumps({key: value for key, value in result.items() if key != 'native'}))
    if result['status'] != 'PASS': raise SystemExit(1)


if __name__ == '__main__':
    try: main()
    except SystemExit: raise
    except Exception as error:
        code = str(error) if type(error) is RuntimeError and re.fullmatch('[A-Za-z][A-Za-z0-9_]{0,110}', str(error)) else type(error).__name__
        print(json.dumps({'status': 'STOP', 'code': code, 'rawErrorWithheld': True})); raise SystemExit(1)
