"""One named-account password login on an isolated Oracle test clone only."""
import ast
import json
import re
import sys
import cloud_schema as schema
import owner_parity
import rehearsal
import rehearsal_audit
import storage_compat

REPORT=schema.REPO/'docs/evidence/oracle-p4-test-account-login.json'

STATUS=r'''
record=json.loads((ROOT/'config/p4-auth-login.json').read_text())
if record.get('purpose')!='ir35-named-test-login-only' or record.get('target')!=TARGET:
 raise RuntimeError('Owned staging Auth journal required')
allowed={'READY_STOPPED','LOGIN_START_PENDING','HEALTH_FAILED','PRELOGIN_FIDELITY_FAIL','LOGIN_DENIED','PASS','INTENT','START_PENDING'}
status=record.get('status')
if status not in allowed:raise RuntimeError('Unrecognized Auth state; no credential request')
result={'status':status,'credentialAttempts':record.get('loginAttempts',0),'passwordRequested':False,'sourceWrites':0,'stagingWrites':0}
if 'httpStatus' in record:
 if type(record['httpStatus']) is not int or not 100<=record['httpStatus']<=599:raise RuntimeError('Invalid redacted HTTP status')
 result['httpStatus']=record['httpStatus']
print(json.dumps(result))
'''


def get_status():
    script=STATUS.replace('TARGET',repr(storage_compat.NAME))
    return schema.run_guest(schema.guest_bundle(rehearsal=True)+owner_parity.BASE+script,timeout=90)

START=r'''
name=TARGET;login_path=ROOT/'config/p4-auth-login.json'
if login_path.exists():raise RuntimeError('Auth login attempt already journalled; reconcile, never replay credentials')
ledger=json.loads((ROOT/'config/p4-storage-compat.json').read_text())
if ledger.get('purpose')!='ir35-owner-exact-storage-compatibility' or ledger['cycles']['1'].get('status')!='STORAGE_BYTES_VERIFIED':
 raise RuntimeError('Verified private new clone required')
values=read_env();component=component_env(values)['auth']
from urllib.parse import urlsplit,urlunsplit
uri=urlsplit(component['GOTRUE_DB_DATABASE_URL'])
if uri.hostname!='db' or uri.port!=5432 or uri.username!='supabase_auth_admin':raise RuntimeError('Private staging Auth DB identity required')
component['GOTRUE_DB_DATABASE_URL']=urlunsplit((uri.scheme,uri.netloc,'/'+name,uri.query,''))
component.update(GOTRUE_DISABLE_SIGNUP='true',GOTRUE_DB_MAX_POOL_SIZE='3')
if component.get('GOTRUE_SMTP_HOST')!='smtp' or component.get('GOTRUE_SMTP_PORT')!='1025':raise RuntimeError('SMTP sink required')
container='ir35-p4-auth-login'
if run(['docker','ps','-a','--filter','name=^/'+container+'$','--format','{{.ID}}']).strip():raise RuntimeError('Auth container collision; no overwrite')
record={'purpose':'ir35-named-test-login-only','target':name,'attempts':1,'status':'INTENT'}
write(login_path,json.dumps(record),0o600)
envpath=ROOT/'.env.p4-auth-login'
if envpath.exists() or envpath.is_symlink():raise RuntimeError('Auth env collision; no overwrite')
write(envpath,'\n'.join(key+"='"+value+"'" for key,value in component.items())+'\n',0o600,1002)
db=dc('ps','-q','db').strip();networks=json.loads(run(['docker','inspect','--format','{{json .NetworkSettings.Networks}}',db]))
if len(networks)!=1:raise RuntimeError('Exclusive private DB network required')
network=next(iter(networks))
if json.loads(run(['docker','network','inspect',network]))[0].get('Internal') is not True:raise RuntimeError('Auth must have no outbound network')
pin=PIN
record['status']='START_PENDING';write(login_path,json.dumps(record),0o600)
cid=run(['docker','run','-d','--name',container,'--label','ir35.purpose=named-test-login','--network',network,
 '--user','1002:1002','--memory','256m','--pids-limit','64','--cap-drop','ALL','--security-opt','no-new-privileges','--restart','no','--log-driver','none',
 '--mount','type=bind,src='+str(envpath)+',dst='+str(envpath)+',readonly',
 '--mount','type=bind,src=/opt/ir35/bin/env-exec,dst=/run/ir35/env-exec,readonly',
 '--entrypoint','/run/ir35/env-exec',pin['image'],str(envpath),*pin['entrypoint'],*pin['command']]).strip()
record['containerId']=cid;write(login_path,json.dumps(record),0o600)
info=json.loads(run(['docker','inspect',cid]))[0]
if info['HostConfig'].get('PortBindings') or info['HostConfig']['Privileged'] or set(info['NetworkSettings']['Networks'])!={network}:raise RuntimeError('Private Auth isolation failed')
ip=info['NetworkSettings']['Networks'][network]['IPAddress']
class NoRedirect(urllib.request.HTTPRedirectHandler):
 def redirect_request(self,*args,**kwargs):raise RuntimeError('Auth redirect refused; secret never forwarded')
opener=urllib.request.build_opener(urllib.request.ProxyHandler({}),NoRedirect())
deadline=time.monotonic()+120;healthy=False
while time.monotonic()<deadline:
 try:
  with opener.open('http://'+ip+':9999/health',timeout=3) as response:healthy=response.status==200
 except (urllib.error.URLError,TimeoutError):pass
 if healthy:break
 if json.loads(run(['docker','inspect','--format','{{json .State}}',cid])).get('Status')=='exited':break
 time.sleep(2)
if not healthy:
 run(['docker','stop','--time','10',cid]);record['status']='HEALTH_FAILED';write(login_path,json.dumps(record),0o600)
 raise RuntimeError('Private Auth health failed; credentials not submitted, no replay')
'''

