"""Read-only, metadata-only diagnosis of the preserved P3 FAIL494. No DDL."""
import hashlib
import base64
import json
from pathlib import Path
import sys

import cloud_schema as schema

REPO = Path(__file__).resolve().parents[2]


def public_value(value):
    if value is None:
        return None
    result = dict(value)
    if "config" in result:
        config = result.pop("config")
        result["configKeys"] = sorted(item.split("=", 1)[0] for item in (config or []))
        result["configSHA256"] = hashlib.sha256(json.dumps(config, sort_keys=True).encode()).hexdigest()
    return result


def diagnose(source, target):
    def index(catalog):
        result = {obj["kind"] + ":" + obj["name"]: obj for obj in catalog["objects"]}
        if len(result) != len(catalog["objects"]):
            raise ValueError("Duplicate catalog identifiers")
        return result
    a, b = index(source), index(target)
    entries = []
    for key in sorted(a.keys() | b.keys()):
        cloud, clone = a.get(key), b.get(key)
        if cloud and clone and cloud["hash"] == clone["hash"]:
            continue
        kind, name = key.split(":", 1)
        category = kind
        if kind == "grant":
            category = "grants/" + name.split(":", 1)[0]
            if name.startswith("relation:"):
                relation = name.split(":")[1]
                category = "grants/" + ("sequence" if "sequence:" + relation in a or "sequence:" + relation in b else
                    "view" if "view:" + relation in a or "view:" + relation in b else "table")
            if name.startswith("default:"):
                category = "default-privileges"
        if kind == "role":
            category = "role-existence" if not cloud or not clone else "role-attributes"
        values = [public_value(obj["value"]) if obj else None for obj in (cloud, clone)]
        fields = sorted(k for k in (values[0] or {}).keys() | (values[1] or {}).keys()
                        if (values[0] or {}).get(k) != (values[1] or {}).get(k))
        entries.append({"category": category, "object": key,
            "cloudHash": cloud["hash"] if cloud else None, "cloneHash": clone["hash"] if clone else None,
            "cloud": values[0], "clone": values[1], "changedFields": fields})
    counts = {}
    for row in entries:
        counts[row["category"]] = counts.get(row["category"], 0) + 1
    owners = [row["object"] for row in entries if row["cloud"] and row["clone"] and
              row["cloud"].get("owner") != row["clone"].get("owner")]
    return {"status": "DIAGNOSIS_ONLY", "sourceCheckedAt": source["checkedAt"], "targetCheckedAt": target["checkedAt"],
        "differences": len(entries), "categories": counts, "ownerDifferences": owners, "rows": entries,
        "sourceWrites": 0, "stagingWrites": 0, "exceptionsApproved": []}


GUEST = r'''
name='ir35_cloud_baseline_20261021'
record=json.loads((ROOT/'config/p3-cloud-clone.json').read_text())
if record.get('name')!=name or record.get('purpose')!='ir35-disposable-schema-clone' or record.get('status')!='RESTORED':
 raise RuntimeError('Owned restored clone required')
args=['docker','compose','--env-file',str(ENV),'-f',str(ROOT/'compose.yml'),'exec','-T','db','/run/ir35/env-exec','/opt/ir35/.env.db','psql','-XqAt','-v','ON_ERROR_STOP=1','-U','supabase_admin','-d',name,'-f','-']
result=subprocess.run(args,input='BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; SET LOCAL search_path=pg_catalog;\n'+CATALOG_SQL+'\nROLLBACK;',capture_output=True,text=True,timeout=60)
if result.returncode:raise RuntimeError('Read-only diagnosis failed; raw output withheld')
target=json.loads(result.stdout)
MODULE
report=diagnose(cloud,target)
listing=subprocess.run(['docker','compose','--env-file',str(ENV),'-f',str(ROOT/'compose.yml'),'exec','-T','db','pg_restore','--list'],input=(ROOT/'.env.p3-source-schema.dump').read_bytes(),capture_output=True,timeout=30)
if listing.returncode:raise RuntimeError('Private archive TOC audit failed')
lines=listing.stdout.decode().splitlines()
roles=(ROOT/'.env.p3-source-roles.sql').read_text()
report['archive']={'schemaSHA256':hashlib.sha256((ROOT/'.env.p3-source-schema.dump').read_bytes()).hexdigest(),
 'rolesSHA256':hashlib.sha256(roles.encode()).hexdigest(), 'rolesPasswordFree':not bool(re.search(r'(?i)\bPASSWORD\b',roles)),
 'aclEntries':sum(bool(re.search(r'\bACL\b',x)) for x in lines),
 'defaultACLEntries':sum('DEFAULT ACL' in x for x in lines),'tableDataEntries':sum('TABLE DATA' in x for x in lines)}
print(json.dumps(report))
'''


