"""Owner-approved P3 roles-first repair. Never connects to or writes cloud."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys

import cloud_schema as schema

REPO = Path(__file__).resolve().parents[2]
TARGET = 'ir35_acl_repair_20261021'
DIAGNOSIS_COMMIT = '81a1363'


def identifier(value):
    if not isinstance(value,str) or not value or '\x00' in value:
        raise ValueError('Invalid SQL identifier')
    return '"'+value.replace('"','""')+'"'


def literal(value):
    if not isinstance(value,str) or '\x00' in value:
        raise ValueError('Invalid SQL literal')
    return "'"+value.replace("'","''")+"'"


def role_sql(source, target, extra_dependencies):
    def objects(catalog,kind):
        return {o['name']:o['value'] for o in catalog['objects'] if o['kind']==kind}
    a,b=objects(source,'role'),objects(target,'role')
    extras=set(b)-set(a)
    if extras-{'supabase_functions_admin'} or extra_dependencies:
        raise ValueError('Unreviewed extra role/dependencies; do not remove or waive')
    statements=[]
    for name,value in sorted(a.items()):
        if name not in b:
            # Source-matching role creation is approved, not privilege escalation
            # of a pre-existing role beyond cloud. Password remains unset.
            statements.append('CREATE ROLE '+identifier(name)+';')
        old=b.get(name,{})
        if {k:v for k,v in old.items() if k!='config'}!={k:v for k,v in value.items() if k!='config'}:
            flags=' '.join(('' if value[k] else 'NO')+flag for k,flag in
              [('superuser','SUPERUSER'),('inherit','INHERIT'),('createRole','CREATEROLE'),('createDB','CREATEDB'),
               ('login','LOGIN'),('replication','REPLICATION'),('bypassRLS','BYPASSRLS')])
            statements.append('ALTER ROLE '+identifier(name)+' '+flags+' CONNECTION LIMIT '+str(int(value['connectionLimit']))+';')
        if old.get('config')!=value.get('config'):
            statements.append('ALTER ROLE '+identifier(name)+' RESET ALL;')
            for item in value.get('config') or []:
                key,setting=item.split('=',1)
                # Avoid re-quoting list GUCs (notably search_path) as one name.
                statements.append('SELECT pg_catalog.set_config('+literal(key)+','+literal(setting)+',true);')
                statements.append('ALTER ROLE '+identifier(name)+' SET '+identifier(key)+' FROM CURRENT;')
    memberships_a,memberships_b=objects(source,'role-membership'),objects(target,'role-membership')
    for name,value in sorted(memberships_b.items()):
        if memberships_a.get(name)!=value:
            role,member,grantor=name.split(':')
            statements.append('REVOKE '+identifier(role)+' FROM '+identifier(member)+' GRANTED BY '+identifier(grantor)+';')
    for name,value in sorted(memberships_a.items()):
        if memberships_b.get(name)==value:
            continue
        role,member,grantor=name.split(':')
        statements.append('GRANT '+identifier(role)+' TO '+identifier(member)+' WITH '+', '.join(
            key.upper()+' '+str(value[key]).upper() for key in ('admin','inherit','set'))+' GRANTED BY '+identifier(grantor)+';')
    for name in sorted(extras):
        statements.append('DROP ROLE '+identifier(name)+';')
    return '\n'.join(statements)


def normalize_restored_cloud(query,catalog,cloud,name,log):
    restored=catalog(name)
    source_objects={o['kind']+':'+o['name']:o for o in cloud['objects']}
    owner_changes=[]
    for obj in restored['objects']:
     key=obj['kind']+':'+obj['name'];expected=source_objects.get(key)
     if obj['kind'] not in ('function','view') or not expected or obj['value'].get('owner')==expected['value'].get('owner'):continue
     if {k:v for k,v in obj['value'].items() if k!='owner'}!={k:v for k,v in expected['value'].items() if k!='owner'}:
      raise RuntimeError('Non-owner function/view difference; do not rewrite')
     owner_changes.append({'kind':obj['kind'],'name':obj['name'],'owner':expected['value']['owner']})
    # Build supported ALTER FUNCTION/VIEW OWNER statements using server quoting.
    changes=literal(json.dumps(owner_changes))+'::jsonb'
    owner_sql="WITH wanted AS (SELECT * FROM jsonb_to_recordset("+changes+") AS x(kind text,name text,owner text)), commands AS (SELECT format('ALTER %s %I.%I(%s) OWNER TO %I;',CASE p.prokind WHEN 'p' THEN 'PROCEDURE' ELSE 'FUNCTION' END,n.nspname,p.proname,pg_get_function_identity_arguments(p.oid),w.owner) command FROM wanted w JOIN pg_proc p ON w.kind='function' JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')'=w.name UNION ALL SELECT format('ALTER %s %I.%I OWNER TO %I;',CASE c.relkind WHEN 'm' THEN 'MATERIALIZED VIEW' ELSE 'VIEW' END,n.nspname,c.relname,w.owner) FROM wanted w JOIN pg_class c ON w.kind='view' AND c.relkind IN ('v','m') JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname||'.'||c.relname=w.name) SELECT coalesce(json_agg(command),'[]'::json) FROM commands;"
    statements=json.loads(query(owner_sql,name))
    if len(statements)!=len(owner_changes):raise RuntimeError('Owner command coverage mismatch')
    if statements:query('\n'.join(statements),name,log=log)
    current=catalog(name)
    source_grants={o['name']:o for o in cloud['objects'] if o['kind']=='grant'}
    current_grants={o['name']:o for o in current['objects'] if o['kind']=='grant'}
    changed={key.rsplit(':',3)[0] for key in source_grants.keys()|current_grants.keys() if source_grants.get(key,{}).get('hash')!=current_grants.get(key,{}).get('hash')}
    commands_query="SELECT coalesce(json_agg(x),'[]'::json) FROM (SELECT 'schema:'||n.nspname key,format('SCHEMA %I',n.nspname) sql,pg_get_userbyid(n.nspowner) owner FROM pg_namespace n WHERE n.nspname IN ('graphql','graphql_public') UNION ALL SELECT 'function:'||n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')',format('FUNCTION %I.%I(%s)',n.nspname,p.proname,pg_get_function_identity_arguments(p.oid)),pg_get_userbyid(p.proowner) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='extensions' AND p.prokind='f' UNION ALL SELECT 'relation:'||n.nspname||'.'||c.relname,format('TABLE %I.%I',n.nspname,c.relname),pg_get_userbyid(c.relowner) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='extensions' AND c.relkind IN ('v','m')) x;"
    objects={r['key']:r for r in json.loads(query(commands_query,name))}
    acl_sql=[]
    for key in sorted(changed):
     if key not in objects:raise RuntimeError('ACL drift outside diagnosed extension/GraphQL scope')
     obj=objects[key]
     wanted=[o['value'] for k,o in source_grants.items() if k.rsplit(':',3)[0]==key]
     existing=[o['value'] for k,o in current_grants.items() if k.rsplit(':',3)[0]==key]
     if not wanted or any(r['grantor']!=obj['owner'] for r in wanted+existing):
      raise RuntimeError('Multi-grantor ACL requires review; no flattening')
     acl_sql.append('SET LOCAL ROLE '+identifier(obj['owner'])+';')
     for grantee in sorted({r['grantee'] for r in wanted+existing}):
      acl_sql.append('REVOKE ALL PRIVILEGES ON '+obj['sql']+' FROM '+('PUBLIC' if grantee=='PUBLIC' else identifier(grantee))+';')
     for row in wanted:
      if row['privilege'] not in ('SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN','EXECUTE','USAGE','CREATE'):
       raise RuntimeError('Privilege keyword guard')
      acl_sql.append('GRANT '+row['privilege']+' ON '+obj['sql']+' TO '+('PUBLIC' if row['grantee']=='PUBLIC' else identifier(row['grantee']))+(' WITH GRANT OPTION' if row['grantable'] else '')+';')
     acl_sql.append('RESET ROLE;')
    if acl_sql:query('\n'.join(acl_sql),name,log=log)
    final=catalog(name)
    if any(o['kind']=='rls' and o['name'].startswith('public.') and not o['value']['enabled'] for o in final['objects']):
     raise RuntimeError('Public RLS disabled; stop')
    return {'ownerRepairs':len(owner_changes),'aclObjectsReplayed':len(changed),'catalog':final}


GUEST = r'''
import fcntl
lock=os.open(ROOT/'config/p3-acl-repair.lock',os.O_RDWR|os.O_CREAT|os.O_NOFOLLOW,0o600)
fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
fresh_path=ROOT/'.env.p3-acl-source-catalog.json'
fresh_stat=fresh_path.lstat()
if not stat.S_ISREG(fresh_stat.st_mode) or fresh_stat.st_uid!=1002 or stat.S_IMODE(fresh_stat.st_mode)!=0o600 or fresh_stat.st_nlink!=1:
 raise RuntimeError('Private fresh source catalog custody guard')
if hashlib.sha256(fresh_path.read_bytes()).hexdigest()!=FRESH_CATALOG_HASH:
 raise RuntimeError('Private source catalog byte hash mismatch')
fresh=json.loads(fresh_path.read_text())
if {x['kind']+':'+x['name']:x['hash'] for x in fresh['objects']}!={x['kind']+':'+x['name']:x['hash'] for x in cloud['objects']}:
 raise RuntimeError('Fresh source drift; no mutation')
cloud=fresh
name='ir35_acl_repair_20261021'
base=['docker','compose','--env-file',str(ENV),'-f',str(ROOT/'compose.yml'),'exec','-T','db','/run/ir35/env-exec','/opt/ir35/.env.db']

def query(sql,database='postgres',transaction=True,log=None):
 if database not in ('postgres',name):raise RuntimeError('Fixed staging destination only')
 args=base+['psql','-XqAt','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose','-U','supabase_admin','-d',database,'-f','-']
 if transaction:args.append('--single-transaction')
 result=subprocess.run(args,input=sql,capture_output=True,text=True,timeout=120)
 if log:
  log.write(result.stdout.encode());log.write(result.stderr.encode());log.flush();os.fsync(log.fileno())
 if result.returncode:
  codes=sorted(set(re.findall(r'(?:ERROR|FATAL):\s+([A-Z0-9]{5})',result.stderr)))
  raise RuntimeError('Staging SQL failed; SQLSTATE='+','.join(codes)+'; full private log only')
 return result.stdout

def catalog(database):
 return json.loads(query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; SET LOCAL search_path=pg_catalog;\n'+CATALOG_SQL+'\nROLLBACK;',database,False))

target=catalog('postgres')
deps=json.loads(query("SELECT coalesce(json_agg(json_build_object('database',d.datname,'class',s.classid::regclass::text,'dependency',s.deptype)), '[]'::json) FROM pg_shdepend s LEFT JOIN pg_database d ON d.oid=s.dbid WHERE s.refclassid='pg_authid'::regclass AND s.refobjid=(SELECT oid FROM pg_roles WHERE rolname='supabase_functions_admin');"))
MODULE
role_statements=role_sql(cloud,target,deps)
if OPERATION=='inspect':
 print(json.dumps({'status':'PASS','roleDependencies':deps,'roleStatementCount':len(role_statements.splitlines()),'sourceWrites':0,'stagingWrites':0}))
else:
 MUTATION
'''


MUTATION = r'''
marker=ROOT/'config/p3-acl-repair.json'
if marker.exists():raise RuntimeError('Repair already journalled; audit/reconcile only, no repeated restore')
if query("SELECT 1 FROM pg_database WHERE datname='"+name+"';").strip():raise RuntimeError('Unowned database collision; no overwrite')
dump=ROOT/'.env.p3-source-schema.dump'
s=dump.lstat()
if not stat.S_ISREG(s.st_mode) or s.st_uid!=1002 or stat.S_IMODE(s.st_mode)!=0o600 or s.st_nlink!=1 or hashlib.sha256(dump.read_bytes()).hexdigest()!=DUMP_HASH:
 raise RuntimeError('Private source archive identity/custody changed')
logpath=ROOT/'.env.p3-acl-restore.log'
fd=os.open(logpath,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
os.fchown(fd,1002,1002)
record={'purpose':'ir35-disposable-acl-repair','database':name,'status':'PENDING','attempts':1,'sourceSHA256':DUMP_HASH,'diagnosisCommit':'81a1363','customerRowsImported':0}
write(marker,json.dumps(record),0o600)
with os.fdopen(fd,'wb') as log:
 try:
  query(role_statements,log=log)
  after=catalog('postgres')
  roles=lambda cat:{o['kind']+':'+o['name']:o['hash'] for o in cat['objects'] if o['kind'] in ('role','role-membership')}
  if roles(cloud)!=roles(after):raise RuntimeError('Role read-back not identical; no restore')
  record['rolesAligned']=True;write(marker,json.dumps(record),0o600)
  if cloud['encoding']!='UTF8' or cloud['collation']!={'ctype':'en_US.UTF-8','locale':'en-US','collate':'en_US.UTF-8','provider':'i'}:
   raise RuntimeError('Exact collation guard')
  query('CREATE DATABASE '+name+" WITH OWNER postgres TEMPLATE template0 ENCODING 'UTF8' LC_COLLATE 'en_US.UTF-8' LC_CTYPE 'en_US.UTF-8' LOCALE_PROVIDER icu ICU_LOCALE 'en-US';",transaction=False,log=log)
  record['databaseCreated']=True;write(marker,json.dumps(record),0o600)
  # --clean is confined to this just-created, unattached database, never an
  # existing app/source database. Owners, ACLs and defaults are preserved.
  args=base+['pg_restore','--no-password','--verbose','--clean','--if-exists','--single-transaction','--exit-on-error','--username=supabase_admin','--dbname='+name]
  result=subprocess.run(args,input=dump.read_bytes(),stdout=log,stderr=log,timeout=180)
  log.flush();os.fsync(log.fileno())
  if result.returncode:raise RuntimeError('Atomic schema restore failed; full private log retained, no skip/replay')
  record['schemaRestored']=True;write(marker,json.dumps(record),0o600)
  normalized=normalize_restored_cloud(query,catalog,cloud,name,log)
  owner_changes=range(normalized['ownerRepairs']);changed=range(normalized['aclObjectsReplayed'])
  record.update(status='RESTORED',ownerRepairs=len(owner_changes),aclObjectsReplayed=len(changed),fullLogSHA256=hashlib.sha256(logpath.read_bytes()).hexdigest())
  write(marker,json.dumps(record),0o600)
 except Exception:
  record.update(status='FAILED',fullLogSHA256=hashlib.sha256(logpath.read_bytes()).hexdigest());write(marker,json.dumps(record),0o600)
  raise
print(json.dumps({'status':'RESTORE_ONLY','phaseComplete':False,'database':name,'rolesAligned':True,'attempts':record['attempts'],
 'ownerRepairs':record['ownerRepairs'],'aclObjectsReplayed':record['aclObjectsReplayed'],
 'log':{'path':str(logpath),'mode':'600','owner':'ir35','bytes':logpath.stat().st_size,'sha256':record['fullLogSHA256']},
 'sourceWrites':0,'customerRowsImported':0,'zeroDifferenceGate':False,'exceptionsApproved':[]}))
'''


def verify():
    import effective_privileges
    sql=(REPO/'supabase/verification/oracle_effective_privileges.sql').read_text()
    expiry_sql="SELECT jsonb_object_agg(rolname,jsonb_build_object('hash',md5(coalesce((rolvaliduntil AT TIME ZONE 'UTC')::text,'NULL')),'configured',rolvaliduntil IS NOT NULL,'finite',coalesce(isfinite(rolvaliduntil),false)) ORDER BY rolname) FROM pg_roles WHERE rolname !~ '^pg_';"
    with schema.Snapshot(schema.source_environment()) as snapshot:
        snapshot.send((REPO/'supabase/verification/oracle_schema_catalog.sql').read_text())
        source=json.loads(snapshot.line())
        snapshot.send(sql)
        matrix=json.loads(snapshot.line())
        snapshot.send(expiry_sql)
        expiry=json.loads(snapshot.line())
    module=Path(effective_privileges.__file__).read_text()
    guest=r'''
name='ir35_acl_repair_20261021'
record=json.loads((ROOT/'config/p3-acl-repair.json').read_text())
if record.get('purpose')!='ir35-disposable-acl-repair' or record.get('database')!=name or record.get('status')!='RESTORED':
 raise RuntimeError('Owned restored ACL target required; no restore replay')
source=SOURCE_CATALOG
if {x['kind']+':'+x['name']:x['hash'] for x in source['objects']}!={x['kind']+':'+x['name']:x['hash'] for x in cloud['objects']}:
 raise RuntimeError('Source schema changed; keep historical evidence, stop repair')
base=['docker','compose','--env-file',str(ENV),'-f',str(ROOT/'compose.yml'),'exec','-T','db','/run/ir35/env-exec','/opt/ir35/.env.db','psql','-XqAt','-v','ON_ERROR_STOP=1','-U','supabase_admin','-d',name,'-f','-']
def read(sql):
 result=subprocess.run(base,input='BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; SET LOCAL search_path=pg_catalog;\n'+sql+'\nROLLBACK;',capture_output=True,text=True,timeout=60)
 if result.returncode:raise RuntimeError('Read-only repaired target audit failed; raw output withheld')
 return json.loads(result.stdout)
target=read(CATALOG_SQL)
MODULE
privileges=compare(SOURCE_MATRIX,read(PRIVILEGE_SQL))
source_expiry=SOURCE_EXPIRY
target_expiry=read(EXPIRY_SQL)
expiry_differences=[]
for role in sorted(source_expiry.keys()|target_expiry.keys()):
 left,right=source_expiry.get(role,{}),target_expiry.get(role,{})
 if left==right:continue
 expiry_differences.append({'role':role,'cloudHash':left.get('hash'),'cloneHash':right.get('hash'),
  'cloudFiniteExpiry':left.get('finite'),'cloneExpiryConfigured':right.get('configured'),
  'morePermissive':bool(left.get('finite') and (not right.get('configured') or not right.get('finite')))})
log=ROOT/'.env.p3-acl-restore.log';s=log.lstat()
if not stat.S_ISREG(s.st_mode) or s.st_uid!=1002 or stat.S_IMODE(s.st_mode)!=0o600 or s.st_nlink!=1 or hashlib.sha256(log.read_bytes()).hexdigest()!=record.get('fullLogSHA256'):
 raise RuntimeError('Private restore log custody/hash mismatch')
print(json.dumps({'status':'AUDIT_ONLY','source':safe(source),'clone':safe(target),'privileges':privileges,
 'roleExpiry':{'status':'FAIL' if expiry_differences else 'PASS','roles':len(source_expiry),'differences':expiry_differences},
 'catalogRoleFlagsConfigMembershipMatch':{x['kind']+':'+x['name']:x['hash'] for x in source['objects'] if x['kind'] in ('role','role-membership')}=={x['kind']+':'+x['name']:x['hash'] for x in target['objects'] if x['kind'] in ('role','role-membership')},
 'rolesMatch':not expiry_differences and {x['kind']+':'+x['name']:x['hash'] for x in source['objects'] if x['kind'] in ('role','role-membership')}=={x['kind']+':'+x['name']:x['hash'] for x in target['objects'] if x['kind'] in ('role','role-membership')},
 'publicTablesWithoutRLS':[x['name'] for x in target['objects'] if x['kind']=='rls' and x['name'].startswith('public.') and not x['value']['enabled']],
 'sourceWrites':0,'stagingWrites':0,'exceptionsApproved':[]}))
'''.replace('SOURCE_CATALOG',repr(source)).replace('SOURCE_MATRIX',repr(matrix)).replace('PRIVILEGE_SQL',repr(sql)).replace('SOURCE_EXPIRY',repr(expiry)).replace('EXPIRY_SQL',repr(expiry_sql)).replace('MODULE',module)
    result=schema.run_guest(schema.guest_bundle()+guest,timeout=120)
    schema.CACHE.mkdir(parents=True,exist_ok=True)
    for name in ('source','clone'):
        (schema.CACHE/('acl-'+name+'.json')).write_text(json.dumps(result.pop(name),indent=2)+'\n')
    path=REPO/'docs/evidence/oracle-p3-acl-security.json'
    path.write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps({'status':'PASS','operation':'verify-acl-repair','report':'docs/evidence/oracle-p3-acl-security.json',
                     'objects':result['privileges']['sourceEntries'],'sourceWrites':0}))


def main():
    if len(sys.argv)!=2 or sys.argv[1] not in ('inspect','restore'):
        raise ValueError('Fixed staging repair only')
    operation=sys.argv[1]
    if operation=='restore':
        gate=REPO/'docs/evidence/oracle-p3-acl-gate.json'
        if gate.exists() and json.loads(gate.read_text()).get('status')!='CATALOG_MATCH_ONLY':
            raise ValueError('ACL fidelity failed; owner exception decision required, no further mutation')
        # Windows-managed worktree .git contains a Windows absolute path. Git in
        # WSL needs the explicit mounted git-dir; never alter the worktree file.
        gitdir=(REPO/'.git').read_text().strip().removeprefix('gitdir: ')
        if len(gitdir)>3 and gitdir[1:3]==':/':gitdir='/mnt/'+gitdir[0].lower()+gitdir[2:]
        if subprocess.run(['git','--git-dir='+gitdir,'merge-base','--is-ancestor',DIAGNOSIS_COMMIT,'HEAD'],cwd=REPO,capture_output=True).returncode:
            raise ValueError('Committed diagnosis required before mutation')
        evidence=json.loads((REPO/'docs/evidence/oracle-p3-effective-privileges.json').read_text())
        if evidence['morePermissive'] or not evidence['sourceCatalogUnchanged']:
            raise ValueError('Security/source drift hold; no repair')
    module=Path(__file__).read_text().split('GUEST =',1)[0]
    module=module[module.index('def identifier'):]
    digest=json.loads(schema.REPORT.read_text())['artifacts']['.env.p3-source-schema.dump']['sha256']
    fresh_digest=json.loads((REPO/'docs/evidence/oracle-p3-effective-privileges.json').read_text())['sourceCatalogSHA256']
    mutation='\n'.join(' '+line if line else '' for line in MUTATION.replace('DUMP_HASH',repr(digest)).splitlines())
    guest=GUEST.replace('MODULE',module).replace('OPERATION',repr(operation)).replace('FRESH_CATALOG_HASH',repr(fresh_digest)).replace(' MUTATION',mutation)
    result=schema.run_guest(schema.guest_bundle()+guest,timeout=400)
    path=REPO/('docs/evidence/oracle-p3-role-preflight.json' if operation=='inspect' else 'docs/evidence/oracle-p3-acl-restore.json')
    path.write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps(result))


if __name__=='__main__':
    try:main()
    except Exception as error:
        print(json.dumps({'status':'FAIL','code':type(error).__name__,'rawOutput':'withheld'}));raise SystemExit(1)
