"""P7 read-only Auth handoff audit. Never changes configuration or sends mail."""
import json
import subprocess
import sys
from pathlib import Path
import cloud_schema as schema
import p6_context
import p6_resume
import p6_restart_diagnosis
import p6_capture_repair
from p6_pause_reconcile import verified_manifest
from p6_audit_log import Journal
from web_build import git_command

TEMPLATES=('CONFIRMATION','MAGIC_LINK','RECOVERY','INVITE','EMAIL_CHANGE')
RATES=('EMAIL_SENT','VERIFY','TOKEN_REFRESH','OTP','SSO','ANONYMOUS_USERS')


def bind_data(program,data):
    marker='\ndata=DATA\n'
    if program.count(marker)!=1:raise RuntimeError('SingleExplicitP7PayloadBindingRequired')
    return program.replace(marker,'\ndata='+repr(data)+'\n',1)


def phase_journal(repo):
    """Create only the controlled parent; the audit slot stays exclusive."""
    repo=Path(repo).resolve();evidence=repo/'docs/evidence';parent=evidence/'p7'
    if evidence.is_symlink() or not evidence.is_dir() or evidence.resolve()!=repo/'docs/evidence':
        raise RuntimeError('ControlledP7EvidenceRootRequired')
    try:parent.mkdir(mode=0o700)
    except FileExistsError:pass
    if parent.is_symlink() or not parent.is_dir() or parent.resolve()!=evidence/'p7':
        raise RuntimeError('ControlledP7EvidenceParentRequired')
    root=parent/'auth-inventory-01'
    if root.exists() or root.is_symlink():raise RuntimeError('P7InventoryAlreadyRecorded_NoOverwrite')
    return Journal(root)  # Exclusive mkdir + O_EXCL artifact writes unchanged.


def project(config,settings):
    """Only field NAMES, configured booleans and safe behavioural booleans."""
    templates={kind:{'templateConfigured':bool(config.get('GOTRUE_MAILER_TEMPLATES_'+kind)),
        'subjectConfigured':bool(config.get('GOTRUE_MAILER_SUBJECTS_'+kind))} for kind in TEMPLATES}
    return {'emailEnabled':settings.get('external',{}).get('email')is True,
        'confirmationRequired':settings.get('mailer_autoconfirm')is False,
        'googleEnabled':settings.get('external',{}).get('google')is True,
        'githubEnabled':settings.get('external',{}).get('github')is True,
        'smtpSink':config.get('GOTRUE_SMTP_HOST')=='smtp' and config.get('GOTRUE_SMTP_PORT')=='1025' and not config.get('GOTRUE_SMTP_USER') and not config.get('GOTRUE_SMTP_PASS'),
        'siteIsStaging':config.get('GOTRUE_SITE_URL')=='https://staging.ir35careers.com',
        'externalAPIIsStaging':config.get('API_EXTERNAL_URL')=='https://api-staging.ir35careers.com',
        'templates':templates,'explicitRateLimitNames':[name for name in ('GOTRUE_RATE_LIMIT_'+rate for rate in RATES) if name in config],
        'secretValuesPrinted':False,'sourceParityProven':False}


def context():
    git=git_command(schema.REPO)
    if subprocess.check_output(git+['branch','--show-current'],text=True).strip()!='codex/oracle-migration-p7':raise RuntimeError('P7BranchRequired')
    if subprocess.check_output(git+['status','--porcelain'],text=True).strip():raise RuntimeError('CommittedCleanP7SourceRequired')
    directory=schema.REPO/'docs/evidence/p6/capture-owner3-full'
    if verified_manifest(directory)!='5b51ba02d4785d1ddd7dab874c8622a57c163f40adbc9bc26598633259325c24':raise RuntimeError('ExactFullP6ManifestRequired')
    passed=json.loads((directory/'01-full-result.json').read_text())
    if passed.get('status')!='PASS' or passed.get('phaseComplete')is not True:raise RuntimeError('ActualFullP6PassRequired')
    data=p6_restart_diagnosis.evidence_context(p6_resume.evidence_context(p6_context.read_evidence()))
    return data|{'p6Pass':passed}


