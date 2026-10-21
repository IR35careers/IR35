"""Narrow owner-approved expiry repair and one direct-owner extension attempt."""
import json
from pathlib import Path
import sys

import cloud_schema as schema

REPO=Path(__file__).resolve().parents[2]

BASE=r'''
import fcntl
from urllib.parse import urlsplit
lock=os.open(ROOT/'config/p3-owner-parity.lock',os.O_RDWR|os.O_CREAT|os.O_NOFOLLOW,0o600)
fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
base=['docker','compose','--env-file',str(ENV),'-f',str(ROOT/'compose.yml'),'exec','-T','db','/run/ir35/env-exec','/opt/ir35/.env.db']
def query(sql,database='postgres',role='supabase_admin',readonly=True):
 if database not in ('postgres','ir35_acl_repair_20261021','ir35_owner_parity_20261021','ir35_baseline_proof_20261021') or role not in ('supabase_admin','postgres'):
  raise RuntimeError('Fixed staging database/role only')
 prefix='BEGIN ISOLATION LEVEL REPEATABLE READ '+('READ ONLY' if readonly else 'READ WRITE')+'; SET LOCAL search_path=pg_catalog; SET LOCAL TIME ZONE \'UTC\';\n'
 result=subprocess.run(base+['psql','-XqAt','-v','ON_ERROR_STOP=1','-v','VERBOSITY=sqlstate','-U',role,'-d',database,'-f','-'],
  input=prefix+sql+'\n'+('ROLLBACK;' if readonly else 'COMMIT;'),capture_output=True,text=True,timeout=120)
 if result.returncode:raise RuntimeError('Staging SQL failed; raw output withheld')
 return result.stdout

def role_usage():
 role='cli_login_postgres';hits=[];checked=[];users={}
 rows=[json.loads(line) for line in dc('ps','--format','json').splitlines() if line.strip()]
 if {r['Service'] for r in rows}!={'db','auth','rest','realtime','storage','kong','meta','smtp','caddy'}:
  raise RuntimeError('Unexpected staging container inventory')
 for row in rows:
  name=row['Service'];config=json.loads(run(['docker','inspect','--format','{{json .Config}}',row['ID']]))
  # Captured privately; only names/counts/booleans are returned.
  for key in ('Env','Entrypoint','Cmd','Healthcheck'):
   if role in json.dumps(config.get(key)):
    hits.append('container:'+name+':'+key)
  path=ROOT/('.env.'+name);s=path.lstat()
  if not stat.S_ISREG(s.st_mode) or s.st_uid!=1002 or stat.S_IMODE(s.st_mode)!=0o600 or s.st_nlink!=1:
   raise RuntimeError('Component env custody guard')
  data={}
  for line in path.read_text().splitlines():
   m=re.fullmatch(r"([A-Z][A-Z0-9_]*)='([^'\r\n]*)'",line)
   if not m:raise RuntimeError('Invalid private component env')
   data[m[1]]=m[2]
  for key,value in data.items():
   if role in value:hits.append('component:'+name+':'+key)
   if key in ('GOTRUE_DB_DATABASE_URL','PGRST_DB_URI','DATABASE_URL'):
    users[name]=urlsplit(value).username
   if key in ('DB_USER','PG_META_DB_USER'):users[name]=value
  checked.append('component:'+name)
 for root in (ROOT/'bin',ROOT/'config',Path('/etc/cron.d'),Path('/etc/cron.daily'),Path('/etc/cron.hourly'),Path('/etc/cron.weekly'),Path('/etc/cron.monthly'),Path('/var/spool/cron/crontabs'),Path('/usr/local/bin')):
  if not root.exists():continue
  for path in sorted(root.rglob('*')):
   if not path.is_file():continue
   actual=path.resolve()
   if not any(actual.is_relative_to(p) for p in (ROOT,Path('/etc'),Path('/usr'),Path('/var/spool/cron'))):
    raise RuntimeError('Operational scan symlink outside reviewed roots')
   if actual.stat().st_size>2_000_000:raise RuntimeError('Operational file scan bound')
   body=actual.read_bytes()
   if role.encode() in body:hits.append('operational-file:'+str(path))
   checked.append('file:'+str(path))
 if Path('/etc/crontab').exists():
  if role in Path('/etc/crontab').read_text():hits.append('host-crontab')
  checked.append('file:/etc/crontab')
 units=run(['systemctl','list-units','--all','--type=service','--no-legend','--plain','--no-pager'])
 unit_names=[]
 for line in units.splitlines():
  words=line.split()
  if words and re.fullmatch(r'[A-Za-z0-9_.@\\:-]+\.service',words[0]):unit_names.append(words[0])
 if not unit_names or len(unit_names)>500:raise RuntimeError('Host service inventory incomplete')
 cat=subprocess.run(['systemctl','cat',*unit_names],capture_output=True,text=True,timeout=30)
 if role in cat.stdout:hits.append('host-service-definition')
 if len(cat.stdout)>4_000_000:raise RuntimeError('Host service definition bound')
 checked.extend('unit:'+name for name in unit_names)
 sessions=int(query("SELECT count(*) FROM pg_stat_activity WHERE usename='cli_login_postgres';").strip())
 if sessions:hits.append('active-database-login')
 result={'status':'FAIL' if hits else 'PASS','checkedAt':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),
  'checks':len(checked),'componentCount':len(rows),'hostServiceDefinitions':len(unit_names),'activeCLILogins':sessions,
  'componentDatabaseUsers':users,'stagingMigrationRunnerUsers':['supabase_admin','postgres'],'hits':hits,
  'sourceWrites':0,'stagingWrites':0}
 if hits:raise RuntimeError('Staging CLI-role dependency found; no expiry change')
 return result
'''


