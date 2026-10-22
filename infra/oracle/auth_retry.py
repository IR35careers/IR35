"""Owner-authorised attempt 2, preserving attempt 1. No automatic password retry."""
import ast
import json
from pathlib import Path
import re
import sys
import auth_redaction
import cloud_schema as schema
import owner_parity
import rehearsal
import rehearsal_audit
import storage_compat

REPORT=schema.REPO/'docs/evidence/oracle-p4-auth-attempt2.json'
PREPARE_REPORT=schema.REPO/'docs/evidence/oracle-p4-auth-attempt2-preflight.json'

COMMON=r'''
import threading,uuid
name=TARGET
path=ROOT/'config/p4-auth-authorized-2.json'
old=json.loads((ROOT/'config/p4-auth-login.json').read_text())
if old.get('purpose')!='ir35-named-test-login-only' or old.get('target')!=name or old.get('status')!='LOGIN_DENIED' or old.get('loginAttempts')!=1:
 raise RuntimeError('Original denied attempt 1 must remain intact')
values=read_env()
db=dc('ps','-q','db').strip()
networks=json.loads(run(['docker','inspect','--format','{{json .NetworkSettings.Networks}}',db]))
if len(networks)!=1:raise RuntimeError('Exclusive private network required')
network=next(iter(networks))
if json.loads(run(['docker','network','inspect',network]))[0].get('Internal') is not True:raise RuntimeError('Outbound-isolated network required')
class NoRedirect(urllib.request.HTTPRedirectHandler):
 def redirect_request(self,*args,**kwargs):raise RuntimeError('Redirect refused; never forward credentials')
opener=urllib.request.build_opener(urllib.request.ProxyHandler({}),NoRedirect())
def http(url,*,body=None,headers=None,method=None):
 request=urllib.request.Request(url,data=None if body is None else json.dumps(body).encode(),
  headers={'Content-Type':'application/json',**(headers or {})},method=method or ('GET' if body is None else 'POST'))
 try:
  with opener.open(request,timeout=20) as response:return response.status,response.read(1_000_000),dict(response.headers)
 except urllib.error.HTTPError as error:return error.code,error.read(65537),dict(error.headers)
def save():
 # Fixed destination, never a mutable global used by embedded verification code.
 destination=ROOT/'config/p4-auth-authorized-2.json'
 if destination.parent!=ROOT/'config':raise RuntimeError('Journal path guard')
 write(destination,json.dumps(record),0o600)
def stop_all():
 for cid in reversed(list(record.get('containers',{}).values())):run(['docker','stop','--time','10',cid])
def inspect_owned(service,cid):
 info=json.loads(run(['docker','inspect',cid]))[0]
 if info['Name']!='/ir35-p4-auth2-'+service or info['Config']['Labels'].get('ir35.purpose')!='owner-authorized-auth-attempt2' or info['Config']['Image']!=PINS[service]['image']:
  raise RuntimeError('Owned test container identity mismatch')
 if info['HostConfig'].get('PortBindings') or set(info['NetworkSettings']['Networks'])!={network} or info['HostConfig']['Privileged']:
  raise RuntimeError('Test container network/isolation mismatch')
 return info
def urls():
 info=inspect_owned('kong',record['containers']['kong'])
 return 'http://'+info['NetworkSettings']['Networks'][network]['IPAddress']+':8000'
def wait_health():
 deadline=time.monotonic()+120
 while time.monotonic()<deadline:
  gateway=urls()
  try:
   if http(gateway+'/auth/v1/health',headers={'apikey':values['ANON_KEY']})[0]==200:return gateway
  except (urllib.error.URLError,TimeoutError):pass
  if any(inspect_owned(k,v)['State']['Status']=='exited' for k,v in record['containers'].items()):break
  time.sleep(2)
 raise RuntimeError('Private Auth gateway readiness failed; no credential use')
'''