def main():
    if sys.argv[1:]!=['--read-only']:raise RuntimeError('ReadOnlyP7InventoryRequired')
    root=schema.REPO/'docs/evidence/p7/auth-inventory-01'
    if root.exists():raise RuntimeError('P7InventoryAlreadyRecorded_NoOverwrite')
    data=context();journal=phase_journal(schema.REPO);result={'status':'FAIL','readOnly':True,'vmWrites':0,'authRequests':'GET settings only','mailRequests':0,'phaseComplete':False}
    code=p6_capture_repair.bundle()
    code+='\n'+__import__('inspect').getsource(project)
    code+='\nTEMPLATES='+repr(TEMPLATES)+'\nRATES='+repr(RATES)+'\n'
    code+=bind_data('''
from p6_mock_guest import prepared,ROOT
from web_edge_guest import private_env
from web_services_guest import require_prepared
from sdk_owner1_guest import tls_request
from p6_restart_diagnosis_guest import containment
from urllib.parse import urlsplit
data=DATA
store=prepared(data);passed=data['p6Pass'];store.verify(passed['stage'],passed['manifestSHA256'])
require_prepared(data)
config=private_env(ROOT/'.env.p5-auth')
gate=private_env(ROOT/'.env.p5-caddy')['STAGING_GATE_TOKEN'];values=runtime['read_env']()
status,_,body=tls_request('staging.ir35careers.com','GET','/supabase/auth/v1/settings',
 {'Cookie':'__Host-ir35-staging='+gate,'apikey':values['ANON_KEY']})
if status!=200:raise RuntimeError('P7ProtectedSettingsReadFailed')
settings=json.loads(body)
projection=project(config,settings)
uri=urlsplit(config.get('GOTRUE_DB_DATABASE_URL',''))
projection['databaseIsVerifiedP5Fixture']=uri.hostname=='db' and uri.path=='/ir35_p5_app'
projection['readOnlyDatabaseGuard']=('default_transaction_read_only' in uri.query)
checks={name:projection[name]is True for name in ('emailEnabled','confirmationRequired','smtpSink','siteIsStaging','externalAPIIsStaging','databaseIsVerifiedP5Fixture','readOnlyDatabaseGuard')}
handoff=ROOT/'.env.auth-source-handoff.json'
present=handoff.exists()
if present:
 info=handoff.lstat()
 if handoff.is_symlink() or info.st_uid!=1002 or info.st_mode&0o777!=0o600 or info.st_nlink!=1:raise RuntimeError('PrivateAuthHandoffCustodyMismatch')
full=containment(data,runtime,probe_container='ir35-p6-mock-worker-v7-fixedip')
print(json.dumps({'status':'PASS' if all(checks.values()) and full['status']=='PASS' else 'FAIL','readOnly':True,'vmWrites':0,
 'checks':checks,'auth':projection,'sourceHandoffPresent':present,'sourceMetadataIsIncomplete':True,
 'ownerGate':'G3' if not present else 'SOURCE_CONFIG_VALIDATION_REQUIRED','phaseComplete':False,'mailRequests':0,
 'passwordAttempts':0,'fullContainment':full,'p6NativeManifestSHA256':passed['manifestSHA256']}))
''',data)
    compile(code,'<p7-read-only-bootstrap>','exec')  # Reject harness syntax BEFORE consuming a native audit.
    try:
        result['audit']=journal.step(1,'protected-auth-source-readiness',lambda:schema.run_guest(code,timeout=600));result['status']='PASS'
        result['ownerGate']=result['audit']['ownerGate']
    finally:result['manifestSHA256']=journal.seal(result)
    print(json.dumps({k:v for k,v in result.items() if k!='audit'}))


if __name__=='__main__':
    try:main()
    except Exception as error:
        print(json.dumps({'status':'STOP','code':str(error) if type(error)is RuntimeError else type(error).__name__,'rawErrorWithheld':True}));raise SystemExit(1)
