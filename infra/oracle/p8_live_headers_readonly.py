"""ONE new, explicitly read-only owner header/containment gate.

No activation, restart, configuration writer or repair operation is selected.
Importing this module does not access private state, SSH, cloud APIs or a VM.
"""
import json
from pathlib import Path
import re
import subprocess
import sys

REPO = Path(__file__).resolve().parents[2]
SLOT = 'live-headers-readonly-owner-20261030-01'
HEAD_SHA = 'cd979540e5b55cc6992d14b335c88f846b95a1dd111e6741db058ec96cfe5951'


def program(data, *, base_bundle=None):
    if base_bundle is None:
        import p6_capture_repair
        base_bundle = p6_capture_repair.bundle()
    source = base_bundle
    for name in ('p8_live_header_audit', 'p8_live_headers_readonly_guest'):
        source += '\nmodule=types.ModuleType(' + repr(name) + ');sys.modules[' + repr(name) + ']=module\nexec(' + repr(
            (REPO / 'infra/oracle' / (name + '.py')).read_text()) + ',module.__dict__)\n'
    source += "\ntry:\n result=sys.modules['p8_live_headers_readonly_guest'].native_run(" + repr(data) + ',runtime)\n'
    source += "except Exception as error:\n result={'status':'FAIL','exceptionType':type(error).__name__,'rawErrorWithheld':True,'activationPerformed':False,'phaseComplete':False}\nprint(json.dumps(result))\n"
    compile(source, '<p8-new-live-headers-readonly>', 'exec')
    return source


def head_decision(root, verify):
    def require(condition):
        if not condition:
            raise RuntimeError('ExactPriorHeadNoActivationDecisionRequired')
    require(verify(root) == HEAD_SHA)
    saved = json.loads((root / '01-first-heads-result.json').read_bytes())
    rows = saved.get('cases', [])
    require(saved.get('status') == 'PASS' and saved.get('activationRequired') is False
        and saved.get('activationPerformed') is False and saved.get('initialRequiredHeadersPresent') is True
        and len(rows) == 2 and {row.get('host') for row in rows} == {'staging.ir35careers.com', 'api-staging.ir35careers.com'}
        and all(row.get('status') == 'PASS' and row.get('actualStatus') == 401
            and row.get('method') == 'HEAD' and row.get('credentialsSent') is False
            and row.get('noStore') is True and row.get('noindex') is True for row in rows))
    return {'headDecision': 'HEADERS_ALREADY_PRESENT_NO_ACTIVATION', 'headDecisionManifestSHA256': HEAD_SHA}


def main(argv=None):
    args = sys.argv[1:] if argv is None else argv
    if args != ['--read-only']:
        raise RuntimeError('FixedReadOnlyHeaderInvocationRequired')
    # Imports here preserve a fully inert/source-testable module import.
    import cloud_schema as schema
    import p8_staging_readonly as staging
    from p6_audit_log import Journal
    from p6_pause_reconcile import verified_manifest
    from web_build import git_command
    root = REPO / 'docs/evidence/p8' / SLOT
    if root.exists() or root.is_symlink():
        raise RuntimeError('ReadOnlyLocalOwnerSlotUsed_NoReplay')
    decision = head_decision(REPO / 'docs/evidence/p8/caddy-head-owner-20261030-01', verified_manifest)
    data = staging.context()  # Existing clean committed P8 and sealed P4/P5/P6/P7 gates.
    git = git_command(REPO)
    sha = subprocess.check_output(git + ['rev-parse', 'HEAD'], text=True).strip()
    if not re.fullmatch('[a-f0-9]{40}', sha):
        raise RuntimeError('ExactCommittedReadOnlySourceRequired')
    data.update(headerAuditSourceSHA=sha, **decision)
    source = program(data)
    journal = Journal(root)
    result = {'status': 'FAIL', 'sourceSHA': sha, 'activationPerformed': False,
        'serviceRestarts': 0, 'configChanges': 0, 'queuePublications': 0,
        'phaseComplete': False, 'cutover': False, **decision}
    try:
        result['native'] = journal.step(1, 'all-headers-and-full-containment',
            lambda: schema.run_guest(source, timeout=1500))
        result['status'] = result['native']['status']
    except Exception:
        result['code'] = 'NativeReadOnlyHeaderGateFailed_RawWithheld'
    finally:
        result['manifestSHA256'] = journal.seal({key: value for key, value in result.items() if key != 'native'})
    print(json.dumps({key: value for key, value in result.items() if key != 'native'}))
    return 0 if result['status'] == 'PASS' else 1


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except Exception:
        print(json.dumps({'status': 'STOP', 'code': 'ReadOnlyHeaderPreconditionFailed_RawWithheld',
                          'activationPerformed': False, 'phaseComplete': False}))
        raise SystemExit(1)
