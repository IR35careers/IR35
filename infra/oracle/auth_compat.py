"""Read-only Auth startup prerequisite: reject pending migrations before login QA."""
import json
import hashlib
import re
import urllib.request
import cloud_schema as schema
import owner_parity
import storage_compat

GUEST=r'''
name=TARGET
record=json.loads((ROOT/'config/p4-storage-compat.json').read_text())['cycles']['1']
if record.get('target')!=name or record.get('status')!='STORAGE_BYTES_VERIFIED':raise RuntimeError('Verified private compatibility clone required')
sql="BEGIN READ ONLY; SELECT coalesce(jsonb_agg(version ORDER BY version),'[]'::jsonb) FROM auth.schema_migrations; ROLLBACK;"
result=subprocess.run(base+['psql','-XqAt','-v','ON_ERROR_STOP=1','-U','supabase_admin','-d',name,'-f','-'],input=sql,capture_output=True,text=True,timeout=30)
if result.returncode:raise RuntimeError('Read-only Auth migration metadata query failed')
applied=json.loads(result.stdout)
image=PIN
files=run(['docker','run','--rm','--network','none','--read-only','--memory','64m','--pids-limit','32','--cap-drop','ALL','--security-opt','no-new-privileges','--log-driver','none','--entrypoint','sh',image,
 '-c','find /usr/local/etc/auth/migrations -maxdepth 1 -type f -name "*.up.sql" -print'],timeout=40).splitlines()
intended=sorted(re.fullmatch(r'/usr/local/etc/auth/migrations/([0-9]+)_[^/]+\.up\.sql',path)[1] for path in files)
if len(intended)!=len(set(intended)) or not intended:raise RuntimeError('Auth image migration directory invalid')
missing=sorted(set(applied)-set(intended));pending=sorted(set(intended)-set(applied))
if any(not re.fullmatch(r'[0-9]{14}',value) for value in missing):raise RuntimeError('Invalid Auth version metadata')
seeds=[]
if missing:
 command='grep -H -oE '+"'"+'|'.join(missing)+"'"+' /usr/local/etc/auth/migrations/*.up.sql'
 result=subprocess.run(['docker','run','--rm','--network','none','--read-only','--memory','64m','--pids-limit','32','--cap-drop','ALL','--security-opt','no-new-privileges','--log-driver','none','--entrypoint','sh',image,'-c',command],capture_output=True,text=True,timeout=30)
 if result.returncode not in (0,1):raise RuntimeError('Auth bootstrap metadata probe failed; raw output withheld')
 for line in result.stdout.splitlines():
  match=re.fullmatch(r'/usr/local/etc/auth/migrations/([^/:]+\.up\.sql):([0-9]{14})',line)
  if not match:raise RuntimeError('Unexpected bootstrap metadata output; withheld')
  seeds.append({'file':match[1],'version':match[2]})
known=sorted({item['version'] for item in seeds});unexplained=sorted(set(missing)-set(known))
bootstrap='/docker-entrypoint-initdb.d/init-scripts/00000000000001-auth-schema.sql'
seed_sql=dc('exec','-T','db','cat',bootstrap)
if hashlib.sha256(seed_sql.encode()).hexdigest()!=BOOTSTRAP_HASH:raise RuntimeError('Native Postgres bootstrap source hash mismatch')
insert=re.search(r'INSERT INTO auth\.schema_migrations \(version\)\s*VALUES\s*(.*?);',seed_sql,re.S)
if not insert:raise RuntimeError('Pinned platform bootstrap INSERT not found')
platform_versions=re.findall(r"\('([0-9]{14})'\)",insert[1])
if len(platform_versions)!=7 or len(set(platform_versions))!=7:raise RuntimeError('Unexpected platform seed count')
seeds.extend({'file':bootstrap,'version':version,'provider':'supabase/postgres:17.6.1.136'} for version in platform_versions)
known=sorted({item['version'] for item in seeds});unexplained=sorted(set(missing)-set(known))
print(json.dumps({'status':'PASS' if not unexplained and not pending else 'FAIL_PENDING_AUTH_MIGRATIONS',
 'appliedVersions':applied,'imageVersions':intended,'missing':missing,'pending':pending,'image':image,
 'bootstrapSeeds':seeds,'unexplained':unexplained,'filenameOnlyProbeWasIncomplete':bool(missing),
 'bootstrapSHA256':BOOTSTRAP_HASH,'helperRepairs':2,'initialFilenameOnlyMissing':missing,
 'sourceWrites':0,'stagingWrites':0,'authStarted':False,'loginAttempted':False,'phaseComplete':False}))
'''


def main():
    pin=json.loads((schema.REPO/'infra/oracle/staging-images.json').read_text())['images']['auth']['image']
    url='https://raw.githubusercontent.com/supabase/postgres/17.6.1.136/migrations/db/init-scripts/00000000000001-auth-schema.sql'
    with urllib.request.urlopen(url,timeout=30) as response:body=response.read(65_537)
    if len(body)>65_536:raise RuntimeError('Public bootstrap source bound exceeded')
    replacements={'TARGET':repr(storage_compat.NAME),'PIN':repr(pin),'BOOTSTRAP_HASH':repr(hashlib.sha256(body).hexdigest())}
    script=re.sub(r'\b(TARGET|PIN|BOOTSTRAP_HASH)\b',lambda match:replacements[match[0]],GUEST)
    result=schema.run_guest(schema.guest_bundle(rehearsal=True)+owner_parity.BASE+script,timeout=100)
    path=schema.REPO/'docs/evidence/oracle-p4-auth-startup-preflight.json'
    path.write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps({'status':result['status'],'appliedVersions':len(result['appliedVersions']),
                     'pending':len(result['pending']),'missing':len(result['missing']),'authStarted':False}))


if __name__=='__main__':
    try:main()
    except Exception as error:
        print(json.dumps({'status':'FAIL','code':type(error).__name__,'rawOutput':'withheld'}));raise SystemExit(1)