def audit_usage():
    result=schema.run_guest(schema.guest_bundle()+BASE+'\nprint(json.dumps(role_usage()))\n',timeout=180)
    (REPO/'docs/evidence/oracle-p3-cli-role-usage.json').write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps({'status':'PASS','operation':'audit-cli-role-usage','report':'docs/evidence/oracle-p3-cli-role-usage.json','objects':result['checks'],'sourceWrites':0}))


def security_preflight():
    import extension_security
    import effective_privileges
    extension_sql=(REPO/'supabase/verification/oracle_extension_security.sql').read_text()
    privilege_sql=(REPO/'supabase/verification/oracle_effective_privileges.sql').read_text()
    with schema.Snapshot(schema.source_environment()) as snapshot:
        snapshot.send(extension_sql);source=json.loads(snapshot.line())
        snapshot.send(privilege_sql);privileges=json.loads(snapshot.line())
        guest=BASE+r'''
role_usage()
EXTENSION_MODULE
extension_result=compare(SOURCE_EXTENSION,json.loads(query(EXTENSION_SQL,'ir35_acl_repair_20261021')))
PRIVILEGE_MODULE
privilege_result=compare(SOURCE_PRIVILEGES,json.loads(query(PRIVILEGE_SQL,'ir35_acl_repair_20261021')))
print(json.dumps({'status':'PASS' if extension_result['status']=='PASS' and privilege_result['status']=='PASS' else 'FAIL',
 'extensions':extension_result,'appRolePrivileges':privilege_result,'sourceWrites':0,'stagingWrites':0}))
'''
        guest=guest.replace('SOURCE_EXTENSION',repr(source)).replace('SOURCE_PRIVILEGES',repr(privileges)).replace('EXTENSION_SQL',repr(extension_sql)).replace('PRIVILEGE_SQL',repr(privilege_sql))
        guest=guest.replace('EXTENSION_MODULE',Path(extension_security.__file__).read_text()).replace('PRIVILEGE_MODULE',Path(effective_privileges.__file__).read_text())
        result=schema.run_guest(schema.guest_bundle()+guest,timeout=180)
    path=REPO/'docs/evidence/oracle-p3-extension-security-preflight.json'
    path.write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps({'status':result['status'],'operation':'owner-security-preflight','report':'docs/evidence/oracle-p3-extension-security-preflight.json','objects':result['extensions']['objectACLChecks'],'sourceWrites':0}))
    if result['status']!='PASS':raise SystemExit(1)