EFFECTIVE_GUEST = r'''
name='ir35_cloud_baseline_20261021'
record=json.loads((ROOT/'config/p3-cloud-clone.json').read_text())
if record.get('name')!=name or record.get('purpose')!='ir35-disposable-schema-clone' or record.get('status')!='RESTORED':
 raise RuntimeError('Owned restored clone required')
args=['docker','compose','--env-file',str(ENV),'-f',str(ROOT/'compose.yml'),'exec','-T','db','/run/ir35/env-exec','/opt/ir35/.env.db','psql','-XqAt','-v','ON_ERROR_STOP=1','-U','supabase_admin','-d',name,'-f','-']
query='BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; SET LOCAL search_path=pg_catalog;\n'+PRIVILEGE_SQL+'\nROLLBACK;'
result=subprocess.run(args,input=query,capture_output=True,text=True,timeout=60)
if result.returncode:raise RuntimeError('Read-only effective-privilege query failed; raw output withheld')
MODULE
report=compare(SOURCE_MATRIX,json.loads(result.stdout))
old={row['kind']+':'+row['name']:row['hash'] for row in cloud['objects']}
fresh=json.loads((ROOT/'.env.p3-acl-source-catalog.json').read_text())
new={row['kind']+':'+row['name']:row['hash'] for row in fresh['objects']}
report['sourceCatalogUnchanged']=old==new
report['sourceCatalogSHA256']=hashlib.sha256((ROOT/'.env.p3-acl-source-catalog.json').read_bytes()).hexdigest()
report['roleExportSHA256']=hashlib.sha256((ROOT/'.env.p3-acl-source-roles.sql').read_bytes()).hexdigest()
print(json.dumps(report))
'''


def effective_audit():
    import effective_privileges
    sql = (REPO/'supabase/verification/oracle_effective_privileges.sql').read_text()
    environment = schema.source_environment()
    with schema.Snapshot(environment) as snapshot:
        snapshot.send(sql)
        matrix = json.loads(snapshot.line())
        snapshot.send((REPO/'supabase/verification/oracle_schema_catalog.sql').read_text())
        catalog = snapshot.line()
    roles = schema.native('pg_dumpall',['--no-password','--role=postgres','--roles-only','--no-role-passwords'],environment,maximum=1_000_000)
    if b'PASSWORD' in roles.upper():
        raise ValueError('Role passwords must not be exported')
    payload={name:{'body':base64.b64encode(body).decode(),'sha256':hashlib.sha256(body).hexdigest()} for name,body in
             (('.env.p3-acl-source-roles.sql',roles),('.env.p3-acl-source-catalog.json',catalog))}
    transfer = schema.host_ssh.run_remote(schema.RECEIVE.replace('PAYLOAD',repr(payload)),[],timeout=120)
    if transfer.get('status')!='PASS':
        raise ValueError('Private read-only role/catalog transfer failed')
    module=Path(effective_privileges.__file__).read_text()
    guest=EFFECTIVE_GUEST.replace('MODULE',module).replace('PRIVILEGE_SQL',repr(sql)).replace('SOURCE_MATRIX',repr(matrix))
    result=schema.run_guest(schema.guest_bundle()+guest,timeout=120)
    result['rolePasswordsExported']=False
    result['privateArtifacts']=transfer['artifacts']
    path=REPO/'docs/evidence/oracle-p3-effective-privileges.json'
    path.write_text(json.dumps(result,indent=2)+'\n')
    # Execution PASS is not parity PASS: the redacted report retains every diff.
    print(json.dumps({'status':'PASS','operation':'effective-privileges','report':'docs/evidence/oracle-p3-effective-privileges.json',
                     'objects':result['sourceEntries'],'sourceWrites':0}))


