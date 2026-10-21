"""Read-only source schema export. Raw artifacts stay in RAM / VM .env paths."""
import base64
from datetime import datetime, timezone
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import select
import subprocess
import sys
import time

from bootstrap_audit import KEY_DIRECTORY
from key_ceremony import KeySafetyError
from security_session import atomic_metadata, private_file
import host_ssh
import p1_infrastructure as infra
import stack_guest
import staging_stack

REPO = Path(__file__).resolve().parents[2]
STATE = KEY_DIRECTORY / "p3-cloud-clone.json"
PG = "/usr/lib/postgresql/17/bin/"
REPORT = REPO / "docs/evidence/oracle-p3-cloud-export.json"
CACHE = REPO / ".cache/oracle-schema"


def run_guest(source,timeout=120):
    wrapper="import json,sys\ntry:\n exec("+repr(source)+")\nexcept Exception as error:\n print(json.dumps({'error':str(error) if isinstance(error,RuntimeError) else 'Schema guest helper failed: '+type(error).__name__}));sys.exit(1)\n"
    return host_ssh.run_remote(wrapper,[],timeout=timeout)


def guest_bundle():
    state=json.loads(private_file(STATE))
    if state.get("export",{}).get("status")!="PASS":
        raise KeySafetyError("VerifiedSchemaExportRequired")
    pins=json.loads((REPO/"infra/oracle/staging-images.json").read_text())
    journal=json.loads(private_file(infra.JOURNAL))
    config={"uuid":journal["dataMountIntent"]["uuid"],"ownerCIDR":journal["ownerCIDR"],"images":pins["images"],"upstreamCommit":pins["upstreamCommit"]}
    source="import types,sys\nm=types.ModuleType('staging_stack')\nsys.modules['staging_stack']=m\nexec("+repr(Path(staging_stack.__file__).read_text())+",m.__dict__)\n"
    source+=Path(stack_guest.__file__).read_text().replace('if __name__ == "__main__":','if False:')
    source+='\nprerequisites('+repr(config)+')\nread_env()\n'
    current_catalog=".env.p3-source-catalog-v2.json" if (REPO/"docs/evidence/oracle-p3-catalog-repair.json").exists() else ".env.p3-source-catalog.json"
    source+=r'''
state=json.loads(STATE.read_text())
if state.get('purpose')!='ir35-disposable-staging' or state.get('dataRehearsalStarted') or state.get('promotedToProduction'):
 raise RuntimeError('Disposable pre-rehearsal target only')
cloud=json.loads((ROOT/CURRENT_CATALOG).read_text())
CATALOG_SQL=SQL_TEXT
def safe(catalog):
 objects=[]
 for obj in catalog['objects']:
  item={k:obj[k] for k in ('kind','name','hash')}
  value=obj['value']
  if obj['kind']=='role':
   item['value']={k:v for k,v in value.items() if k!='config'}
  elif obj['name'].startswith('public.') and obj['kind'] in ('column','policy','rls','grant','trigger','table'):
   item['value']=value
  objects.append(item)
 return {k:catalog[k] for k in ('version','checkedAt','serverVersion','encoding','collation','schemas')}|{'objects':objects}
'''.replace("SQL_TEXT",repr((REPO/"supabase/verification/oracle_schema_catalog.sql").read_text())).replace("CURRENT_CATALOG",repr(current_catalog))
    return source


def audit_target():
    source=guest_bundle()+'''
target=json.loads(psql("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; SET LOCAL search_path=pg_catalog;\\n"+CATALOG_SQL+"\\nROLLBACK;",transaction=False))
print(json.dumps({'status':'PASS','source':safe(cloud),'target':safe(target),'databaseWrites':0}))
'''
    result=run_guest(source)
    if result.get("status")!="PASS":
        raise KeySafetyError("TargetAuditFailed")
    for name in ("source","target"):
        CACHE.mkdir(parents=True,exist_ok=True)
        (CACHE/("source.json" if name=="source" else "repo-target.json")).write_text(json.dumps(result[name],indent=2)+"\n")
    print(json.dumps({"status":"PASS","operation":"audit-target","report":".cache/oracle-schema/repo-target.json","objects":len(result["target"]["objects"]),"sourceWrites":0}))