EXPIRY_PROBE=r'''
usage=role_usage()
name='ir35_owner_parity_20261021'
marker=ROOT/'config/p3-owner-parity.json'
if marker.exists():raise RuntimeError('Owner attempt already journalled; read-back/reconcile only, no second attempt')
source=SOURCE_DATA
if {x['kind']+':'+x['name']:x['hash'] for x in source['catalog']['objects']}!={x['kind']+':'+x['name']:x['hash'] for x in cloud['objects']}:
 raise RuntimeError('Source schema changed; no expiry or extension attempt')
EXTENSION_MODULE
conditions=compare(source['extensions'],json.loads(query(EXTENSION_SQL,'ir35_acl_repair_20261021')))
if conditions['status']!='PASS':raise RuntimeError('Extension a-d precondition FAIL; no mutation')
if query("SELECT 1 FROM pg_database WHERE datname='"+name+"';").strip():raise RuntimeError('Unowned clean-target collision')
until=source['expiry']
if not isinstance(until,str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{6}\+00',until):
 raise RuntimeError('Finite canonical source expiry required')
def expiry_map(database):return json.loads(query(EXPIRY_SQL,database))
role_sql="SELECT md5(jsonb_build_object('superuser',rolsuper,'inherit',rolinherit,'createRole',rolcreaterole,'createDB',rolcreatedb,'login',rolcanlogin,'replication',rolreplication,'bypassRLS',rolbypassrls,'connectionLimit',rolconnlimit,'config',rolconfig)::text) FROM pg_roles WHERE rolname='cli_login_postgres';"
before=query(role_sql).strip()
private=ROOT/'.env.p3-owner-source.json'
fd=os.open(private,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
with os.fdopen(fd,'wb') as f:
 os.fchown(f.fileno(),1002,1002);f.write(json.dumps(source,sort_keys=True).encode());f.flush();os.fsync(f.fileno())
record={'purpose':'ir35-owner-approved-parity','status':'EXPIRY_PENDING','extensionAttempts':0,
 'sourceSHA256':hashlib.sha256(private.read_bytes()).hexdigest(),'database':name,'approval':'21October-exact-expiry-one-owner-attempt'}
write(marker,json.dumps(record),0o600)
query('ALTER ROLE "cli_login_postgres" VALID UNTIL '+"'"+until+"';",readonly=False)
after=query(role_sql).strip();expiry=expiry_map('ir35_acl_repair_20261021')
if before!=after or expiry!=source['roleExpiry']:
 record['status']='EXPIRY_FAIL';write(marker,json.dumps(record),0o600);raise RuntimeError('Role-attribute mismatch after expiry-only repair')
record['status']='EXPIRY_PASS';record['expiryOnlyHash']=expiry['cli_login_postgres']['hash'];write(marker,json.dumps(record),0o600)
create="CREATE DATABASE "+name+" WITH OWNER postgres TEMPLATE template0 ENCODING 'UTF8' LC_COLLATE 'en_US.UTF-8' LC_CTYPE 'en_US.UTF-8' LOCALE_PROVIDER icu ICU_LOCALE 'en-US';"
# CREATE DATABASE cannot run inside a transaction. Intent remains durable.
result=subprocess.run(base+['psql','-XqAt','-v','ON_ERROR_STOP=1','-U','supabase_admin','-d','postgres','-f','-'],input=create,capture_output=True,text=True,timeout=60)
if result.returncode:raise RuntimeError('Isolated database create failed; output withheld, no duplicate create')
record['extensionAttempts']=1;record['status']='OWNER_PROBE_PENDING';write(marker,json.dumps(record),0o600)
logpath=ROOT/'.env.p3-owner-probe.log';fd=os.open(logpath,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600);os.fchown(fd,1002,1002)
probe="BEGIN; SET LOCAL search_path=pg_catalog; CREATE SCHEMA extensions AUTHORIZATION postgres;\n"
for ext,version in (('pg_stat_statements','1.11'),('pgcrypto','1.3'),('uuid-ossp','1.1')):
 probe+='CREATE EXTENSION "'+ext+'" WITH SCHEMA extensions VERSION '+"'"+version+"';\n"
probe+="SELECT json_build_object('connectedUser',current_user,'superuser',(SELECT rolsuper FROM pg_roles WHERE rolname=current_user),'extensions',(SELECT json_agg(json_build_object('name',extname,'owner',pg_get_userbyid(extowner),'version',extversion) ORDER BY extname) FROM pg_extension WHERE extname IN ('pg_stat_statements','pgcrypto','uuid-ossp')));\nROLLBACK;"
# Direct owner connection, NOT SET ROLE and no extra privilege grants.
result=subprocess.run(base+['psql','-XqAt','-v','ON_ERROR_STOP=1','-v','VERBOSITY=sqlstate','-U','postgres','-d',name,'-f','-'],input=probe,capture_output=True,text=True,timeout=120)
with os.fdopen(fd,'wb') as f:
 f.write(result.stdout.encode());f.write(result.stderr.encode());f.flush();os.fsync(f.fileno())
if result.returncode:
 observed={'connectedUser':'postgres','sqlStates':sorted(set(re.findall(r'(?:ERROR|FATAL):\s+([A-Z0-9]{5})',result.stderr))),'status':'CREATE_REJECTED'}
else:
 observed=json.loads(result.stdout);observed['status']='EXACT' if all(x['owner']=='postgres' for x in observed['extensions']) else 'PLATFORM_DELEGATED'
remaining=json.loads(query("SELECT json_agg(extname ORDER BY extname) FROM pg_extension;",name))
if remaining!=['plpgsql']:raise RuntimeError('Owner probe rollback not clean; STOP')
record.update(status='OWNER_PROBE_COMPLETE',probe=observed,probeLogSHA256=hashlib.sha256(logpath.read_bytes()).hexdigest())
write(marker,json.dumps(record),0o600)
print(json.dumps({'status':'PASS','phaseComplete':False,'usageAudit':usage,'roleExpiry':{'status':'PASS','roles':len(expiry),'differences':[],
 'otherAttributesUnchanged':before==after,'passwordChanged':False,'hash':expiry['cli_login_postgres']['hash']},
 'ownerAttempt':observed,'extensionAttempts':1,'cleanProbeRollback':True,'database':name,
 'probeLog':{'path':str(logpath),'mode':'600','owner':'ir35','sha256':record['probeLogSHA256']},
 'privateSource':{'path':str(private),'mode':'600','owner':'ir35','sha256':record['sourceSHA256']},'sourceWrites':0,'customerRowsImported':0}))
'''


