"""Read-only named-test-account context, never a password or customer login."""
import json
import hashlib
from datetime import datetime, timezone
import re
import cloud_schema as schema
import owner_parity
import storage_compat
import storage_source

PREFLIGHT=r'''
sql="BEGIN READ ONLY; SELECT jsonb_build_object('count',count(*),'passwordPresent',coalesce(bool_and(coalesce(encrypted_password,'')<>''),false),'confirmed',coalesce(bool_and(email_confirmed_at IS NOT NULL),false)) FROM auth.users WHERE lower(email)='anvesh.mannuru+ir35test@gmail.com'; ROLLBACK;"
result=subprocess.run(base+['psql','-XqAt','-v','ON_ERROR_STOP=1','-U','supabase_admin','-d',TARGET,'-f','-'],input=sql,capture_output=True,text=True,timeout=30)
if result.returncode:raise RuntimeError('Named test account preflight failed; raw output withheld')
account=json.loads(result.stdout)
print(json.dumps({'status':'PASS','testAccountPresent':account['count']==1,'passwordPresent':account['passwordPresent'],'confirmed':account['confirmed'],'sourceWrites':0,'stagingWrites':0}))
'''


def preflight():
    result=schema.run_guest(schema.guest_bundle(rehearsal=True)+owner_parity.BASE+PREFLIGHT.replace('TARGET',repr(storage_compat.NAME)))
    path=schema.REPO/'docs/evidence/oracle-p4-test-account-preflight.json'
    path.write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps(result))


def digest(value):
    return hashlib.sha256(json.dumps(value,sort_keys=True,ensure_ascii=False,separators=(',',':')).encode()).hexdigest()


def path_hash(bucket,name):
    return hashlib.sha256(json.dumps([bucket,name],ensure_ascii=False,separators=(',',':')).encode()).hexdigest()


def storage_security(catalog):
    return sorted(({key:row[key] for key in ('kind','name','hash')} for row in catalog['objects']
                   if row['name'].startswith('storage.')),key=lambda row:(row['kind'],row['name']))


def capture():
    """Source policy evaluation only. Never log in, mint a cloud JWT or write SQL."""
    environment=schema.source_environment()
    with schema.Snapshot(environment) as snapshot:
        snapshot.send("SELECT coalesce(jsonb_agg(id::text),'[]'::jsonb) FROM auth.users WHERE lower(email)='anvesh.mannuru+ir35test@gmail.com';")
        ids=json.loads(snapshot.line())
        if len(ids)!=1 or not re.fullmatch(r'[0-9a-f-]{36}',ids[0]):
            raise RuntimeError('Named test account must exist exactly once; no customer login')
        snapshot.send(storage_source.SQL);metadata=json.loads(snapshot.line())
        snapshot.send((schema.REPO/'supabase/verification/oracle_schema_catalog.sql').read_text())
        security=storage_security(json.loads(snapshot.line()))
        roles={}
        for role in ('anon','authenticated'):
            claims={'role':role,'aud':'authenticated'}
            if role=='authenticated':claims.update(sub=ids[0],email='anvesh.mannuru+ir35test@gmail.com')
            literal=lambda value:"'"+value.replace("'","''")+"'"
            snapshot.send("SET LOCAL request.jwt.claims="+literal(json.dumps(claims))+"; SET LOCAL request.jwt.claim.sub="+literal(claims.get('sub',''))+"; SET LOCAL request.jwt.claim.role="+literal(role)+"; SET LOCAL ROLE "+role+"; SELECT jsonb_build_object('objects',coalesce((SELECT jsonb_agg(jsonb_build_object('bucket',bucket_id,'name',name)) FROM storage.objects),'[]'::jsonb),'buckets',coalesce((SELECT jsonb_agg(id) FROM storage.buckets),'[]'::jsonb)); RESET ROLE;")
            values=json.loads(snapshot.line())
            roles[role]={'objectPathHashes':sorted(path_hash(row['bucket'],row['name']) for row in values['objects']),
                         'bucketNameHashes':sorted(hashlib.sha256(name.encode()).hexdigest() for name in values['buckets'])}
    payload={'purpose':'ir35-readonly-cloud-storage-policy-snapshot','checkedAt':datetime.now(timezone.utc).isoformat(),
             'testUserId':ids[0],'metadataSHA256':digest(metadata),'storageSecuritySHA256':digest(security),'roles':roles}
    script=r'''
payload=PAYLOAD
path=ROOT/'.env.p4-storage-access-source.json'
if path.exists() or path.is_symlink():raise RuntimeError('Private access snapshot already exists; reconcile without overwrite')
fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
with os.fdopen(fd,'w') as f:
 os.fchown(f.fileno(),1002,1002);f.write(json.dumps(payload,sort_keys=True));f.flush();os.fsync(f.fileno())
print(json.dumps({'status':'PASS','operationalKeysTransferred':False}))
'''.replace('PAYLOAD',repr(payload))
    schema.run_guest(schema.guest_bundle(rehearsal=True)+owner_parity.BASE+script)
    report={key:payload[key] for key in ('purpose','checkedAt','metadataSHA256','storageSecuritySHA256','roles')}
    report.update(status='PASS',sourceWrites=0,stagingDataWrites=0,cloudLogin=False,roleContexts=2)
    path=schema.REPO/'docs/evidence/oracle-p4-storage-access-source.json'
    path.write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps({'status':'PASS','operation':'p4-storage-access','report':str(path.relative_to(schema.REPO)),'objects':2,'sourceWrites':0}))


if __name__=='__main__':preflight()
