"""New isolated restore of the frozen cloud archive; never replay the failed clone."""
import inspect
import json
from pathlib import Path
import re
import sys
import time

import cloud_schema as schema
import owner_parity
import rehearsal
import storage_release
import storage_source
import storage_target
import data_fingerprint

NAME = 'ir35_storage_compat_a_20261021'
REPORT = schema.REPO/'docs/evidence/oracle-p4-storage-compatible-restore.json'

ACCESS_TESTS=r'''
def http(path,token=None,payload=None):
 headers={'Accept-Encoding':'identity'}
 if token:headers['Authorization']='Bearer '+token
 body=None
 if payload is not None:body=json.dumps(payload).encode();headers['Content-Type']='application/json'
 request=urllib.request.Request('http://'+ip+':5000'+path,headers=headers,data=body,method='POST' if body is not None else 'GET')
 try:
  with opener.open(request,timeout=20) as response:return response.status,response.read(52_428_801)
 except urllib.error.HTTPError as error:return error.code,b''
def jwt_for_test():
 now=int(time.time());claims={'role':'authenticated','aud':'authenticated','sub':access['testUserId'],
  'email':'anvesh.mannuru+ir35test@gmail.com','iat':now,'exp':now+300}
 encode=lambda value:base64.urlsafe_b64encode(json.dumps(value,separators=(',',':')).encode()).decode().rstrip('=')
 message=encode({'alg':'HS256','typ':'JWT'})+'.'+encode(claims)
 signature=base64.urlsafe_b64encode(hmac.new(values['JWT_SECRET'].encode(),message.encode(),hashlib.sha256).digest()).decode().rstrip('=')
 return message+'.'+signature
access_results={}
for role,token in (('anon',component['ANON_KEY']),('authenticated',jwt_for_test())):
 expected=access['roles'][role];allowed=set(expected['objectPathHashes'])
 status,body=http('/bucket',token)
 if status!=200:raise RuntimeError('Valid staging role token rejected by bucket endpoint: '+role)
 buckets=json.loads(body)
 if sorted(hashlib.sha256(row['id'].encode()).hexdigest() for row in buckets)!=expected['bucketNameHashes']:
  raise RuntimeError('Cloud-vs-staging bucket RLS mismatch: '+role)
 accepted=0;denied=0
 for obj in source['storage']['privateObjects']:
  path='/object/authenticated/'+quote(obj['bucket'],safe='')+'/'+quote(obj['name'],safe='/')
  status,body=http(path,token)
  if obj['pathHash'] in allowed:
   if status!=200 or str(len(body))!=obj['bytes'] or hashlib.sha256(body).hexdigest()!=obj['sha256']:
    raise RuntimeError('Cloud-vs-staging allowed object RLS/bytes mismatch: '+role)
   accepted+=1
  else:
   if status not in (400,403,404):raise RuntimeError('Cloud-vs-staging denied object RLS mismatch: '+role)
   denied+=1
 access_results[role]={'bucketListMatchesCloud':True,'allowed':accepted,'denied':denied,'objectChecks':accepted+denied}
signed_checks=0
for obj in source['storage']['privateObjects']:
 suffix=quote(obj['bucket'],safe='')+'/'+quote(obj['name'],safe='/')
 status,body=http('/object/sign/'+suffix,component['SERVICE_KEY'],{'expiresIn':60})
 if status!=200:raise RuntimeError('Staging signed URL generation failed')
 signed=json.loads(body).get('signedURL');parsed=urlsplit(signed) if isinstance(signed,str) else None
 if not parsed or parsed.scheme or parsed.netloc or not parsed.path.startswith('/object/sign/') or not parsed.query:
  raise RuntimeError('Signed URL origin/path safety failed; token withheld')
 status,body=http(signed)
 if status!=200 or str(len(body))!=obj['bytes'] or hashlib.sha256(body).hexdigest()!=obj['sha256']:
  raise RuntimeError('Staging signed URL bytes mismatch; STOP')
 signed_checks+=1
 if signed_checks==1:
  status,_=http(parsed.path+'?token=invalid')
  if status not in (400,401,403):raise RuntimeError('Invalid signed URL token was not denied')
if json.loads(read(STORAGE_SQL))!=original:raise RuntimeError('Signed URL/RLS probes changed source-matching Storage metadata; STOP')
entry['signedURLChecks']=signed_checks;entry['accessChecks']=access_results;write(ledger_path,json.dumps(ledger),0o600)
'''