PREPARE=r'''
if path.exists():raise RuntimeError('Attempt 2 already prepared; reconcile, never reset history')
if int(re.search(r'^MemAvailable:\s+(\d+)',Path('/proc/meminfo').read_text(),re.M)[1])<3*1024*1024:
 raise RuntimeError('Insufficient OS headroom for isolated 896MiB test services')
for service in ('auth','rest','kong'):
 if run(['docker','ps','-a','--filter','name=^/ir35-p4-auth2-'+service+'$','--format','{{.ID}}']).strip():raise RuntimeError('Owned test container collision')
record={'purpose':'ir35-owner-authorized-second-password-attempt','target':name,'previousAttempt':'p4-auth-login.json',
 'previousResult':'LOGIN_DENIED','globalPasswordAttempts':1,'authorizedAdditionalAttempts':1,'passwordAttempts':0,'status':'PREPARING','containers':{}}
save()
components=component_env(values)
for service in ('auth','rest'):
 key='GOTRUE_DB_DATABASE_URL' if service=='auth' else 'PGRST_DB_URI'
 uri=urlsplit(components[service][key])
 if uri.hostname!='db' or uri.port!=5432:raise RuntimeError('Private DB URI required')
 components[service][key]=urlunsplit((uri.scheme,uri.netloc,'/'+name,uri.query,''))
components['auth'].update(GOTRUE_LOG_LEVEL='info',GOTRUE_REQUEST_ID_HEADER='X-Request-ID',GOTRUE_DB_MAX_POOL_SIZE='3')
components['rest']['PGRST_DB_POOL']='3'
if components['auth'].get('GOTRUE_SMTP_HOST')!='smtp' or components['auth'].get('GOTRUE_SMTP_PORT')!='1025':raise RuntimeError('SMTP sink only')
for service in ('auth','rest','kong'):
 envpath=ROOT/('.env.p4-auth2-'+service)
 if envpath.exists() or envpath.is_symlink():raise RuntimeError('Fresh private env collision')
 if service=='kong':
  config=stack.kong_config(values['ANON_KEY'],values['SERVICE_ROLE_KEY'])
  config['services']=[s for s in config['services'] if s['name']=='rest-v1' or s['name']=='auth-v1' or s['name'].startswith('auth-open-')]
  for item in config['services']:
   for upstream,port in (('auth',9999),('rest',3000)):
    if item['url'].startswith('http://'+upstream+':'):
     cid=record['containers'][upstream];ip=inspect_owned(upstream,cid)['NetworkSettings']['Networks'][network]['IPAddress']
     item['url']=item['url'].replace('http://'+upstream+':'+str(port),'http://'+ip+':'+str(port))
  configpath=ROOT/'.env.p4-auth2-kong-config.json'
  if configpath.exists() or configpath.is_symlink():raise RuntimeError('Fresh gateway config collision')
  write(configpath,json.dumps(config),0o600,1002)
 write(envpath,env_text(components[service]),0o600,1002)
 pin=PINS[service]
 args=['docker','run','-d','--name','ir35-p4-auth2-'+service,'--label','ir35.purpose=owner-authorized-auth-attempt2',
 '--network',network,'--user','1002:1002','--memory',{'auth':'256m','rest':'256m','kong':'384m'}[service],
 '--pids-limit','128','--cap-drop','ALL','--security-opt','no-new-privileges','--restart','no','--log-driver','none',
 '--mount','type=bind,src='+str(envpath)+',dst='+str(envpath)+',readonly',
 '--mount','type=bind,src=/opt/ir35/bin/env-exec,dst=/run/ir35/env-exec,readonly']
 if service=='kong':args+=['--tmpfs','/run/kong:rw,uid=1002,gid=1002,mode=0700','--ulimit','nofile=4096:4096',
 '--mount','type=bind,src='+str(configpath)+',dst=/run/ir35/.env.kong-config.json,readonly']
 record['status']='START_PENDING';save()
 cid=run(args+['--entrypoint','/run/ir35/env-exec',pin['image'],str(envpath),*pin['entrypoint'],*pin['command']]).strip()
 record['containers'][service]=cid;save();inspect_owned(service,cid)
gateway=wait_health()
# Prove live, request-ID-scoped log capture without any password or OTP.
preflight_rid=str(uuid.uuid4());preflight_lines=[]
preflight_attach=subprocess.Popen(['docker','attach','--no-stdin','--sig-proxy=false',record['containers']['auth']],stdout=subprocess.PIPE,stderr=subprocess.STDOUT)
def collect_preflight():
 total=0
 for line in iter(preflight_attach.stdout.readline,b''):
  total+=len(line)
  if total<=131072:preflight_lines.append(line)
preflight_thread=threading.Thread(target=collect_preflight,daemon=True);preflight_thread.start();time.sleep(.5)
# No password, OTP or user mutation: health/settings and key-auth negative controls.
checks={'healthWithApikey':http(gateway+'/auth/v1/health',headers={'apikey':values['ANON_KEY']})[0]==200,
 'missingApikeyRejected':http(gateway+'/auth/v1/settings')[0]==401,
 'invalidApikeyRejected':http(gateway+'/auth/v1/settings',headers={'apikey':'not-a-valid-key'})[0] in (401,403),
 'passwordRouteStripsPrefix':any(s['name']=='auth-v1' and s['routes'][0]['strip_path'] is True for s in config['services'])}
status,body,_=http(gateway+'/auth/v1/settings',headers={'apikey':values['ANON_KEY'],'X-Request-ID':preflight_rid})
settings=json.loads(body) if status==200 else {}
checks['emailEnabledViaGateway']=settings.get('external',{}).get('email') is True
checks['confirmationRequiredViaGateway']=settings.get('mailer_autoconfirm') is False
if not all(checks.values()):stop_all();record['status']='CONFIG_FAIL';save();raise RuntimeError('Auth gateway config check failed before credentials')
'''