def audit_clone():
    source=guest_bundle()+CLONE_AUDIT
    result=run_guest(source)
    for name in ('source','clone'):
        catalog=result[name]
        keys=[row['kind']+':'+row['name'] for row in catalog['objects']]
        if len(keys)!=len(set(keys)):
            raise KeySafetyError('DuplicateCatalogObjectsInvalidComparison')
        CACHE.mkdir(parents=True,exist_ok=True)
        (CACHE/('source.json' if name=='source' else 'clone.json')).write_text(json.dumps(catalog,indent=2)+'\n')
    print(json.dumps({'status':'PASS','operation':'audit-clone','report':'.cache/oracle-schema/clone.json','objects':len(result['clone']['objects']),'sourceWrites':0}))


CLONE_AUDIT=r'''
name='ir35_cloud_baseline_20261021'
record=json.loads((ROOT/'config/p3-cloud-clone.json').read_text())
if record.get('name')!=name or record.get('purpose')!='ir35-disposable-schema-clone' or record.get('status')!='RESTORED':raise RuntimeError('Owned restored clone required')
args=['docker','compose','--env-file',str(ENV),'-f',str(ROOT/'compose.yml'),'exec','-T','db','/run/ir35/env-exec','/opt/ir35/.env.db','psql','-XqAt','-v','ON_ERROR_STOP=1','-U','supabase_admin','-d',name,'-f','-']
result=subprocess.run(args,input='BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; SET LOCAL search_path=pg_catalog;\n'+CATALOG_SQL+'\nROLLBACK;',capture_output=True,text=True,timeout=60)
if result.returncode:raise RuntimeError('Read-only clone catalog query failed; raw output withheld')
print(json.dumps({'status':'PASS','source':safe(cloud),'clone':safe(json.loads(result.stdout)),'databaseWrites':0}))
'''