FINISH=r'''
if prelogin.get('status')!='PASS':
 run(['docker','stop','--time','10',cid]);record['status']='PRELOGIN_FIDELITY_FAIL';write(login_path,json.dumps(record),0o600)
 raise RuntimeError('Auth startup changed snapshot data/schema; STOP before credential use')
payload=json.dumps({'email':'anvesh.mannuru+ir35test@gmail.com','password':PASSWORD}).encode()
request=urllib.request.Request('http://'+ip+':9999/token?grant_type=password',data=payload,
 headers={'Content-Type':'application/json'},method='POST')
try:
 with opener.open(request,timeout=20) as response:reply=json.loads(response.read(1_000_000))
except urllib.error.HTTPError as error:
 run(['docker','stop','--time','10',cid]);record['status']='LOGIN_DENIED';record['httpStatus']=error.code;write(login_path,json.dumps(record),0o600)
 raise RuntimeError('Named test-account login denied; secret/body withheld; no automatic credential retry') from None
test_ids=json.loads(read("SELECT jsonb_agg(id::text) FROM auth.users WHERE lower(email)='anvesh.mannuru+ir35test@gmail.com';"))
token=reply.get('access_token','');parts=token.split('.')
if len(parts)!=3:raise RuntimeError('Staging Auth token missing; withheld')
signature=base64.urlsafe_b64encode(hmac.new(values['JWT_SECRET'].encode(),('.'.join(parts[:2])).encode(),hashlib.sha256).digest()).decode().rstrip('=')
claims=json.loads(base64.urlsafe_b64decode(parts[1]+'='*((4-len(parts[1])%4)%4)))
if not hmac.compare_digest(signature,parts[2]) or test_ids!=[claims.get('sub')] or claims.get('role')!='authenticated':
 raise RuntimeError('Staging Auth identity/signature mismatch; STOP')
logout=urllib.request.Request('http://'+ip+':9999/logout?scope=local',data=b'',headers={'Authorization':'Bearer '+token},method='POST')
with opener.open(logout,timeout=20) as response:
 if response.status not in (200,204):raise RuntimeError('Test-session logout failed')
run(['docker','stop','--time','10',cid]);run(['docker','rm',cid]);envpath.unlink()
record.update(status='PASS',passwordLogin=True,preloginFidelity=True,testSessionLoggedOut=True,containerRemoved=True)
write(login_path,json.dumps(record),0o600)
print(json.dumps({'status':'PASS','passwordLogin':True,'namedTestAccountOnly':True,'stagingJWTVerified':True,
 'preloginFidelity':prelogin,'testSessionLoggedOut':True,'containerRemoved':True,'sourceWrites':0,
 'stagingTestAuthWrites':True,'operationalSecretPersisted':False,'phaseComplete':False,
 'note':'Complete snapshot equality proven BEFORE intended test-account Auth/session writes; no post-login zero-difference claim.'}))
'''

RESUME=r'''
name=TARGET;login_path=ROOT/'config/p4-auth-login.json'
record=json.loads(login_path.read_text())
if record.get('purpose')!='ir35-named-test-login-only' or record.get('target')!=name or record.get('status')!='READY_STOPPED' or record.get('loginAttempts',0)!=0:
 raise RuntimeError('Prepared stopped Auth required; never replay a credential attempt')
values=read_env();cid=record['containerId'];envpath=ROOT/'.env.p4-auth-login';pin=PIN
s=envpath.lstat()
if not stat.S_ISREG(s.st_mode) or s.st_uid!=1002 or stat.S_IMODE(s.st_mode)!=0o600 or s.st_nlink!=1:
 raise RuntimeError('Prepared Auth secret custody mismatch')
info=json.loads(run(['docker','inspect',cid]))[0]
if info['Name']!='/ir35-p4-auth-login' or info['Config']['Labels'].get('ir35.purpose')!='named-test-login' or info['Config']['Image']!=pin['image'] or info['State']['Status']!='exited':
 raise RuntimeError('Prepared Auth identity/state mismatch')
db=dc('ps','-q','db').strip();networks=json.loads(run(['docker','inspect','--format','{{json .NetworkSettings.Networks}}',db]))
if len(networks)!=1:raise RuntimeError('Exclusive private DB network required')
network=next(iter(networks))
if json.loads(run(['docker','network','inspect',network]))[0].get('Internal') is not True:raise RuntimeError('Private Auth network required')
record.update(status='LOGIN_START_PENDING',loginAttempts=1);write(login_path,json.dumps(record),0o600)
run(['docker','start',cid])
'''