def expiry_probe():
    import extension_security
    extension_sql=(REPO/'supabase/verification/oracle_extension_security.sql').read_text()
    privilege_sql=(REPO/'supabase/verification/oracle_effective_privileges.sql').read_text()
    expiry_sql="SELECT jsonb_object_agg(rolname,jsonb_build_object('hash',md5(coalesce((rolvaliduntil AT TIME ZONE 'UTC')::text,'NULL')),'configured',rolvaliduntil IS NOT NULL,'finite',coalesce(isfinite(rolvaliduntil),false)) ORDER BY rolname) FROM pg_roles WHERE rolname !~ '^pg_';"
    with schema.Snapshot(schema.source_environment()) as snapshot:
        snapshot.send("SET LOCAL TIME ZONE 'UTC'; SET LOCAL DateStyle='ISO,YMD';")
        snapshot.send((REPO/'supabase/verification/oracle_schema_catalog.sql').read_text());catalog=json.loads(snapshot.line())
        snapshot.send(extension_sql);extensions=json.loads(snapshot.line())
        snapshot.send(privilege_sql);privileges=json.loads(snapshot.line())
        snapshot.send(expiry_sql);role_expiry=json.loads(snapshot.line())
        snapshot.send("SELECT to_char(rolvaliduntil AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS.US')||'+00' FROM pg_roles WHERE rolname='cli_login_postgres' AND isfinite(rolvaliduntil);")
        until=snapshot.line().decode()
        data={'catalog':catalog,'extensions':extensions,'privileges':privileges,'roleExpiry':role_expiry,'expiry':until}
        guest=EXPIRY_PROBE.replace('SOURCE_DATA',repr(data)).replace('EXTENSION_SQL',repr(extension_sql)).replace('EXPIRY_SQL',repr(expiry_sql))
        guest=guest.replace('EXTENSION_MODULE',Path(extension_security.__file__).read_text())
        result=schema.run_guest(schema.guest_bundle()+BASE+guest,timeout=400)
    path=REPO/'docs/evidence/oracle-p3-owner-attempt.json'
    path.write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps({'status':'PASS','operation':'owner-expiry-probe','report':'docs/evidence/oracle-p3-owner-attempt.json','objects':len(catalog['objects']),'sourceWrites':0}))