HEADER = r'''
cycle=1;name=TARGET
ledger_path=ROOT/'config/p4-storage-compat.json'
if ledger_path.exists():raise RuntimeError('Compatibility restore already journalled; reconcile, never replay')
old=json.loads((ROOT/'config/p4-rehearsal.json').read_text())
if old.get('purpose')!='ir35-owner-full-copy-rehearsal' or old['cycles']['1'].get('target')!='ir35_rehearsal_a_20261021':
 raise RuntimeError('Original quarantined source identity required')
original=old['cycles']['1'];dump_path=ROOT/'.env.p4-cycle1.dump';bundle_path=ROOT/'.env.p4-cycle1-source.json'
for path in (dump_path,bundle_path):
 s=path.lstat()
 if not stat.S_ISREG(s.st_mode) or s.st_uid!=1002 or stat.S_IMODE(s.st_mode)!=0o600 or s.st_nlink!=1:
  raise RuntimeError('Private archive custody mismatch')
archive=dump_path.read_bytes();bundle=bundle_path.read_bytes()
if hashlib.sha256(archive).hexdigest()!=ARCHIVE_HASH or ARCHIVE_HASH!=original['archiveSHA256']:
 raise RuntimeError('Frozen archive hash mismatch; STOP')
if hashlib.sha256(bundle).hexdigest()!=BUNDLE_HASH or BUNDLE_HASH!=original['sourceBundleSHA256']:
 raise RuntimeError('Frozen source bundle hash mismatch; STOP')
source=json.loads(bundle)
if not source.get('snapshotBound') or not source.get('sequenceStable') or not source.get('storageStable'):
 raise RuntimeError('Exact consistent source snapshot required')
usage=role_usage()
def execute(sql,database='postgres',transaction=True,log=None):
 if database not in ('postgres',name):raise RuntimeError('Fixed isolated compatibility destination only')
 args=base+['psql','-XqAt','-v','ON_ERROR_STOP=1','-v','VERBOSITY=sqlstate','-U','supabase_admin','-d',database,'-f','-']
 if transaction:args.append('--single-transaction')
 result=subprocess.run(args,input=sql,capture_output=True,text=True,timeout=180)
 if log:log.write(result.stdout.encode());log.write(result.stderr.encode());log.flush();os.fsync(log.fileno())
 if result.returncode:raise RuntimeError('Compatibility SQL failed; protected log only, never skip')
 return result.stdout
def catalog(database):return json.loads(execute('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; SET LOCAL search_path=pg_catalog;\n'+CATALOG_SQL+'\nROLLBACK;',database,False))
def read(sql,database=name):return execute('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; '+SETTINGS+sql+' ROLLBACK;',database,False)
roles=lambda cat:{x['kind']+':'+x['name']:x['hash'] for x in cat['objects'] if x['kind'] in ('role','role-membership')}
if roles(catalog('postgres'))!=roles(source['catalog']) or json.loads(read(EXPIRY_SQL,'postgres'))!=source['roleExpiry']:
 raise RuntimeError('Cluster role snapshot mismatch; no role/password changes permitted')
if execute("SELECT 1 FROM pg_database WHERE datname='"+name+"';").strip():
 raise RuntimeError('Unowned compatibility destination collision; no overwrite')
available=int(next(line.split()[1] for line in Path('/proc/meminfo').read_text().splitlines() if line.startswith('MemAvailable:')))*1024
if available<2*1024**3 or shutil.disk_usage(ROOT/'data').free<2*1024**3:
 raise RuntimeError('Free envelope headroom insufficient; no restore')
entry={'status':'INTENT','target':name,'archiveSHA256':ARCHIVE_HASH,'sourceBundleSHA256':BUNDLE_HASH,'attempts':1,'customerData':True}
ledger={'purpose':'ir35-owner-exact-storage-compatibility','cycles':{'1':entry}}
write(ledger_path,json.dumps(ledger),0o600)
'''


def replace_once(text, before, after):
    if text.count(before)!=1:
        raise ValueError('Reviewed helper layout changed; no remote execution')
    return text.replace(before,after,1)


def check_reference_integrity():
    if (schema.REPO/'docs/evidence/oracle-p4-auth-reference-integrity.json').exists():
        raise ValueError('Source reference integrity hold; no restore, API or replay')


