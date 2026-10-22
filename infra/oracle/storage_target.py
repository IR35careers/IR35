"""Isolated file-backend transport and private read-only Storage API proof."""
import inspect
import json
from pathlib import Path,PurePosixPath
import re
import sys
import cloud_schema as schema
import data_fingerprint as fp
import owner_parity
import rehearsal
from key_ceremony import KeySafetyError


def backend_path(bucket,name,version):
    for value in (bucket,name):
        if (not isinstance(value,str) or not value or PurePosixPath(value).is_absolute() or
            any(x in ('','..','.') for x in value.split('/')) or any(x in value for x in ('\\','\x00','\r','\n'))):
            raise ValueError('Unsafe Storage backend locator; raw path withheld')
    if '/' in bucket:raise ValueError('Bucket path separator refused')
    if version is not None and (not isinstance(version,str) or not re.fullmatch(r'[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}',version)):raise ValueError('Reviewed immutable object version required')
    # Exact pinned v1.81.0 TenantLocation + withOptionalVersion, TUS separator off.
    return 'ir35-staging/ir35-staging/'+bucket+'/'+name+('/'+version if version else '')


GUEST=r'''
cycle=CYCLE;name=TARGET
ledger_path=ROOT/'config/p4-rehearsal.json';ledger=json.loads(ledger_path.read_text());entry=ledger['cycles'].get(str(cycle),{})
if ledger.get('purpose')!='ir35-owner-full-copy-rehearsal' or entry.get('status')!='TABLES_VERIFIED' or entry.get('target')!=name:
 raise RuntimeError('Exactly verified isolated table restore required; no API/start/replay')
if entry.get('storageStarted'):raise RuntimeError('Storage attempt already journalled; reconcile, never blind replay')
bundle=ROOT/('.env.p4-cycle'+str(cycle)+'-source.json');archive=ROOT/('.env.p4-cycle'+str(cycle)+'.dump')
for path in (bundle,archive):
 s=path.lstat()
 if not stat.S_ISREG(s.st_mode) or s.st_uid!=1002 or stat.S_IMODE(s.st_mode)!=0o600 or s.st_nlink!=1:raise RuntimeError('Private source custody changed')
if hashlib.sha256(archive.read_bytes()).hexdigest()!=entry['archiveSHA256']:raise RuntimeError('Verified archive changed; STOP')
source=json.loads(bundle.read_text());entry['sourceBundleSHA256']=hashlib.sha256(bundle.read_bytes()).hexdigest()
if source['rows']['tables']!=EXPECTED_TABLES:raise RuntimeError('Private bundle differs from recorded exact table proof')
def read(sql):
 result=subprocess.run(base+['psql','-XqAt','-v','ON_ERROR_STOP=1','-U','supabase_admin','-d',name,'-f','-'],
  input='BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; '+SETTINGS+sql+' ROLLBACK;',capture_output=True,text=True,timeout=90)
 if result.returncode:raise RuntimeError('Read-only Storage verification SQL failed; values withheld')
 return result.stdout
original=json.loads(read(STORAGE_SQL))
if original!=source['storage']['metadata']:raise RuntimeError('Restored Storage metadata mismatch; no byte copy')
root=ROOT/'data/rehearsal'/('cycle'+str(cycle))/'storage'
if root.exists() or root.is_symlink():raise RuntimeError('Unowned Storage directory collision; no overwrite')
container='ir35-p4-storage-'+str(cycle)
existing=run(['docker','ps','-a','--filter','name=^/'+container+'$','--format','{{.ID}}']).strip()
if existing:raise RuntimeError('Unowned Storage container collision; no replacement')
entry['storageStarted']=True;entry['status']='STORAGE_FILES_PENDING';write(ledger_path,json.dumps(ledger),0o600)
def mkdir(path):
 if path.exists():
  s=path.lstat()
  if not stat.S_ISDIR(s.st_mode) or s.st_uid!=1002 or stat.S_IMODE(s.st_mode)!=0o700:raise RuntimeError('Storage parent custody mismatch')
 else:path.mkdir(mode=0o700);os.chown(path,1002,1002)
for path in (ROOT/'data/rehearsal',root.parent,root):mkdir(path)
objects=[]
for obj in source['storage']['privateObjects']:
 relative=backend_path(obj['bucket'],obj['name'],obj['version']);path=root/relative
 if not path.resolve().is_relative_to(root.resolve()):raise RuntimeError('Storage path escaped isolated target')
 parent=root
 for part in Path(relative).parts[:-1]:parent=parent/part;mkdir(parent)
 body=base64.b64decode(obj['body'],validate=True)
 if len(body)!=int(obj['bytes']) or hashlib.sha256(body).hexdigest()!=obj['sha256']:raise RuntimeError('Captured Storage bytes mismatch; no edit/skip')
 fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
 with os.fdopen(fd,'wb') as f:os.fchown(f.fileno(),1002,1002);f.write(body);f.flush();os.fsync(f.fileno())
 for field,attr in (('contentType','content-type'),('cacheControl','cache-control'),('contentEncoding','content-encoding')):
  if obj.get(field):os.setxattr(path,'user.supabase.'+attr,obj[field].encode())
 if hashlib.sha256(path.read_bytes()).hexdigest()!=obj['sha256']:raise RuntimeError('On-disk Storage checksum mismatch; STOP')
 objects.append({'pathHash':obj['pathHash'],'bytes':obj['bytes'],'sha256':obj['sha256']})
entry['status']='STORAGE_FILES_VERIFIED';entry['storageFilesVerified']=True;write(ledger_path,json.dumps(ledger),0o600)
values=read_env();component=stack.component_env(values)['storage'] if hasattr(stack,'component_env') else component_env(values)['storage']
from urllib.parse import urlsplit,urlunsplit,urlencode,quote
uri=urlsplit(component['DATABASE_URL'])
if uri.hostname!='db' or uri.port!=5432 or uri.username!='supabase_storage_admin':raise RuntimeError('Private staging Storage DB identity mismatch')
component['DATABASE_URL']=urlunsplit((uri.scheme,uri.netloc,'/'+name,urlencode({'options':'-c default_transaction_read_only=on'}),''))
latest=read('SELECT name FROM storage.migrations ORDER BY id DESC LIMIT 1;').strip()
if not re.fullmatch(r'[A-Za-z0-9_-]{1,180}',latest):raise RuntimeError('Source Storage migration freeze name required')
component.update(DB_MIGRATIONS_FREEZE_AT=latest,DB_ALLOW_MIGRATION_REFRESH='false',DB_INSTALL_ROLES='false',
 TUS_USE_FILE_VERSION_SEPARATOR='false',STORAGE_FILE_ETAG_ALGORITHM='md5',PG_QUEUE_ENABLE='false',PG_QUEUE_WORKERS_ENABLE='false',
 STORAGE_LIFECYCLE_ENABLED='false',TRACING_ENABLED='false',NODE_OPTIONS='--max-old-space-size=384')
envpath=ROOT/('.env.p4-storage'+str(cycle))
write(envpath,'\n'.join(key+"='"+value+"'" for key,value in component.items())+'\n',0o600,1002)
db_container=dc('ps','-q','db').strip()
networks=json.loads(run(['docker','inspect','--format','{{json .NetworkSettings.Networks}}',db_container]))
if len(networks)!=1:raise RuntimeError('Exclusive internal DB network required')
network=next(iter(networks))
network_info=json.loads(run(['docker','network','inspect',network]))[0]
if network_info.get('Internal') is not True:raise RuntimeError('Rehearsal API must have no outbound network')
pin=PINS['images']['storage']
entry['status']='STORAGE_API_PENDING';entry['storageContainer']=container;entry['storageAPIAttempts']=1;write(ledger_path,json.dumps(ledger),0o600)
args=['docker','run','-d','--name',container,'--label','ir35.purpose=full-copy-rehearsal','--label','ir35.cycle='+str(cycle),
 '--network',network,'--user','1002:1002','--memory','512m','--pids-limit','128','--cap-drop','ALL','--security-opt','no-new-privileges',
 '--restart','no','--log-driver','none','--mount','type=bind,src='+str(root)+',dst=/var/lib/storage',
 '--mount','type=bind,src='+str(envpath)+',dst='+str(envpath)+',readonly',
 '--mount','type=bind,src=/opt/ir35/bin/env-exec,dst=/run/ir35/env-exec,readonly',
 '--entrypoint','/run/ir35/env-exec',pin['image'],str(envpath),*pin['entrypoint'],*pin['command']]
cid=run(args).strip()
entry['storageContainerId']=cid;write(ledger_path,json.dumps(ledger),0o600)
info=json.loads(run(['docker','inspect',cid]))[0]
if info['HostConfig'].get('PortBindings') or info['HostConfig']['Privileged'] or info['Config']['User']!='1002:1002' or set(info['NetworkSettings']['Networks'])!={network}:
 raise RuntimeError('Private API isolation mismatch; STOP')
ip=info['NetworkSettings']['Networks'][network]['IPAddress']
if not ipaddress.ip_address(ip).is_private:raise RuntimeError('Private API address required')
opener=urllib.request.build_opener(urllib.request.ProxyHandler({}),NO_REDIRECT())
deadline=time.monotonic()+120;healthy=False
while time.monotonic()<deadline:
 try:
  with opener.open('http://'+ip+':5000/status',timeout=3) as response:healthy=response.status==200
 except (urllib.error.URLError,TimeoutError):pass
 if healthy:break
 info=json.loads(run(['docker','inspect','--format','{{json .State}}',cid]))
 if info.get('Status')=='exited':break
 time.sleep(2)
if not healthy:
 entry['storageFailure']='READ_ONLY_FROZEN_API_HEALTH';write(ledger_path,json.dumps(ledger),0o600)
 raise RuntimeError('Read-only frozen Storage API did not become healthy; no migration permission or retry granted')
api_objects=[]
for obj in source['storage']['privateObjects']:
 url='http://'+ip+':5000/object/authenticated/'+quote(obj['bucket'],safe='')+'/'+quote(obj['name'],safe='/')
 request=urllib.request.Request(url,headers={'Authorization':'Bearer '+component['SERVICE_KEY'],'Accept-Encoding':'identity'},method='GET')
 try:
  with opener.open(request,timeout=20) as response:
   if response.status!=200 or response.geturl()!=url:raise RuntimeError('Private API GET status/origin mismatch')
   body=response.read(int(obj['bytes'])+1)
 except urllib.error.HTTPError as error:raise RuntimeError('Private Storage GET HTTP '+str(error.code)+'; path/key/body withheld') from None
 digest=hashlib.sha256(body).hexdigest()
 if len(body)!=int(obj['bytes']) or digest!=obj['sha256']:raise RuntimeError('Storage API byte mismatch; STOP without data rewrite')
 api_objects.append({'pathHash':obj['pathHash'],'bytes':str(len(body)),'sha256':digest})
if json.loads(read(STORAGE_SQL))!=original:raise RuntimeError('Read-only API changed restored Storage metadata; STOP')
entry['status']='STORAGE_BYTES_VERIFIED';entry['storageObjectCount']=len(api_objects);write(ledger_path,json.dumps(ledger),0o600)
# Stop just the exact owned ephemeral API. Retain all files/rows pending full
# verification, login/reverse rehearsal and the explicit disposable wipe guard.
info=json.loads(run(['docker','inspect',cid]))[0]
if info['Name']!='/'+container or info['Config']['Labels'].get('ir35.purpose')!='full-copy-rehearsal':raise RuntimeError('Owned API cleanup identity mismatch')
run(['docker','stop','--time','20',cid]);run(['docker','rm',cid]);envpath.unlink()
entry['storageContainerRemoved']=True;write(ledger_path,json.dumps(ledger),0o600)
print(json.dumps({'status':'PASS','cycle':cycle,'target':name,'fileBackend':True,'privateStorageAPI':True,'apiDatabaseReadOnly':True,
 'migrationFreeze':True,'objectCount':len(api_objects),'totalBytes':sum(int(x['bytes']) for x in api_objects),'objects':api_objects,
 'metadataUnchanged':True,'containerRemoved':True,'sourceWrites':0,'phaseComplete':False,'stagingWiped':False}))
'''