READY=r'''
stop_all()
preflight_thread.join(timeout=5)
if preflight_attach.poll() is None:preflight_attach.terminate();preflight_attach.wait(timeout=5)
projected=correlated_logs(b''.join(preflight_lines).decode('utf-8','replace'),preflight_rid)
checks['requestCorrelatedLogsCaptured']=len(projected)>0
if not checks['requestCorrelatedLogsCaptured']:
 record['status']='LOG_CAPTURE_FAIL';save();raise RuntimeError('Request-correlated log capture failed before password prompt')
if prelogin.get('status')!='PASS':record['status']='FIDELITY_FAIL';save();raise RuntimeError('Pre-login full data/schema mismatch; STOP')
record.update(status='READY_STOPPED',configChecks=checks,preloginFidelity=True);save()
print(json.dumps({'status':'READY_STOPPED','passwordRequested':False,'passwordAttempts':0,'globalPasswordAttempts':1,
 'previousDeniedAttemptPreserved':True,'configChecks':checks,'fullFidelity':prelogin,'sourceWrites':0,'stagingWrites':0}))
'''

STATUS=r'''
record=json.loads(path.read_text())
if record.get('purpose')!='ir35-owner-authorized-second-password-attempt' or record.get('target')!=name or record.get('authorizedAdditionalAttempts')!=1:
 raise RuntimeError('Explicit owner attempt-2 journal required')
print(json.dumps({'status':record['status'],'passwordAttempts':record['passwordAttempts'],
 'globalPasswordAttempts':record['globalPasswordAttempts'],'passwordRequested':False}))
'''

RESUME=r'''
record=json.loads(path.read_text())
if record.get('purpose')!='ir35-owner-authorized-second-password-attempt' or record.get('target')!=name or record.get('status')!='READY_STOPPED' or record.get('passwordAttempts')!=0 or record.get('globalPasswordAttempts')!=1:
 raise RuntimeError('Exactly one owner-authorised second attempt; never replay a credential')
for service,cid in record['containers'].items():
 if inspect_owned(service,cid)['State']['Status']!='exited':raise RuntimeError('Prepared stopped containers required')
record['status']='RESUMING';save()
for cid in record['containers'].values():run(['docker','start',cid])
gateway=wait_health()
'''

