"""Internal RAM-only browser bootstrap; no CLI prints credentials or settings."""
import json
import cloud_schema as schema
import p6_capture_repair
import p8_staging_readonly as staging


BOOTSTRAP_BODY = '''
from p6_mock_guest import prepared,ROOT
from web_services_guest import require_prepared
from web_edge_guest import private_env
prepared(data);require_prepared(data)
values=runtime['read_env']();web=private_env(ROOT/'.env.p5-web');auth=private_env(ROOT/'.env.p5-auth')
if (web.get('IR35_READ_ONLY')!='true' or web.get('APPLY_RUNNER')!='mock'
 or web.get('APPLICATION_WORKER_ACCEPT_JOBS')!='false' or values.get('APPLY_RUNNER')!='mock'
 or values.get('APPLICATION_WORKER_ACCEPT_JOBS')!='false'):
 raise RuntimeError('ProtectedReadonlyMockFixtureRequired')
if auth.get('GOTRUE_SMTP_HOST')!='smtp' or auth.get('GOTRUE_SMTP_PORT')!='1025' or auth.get('GOTRUE_SMTP_USER') or auth.get('GOTRUE_SMTP_PASS'):
 raise RuntimeError('ExistingPrivateSMTPSinkRequired')
password=values['STAGING_BASIC_PASSWORD']
if not re.fullmatch('[a-f0-9]{48}',password):raise RuntimeError('ExistingBasicCredentialShapeRequired')
# INTERNAL IPC ONLY: caller captures in RAM and never forwards raw stdout/errors.
print(json.dumps({'status':'PASS','origin':'https://staging.ir35careers.com','username':'ir35','password':password,
 'mockOnly':True,'realAcceptance':False,'readOnly':True,'smtpSink':True}))
'''


def private_program(data):
    source = p6_capture_repair.bundle() + '\ndata=' + repr(data) + '\n' + BOOTSTRAP_BODY
    compile(source, '<private-readonly-browser-bootstrap>', 'exec')
    return source


def source_context():
    # Called BEFORE the native controller creates its public journal. The
    # existing clean committed P8/source/fidelity gates remain unchanged.
    return staging.context()


def private_bootstrap(data):
    return schema.run_guest(private_program(data), timeout=120)


CONTAINMENT_BODY = '''
from p6_mock_guest import prepared
from web_services_guest import require_prepared
from p6_restart_diagnosis_guest import containment
prepared(data);require_prepared(data)
full=containment(data,runtime,probe_container='ir35-p6-mock-worker-v7-fixedip')
print(json.dumps({'status':full['status'],'readOnly':True,'vmWrites':0,'fullContainment':full,'phaseComplete':False}))
'''


def containment_program(data):
    source = p6_capture_repair.bundle() + '\ndata=' + repr(data) + '\n' + CONTAINMENT_BODY
    compile(source, '<post-browser-readonly-containment>', 'exec')
    return source


def full_containment(data):
    return schema.run_guest(containment_program(data), timeout=600)


if __name__ == '__main__':
    raise SystemExit('Imported by native browser controller only; no credential-output CLI.')