def gates():
    check_reference_integrity()
    image=json.loads(storage_release.PIN.read_text())
    fixture=json.loads(storage_release.FIXTURE_REPORT.read_text())
    exported=json.loads(storage_release.SOURCE_REPORT.read_text())
    if (image.get('migrationFixtureVerified') is not True or fixture.get('status')!='PASS'
            or fixture.get('altered')!=[] or fixture.get('missing')!=[] or fixture.get('pending')!=[]
            or fixture.get('image')!=image.get('image') or fixture.get('archiveSHA256')!=exported.get('archiveSHA256')):
        raise ValueError('Exact digest/native metadata fixture required before new restore')
    if storage_release.compare(exported['migrations'],fixture['migrations'])['status']!='PASS':
        raise ValueError('Fixture rows do not match the exported history')
    return image,exported


def restore_guest(exported):
    # Reuse the already tested restore/normalization/full-comparison tail, not
    # the old capture/role-write/journal path. Both targets remain independent.
    marker="entry['status']='CREATE_PENDING';write(ledger_path,json.dumps(ledger),0o600)"
    tail=rehearsal.GUEST[rehearsal.GUEST.index(marker):]
    tail=replace_once(tail,"'.env.p4-cycle'","'.env.p4-compat'")
    script=HEADER+tail
    replacements={'TARGET':repr(NAME),'ARCHIVE_HASH':repr(exported['archiveSHA256']),
                  'BUNDLE_HASH':repr(exported['sourceBundleSHA256']),'EXPIRY_SQL':repr(rehearsal.EXPIRY_SQL)}
    for token,path in (('EXTENSION_SQL','oracle_extension_security.sql'),('PRIVILEGE_SQL','oracle_effective_privileges.sql'),('TRANSPORT_SQL','oracle_transport_catalog.sql'),('INVENTORY_SQL','oracle_data_inventory.sql')):
        replacements[token]=repr((schema.REPO/'supabase/verification'/path).read_text())
    script=re.sub(r'\b('+'|'.join(replacements)+r')\b',lambda match:replacements[match[0]],script)
    return schema.guest_bundle(rehearsal=True)+owner_parity.BASE+rehearsal.verification_modules()+script


def api_guest(image,proof):
    import storage_access
    script=storage_target.GUEST
    for before,after in (("config/p4-rehearsal.json","config/p4-storage-compat.json"),
                         ("ir35-owner-full-copy-rehearsal","ir35-owner-exact-storage-compatibility"),
                         ("ROOT/'data/rehearsal'","ROOT/'data/storage-compat'"),
                         ("'ir35-p4-storage-'","'ir35-p4-compatible-storage-'"),
                         ("'.env.p4-storage'","'.env.p4-compat-storage'")):
        # The parent path occurs twice; each exact replacement is intentional.
        if before not in script:raise ValueError('Reviewed Storage helper layout changed')
        script=script.replace(before,after)
    script=replace_once(script,"source=json.loads(bundle.read_text());entry['sourceBundleSHA256']=hashlib.sha256(bundle.read_bytes()).hexdigest()",
        "if hashlib.sha256(bundle.read_bytes()).hexdigest()!=entry['sourceBundleSHA256']:raise RuntimeError('Frozen source bundle changed; STOP')\nsource=json.loads(bundle.read_text())")
    script=replace_once(script,"if original!=source['storage']['metadata']:raise RuntimeError('Restored Storage metadata mismatch; no byte copy')",
        "if original!=source['storage']['metadata']:raise RuntimeError('Restored Storage metadata mismatch; no byte copy')\n"
        "access_path=ROOT/'.env.p4-storage-access-source.json';s=access_path.lstat()\n"
        "if not stat.S_ISREG(s.st_mode) or s.st_uid!=1002 or stat.S_IMODE(s.st_mode)!=0o600 or s.st_nlink!=1:raise RuntimeError('Private source access snapshot custody mismatch')\n"
        "access=json.loads(access_path.read_text())\n"
        "if access.get('purpose')!='ir35-readonly-cloud-storage-policy-snapshot':raise RuntimeError('Source access snapshot purpose mismatch')\n"
        "if digest(original)!=access['metadataSHA256'] or digest(storage_security(source['catalog']))!=access['storageSecuritySHA256']:raise RuntimeError('Source policy/metadata changed; STOP')\n"
        "test_id=json.loads(read(\"SELECT coalesce(jsonb_agg(id::text),'[]'::jsonb) FROM auth.users WHERE lower(email)='anvesh.mannuru+ir35test@gmail.com';\"))\n"
        "if test_id!=[access['testUserId']]:raise RuntimeError('Named test identity mismatch; STOP')")
    script=replace_once(script,"entry['status']='STORAGE_BYTES_VERIFIED';",ACCESS_TESTS+"\nentry['status']='STORAGE_BYTES_VERIFIED';")
    script=replace_once(script,"'metadataUnchanged':True,'containerRemoved':True,",
        "'metadataUnchanged':True,'containerRemoved':True,'signedURLChecks':signed_checks,'accessChecks':access_results,'cloudPolicySQLCompared':True,'cloudLogin':False,'testAccountLogin':False,")
    replacements={'CYCLE':'1','TARGET':repr(NAME),'EXPECTED_TABLES':repr(proof['tables']),
                  'STORAGE_SQL':repr(storage_source.SQL),'PINS':repr({'images':{'storage':image['image']}})}
    script=re.sub(r'\b('+'|'.join(replacements)+r')\b',lambda match:replacements[match[0]],script)
    helper=inspect.getsource(storage_target.backend_path)+'\n'+inspect.getsource(storage_source.NoRedirect).replace('class NoRedirect','class NO_REDIRECT')+'\n'
    helper+='\n'+inspect.getsource(storage_access.digest)+'\n'+inspect.getsource(storage_access.storage_security)+'\n'
    return schema.guest_bundle(rehearsal=True)+owner_parity.BASE+Path(data_fingerprint.__file__).read_text()+'\nfrom pathlib import PurePosixPath\n'+helper+script


