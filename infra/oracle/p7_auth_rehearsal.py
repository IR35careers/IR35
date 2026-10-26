"""ONE source-configured staging Auth rehearsal; private handoff on stdin only."""
import json
import sys
import cloud_schema as schema
import p6_capture_repair
import p7_auth_inventory as inventory
import p7_auth_profile as profile
from p6_audit_log import Journal
from p6_pause_reconcile import verified_manifest


def program(data,handoff):
    profile.validate(handoff)
    code=p6_capture_repair.bundle()
    for name in ('export_auth_settings','p7_auth_profile','p4_mail_probe','p7_auth_rehearsal_guest'):
        code+='module=types.ModuleType('+repr(name)+');sys.modules['+repr(name)+']=module\nexec('+repr((schema.REPO/'infra/oracle'/(name+'.py')).read_text())+',module.__dict__)\n'
    code+='\nhandoff='+repr(handoff)+'\ndata='+repr(data)+'\n'
    code+='''
from pathlib import Path
from p6_mock_guest import prepared,ROOT
from web_services_guest import require_prepared
store=prepared(data);store.verify(data['p6Pass']['stage'],data['p6Pass']['manifestSHA256'])
require_prepared(data)
path=ROOT/'.env.auth-source-handoff.json'
body=(json.dumps(handoff,sort_keys=True,ensure_ascii=False,indent=2)+'\\n').encode()
if path.exists():
 info=path.lstat()
 if path.is_symlink() or info.st_uid!=1002 or info.st_mode&0o777!=0o600 or info.st_nlink!=1 or path.read_bytes()!=body:raise RuntimeError('ExistingAuthHandoffPreserved_Mismatch')
else:
 fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
 try:
  os.fchown(fd,1002,1002)
  with os.fdopen(fd,'wb',closefd=False) as target:target.write(body);target.flush();os.fsync(target.fileno())
 finally:os.close(fd)
result=sys.modules['p7_auth_rehearsal_guest'].run(data,runtime,handoff)
result['privateHandoffSHA256']=hashlib.sha256(body).hexdigest()
print(json.dumps(result))
'''
    compile(code,'<p7-private-auth-rehearsal>','exec')
    return code


def main():
    if sys.argv[1:]!=['--staging-only']:raise RuntimeError('ExplicitStagingAuthOperationRequired')
    root=schema.REPO/'docs/evidence/p7/auth-rehearsal-01'
    if root.exists():raise RuntimeError('P7AuthAttemptUsed_NoReplay')
    raw=sys.stdin.buffer.read(4*1024*1024+1)
    if len(raw)>4*1024*1024:raise RuntimeError('BoundedSourceHandoffRequired')
    handoff=json.loads(raw);profile.validate(handoff)
    readiness=schema.REPO/'docs/evidence/p7/g3-runtime-readiness-01'
    if verified_manifest(readiness)!='8102e6ec7eb58e156bc337d4dac69da1fb3b5c781e4bd7e6df9a984503700a58':raise RuntimeError('ActualG3ReadinessRequired')
    if json.loads((readiness/'result.json').read_bytes())['status']!='PASS':raise RuntimeError('ActualG3ReadinessRequired')
    data=inventory.context();code=program(data,handoff);journal=Journal(root)
    journal.put('intent.json',{'stagingOnly':True,'disposableAuthClonesOnly':True,'attempt':1,'smtpSink':True,
        'realPasswordAttempts':0,'productionChanges':False,'oauthProviderCalls':0,'sourceValuesPrinted':False})
    result={'status':'FAIL','phaseComplete':False,'stagingOnly':True}
    try:
        result['auth']=schema.run_guest(code,timeout=1200)
        journal.put('auth-result.json',result['auth']);result['status']=result['auth']['status']
    except Exception as error:
        result['code']=str(error) if type(error)is RuntimeError else type(error).__name__
    finally:result['manifestSHA256']=journal.seal(result)
    print(json.dumps({key:value for key,value in result.items() if key!='auth'}))
    if result['status']!='PASS':raise SystemExit(1)


if __name__=='__main__':
    try:main()
    except Exception as error:
        print(json.dumps({'status':'STOP','code':str(error) if type(error)is RuntimeError else type(error).__name__,'rawErrorWithheld':True}));raise SystemExit(1)