INSTALL=r'''
marker=ROOT/'config/p3-owner-parity.json';record=json.loads(marker.read_text())
if record.get('purpose')!='ir35-owner-approved-parity' or record.get('status')!='OWNER_PROBE_COMPLETE' or record.get('extensionAttempts')!=1:
 raise RuntimeError('Single completed owner attempt required; no probe replay')
if record['probe'].get('status') not in ('PLATFORM_DELEGATED','CREATE_REJECTED'):
 raise RuntimeError('Exact owner possible; cannot take exception route')
private=ROOT/'.env.p3-owner-source.json';s=private.lstat()
if not stat.S_ISREG(s.st_mode) or s.st_uid!=1002 or stat.S_IMODE(s.st_mode)!=0o600 or s.st_nlink!=1 or hashlib.sha256(private.read_bytes()).hexdigest()!=record['sourceSHA256']:
 raise RuntimeError('Verified private source bundle required')
source=json.loads(private.read_text());cloud=source['catalog']
dump=ROOT/'.env.p3-source-schema.dump';s=dump.lstat()
if not stat.S_ISREG(s.st_mode) or s.st_uid!=1002 or stat.S_IMODE(s.st_mode)!=0o600 or s.st_nlink!=1 or hashlib.sha256(dump.read_bytes()).hexdigest()!=DUMP_HASH:
 raise RuntimeError('Verified schema archive required')
ledger_path=ROOT/'config/p3-owner-installs.json'
ledger=json.loads(ledger_path.read_text()) if ledger_path.exists() else {'purpose':'ir35-owner-baseline-installs','sourceSHA256':record['sourceSHA256'],'targets':{}}
if ledger.get('purpose')!='ir35-owner-baseline-installs' or ledger.get('sourceSHA256')!=record['sourceSHA256']:
 raise RuntimeError('Baseline install ledger identity mismatch')
ALIGN_MODULE
EXTENSION_MODULE
extension_compare=compare
PRIVILEGE_MODULE
privilege_compare=compare
FIDELITY_MODULE
fidelity_compare=compare
def execute(sql,database='postgres',transaction=True,log=None):
 if database not in ('postgres','ir35_owner_parity_20261021','ir35_baseline_proof_20261021'):
  raise RuntimeError('Fixed staging baseline destinations only')
 args=base+['psql','-XqAt','-v','ON_ERROR_STOP=1','-v','VERBOSITY=sqlstate','-U','supabase_admin','-d',database,'-f','-']
 if transaction:args.append('--single-transaction')
 result=subprocess.run(args,input=sql,capture_output=True,text=True,timeout=120)
 if log:log.write(result.stdout.encode());log.write(result.stderr.encode());log.flush();os.fsync(log.fileno())
 if result.returncode:raise RuntimeError('Baseline SQL failed; full private log only, no skip')
 return result.stdout
def catalog(database):
 return json.loads(execute('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; SET LOCAL search_path=pg_catalog;\n'+CATALOG_SQL+'\nROLLBACK;',database,False))
roles=lambda cat:{o['kind']+':'+o['name']:o['hash'] for o in cat['objects'] if o['kind'] in ('role','role-membership')}
if roles(catalog('postgres'))!=roles(cloud):raise RuntimeError('Fresh baseline cluster role prerequisites differ; no restore')
def expiry_matches(database):return json.loads(query(EXPIRY_SQL,database))==source['roleExpiry']
if not expiry_matches('postgres'):raise RuntimeError('Snapshot-bound role expiry mismatch; no restore')
gates={};logs={}
for name in ('ir35_owner_parity_20261021','ir35_baseline_proof_20261021'):
 prior=ledger['targets'].get(name)
 if prior and prior.get('status')!='RESTORED':raise RuntimeError('Ambiguous/failed baseline target; reconcile, no replay')
 if not prior:
  existing=execute("SELECT oid FROM pg_database WHERE datname='"+name+"';").strip()
  if existing and name!='ir35_owner_parity_20261021':raise RuntimeError('Unowned fresh baseline database collision')
  ledger['targets'][name]={'status':'PENDING','attempts':1};write(ledger_path,json.dumps(ledger),0o600)
  if not existing:
   execute('CREATE DATABASE '+name+" WITH OWNER postgres TEMPLATE template0 ENCODING 'UTF8' LC_COLLATE 'en_US.UTF-8' LC_CTYPE 'en_US.UTF-8' LOCALE_PROVIDER icu ICU_LOCALE 'en-US';",transaction=False)
  tables=execute("SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname<>'information_schema' AND n.nspname!~'^pg_' AND c.relkind IN ('r','p','f');",name).strip()
  if tables!='0':raise RuntimeError('Fresh baseline is not empty; no overwrite')
  logpath=ROOT/('.env.p3-'+('owner-clone' if name=='ir35_owner_parity_20261021' else 'baseline-proof')+'.log')
  fd=os.open(logpath,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600);os.fchown(fd,1002,1002)
  with os.fdopen(fd,'wb') as log:
   args=base+['pg_restore','--no-password','--verbose','--clean','--if-exists','--single-transaction','--exit-on-error','--username=supabase_admin','--dbname='+name]
   restored=subprocess.run(args,input=dump.read_bytes(),stdout=log,stderr=log,timeout=180)
   log.flush();os.fsync(log.fileno())
   if restored.returncode:
    ledger['targets'][name]['status']='FAILED';write(ledger_path,json.dumps(ledger),0o600);raise RuntimeError('Baseline restore failed; no skipped errors or replay')
   normalized=normalize_restored_cloud(execute,catalog,cloud,name,log)
  ledger['targets'][name].update(status='RESTORED',ownerRepairs=normalized['ownerRepairs'],aclObjectsReplayed=normalized['aclObjectsReplayed'],logPath=str(logpath),logSHA256=hashlib.sha256(logpath.read_bytes()).hexdigest())
  write(ledger_path,json.dumps(ledger),0o600)
 target=catalog(name)
 extension=extension_compare(source['extensions'],json.loads(query(EXTENSION_SQL,name)))
 privileges=privilege_compare(source['privileges'],json.loads(query(PRIVILEGE_SQL,name)))
 gate=fidelity_compare(source['catalog'],target,extension,privileges,expiry_matches(name))
 gate['extensions']=extension;gate['appRolePrivileges']=privileges
 gates[name]=gate;logs[name]=ledger['targets'][name]
 if gate['status']=='FAIL':
  print(json.dumps({'status':'FAIL','gates':gates,'sourceWrites':0,'customerRowsImported':0}));sys.exit(1)
print(json.dumps({'status':'PASS','phaseComplete':False,'schemaOnly':True,'gates':gates,'logs':logs,
 'sourceBundleSHA256':record['sourceSHA256'],'sourceWrites':0,'customerRowsImported':0,'extensionAttempts':record['extensionAttempts']}))
'''


