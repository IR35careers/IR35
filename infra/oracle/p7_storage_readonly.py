"""Fresh P7 signed download/RLS reads on the unchanged read-only P5 API."""
import inspect
import json
import sys
from urllib.parse import urlsplit
import cloud_schema as schema
import p6_capture_repair
import p7_auth_inventory as inventory
from p6_audit_log import Journal
from p6_pause_reconcile import verified_manifest


def signed_relative(value):
    if type(value)is not str or len(value)>8192:raise RuntimeError('BoundedSignedURLRequired')
    parsed=urlsplit(value)
    if parsed.scheme or parsed.netloc or not parsed.path.startswith('/object/sign/') or not parsed.query:
        raise RuntimeError('SignedURLOriginRefused')
    return value


def program(data):
    code=p6_capture_repair.bundle()+'\n'+inspect.getsource(signed_relative)
    code+='\ndata='+repr(data)+'\n'
    code+='''
import base64,hmac,hashlib,time,uuid,urllib.request,urllib.error
from urllib.parse import quote,urlsplit
from p6_mock_guest import prepared,ROOT
from web_services_guest import require_prepared,private_address
from p6_restart_diagnosis_guest import containment
from p4_recovery_guest import Recovery
prepared(data);require_prepared(data)
recovery=Recovery(data['p4'],runtime);source=recovery.source();values=runtime['read_env']()
container=json.loads(runtime['run'](['docker','inspect','ir35-p5-storage']))[0]
if (not container['State']['Running'] or container['HostConfig'].get('PortBindings')
 or container['Config']['Image']!=data['p4']['pins']['storage']['image']
 or not any(m.get('Source')=='/opt/ir35/data/p5-storage' and m.get('Destination')=='/var/lib/storage' and m.get('RW')is False for m in container['Mounts'])):
 raise RuntimeError('ExistingReadonlyStorageIdentityRequired')
address='http://'+private_address(container)+':5000'
class NoRedirect(urllib.request.HTTPRedirectHandler):
 def redirect_request(self,*args,**kwargs):raise RuntimeError('StorageRedirectRefused')
opener=urllib.request.build_opener(urllib.request.ProxyHandler({}),NoRedirect())
def request(path,headers=None,body=None):
 req=urllib.request.Request(address+path,data=None if body is None else json.dumps(body).encode(),
  headers={'Accept-Encoding':'identity','Content-Type':'application/json',**(headers or {})},method='GET' if body is None else 'POST')
 try:
  with opener.open(req,timeout=20) as reply:return reply.status,reply.read(52_428_801)
 except urllib.error.HTTPError as error:return error.code,error.read(65537)
def authenticated(uid):
 encode=lambda value:base64.urlsafe_b64encode(json.dumps(value,separators=(',',':')).encode()).rstrip(b'=')
 now=int(time.time());raw=encode({'alg':'HS256','typ':'JWT'})+b'.'+encode({'sub':uid,'aud':'authenticated','role':'authenticated','iss':'supabase','iat':now,'exp':now+600})
 return (raw+b'.'+base64.urlsafe_b64encode(hmac.new(values['JWT_SECRET'].encode(),raw,hashlib.sha256).digest()).rstrip(b'=')).decode()
fixture=Recovery(data['p4'],runtime);fixture.database='ir35_p5_app'
buckets=json.loads(fixture.query("SELECT coalesce(jsonb_object_agg(id,public),'{}') FROM storage.buckets;"))
named=fixture.query("SELECT id::text FROM auth.users WHERE lower(email)='anvesh.mannuru+ir35test@gmail.com';").strip()
if not re.fullmatch(r'[a-f0-9-]{36}',named):raise RuntimeError('NamedStorageFixtureIdentityRequired')
wrong=authenticated(str(uuid.uuid4()));owner=authenticated(named)
result={'status':'FAIL','readOnly':True,'databaseWrites':0,'objects':0,'signedURLChecks':0,'privateAnonDenials':0,
 'privateOtherUserDenials':0,'namedOwnerReads':0,'publicReads':0,'bytes':0,'pathsPrinted':False,'tokensPrinted':False,'phaseComplete':False}
try:
 for obj in source['storage']['privateObjects']:
  locator=quote(obj['bucket'],safe='')+'/'+quote(obj['name'],safe='/')
  headers={'Authorization':'Bearer '+values['SERVICE_ROLE_KEY']}
  status,body=request('/object/authenticated/'+locator,headers)
  if status!=200 or len(body)!=int(obj['bytes']) or hashlib.sha256(body).hexdigest()!=obj['sha256']:raise RuntimeError('StorageAPIByteMismatch_Abort')
  status,body=request('/object/sign/'+locator,headers,{'expiresIn':60})
  if status!=200:raise RuntimeError('StorageSignedURLCreationFailed')
  path=signed_relative(json.loads(body).get('signedURL'))
  status,body=request(path)
  if status!=200 or len(body)!=int(obj['bytes']) or hashlib.sha256(body).hexdigest()!=obj['sha256']:raise RuntimeError('StorageSignedByteMismatch_Abort')
  result['signedURLChecks']+=1;result['objects']+=1;result['bytes']+=int(obj['bytes'])
  if buckets.get(obj['bucket'])is False:
   for token,label in ((values['ANON_KEY'],'privateAnonDenials'),(wrong,'privateOtherUserDenials')):
    status,unused=request('/object/authenticated/'+locator,{'Authorization':'Bearer '+token})
    if status not in (400,401,403,404):raise RuntimeError('PrivateStorageRLSMismatch_Abort')
    result[label]+=1
   if obj['bucket']=='cvs' and obj['name'].split('/')[0]==named:
    status,body=request('/object/authenticated/'+locator,{'Authorization':'Bearer '+owner})
    if status!=200 or hashlib.sha256(body).hexdigest()!=obj['sha256']:raise RuntimeError('NamedStorageOwnerRLSMismatch_Abort')
    result['namedOwnerReads']+=1
  elif buckets.get(obj['bucket'])is True:
   status,body=request('/object/public/'+locator)
   if status!=200 or hashlib.sha256(body).hexdigest()!=obj['sha256']:raise RuntimeError('PublicStorageByteMismatch_Abort')
   result['publicReads']+=1
  else:raise RuntimeError('SourceBucketRestrictionMissing_Abort')
 result['status']='PASS'
except Exception as error:result['code']=str(error) if type(error)is RuntimeError else type(error).__name__
result['fullContainment']=containment(data,runtime,probe_container='ir35-p6-mock-worker-v7-fixedip')
if result['fullContainment']['status']!='PASS':result.update(status='FAIL',code='StoragePostContainmentMismatch_Abort')
print(json.dumps(result))
'''
    compile(code,'<p7-storage-readonly>','exec')
    return code


def main():
    if sys.argv[1:]!=['--read-only']:raise RuntimeError('ExplicitReadonlyStorageRequired')
    root=schema.REPO/'docs/evidence/p7/storage-readonly-01'
    if root.exists():raise RuntimeError('P7StorageAuditUsed_NoReplay')
    auth=schema.REPO/'docs/evidence/p7/auth-rehearsal-03'
    if verified_manifest(auth)!='67a1051c0930d544a02d86706a0b02fb29bab59de910266a46f0020f5c219595':raise RuntimeError('ActualFinalAuthPassRequired')
    if json.loads((auth/'result.json').read_bytes())['status']!='PASS':raise RuntimeError('ActualFinalAuthPassRequired')
    data=inventory.context();code=program(data);journal=Journal(root)
    result={'status':'FAIL','readOnly':True,'phaseComplete':False}
    try:result['storage']=journal.step(1,'signed-bytes-rls-containment',lambda:schema.run_guest(code,timeout=600));result['status']=result['storage']['status']
    finally:result['manifestSHA256']=journal.seal(result)
    print(json.dumps({key:value for key,value in result.items() if key!='storage'}))
    if result['status']!='PASS':raise SystemExit(1)


if __name__=='__main__':main()