def platform_audit():
    sql=(REPO/'supabase/verification/oracle_platform_diagnosis.sql').read_text()
    with schema.Snapshot(schema.source_environment()) as snapshot:
        snapshot.send(sql)
        source=json.loads(snapshot.line())
    guest=GUEST[:GUEST.index('MODULE')]+r'''
query='BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; SET LOCAL search_path=pg_catalog;\n'+PLATFORM_SQL+'\nROLLBACK;'
queried=subprocess.run(args,input=query,capture_output=True,text=True,timeout=60)
if queried.returncode:raise RuntimeError('Read-only platform audit failed; raw output withheld')
archive=subprocess.run(['docker','compose','--env-file',str(ENV),'-f',str(ROOT/'compose.yml'),'exec','-T','db','pg_restore','--file=-'],input=(ROOT/'.env.p3-source-schema.dump').read_bytes(),capture_output=True,timeout=30)
if archive.returncode:raise RuntimeError('Private archive SQL audit failed')
sql=archive.stdout.decode()
acl={name:sum(bool(re.search(r'\b(?:GRANT|REVOKE)\b.*?\bSCHEMA\s+"?'+re.escape(name)+r'"?(?:\s|;)',line)) for line in sql.splitlines()) for name in ('graphql','graphql_public')}
report={'status':'DIAGNOSIS_ONLY','cloud':SOURCE_PLATFORM,'clone':json.loads(queried.stdout),
 'archive':{'graphqlSchemaACLStatements':acl,'createExtensions':re.findall(r'^CREATE EXTENSION IF NOT EXISTS "?([a-z_0-9-]+)"?',sql,re.M),
 'extensionOwnerAlterStatements':len(re.findall(r'^ALTER EXTENSION .*? OWNER TO ',sql,re.M))},'sourceWrites':0,'stagingWrites':0}
print(json.dumps(report))
'''
    result=schema.run_guest(schema.guest_bundle()+guest.replace('PLATFORM_SQL',repr(sql)).replace('SOURCE_PLATFORM',repr(source)),timeout=120)
    path=REPO/'docs/evidence/oracle-p3-platform-diagnosis.json'
    path.write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps({'status':'PASS','operation':'platform-diagnosis','report':'docs/evidence/oracle-p3-platform-diagnosis.json','sourceWrites':0}))


def main():
    if sys.argv[1:] != ["diagnose"]:
        raise ValueError("Read-only diagnosis only")
    module = Path(__file__).read_text().split("GUEST =", 1)[0]
    module = module[module.index("def public_value"):]
    result = schema.run_guest(schema.guest_bundle() + GUEST.replace("MODULE", module), timeout=120)
    original = json.loads((REPO / "docs/evidence/oracle-p3-clone-gate.json").read_text())
    if {row["object"]: (row["cloudHash"], row["cloneHash"]) for row in result["rows"]} != {
            row["object"]: (row["cloudHash"], row["cloneHash"]) for row in original["differences"]}:
        raise ValueError("Historical494 changed; retain history, review new diagnostic snapshot")
    path = REPO / "docs/evidence/oracle-p3-acl-diagnosis.json"
    path.write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps({k: result[k] for k in ("status", "differences", "categories", "sourceWrites", "stagingWrites")}))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(json.dumps({"status": "FAIL", "code": type(error).__name__, "rawOutput": "withheld"}))
        raise SystemExit(1)
