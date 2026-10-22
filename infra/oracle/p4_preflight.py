"""Read-only extended schema comparison; no customer rows or destination writes."""
import json
from pathlib import Path
import cloud_schema as schema
import owner_parity


def compare(source,target):
    def index(value):
        if value.get('version')!=1:raise ValueError('Transport catalog version')
        result={}
        for row in value['objects']:
            if set(row)!={'kind','name','hash'}:raise ValueError('Hashes only; no raw definitions')
            key=row['kind']+':'+row['name']
            if key in result:raise ValueError('Duplicate transport object')
            result[key]=row['hash']
        if not result:raise ValueError('Empty transport coverage is not PASS')
        return result
    a,b=index(source),index(target)
    differences=[{'object':key,'sourceHash':a.get(key),'targetHash':b.get(key)} for key in sorted(a.keys()|b.keys()) if a.get(key)!=b.get(key)]
    return {'status':'FAIL' if differences else 'PASS','sourceObjects':len(a),'targetObjects':len(b),
      'sourceCheckedAt':source['checkedAt'],'targetCheckedAt':target['checkedAt'],'differences':differences,
      'exceptions':[],'sourceWrites':0,'stagingWrites':0,'customerRowsImported':0,'fullDataVerification':False}


def run():
    import inspect
    sql=(schema.REPO/'supabase/verification/oracle_transport_catalog.sql').read_text()
    with schema.Snapshot(schema.source_environment()) as snapshot:
        snapshot.send(sql);source=json.loads(snapshot.line())
        guest=inspect.getsource(compare)+r'''
source=SOURCE_TRANSPORT
gates={}
for name in ('ir35_owner_parity_20261021','ir35_baseline_proof_20261021'):
 target=json.loads(query(TRANSPORT_SQL,name))
 gates[name]=compare(source,target)
print(json.dumps({'status':'FAIL' if any(x['status']!='PASS' for x in gates.values()) else 'PASS',
 'gates':gates,'sourceWrites':0,'stagingWrites':0,'customerRowsImported':0,'phaseComplete':False}))
'''
        guest=guest.replace('SOURCE_TRANSPORT',repr(source)).replace('TRANSPORT_SQL',repr(sql))
        result=schema.run_guest(schema.guest_bundle()+owner_parity.BASE+guest,timeout=180)
    path=schema.REPO/'docs/evidence/oracle-p4-schema-preflight.json'
    path.write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps({'status':result['status'],'operation':'p4-schema-preflight','report':'docs/evidence/oracle-p4-schema-preflight.json',
      'objects':len(source['objects']),'sourceWrites':0}))
    if result['status']!='PASS':raise SystemExit(1)