FINISH=r'''
if prelogin.get('status')!='PASS':stop_all();record['status']='FIDELITY_FAIL';save();raise RuntimeError('Full data/schema mismatch; no credential submitted')
authcid=record['containers']['auth']
# Live attach streams exist only in RAM. Docker log-driver remains none.
logs=[];log_bytes=[0]
attached=subprocess.Popen(['docker','attach','--no-stdin','--sig-proxy=false',authcid],stdout=subprocess.PIPE,stderr=subprocess.STDOUT)
def collect():
 for line in iter(attached.stdout.readline,b''):
  log_bytes[0]+=len(line)
  if log_bytes[0]<=131072:logs.append(line)
thread=threading.Thread(target=collect,daemon=True);thread.start();time.sleep(.5)
rid=str(uuid.uuid4());record.update(status='PASSWORD_PENDING',passwordAttempts=1,globalPasswordAttempts=2,requestId=rid);save()
try:
 status,body,headers=http(gateway+'/auth/v1/token?grant_type=password',body={'email':'anvesh.mannuru+ir35test@gmail.com','password':PASSWORD},
  headers={'apikey':values['ANON_KEY'],'X-Request-ID':rid})
 diagnostic=response_diagnostic(status,body,headers,rid)
 if status!=200:
  record.update(status='LOGIN_DENIED',diagnostic=diagnostic)
 else:
  reply=json.loads(body);token=reply.get('access_token','');parts=token.split('.')
  if len(parts)!=3:raise RuntimeError('Staging session token missing')
  signature=base64.urlsafe_b64encode(hmac.new(values['JWT_SECRET'].encode(),'.'.join(parts[:2]).encode(),hashlib.sha256).digest()).decode().rstrip('=')
  claims=json.loads(base64.urlsafe_b64decode(parts[1]+'='*((4-len(parts[1])%4)%4)))
  ids=json.loads(read("SELECT jsonb_agg(id::text) FROM auth.users WHERE lower(email)='anvesh.mannuru+ir35test@gmail.com';"))
  if not hmac.compare_digest(signature,parts[2]) or ids!=[claims.get('sub')] or claims.get('aud')!='authenticated' or claims.get('role')!='authenticated' or claims.get('exp',0)<=time.time():
   raise RuntimeError('Staging token identity/audience/signature/expiry mismatch')
  bearer={'apikey':values['ANON_KEY'],'Authorization':'Bearer '+token}
  user_status,user_body,_=http(gateway+'/auth/v1/user',headers=bearer)
  user=json.loads(user_body) if user_status==200 else {}
  if user.get('id')!=ids[0] or user.get('email')!='anvesh.mannuru+ir35test@gmail.com':raise RuntimeError('Real staging session identity mismatch')
  profile_status,profile_body,_=http(gateway+'/rest/v1/profiles?select=id',headers=bearer)
  profiles=json.loads(profile_body) if profile_status==200 else None
  if not isinstance(profiles,list) or any(row.get('id')!=ids[0] for row in profiles):raise RuntimeError('Owner RLS leaked another profile or rejected the session')
  denied_status,denied_body,_=http(gateway+'/rest/v1/profiles?select=id&id=neq.'+ids[0],headers=bearer)
  if denied_status!=200 or json.loads(denied_body)!=[]:raise RuntimeError('Cross-owner RLS negative failed')
  anon_status,anon_body,_=http(gateway+'/rest/v1/profiles?select=id',headers={'apikey':values['ANON_KEY']})
  if anon_status not in (401,403) and not (anon_status==200 and json.loads(anon_body)==[]):raise RuntimeError('Anonymous private-profile access leaked')
  logout_status,_,_=http(gateway+'/auth/v1/logout?scope=local',body={},headers=bearer)
  if logout_status not in (200,204):raise RuntimeError('Test session logout failed')
  record.update(status='PASS',passwordLogin=True,stagingJWTVerified=True,sessionUserVerified=True,ownerRLS=True,crossOwnerDenied=True,anonDenied=True,testSessionLoggedOut=True,diagnostic=diagnostic)
except Exception:
 record['status']='CHECK_FAILED';raise
finally:
 stop_all();thread.join(timeout=5)
 if attached.poll() is None:attached.terminate();attached.wait(timeout=5)
 record['correlatedLogs']=correlated_logs(b''.join(logs).decode('utf-8','replace'),rid)
 record['logCaptureBoundExceeded']=log_bytes[0]>131072
 record['containersStopped']=True;save()
print(json.dumps({'status':record['status'],'passwordLogin':record.get('passwordLogin',False),'attempt':2,
 'diagnostic':record.get('diagnostic'), 'correlatedLogs':record['correlatedLogs'],'containersStopped':True,
 'sessionUserVerified':record.get('sessionUserVerified',False),'ownerRLS':record.get('ownerRLS',False),
 'crossOwnerDenied':record.get('crossOwnerDenied',False),'anonDenied':record.get('anonDenied',False),
 'testSessionLoggedOut':record.get('testSessionLoggedOut',False),'sourceWrites':0,'phaseComplete':False,
 'note':'Test-account session writes are intentional on staging only; immutable pre-login full fidelity retained.'}))
'''


