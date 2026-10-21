"""Read-only file-byte and unchanged protected-runtime audit after P4 hold."""
import inspect
import json
import acl_runtime_audit
import cloud_schema as schema
import owner_parity
import storage_target

GUEST=r'''
ledger=json.loads((ROOT/'config/p4-rehearsal.json').read_text());entry=ledger['cycles']['1']
path=ROOT/'.env.p4-cycle1-source.json'
if hashlib.sha256(path.read_bytes()).hexdigest()!=entry['sourceBundleSHA256']:raise RuntimeError('Private source bundle changed; STOP')
source=json.loads(path.read_text());root=ROOT/'data/rehearsal/cycle1/storage';expected=set();objects=[]
for obj in source['storage']['privateObjects']:
 relative=backend_path(obj['bucket'],obj['name'],obj['version']);file=root/relative;expected.add(file)
 s=file.lstat()
 if not stat.S_ISREG(s.st_mode) or s.st_uid!=1002 or stat.S_IMODE(s.st_mode)!=0o600 or s.st_nlink!=1:raise RuntimeError('Storage file custody mismatch')
 digest=hashlib.sha256(file.read_bytes()).hexdigest()
 if str(s.st_size)!=obj['bytes'] or digest!=obj['sha256']:raise RuntimeError('Storage file byte mismatch; STOP')
 objects.append({'pathHash':obj['pathHash'],'bytes':str(s.st_size),'sha256':digest})
actual=set()
for file in root.rglob('*'):
 if file.is_symlink():raise RuntimeError('Storage symlink found; STOP')
 if file.is_file():actual.add(file)
 elif file.is_dir():
  s=file.stat()
  if s.st_uid!=1002 or stat.S_IMODE(s.st_mode)!=0o700:raise RuntimeError('Storage directory custody mismatch')
if actual!=expected:raise RuntimeError('Storage file manifest coverage mismatch; STOP')
cid=entry['storageContainerId'];state=json.loads(run(['docker','inspect','--format','{{json .State}}',cid]))
if state['Status']!='exited':raise RuntimeError('Failed rehearsal API must remain stopped')
print(json.dumps({'status':'PASS','sourceWrites':0,'stagingWrites':0,'objects':objects,'objectCount':len(objects),
 'totalBytes':sum(int(x['bytes']) for x in objects),'directoriesMode':'700','filesMode':'600','owner':'ir35',
 'scratchAPIStopped':True,'apiHealthPASS':False,'phaseComplete':False}))
'''


def main():
    prefix=schema.guest_bundle(rehearsal=True)+owner_parity.BASE
    script='\nfrom pathlib import PurePosixPath\n'+inspect.getsource(storage_target.backend_path)+'\n'+GUEST
    files=schema.run_guest(prefix+script,timeout=100)
    runtime=schema.run_guest(prefix+acl_runtime_audit.GUEST,timeout=120)
    path=schema.REPO/'docs/evidence/oracle-p4-protection.json'
    path.write_text(json.dumps({'files':files,'runtime':runtime,'phaseComplete':False,'productionChanges':0},indent=2)+'\n')
    print(json.dumps({'status':'PASS','report':str(path.relative_to(schema.REPO)),'objectCount':files['objectCount'],'sourceWrites':0,'stagingWrites':0}))


if __name__=='__main__':
    try:main()
    except Exception as error:
        print(json.dumps({'status':'FAIL','code':type(error).__name__,'rawOutput':'withheld'}));raise SystemExit(1)