def repair_catalog():
    state=json.loads(private_file(STATE))
    if state.get('export',{}).get('status')!='PASS' or state.get('catalogRepairAttempts',0)>=3:
        raise KeySafetyError('CatalogRepairGuard')
    state['catalogRepairAttempts']=state.get('catalogRepairAttempts',0)+1
    atomic_metadata(STATE,state)
    with Snapshot(source_environment()) as snapshot:
        snapshot.send((REPO/'supabase/verification/oracle_schema_catalog.sql').read_text())
        raw=snapshot.line()
        catalog=json.loads(raw)
    keys=[obj['kind']+':'+obj['name'] for obj in catalog['objects']]
    if len(keys)!=len(set(keys)):
        raise KeySafetyError('DuplicateCatalogObjectsInvalidComparison')
    payload={'.env.p3-source-catalog-v2.json':{'body':base64.b64encode(raw).decode(),'sha256':hashlib.sha256(raw).hexdigest()}}
    result=host_ssh.run_remote(RECEIVE.replace('PAYLOAD',repr(payload)),[],timeout=120)
    if result.get('status')!='PASS':raise KeySafetyError('CatalogRepairTransferFailed')
    report={'status':'PASS','schemaOnly':True,'sourceWrites':0,'objects':len(keys),'checkedAt':catalog['checkedAt'],'artifacts':result['artifacts'],
      'reason':'Catalog helper name-type truncation repaired with explicit text; logical visible column ordering ignores dropped physical slots.',
      'originalSchemaArchiveUnchanged':True,'freshReadOnlyCatalogSnapshot':True,'archiveCatalogShareSnapshot':False,'phaseComplete':False}
    (REPO/'docs/evidence/oracle-p3-catalog-repair.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps({'status':'PASS','operation':'catalog-repair','report':'docs/evidence/oracle-p3-catalog-repair.json','objects':len(keys),'sourceWrites':0}))


def clone_schema():
    gate=REPO/'docs/evidence/oracle-p3-clone-gate.json'
    if gate.exists() and json.loads(gate.read_text()).get('status')!='CATALOG_MATCH_ONLY':
        raise KeySafetyError('CloneGateFailedNoFurtherMutation')
    source=guest_bundle()+CLONE
    result=run_guest(source,timeout=400)
    if result.get("status")!="PASS":
        raise KeySafetyError("CloneRestoreNotPass")
    CACHE.mkdir(parents=True,exist_ok=True)
    (CACHE/"clone.json").write_text(json.dumps(result.pop("catalog"),indent=2)+"\n")
    (REPO/"docs/evidence/oracle-p3-clone-restore.json").write_text(json.dumps(result,indent=2)+"\n")
    print(json.dumps({"status":"PASS","operation":"clone-schema","report":"docs/evidence/oracle-p3-clone-restore.json","objects":result["objects"],"sourceWrites":0}))


CLONE=r'''
name='ir35_cloud_baseline_20261021'
marker=ROOT/'config/p3-cloud-clone.json'
artifacts={'.env.p3-source-schema.dump':SOURCE_DUMP_HASH,'.env.p3-source-roles.sql':SOURCE_ROLES_HASH,'.env.p3-source-catalog.json':SOURCE_CATALOG_HASH}
for filename,digest in artifacts.items():
 path=ROOT/filename;s=path.lstat()
 if not stat.S_ISREG(s.st_mode) or s.st_uid!=1002 or stat.S_IMODE(s.st_mode)!=0o600 or s.st_nlink!=1 or hashlib.sha256(path.read_bytes()).hexdigest()!=digest:
  raise RuntimeError('Verified private source artifact changed; no restore')
def query(sql,database='postgres',transaction=True):
 if database not in ('postgres',name):raise RuntimeError('Fixed disposable target database only')
 args=['docker','compose','--env-file',str(ENV),'-f',str(ROOT/'compose.yml'),'exec','-T','db','/run/ir35/env-exec','/opt/ir35/.env.db','psql','-XqAt','-v','ON_ERROR_STOP=1','-v','VERBOSITY=sqlstate','-U','supabase_admin','-d',database,'-f','-']
 if transaction:args.append('--single-transaction')
 result=subprocess.run(args,input=sql,capture_output=True,text=True,timeout=120)
 if result.returncode:
  codes=sorted(set(re.findall(r'(?:ERROR|FATAL):\s+([A-Z0-9]{5})(?:\s|$)',result.stderr)))
  raise RuntimeError('Clone SQL failed; SQLSTATE='+','.join(codes)+'; raw output withheld')
 return result.stdout
record=json.loads(marker.read_text()) if marker.exists() else {'purpose':'ir35-disposable-schema-clone','name':name,'attempts':0,'sourceSHA256':artifacts['.env.p3-source-schema.dump']}
if record.get('purpose')!='ir35-disposable-schema-clone' or record.get('name')!=name or record.get('sourceSHA256')!=artifacts['.env.p3-source-schema.dump'] or record.get('attempts',0)>=3:
 raise RuntimeError('Clone identity or durable attempt guard')
if record.get('status')=='PENDING':raise RuntimeError('Ambiguous clone restore; reconcile, do not replay')
if record.get('status')!='RESTORED':
 record['attempts']+=1
 existing=query("SELECT oid FROM pg_database WHERE datname='"+name+"';").strip()
 if existing:raise RuntimeError('Unowned clone database collision; no overwrite')
 # Only missing roles; preserve existing passwords/attributes/configuration.
 existing_roles=set(json.loads(query('SELECT json_agg(rolname) FROM pg_roles;')))
 for obj in cloud['objects']:
  if obj['kind']!='role' or obj['name'] in existing_roles:continue
  if not re.fullmatch('[a-z][a-z0-9_]{0,62}',obj['name']):raise RuntimeError('Role name guard')
  value=obj['value']
  if value.get('superuser') or value.get('bypassRLS') or value.get('createRole') or value.get('replication') or value.get('createDB'):
   raise RuntimeError('Missing privileged role requires review; no broad role creation')
  query('CREATE ROLE "'+obj['name']+'" '+('LOGIN' if value['login'] else 'NOLOGIN')+' '+('INHERIT' if value['inherit'] else 'NOINHERIT')+' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD NULL;')
 if cloud['encoding']!='UTF8' or cloud['collation']!={'ctype':'en_US.UTF-8','locale':'en-US','collate':'en_US.UTF-8','provider':'i'}:
  raise RuntimeError('Source encoding/collation requires reviewed CREATE syntax')
 record['status']='PENDING';write(marker,json.dumps(record),0o600)
 query('CREATE DATABASE '+name+" WITH OWNER postgres TEMPLATE template0 ENCODING 'UTF8' LC_COLLATE 'en_US.UTF-8' LC_CTYPE 'en_US.UTF-8' LOCALE_PROVIDER icu ICU_LOCALE 'en-US';",transaction=False)
 # A new, unattached database only. Never --clean an existing app/source DB.
 args=['docker','compose','--env-file',str(ENV),'-f',str(ROOT/'compose.yml'),'exec','-T','db','/run/ir35/env-exec','/opt/ir35/.env.db','pg_restore','--no-password','--clean','--if-exists','--single-transaction','--exit-on-error','--username=supabase_admin','--dbname='+name]
 result=subprocess.run(args,input=(ROOT/'.env.p3-source-schema.dump').read_bytes(),capture_output=True,timeout=180)
 if result.returncode:
  # Keep database/PENDING intent; never skip failed objects or retry blindly.
  codes=sorted(set(re.findall(rb'(?:ERROR|FATAL):\s+([A-Z0-9]{5})(?:\s|$)',result.stderr)))
  record['errorSQLSTATE']=[x.decode() for x in codes];write(marker,json.dumps(record),0o600)
  raise RuntimeError('Schema restore failed; SQLSTATE='+','.join(record['errorSQLSTATE'])+'; exact stderr withheld; pending intent retained')
 record['status']='RESTORED';write(marker,json.dumps(record),0o600)
catalog=json.loads(query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; SET LOCAL search_path=pg_catalog;\n'+CATALOG_SQL+'\nROLLBACK;',name,False))
print(json.dumps({'status':'PASS','phaseComplete':False,'database':name,'schemaOnly':True,'sourceWrites':0,'customerRowsImported':0,'objects':len(catalog['objects']),'catalog':safe(catalog),'zeroDifferenceGate':False,'attempts':record['attempts']}))
'''


def source_environment():
    result = {key: value for key, value in os.environ.items() if key.startswith("PG")}
    if (result.get("PGHOST") != "aws-1-eu-west-2.pooler.supabase.com" or result.get("PGPORT") != "5432"
        or result.get("PGDATABASE") != "postgres" or not result.get("PGUSER", "").endswith(".kxcbgflleqnjzjbkevwd")
        or not result.get("PGPASSWORD") or result.get("PGSSLMODE") != "verify-full"
        or result.get("PGSSLROOTCERT") != "/mnt/c/Users/anves/.codex/operations/ir35careers/supabase-prod-ca-2021.crt"
        or result.get("PGOPTIONS") != "-c default_transaction_read_only=on -c statement_timeout=300000 -c lock_timeout=5000"):
        raise KeySafetyError("SourceConnectionGuard")
    # Never inherit alternate services/passfiles or loader settings.
    allowed = {"PGHOST", "PGPORT", "PGUSER", "PGPASSWORD", "PGDATABASE", "PGSSLMODE", "PGSSLROOTCERT", "PGCONNECT_TIMEOUT", "PGAPPNAME", "PGOPTIONS"}
    if set(result) - allowed:
        raise KeySafetyError("SourceEnvironmentUnexpected")
    return {"PATH": "/usr/bin:/bin", "HOME": str(Path.home()), "LC_ALL": "C.UTF-8", **result}


def native(tool, arguments, environment, *, input=None, maximum=32_000_000):
    if tool not in ("pg_dump", "pg_dumpall", "pg_restore", "psql"):
        raise KeySafetyError("NativeToolGuard")
    result = subprocess.run([PG + tool, *arguments], input=input, capture_output=True, env=environment, timeout=300)
    if result.returncode:
        # SQLSTATE alone, not vendor output or a database URI.
        codes = sorted(set(re.findall(rb"(?:ERROR|FATAL):\s+([A-Z0-9]{5})(?:\s|$)", result.stderr)))
        raise KeySafetyError("Native_" + tool + "_exit" + str(result.returncode) + (":" + ",".join(x.decode() for x in codes) if codes else ""))
    if len(result.stdout) > maximum:
        raise KeySafetyError("NativeOutputBound")
    return result.stdout


class Snapshot:
    def __init__(self, environment):
        self.environment = environment
        self.buffer = b""

    def __enter__(self):
        self.process = subprocess.Popen([PG + "psql", "-XqAt", "--no-password", "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=sqlstate"], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=self.environment)
        try:
            self.send("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; SET LOCAL ROLE postgres; SET LOCAL search_path=pg_catalog; SELECT pg_export_snapshot();")
            self.snapshot = self.line().decode().strip()
        except Exception:
            self.__exit__(None, None, None)
            raise
        if not re.fullmatch(r"[0-9A-Fa-f]{8}-[0-9A-Fa-f]{8}-[0-9]+", self.snapshot):
            self.__exit__(None, None, None)
            raise KeySafetyError("SnapshotIdentityInvalid")
        return self

    def send(self, sql):
        self.process.stdin.write((sql + "\n").encode())
        self.process.stdin.flush()

    def line(self):
        deadline = time.monotonic() + 35
        while b"\n" not in self.buffer:
            if len(self.buffer) > 4_000_000:
                raise KeySafetyError("SnapshotCatalogBound")
            ready, _, _ = select.select([self.process.stdout], [], [], max(0, deadline - time.monotonic()))
            if not ready:
                raise KeySafetyError("SnapshotReadTimeout")
            block = os.read(self.process.stdout.fileno(), 65536)
            if not block:
                codes = sorted(set(re.findall(rb"(?:ERROR|FATAL):\s+([A-Z0-9]{5})(?:\s|$)", self.process.stderr.read(8192))))
                raise KeySafetyError("SnapshotConnectionEnded" + (":" + ",".join(x.decode() for x in codes) if codes else ""))
            self.buffer += block
        line, self.buffer = self.buffer.split(b"\n", 1)
        return line

    def __exit__(self, *unused):
        if self.process.poll() is None:
            try:
                self.send("ROLLBACK;\n\\q")
                self.process.communicate(timeout=10)
            except (BrokenPipeError, subprocess.TimeoutExpired):
                self.process.kill()
                self.process.communicate()


RECEIVE = r'''
import base64,hashlib,json,os,stat,sys
from pathlib import Path
payload=PAYLOAD
root=Path('/opt/ir35')
try:
 state=json.loads((root/'config/p3-stack-state.json').read_text())
 if os.geteuid()!=0 or state.get('purpose')!='ir35-disposable-staging' or state.get('dataRehearsalStarted') or state.get('promotedToProduction'):
  raise RuntimeError('DestinationIdentityGuard')
 for name,record in payload.items():
  if name not in ('.env.p3-source-schema.dump','.env.p3-source-roles.sql','.env.p3-source-catalog.json','.env.p3-source-catalog-v2.json',
                  '.env.p3-acl-source-roles.sql','.env.p3-acl-source-catalog.json'):
   raise RuntimeError('ArtifactPathGuard')
  body=base64.b64decode(record['body'],validate=True)
  if hashlib.sha256(body).hexdigest()!=record['sha256'] or len(body)>32000000:
   raise RuntimeError('ArtifactHashGuard')
  path=root/name
  if path.exists() or path.is_symlink():
   s=path.lstat()
   if not stat.S_ISREG(s.st_mode) or s.st_uid!=1002 or s.st_nlink!=1 or stat.S_IMODE(s.st_mode)!=0o600 or hashlib.sha256(path.read_bytes()).hexdigest()!=record['sha256']:
    raise RuntimeError('ArtifactCollisionNoOverwrite')
  else:
   fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
   with os.fdopen(fd,'wb') as f:
    os.fchown(f.fileno(),1002,1002);f.write(body);f.flush();os.fsync(f.fileno())
 print(json.dumps({'status':'PASS','artifacts':{n:{'bytes':len(base64.b64decode(r['body'])),'sha256':r['sha256'],'mode':'600','owner':'ir35'} for n,r in payload.items()},'databaseWrites':0}))
except Exception:
 print(json.dumps({'error':'Private schema artifact custody failed; no raw values'}));sys.exit(1)
'''


def main():
    if sys.argv[1:]==['platform-diagnosis']:
        from acl_diagnosis import platform_audit
        platform_audit()
        return
    if sys.argv[1:]==['effective-privileges']:
        from acl_diagnosis import effective_audit
        effective_audit()
        return
    if sys.argv[1:]==['catalog-repair']:
        repair_catalog()
        return
    if sys.argv[1:]==['audit-clone']:
        audit_clone()
        return
    if sys.argv[1:]==["audit-target"]:
        audit_target()
        return
    if sys.argv[1:]==["clone-schema"]:
        global CLONE
        record=json.loads(REPORT.read_text())
        for placeholder,filename in (("SOURCE_DUMP_HASH",".env.p3-source-schema.dump"),("SOURCE_ROLES_HASH",".env.p3-source-roles.sql"),("SOURCE_CATALOG_HASH",".env.p3-source-catalog.json")):
            CLONE=CLONE.replace(placeholder,repr(record["artifacts"][filename]["sha256"]))
        clone_schema()
        return
    if sys.argv[1:] != ["export"]:
        raise KeySafetyError("FixedExportOnly")
    lock = os.open(KEY_DIRECTORY / "p1-control-plane.lock", os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        state = json.loads(private_file(STATE)) if STATE.exists() else {"ownerApproval": "21October-exact-cloud-schema-first", "exportAttempts": 0}
        if state.get("export", {}).get("status") == "PASS":
            print(json.dumps({"status":"PASS","operation":"export","report":"docs/evidence/oracle-p3-cloud-export.json","reused":True,"sourceWrites":0}))
            return
        if state.get("exportAttempts", 0) >= 3 or state.get("artifactTransferPending"):
            raise KeySafetyError("AttemptOrPendingTransferGuard")
        state["exportAttempts"] += 1
        atomic_metadata(STATE, state)
        environment = source_environment()
        connection = native("psql", ["-XqAt","--no-password","-c",r"\conninfo"], environment, maximum=8192)
        client_tls = b"SSL connection" in connection and b"TLSv1" in connection
        with Snapshot(environment) as snapshot:
            snapshot.send("SELECT json_build_object('readOnly',current_setting('transaction_read_only'),'version',current_setting('server_version_num'),'ssl',(SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()));")
            preflight = json.loads(snapshot.line())
            # Session pooler terminates client TLS; pg_stat_ssl describes its
            # backend leg, not the hostname-verified libpq connection.
            state["sourcePreflight"] = {"readOnly":preflight.get("readOnly")=="on","pg17":str(preflight.get("version", "")).startswith("17"),"clientVerifiedTLS":client_tls,"poolerBackendSSL":preflight.get("ssl")}
            atomic_metadata(STATE,state)
            if preflight.get("readOnly") != "on" or not client_tls or not str(preflight.get("version", "")).startswith("17"):
                raise KeySafetyError("SourceReadOnlyTLSVersionGuard")
            dump = native("pg_dump", ["--no-password","--role=postgres","--schema-only","--format=custom","--snapshot=" + snapshot.snapshot], environment)
            snapshot.send((REPO / "supabase/verification/oracle_schema_catalog.sql").read_text())
            catalog_raw = snapshot.line()
            catalog = json.loads(catalog_raw)
        roles = native("pg_dumpall", ["--no-password","--role=postgres","--roles-only","--no-role-passwords"], environment, maximum=1_000_000)
        listing = native("pg_restore", ["--list"], {"PATH":"/usr/bin:/bin","LC_ALL":"C.UTF-8"}, input=dump, maximum=4_000_000)
        if b"TABLE DATA" in listing or b"SEQUENCE SET" in listing or b"PASSWORD '" in roles or not dump.startswith(b"PGDMP"):
            raise KeySafetyError("SchemaOnlyArchiveGuard")
        if not {"public","auth","storage","pgboss"}.issubset(set(catalog.get("schemas", []))):
            raise KeySafetyError("CatalogSchemaCompletenessGuard")
        artifacts = {name:{"body":base64.b64encode(body).decode(),"sha256":hashlib.sha256(body).hexdigest()} for name,body in
            ((".env.p3-source-schema.dump",dump),(".env.p3-source-roles.sql",roles),(".env.p3-source-catalog.json",catalog_raw))}
        state["artifactTransferPending"] = True
        state["artifactHashes"] = {name:row["sha256"] for name,row in artifacts.items()}
        atomic_metadata(STATE,state)
        result = host_ssh.run_remote(RECEIVE.replace("PAYLOAD",repr(artifacts)), [], timeout=120)
        if result.get("status") != "PASS":
            raise KeySafetyError("ArtifactTransferNotPass")
        report = {"status":"PASS","phaseComplete":False,"checkedAt":datetime.now(timezone.utc).isoformat(),"sourceReadOnly":True,"sourceTLS":"verify-full",
            "schemaOnly":True,"sourceWrites":0,"schemaSnapshotBound":True,"rolePasswordsExported":False,"preflight":state["sourcePreflight"],
            "schemas":catalog["schemas"],"catalogObjects":len(catalog["objects"]),"artifacts":result["artifacts"],
            "restoreExecuted":False,"zeroDifferenceGate":False,"notes":["Roles are cluster-global; separate roles-only dump, no passwords. Compare before any restore.","Raw schema/catalog only in RAM and VM.env paths600/ir35; no raw dump in repository."]}
        REPORT.write_text(json.dumps(report,indent=2)+"\n")
        state.update(artifactTransferPending=False,export={"status":"PASS","reportSHA256":hashlib.sha256(REPORT.read_bytes()).hexdigest()})
        atomic_metadata(STATE,state)
        print(json.dumps({"status":"PASS","operation":"export","report":"docs/evidence/oracle-p3-cloud-export.json","schemaBytes":len(dump),"rolesBytes":len(roles),"objects":len(catalog["objects"]),"sourceWrites":0}))
    finally:
        os.close(lock)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        code = str(error) if isinstance(error,KeySafetyError) and re.fullmatch(r"[A-Za-z0-9_:.-]{1,160}",str(error)) else type(error).__name__
        print(json.dumps({"status":"FAIL","code":code,"sourceWrites":0}))
        raise SystemExit(1)