def guest(cycle,expected):
    import storage_source
    pins=json.loads((schema.REPO/'infra/oracle/staging-images.json').read_text())
    script=inspect.getsource(backend_path)+'\n'+inspect.getsource(storage_source.NoRedirect).replace('class NoRedirect','class NO_REDIRECT')+'\n'+GUEST
    replacements={'CYCLE':repr(cycle),'TARGET':repr(rehearsal.TARGETS[cycle]),'EXPECTED_TABLES':repr(expected),
      'STORAGE_SQL':repr(storage_source.SQL),'PINS':repr(pins)}
    script=re.sub(r'\b('+'|'.join(replacements)+r')\b',lambda m:replacements[m[0]],script)
    return schema.guest_bundle(rehearsal=True)+owner_parity.BASE+Path(fp.__file__).read_text()+'\nfrom pathlib import PurePosixPath\n'+script


def main():
    if sys.argv[1:]==['--read-back']:
        script=r'''
ledger=json.loads((ROOT/'config/p4-rehearsal.json').read_text())
allowed={'status','target','attempts','storageStarted','storageFilesVerified','storageContainer','storageContainerId','storageAPIAttempts','storageFailure','storageContainerRemoved'}
entries={key:{k:v for k,v in value.items() if k in allowed} for key,value in ledger['cycles'].items()}
rows=run(['docker','ps','-a','--filter','label=ir35.purpose=full-copy-rehearsal','--format','{{json .}}'])
containers=[{k:v for k,v in json.loads(line).items() if k in ('ID','Names','State','Status','Image')} for line in rows.splitlines() if line]
print(json.dumps({'status':'AUDIT_ONLY','cycles':entries,'containers':containers,'sourceWrites':0,'stagingWrites':0}))
'''
        print(json.dumps(schema.run_guest(schema.guest_bundle(rehearsal=True)+owner_parity.BASE+script,timeout=90)));return
    rehearsal.gates()
    if sys.argv[1:] not in (['--staging','--cycle','1'],['--staging','--cycle','2']):raise ValueError('Explicit fixed staging cycle required')
    cycle=int(sys.argv[-1]);proof=json.loads((schema.REPO/('docs/evidence/oracle-p4-cycle'+str(cycle)+'.json')).read_text())
    if proof.get('status')!='TABLES_VERIFIED' or proof.get('dataDifferences')!=[]:raise ValueError('Exact table proof required before Storage copy')
    result=schema.run_guest(guest(cycle,proof['tables']),timeout=300)
    path=schema.REPO/('docs/evidence/oracle-p4-storage-cycle'+str(cycle)+'.json')
    path.write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps({'status':result['status'],'report':str(path.relative_to(schema.REPO)),'sourceWrites':0}))


if __name__=='__main__':
    try:main()
    except Exception as error:
        print(json.dumps({'status':'FAIL','code':str(error) if isinstance(error,(RuntimeError,KeySafetyError)) else type(error).__name__,'rawOutput':'withheld'}));raise SystemExit(1)
