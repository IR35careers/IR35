"""Read-only comparison of image migration fingerprints, never run migrations."""
import json
import cloud_schema as schema
import owner_parity
from key_ceremony import KeySafetyError

MIGRATION_JS = "require('postgres-migrations').loadMigrationFiles('./migrations/tenant').then(rows=>{const result=rows.map(x=>({id:x.id,name:x.name,hash:x.hash}));console.log(JSON.stringify(result));}).catch(()=>process.exit(1));"

GUEST=r'''
name='ir35_rehearsal_a_20261021'
sql="BEGIN READ ONLY; SET LOCAL search_path=pg_catalog; SELECT jsonb_agg(jsonb_build_object('id',id,'name',name,'hash',hash) ORDER BY id) FROM storage.migrations; ROLLBACK;"
result=subprocess.run(base+['psql','-XqAt','-v','ON_ERROR_STOP=1','-U','supabase_admin','-d',name,'-f','-'],input=sql,capture_output=True,text=True,timeout=30)
if result.returncode:raise RuntimeError('Private migration metadata read failed')
applied=json.loads(result.stdout)
pin=PINS['images']['storage']['image']
js=MIGRATION_JS
result=subprocess.run(['docker','run','--rm','--network','none','--read-only','--memory','128m','--pids-limit','64','--cap-drop','ALL','--security-opt','no-new-privileges','--log-driver','none','--user','1002:1002','--entrypoint','node',pin,'-e',js],capture_output=True,text=True,timeout=40)
if result.returncode:raise RuntimeError('Image migration metadata loader failed; no database connection or mutation')
intended=json.loads(result.stdout);by_name={x['name']:x for x in intended};diffs=[]
for row in applied:
 expected=by_name.get(row['name'])
 if not expected or row['id']!=expected['id'] or row['hash']!=expected['hash']:
  diffs.append({'name':row['name'],'appliedId':row['id'],'imageId':expected['id'] if expected else None,'appliedHash':row['hash'],'imageHash':expected['hash'] if expected else None})
print(json.dumps({'status':'PASS' if not diffs else 'FAIL','appliedMigrations':len(applied),'imageMigrations':len(intended),
 'freezeName':applied[-1]['name'],'freezeExistsInImage':applied[-1]['name'] in by_name,'differences':diffs,
 'image':pin,'sourceWrites':0,'stagingWrites':0,'apiRestarted':False,'migrationRunnerCalled':False,'phaseComplete':False}))
'''


def main():
    pins=json.loads((schema.REPO/'infra/oracle/staging-images.json').read_text())
    script=GUEST.replace('PINS',repr(pins)).replace('MIGRATION_JS',repr(MIGRATION_JS))
    result=schema.run_guest(schema.guest_bundle(rehearsal=True)+owner_parity.BASE+script,timeout=100)
    path=schema.REPO/'docs/evidence/oracle-p4-storage-migrations.json';path.write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps({'status':result['status'],'report':str(path.relative_to(schema.REPO)),'differences':len(result['differences']),'sourceWrites':0,'stagingWrites':0}))


if __name__=='__main__':
    try:main()
    except Exception as error:
        print(json.dumps({'status':'FAIL','code':str(error) if isinstance(error,KeySafetyError) else type(error).__name__,'rawOutput':'withheld'}));raise SystemExit(1)