def guest(mode,password=''):
    pins=json.loads((schema.REPO/'infra/oracle/staging-images.json').read_text())['images']
    replacements={'TARGET':repr(storage_compat.NAME),'PINS':repr(pins),'PASSWORD':repr(password),'EXPIRY_SQL':repr(rehearsal.EXPIRY_SQL)}
    for key,file in (('EXTENSION_SQL','oracle_extension_security.sql'),('PRIVILEGE_SQL','oracle_effective_privileges.sql'),('TRANSPORT_SQL','oracle_transport_catalog.sql'),('INVENTORY_SQL','oracle_data_inventory.sql')):
        replacements[key]=repr((schema.REPO/'supabase/verification'/file).read_text())
    substitute=lambda text:re.sub(r'\b('+'|'.join(replacements)+r')\b',lambda m:replacements[m[0]],text)
    source=substitute(COMMON+({'prepare':PREPARE,'status':STATUS,'login':RESUME}[mode]))
    if mode!='status':
        audit=rehearsal_audit.GUEST.replace('ir35_rehearsal_a_20261021',storage_compat.NAME).replace('config/p4-rehearsal.json','config/p4-storage-compat.json')
        tree=ast.parse(audit);tree.body[-1]=ast.Assign(targets=[ast.Name(id='prelogin',ctx=ast.Store())],value=tree.body[-1].value.args[0].args[0])
        audit_code=substitute(ast.unparse(ast.fix_missing_locations(tree)))
        # Embedded scripts must not share mutable globals (path/name/record).
        source+='\naudit_context=dict(globals())\nexec('+repr(audit_code)+',audit_context)\nprelogin=audit_context["prelogin"]\nread=audit_context["read"]\n'+substitute(READY if mode=='prepare' else FINISH)
    return schema.guest_bundle(rehearsal=True)+owner_parity.BASE+rehearsal.verification_modules()+'\nfrom urllib.parse import urlunsplit\n'+Path(auth_redaction.__file__).read_text()+'\n'+source


def get_status():return schema.run_guest(guest('status'),timeout=90)


def main():
    # Integrity hold precedes SSH, preparation and hidden credential reads.
    hold=schema.REPO/'docs/evidence/oracle-p4-auth-reference-integrity.json'
    if hold.exists():raise ValueError('Source reference integrity hold; no runtime or credential retry')
    if sys.argv[1:]==['--status']:print(json.dumps(get_status()));return
    if sys.argv[1:] not in (['--prepare'],['--stdin-secret']):raise ValueError('Explicit mode; never password arguments')
    diagnosis=json.loads((schema.REPO/'docs/evidence/oracle-p4-auth-diagnosis.json').read_text())
    if diagnosis.get('status')!='PASS' or not diagnosis['account']['passwordMD5EqualsCloud'] or not all(diagnosis['fieldParity'].values()):raise ValueError('Cloud account parity required')
    if sys.argv[1:]==['--prepare']:
        result=schema.run_guest(guest('prepare'),timeout=360);PREPARE_REPORT.write_text(json.dumps(result,indent=2)+'\n');print(json.dumps({'status':result['status'],'passwordRequested':False}));return
    if get_status().get('status')!='READY_STOPPED':raise ValueError('Not ready; do not ask for/read a password')
    data=json.loads(sys.stdin.read(4097))
    if set(data)!={'password'} or not isinstance(data['password'],str) or not 1<=len(data['password'])<=512:raise ValueError('Bounded hidden stdin only')
    result=schema.run_guest(guest('login',data.pop('password')),timeout=360)
    REPORT.write_text(json.dumps(result,indent=2)+'\n');print(json.dumps({'status':result['status'],'passwordLogin':result['passwordLogin'],'attempt':2}))


if __name__=='__main__':
    try:main()
    except Exception as error:
        print(json.dumps({'status':'FAIL','code':type(error).__name__,'rawOutput':'withheld'}));raise SystemExit(1)