def baseline_guest(digest):
    import inspect
    import acl_repair
    import extension_security
    import effective_privileges
    import fidelity_gate
    expiry_sql="SELECT jsonb_object_agg(rolname,jsonb_build_object('hash',md5(coalesce((rolvaliduntil AT TIME ZONE 'UTC')::text,'NULL')),'configured',rolvaliduntil IS NOT NULL,'finite',coalesce(isfinite(rolvaliduntil),false)) ORDER BY rolname) FROM pg_roles WHERE rolname !~ '^pg_';"
    guest=INSTALL.replace('DUMP_HASH',repr(digest)).replace('EXTENSION_SQL',repr((REPO/'supabase/verification/oracle_extension_security.sql').read_text())).replace('PRIVILEGE_SQL',repr((REPO/'supabase/verification/oracle_effective_privileges.sql').read_text())).replace('EXPIRY_SQL',repr(expiry_sql))
    align='\n\n'.join(inspect.getsource(fn) for fn in (acl_repair.identifier,acl_repair.literal,acl_repair.normalize_restored_cloud))
    guest=guest.replace('ALIGN_MODULE',align).replace('EXTENSION_MODULE',Path(extension_security.__file__).read_text()).replace('PRIVILEGE_MODULE',Path(effective_privileges.__file__).read_text()).replace('FIDELITY_MODULE',Path(fidelity_gate.__file__).read_text().replace('import extension_security',''))
    # fidelity_gate needs the extension version map, already loaded above.
    guest=guest.replace('extension_security.EXTENSIONS','EXTENSIONS')
    return BASE+guest


def install_verified_baselines():
    digest=json.loads(schema.REPORT.read_text())['artifacts']['.env.p3-source-schema.dump']['sha256']
    result=schema.run_guest(schema.guest_bundle()+baseline_guest(digest),timeout=600)
    if result.get('status')!='PASS':raise RuntimeError('Baseline fidelity failed; no continuation')
    path=REPO/'docs/evidence/oracle-p3-owner-fidelity.json'
    path.write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps({'status':'PASS','operation':'install-owner-baselines','report':'docs/evidence/oracle-p3-owner-fidelity.json','objects':len(result['gates']),'sourceWrites':0}))


if __name__=='__main__':
    try:
        if sys.argv[1:]==['audit-usage']:audit_usage()
        elif sys.argv[1:]==['install-baselines']:install_verified_baselines()
        else:raise ValueError('Fixed staging operation only')
    except Exception as error:
        print(json.dumps({'status':'FAIL','code':type(error).__name__,'rawOutput':'withheld'}));raise SystemExit(1)
