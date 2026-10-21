"""Read-only containment audit after verification-reference integrity failure."""
import json
from pathlib import Path
import re
import cloud_schema as schema
import owner_parity
import rehearsal
import data_fingerprint
import storage_source
import storage_target
import storage_compat

GUEST=r'''
name=TARGET
dump=ROOT/'.env.p4-cycle1.dump';bundle=ROOT/'.env.p4-cycle1-source.json'
expected_archive='9a93fdc86e7c3a4611eefcb8b1d1ca30bc9c4ee31a7da28e2b6ee746ea91ed10'
expected_bundle='5f12f3dce1ffc29f6ad17e9085d377d7fd2ece9fefeabc831eec933ef3eeed9e'
archive_ok=hashlib.sha256(dump.read_bytes()).hexdigest()==expected_archive
if not archive_ok:raise RuntimeError('Archive integrity mismatch; STOP')
observed=hashlib.sha256(bundle.read_bytes()).hexdigest()
matches=[]
for p in ROOT.glob('.env.p4*'):
 if p.is_file() and not p.is_symlink() and p.stat().st_size<=32_000_000 and hashlib.sha256(p.read_bytes()).hexdigest()==expected_bundle:matches.append(p.name)
def read(sql):
 result=subprocess.run(base+['psql','-XqAt','-v','ON_ERROR_STOP=1','-U','supabase_admin','-d',name,'-f','-'],
  input='BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; '+SETTINGS+sql+' ROLLBACK;',capture_output=True,text=True,timeout=120)
 if result.returncode:raise RuntimeError('Containment read-only SQL failed; raw output withheld')
 return result.stdout
inventory=json.loads(read(INVENTORY_SQL));tables=[]
for table in inventory['tables']:
 value=fingerprint(base+['psql','-XqAt','-v','ON_ERROR_STOP=1','-U','supabase_admin','-d',name,'-f','-'],
  {'PATH':'/usr/sbin:/usr/bin:/sbin:/bin','LC_ALL':'C.UTF-8'},'BEGIN READ ONLY; '+SETTINGS+copy_sql(table)+' ROLLBACK;')
 tables.append({'name':table['schema']+'.'+table['name'],**value})
a={x['name']:x for x in EXPECTED_TABLES};b={x['name']:x for x in tables}
diff=[k for k in sorted(a.keys()|b.keys()) if a.get(k)!=b.get(k)]
# The unmodified custom archive independently preserves source sequence values.
result=subprocess.run(base+['pg_restore','--data-only','--file=-'],input=dump.read_bytes(),capture_output=True,timeout=90)
if result.returncode:raise RuntimeError('Archive sequence read failed; no restore executed')
archive_sequences={}
for match in re.finditer(rb"SELECT pg_catalog.setval\('([^']+)', ([0-9]+), (true|false)\);",result.stdout):
 archive_sequences[match[1].decode()]=(match[2].decode(),match[3]==b'true')
sequence_diff=[]
for seq in inventory['sequences']:
 key=seq['schema']+'.'+seq['name']
 value=json.loads(read("SELECT jsonb_build_object('value',last_value::text,'called',is_called) FROM "+identifier(seq['schema'])+'.'+identifier(seq['name'])+';'))
 if archive_sequences.get(key)!=(value['value'],value['called']):sequence_diff.append(key)
if len(archive_sequences)!=len(inventory['sequences']):sequence_diff.append('archive-sequence-coverage')
metadata=json.loads(read(STORAGE_SQL));physical={}
for directory in ('data/rehearsal/cycle1/storage','data/storage-compat/cycle1/storage'):
 root=ROOT/directory;objects=[];paths=set()
 for obj in metadata['objects']:
  relative=backend_path(obj['bucket'],obj['name'],obj['version']);p=root/relative;paths.add(p)
  if p.is_symlink() or not p.is_file():raise RuntimeError('Storage containment missing file; raw path withheld')
  body=p.read_bytes();framed=json.dumps([obj['bucket'],obj['name']],ensure_ascii=False,separators=(',',':')).encode()
  objects.append({'pathHash':hashlib.sha256(framed).hexdigest(),'bytes':str(len(body)),'sha256':hashlib.sha256(body).hexdigest()})
 physical[directory]={'objectCount':len(objects),'manifestMatchesRecordedProof':sorted(objects,key=lambda x:x['pathHash'])==sorted(EXPECTED_OBJECTS,key=lambda x:x['pathHash']),
  'extraFiles':len({p for p in root.rglob('*') if p.is_file()}-paths)}
journal=json.loads((ROOT/'config/p4-auth-authorized-2.json').read_text());containers={}
for key,cid in journal.get('containers',{}).items():
 info=json.loads(run(['docker','inspect',cid]))[0]
 containers[key]={'stopped':info['State']['Status']=='exited','noPublicPorts':not bool(info['HostConfig'].get('PortBindings')),'restartPolicy':info['HostConfig']['RestartPolicy']['Name']}
print(json.dumps({'status':'FAIL','reason':'SOURCE_REFERENCE_OVERWRITTEN_BY_HELPER','phaseComplete':False,
 'archiveUnchanged':archive_ok,'expectedBundleSHA256':expected_bundle,'observedBundleSHA256':observed,
 'exactRecoveryCopiesInKnownP4Artifacts':matches,'originalDeniedAttemptPreserved':json.loads((ROOT/'config/p4-auth-login.json').read_text()).get('status')=='LOGIN_DENIED',
 'secondPasswordAttempts':journal.get('passwordAttempts'),'containers':containers,'tableChecks':len(tables),'dataDifferences':diff,
 'comparisonBaseline':'previous frozen-restore public fingerprints, not a recreated source bundle',
 'sequenceChecks':len(inventory['sequences']),'sequenceDifferencesVsUnchangedArchive':sequence_diff,'storage':physical,
 'sourceWrites':0,'stagingDataWrites':0,'passwordRequested':False,'newFullFidelityClaim':False}))
'''


def run():
    tables=json.loads((schema.REPO/'docs/evidence/oracle-p4-storage-compatible-restore.json').read_text())['tables']
    objects=json.loads((schema.REPO/'docs/evidence/oracle-p4-storage-compatible-api.json').read_text())['objects']
    source=GUEST
    # One pass avoids substituting inside inserted, hash-only proof records.
    values={'TARGET':repr(storage_compat.NAME),'INVENTORY_SQL':repr((schema.REPO/'supabase/verification/oracle_data_inventory.sql').read_text()),'STORAGE_SQL':repr(storage_source.SQL),'EXPECTED_TABLES':repr(tables),'EXPECTED_OBJECTS':repr(objects)}
    source=re.sub(r'\b('+'|'.join(values)+r')\b',lambda m:values[m[0]],source)
    import inspect
    source=schema.guest_bundle(rehearsal=True)+owner_parity.BASE+Path(data_fingerprint.__file__).read_text()+'\nfrom pathlib import PurePosixPath\n'+inspect.getsource(storage_target.backend_path)+'\n'+source
    result=schema.run_guest(source,timeout=300)
    (schema.REPO/'docs/evidence/oracle-p4-auth-reference-integrity.json').write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps(result))


if __name__=='__main__':run()