PREPARED=r'''
run(['docker','stop','--time','10',cid])
if prelogin.get('status')!='PASS':
 record['status']='PRELOGIN_FIDELITY_FAIL';write(login_path,json.dumps(record),0o600)
 raise RuntimeError('Auth startup changed snapshot data/schema; STOP before asking for a password')
record.update(status='READY_STOPPED',loginAttempts=0,preloginFidelity=True)
write(login_path,json.dumps(record),0o600)
print(json.dumps({'status':'READY_STOPPED','preloginFidelity':prelogin,'authHealthPASS':True,'sourceWrites':0,
 'stagingWrites':0,'passwordRequested':False,'passwordLogin':False,'phaseComplete':False}))
'''


def guest(password,pin,*,prepare=False):
    audit=rehearsal_audit.GUEST.replace('ir35_rehearsal_a_20261021',storage_compat.NAME).replace('config/p4-rehearsal.json','config/p4-storage-compat.json')
    tree=ast.parse(audit)
    tree.body[-1]=ast.Assign(targets=[ast.Name(id='prelogin',ctx=ast.Store())],value=tree.body[-1].value.args[0].args[0])
    audit=ast.unparse(ast.fix_missing_locations(tree))
    if type(prepare) is not bool:raise ValueError('Explicit preparation mode required')
    health=START[START.index("info=json.loads(run(['docker','inspect',cid]))[0]"):]
    source=(START if prepare else RESUME+health)+audit+'\n'+(PREPARED if prepare else FINISH)
    replacements={'TARGET':repr(storage_compat.NAME),'PIN':repr(pin),'PASSWORD':repr(password),'EXPIRY_SQL':repr(rehearsal.EXPIRY_SQL)}
    for key,file in (('EXTENSION_SQL','oracle_extension_security.sql'),('PRIVILEGE_SQL','oracle_effective_privileges.sql'),('TRANSPORT_SQL','oracle_transport_catalog.sql'),('INVENTORY_SQL','oracle_data_inventory.sql')):
        replacements[key]=repr((schema.REPO/'supabase/verification'/file).read_text())
    source=re.sub(r'\b('+'|'.join(replacements)+r')\b',lambda match:replacements[match[0]],source)
    return schema.guest_bundle(rehearsal=True)+owner_parity.BASE+rehearsal.verification_modules()+source


def main():
    if sys.argv[1:]==['--status']:
        print(json.dumps(get_status()));return
    if sys.argv[1:] not in (['--stdin-secret'],['--prepare']):raise ValueError('Status/preparation or hidden stdin only; no credential arguments')
    preflight=json.loads((schema.REPO/'docs/evidence/oracle-p4-auth-startup-preflight.json').read_text())
    if preflight.get('status')!='PASS' or preflight.get('pending')!=[] or preflight.get('unexplained')!=[]:
        raise ValueError('Auth migration preflight required')
    pin=json.loads((schema.REPO/'infra/oracle/staging-images.json').read_text())['images']['auth']
    if sys.argv[1:]==['--prepare']:
        result=schema.run_guest(guest('',pin,prepare=True),timeout=360)
        path=schema.REPO/'docs/evidence/oracle-p4-auth-runtime-preflight.json'
        path.write_text(json.dumps(result,indent=2)+'\n')
        print(json.dumps({'status':result['status'],'authHealthPASS':result['authHealthPASS'],'passwordRequested':False,'sourceWrites':0}));return
    if get_status().get('status')!='READY_STOPPED':
        raise ValueError('Not ready for a credential attempt; never request/read/replay a password after denial')
    data=json.loads(sys.stdin.read(4097))
    if set(data)!={'password'} or not isinstance(data['password'],str) or not 1<=len(data['password'])<=512:
        raise ValueError('Bounded hidden test credential required')
    result=schema.run_guest(guest(data.pop('password'),pin),timeout=360)
    REPORT.write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps({'status':result['status'],'passwordLogin':result['passwordLogin'],'sourceWrites':0}))


if __name__=='__main__':
    try:main()
    except Exception as error:
        print(json.dumps({'status':'FAIL','code':type(error).__name__,'rawOutput':'withheld'}));raise SystemExit(1)