def main():
    image,exported=gates()
    if sys.argv[1:]==['--restore']:
        started=time.monotonic()
        result=schema.run_guest(restore_guest(exported),timeout=600)
        result['durationSeconds']=round(time.monotonic()-started,3)
        result['compatibilityImage']=image['image']
        REPORT.write_text(json.dumps(result,indent=2)+'\n')
        print(json.dumps({'status':result['status'],'tables':len(result.get('tables',[])), 'sourceWrites':0,'phaseComplete':False}))
    elif sys.argv[1:]==['--storage-api']:
        proof=json.loads(REPORT.read_text())
        if proof.get('status')!='TABLES_VERIFIED' or proof.get('target')!=NAME or proof.get('dataDifferences')!=[]:
            raise ValueError('New isolated restore full table proof required')
        result=schema.run_guest(api_guest(image,proof),timeout=300)
        path=schema.REPO/'docs/evidence/oracle-p4-storage-compatible-api.json'
        path.write_text(json.dumps(result,indent=2)+'\n')
        print(json.dumps({'status':result['status'],'objects':result['objectCount'],'phaseComplete':False}))
    elif sys.argv[1:]==['--post-audit']:
        import rehearsal_audit
        script=rehearsal_audit.GUEST.replace('ir35_rehearsal_a_20261021',NAME).replace('config/p4-rehearsal.json','config/p4-storage-compat.json')
        replacements={'EXPIRY_SQL':repr(rehearsal.EXPIRY_SQL)}
        for key,file in (('EXTENSION_SQL','oracle_extension_security.sql'),('PRIVILEGE_SQL','oracle_effective_privileges.sql'),('TRANSPORT_SQL','oracle_transport_catalog.sql'),('INVENTORY_SQL','oracle_data_inventory.sql')):
            replacements[key]=repr((schema.REPO/'supabase/verification'/file).read_text())
        script=re.sub(r'\b('+'|'.join(replacements)+r')\b',lambda match:replacements[match[0]],script)
        result=schema.run_guest(schema.guest_bundle(rehearsal=True)+owner_parity.BASE+rehearsal.verification_modules()+script,timeout=240)
        path=schema.REPO/'docs/evidence/oracle-p4-storage-compatible-post-audit.json'
        path.write_text(json.dumps(result,indent=2)+'\n')
        print(json.dumps({'status':result['status'],'tables':result['tableChecks'],'sequences':result['sequenceChecks'],'sourceWrites':0,'stagingWrites':0}))
    else:raise ValueError('Explicit new isolated restore or API stage required')


if __name__=='__main__':
    try:main()
    except Exception as error:
        print(json.dumps({'status':'FAIL','code':str(error) if isinstance(error,RuntimeError) else type(error).__name__,'rawOutput':'withheld'}));raise SystemExit(1)
