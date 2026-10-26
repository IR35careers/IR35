"""One bounded queue-role addition on existing staging Postgres, never cloud."""
import json
import copy
import os
from pathlib import Path
import re
import stat
import subprocess
from immutable_artifacts import Store
from p4_recovery_guest import Recovery,RecoveryError
from sdk_owner1_guest import fidelity as before_roles
from p6_containment import fidelity as after_roles
from p6_role_policy import APPROVED_ROLES

ROOT=Path('/opt/ir35')
JOURNAL=ROOT/'.env.p6'

PREFLIGHT_SQL="""SELECT jsonb_build_object(
 'administrator',current_user,'existingSuperuser',(SELECT rolsuper FROM pg_roles WHERE rolname=current_user),
 'rolesAbsent',NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname IN ('ir35_queue','ir35_queue_producer')),
 'schemaOwner',(SELECT pg_get_userbyid(nspowner) FROM pg_namespace WHERE nspname='pgboss'),
 'queueObjects',(SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='pgboss'),
 'logging',jsonb_build_object('statement',current_setting('log_statement'),'errorStatement',current_setting('log_min_error_statement'),
 'pgStatStatements',current_setting('pg_stat_statements.track',true),'pgaudit',current_setting('pgaudit.log',true)),
 'appSchemas',(SELECT jsonb_agg(nspname ORDER BY nspname) FROM pg_namespace WHERE nspname IN ('auth','public','storage')));"""


def require_preflight(proof,container):
    if proof.get('administrator')!='supabase_admin' or proof.get('existingSuperuser')is not True:raise RecoveryError('ExistingSuperuserRequired_NoRoleElevation')
    if proof.get('rolesAbsent')is not True or proof.get('schemaOwner')!='postgres' or proof.get('queueObjects')!=0:raise RecoveryError('QueueRoleIntentNeedsReadOnlyReconciliation_NoReplay')
    if proof.get('appSchemas')!=['auth','public','storage']:raise RecoveryError('DeniedReadTargetsMissing')
    logging=proof.get('logging',{})
    if logging.get('statement')!='none' or logging.get('errorStatement')!='panic' or logging.get('pgaudit') not in (None,'','none'):
        raise RecoveryError('CredentialStatementLoggingNotProvenSafe')
    if container['HostConfig']['LogConfig']['Type']!='none' or container['HostConfig'].get('PortBindings'):
        raise RecoveryError('PrivateUnloggedPostgresRequired')


def preflight(data,runtime):
    store=Store(JOURNAL,uid=1002);inventory=data['p6Inventory'];store.verify(inventory['stage'],inventory['manifestSHA256'])
    stage=store.stage('02-role-preflight');result={'status':'FAIL','roleWrites':0,'secretChanges':0,'productionChanges':False}
    try:
        containment,pristine,fixture=before_roles(data,runtime)
        store.put(stage,'pristine-fidelity.json',json.dumps(pristine).encode());store.put(stage,'fixture-fidelity.json',json.dumps(fixture).encode())
        if containment['status']!='PASS':raise RecoveryError('P6PreRoleDataMismatch_Abort')
        original=Recovery(data['p4'],runtime);proof=json.loads(original.query(PREFLIGHT_SQL,'postgres'))
        container=json.loads(runtime['run'](['docker','inspect','ir35-staging-db-1']))[0]
        require_preflight(proof,container)
        result.update(status='PASS',containment=containment,database=proof,dbImage=container['Image'],logDriver='none',publicPorts=False)
    except Exception as error:result['code']=str(error) if type(error)is RecoveryError else type(error).__name__
    store.put(stage,'result.json',json.dumps(result,sort_keys=True).encode())
    return result|{'stage':stage.name,'manifestSHA256':store.seal(stage)}


def private_new(path,body):
    if path.parent!=ROOT or path.name not in ('.env.p6-queue-owner','.env.p6-queue-producer'):raise RecoveryError('FixedP6CredentialPathRequired')
    fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
    try:
        os.fchown(fd,1002,1002)
        with os.fdopen(fd,'wb',closefd=False) as output:output.write(body);output.flush();os.fsync(output.fileno())
    finally:os.close(fd)


def role_sql(passwords):
    if set(passwords)!=set(APPROVED_ROLES) or not all(re.fullmatch(r'[0-9a-f]{64}',value) for value in passwords.values()):raise RecoveryError('MemoryGeneratedCredentialsRequired')
    # Only stdin, with statement/error/audit/statistics logging disabled. Never
    # persist this SQL, its stdout/stderr, or passwords in an evidence artifact.
    sql="SET LOCAL log_statement='none'; SET LOCAL log_min_error_statement='panic'; SET LOCAL log_parameter_max_length_on_error=0; SET LOCAL pg_stat_statements.track='none'; SET LOCAL password_encryption='scram-sha-256';\n"
    for name,limit in APPROVED_ROLES.items():
        sql+='CREATE ROLE '+name+" NOINHERIT LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT "+str(limit)+" PASSWORD '"+passwords[name]+"';\n"
    sql+="ALTER SCHEMA pgboss OWNER TO ir35_queue; REVOKE ALL ON SCHEMA pgboss FROM PUBLIC,anon,authenticated; GRANT USAGE ON SCHEMA pgboss TO ir35_queue_producer;\n"
    # Reject unexpected PUBLIC/default access atomically, before COMMIT. No
    # edits to source ACLs, data, roles, memberships, RLS, hashes or catalogs.
    sql+="""DO $gate$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_auth_members m JOIN pg_roles r ON r.oid IN (m.roleid,m.member) WHERE r.rolname IN ('ir35_queue','ir35_queue_producer')) THEN RAISE EXCEPTION 'P6 membership denied'; END IF;
 IF EXISTS(SELECT 1 FROM pg_roles r CROSS JOIN pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE r.rolname IN ('ir35_queue','ir35_queue_producer') AND n.nspname IN ('auth','public','storage') AND c.relkind IN ('r','p','v','m','f') AND (has_table_privilege(r.oid,c.oid,'SELECT') OR has_any_column_privilege(r.oid,c.oid,'SELECT'))) THEN RAISE EXCEPTION 'P6 customer read access denied'; END IF;
END $gate$;
SELECT 'P6_ROLES_COMMITTED';"""
    return sql


def probe(runtime,image,role,path,sql):
    if role not in APPROVED_ROLES:raise RecoveryError('FixedQueueIdentityRequired')
    args=['docker','run','--rm','-i','--network','ir35-staging_backend','--read-only','--user','1002:1002','--cap-drop','ALL',
          '--security-opt','no-new-privileges:true','--log-driver','none','--memory','128m','--pids-limit','32',
          '--volume','/opt/ir35/bin/env-exec:/run/ir35/env-exec:ro','--volume',str(path)+':'+str(path)+':ro',
          '--entrypoint','/run/ir35/env-exec',image,str(path),'psql','-XqAt','-v','ON_ERROR_STOP=1','-v','VERBOSITY=sqlstate','-f','-']
    result=subprocess.run(args,input=sql.encode(),capture_output=True,timeout=45)
    # Reduce to a code; never return raw authentication errors or SQL values.
    return {'exitCode':result.returncode,'denied42501':bool(re.search(rb'ERROR:\s+42501\b',result.stderr)),
            'connectedAsExpected':result.returncode==0 and result.stdout.strip()==role.encode()}


def no_customer_access(original):
    reports=[]
    for name in ('postgres',original.database,'ir35_p5_app'):
        scoped=copy.copy(original);scoped.database=name
        sql="""SELECT jsonb_build_object('checks',count(*),'unexpectedAccess',count(*) FILTER(WHERE
          has_table_privilege(r.oid,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
          OR has_any_column_privilege(r.oid,c.oid,'SELECT,INSERT,UPDATE,REFERENCES')))
          FROM pg_roles r CROSS JOIN pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
          WHERE r.rolname IN ('ir35_queue','ir35_queue_producer') AND n.nspname IN ('auth','public','storage')
          AND c.relkind IN ('r','p','v','m','f');"""
        value=json.loads(scoped.query(sql));reports.append({'database':name,**value})
    if not all(row['checks']>0 and row['unexpectedAccess']==0 for row in reports):raise RecoveryError('QueueRoleCustomerPrivilegeMismatch_Abort')
    return reports


def install(data,runtime):
    store=Store(JOURNAL,uid=1002);prior=data['rolePreflight'];store.verify(prior['stage'],prior['manifestSHA256'])
    if prior['status']!='PASS':raise RecoveryError('PassingRolePreflightRequired')
    stage=store.stage('03-queue-roles');result={'status':'FAIL','productionChanges':False,'sourceRoleWrites':0,'sourceWrites':0,'roleWrites':0}
    try:
        original=Recovery(data['p4'],runtime)
        proof=json.loads(original.query(PREFLIGHT_SQL,'postgres'));container=json.loads(runtime['run'](['docker','inspect','ir35-staging-db-1']))[0]
        require_preflight(proof,container)
        if container['Image']!=prior['dbImage']:raise RecoveryError('PostgresImageChanged')
        for name in ('.env.p6-queue-owner','.env.p6-queue-producer'):
            if (ROOT/name).exists() or (ROOT/name).is_symlink():raise RecoveryError('CredentialIntentExists_NoReplay')
        store.put(stage,'intent.json',json.dumps({'roles':list(APPROVED_ROLES),'attempts':1,'preflightManifestSHA256':prior['manifestSHA256'],
                  'p5SDK':['401','401','200'],'transaction':'single atomic CREATE ROLE and empty queue schema grants','sourceRoleChanges':0}).encode())
        passwords={name:runtime['run'](['openssl','rand','-hex','32']).strip() for name in APPROVED_ROLES}
        paths={name:ROOT/('.env.p6-queue-'+('owner' if name=='ir35_queue' else 'producer')) for name in APPROVED_ROLES}
        for name,path in paths.items():
            values={'PG_BOSS_DATABASE_URL':'postgresql://'+name+':'+passwords[name]+'@db:5432/postgres',
                    'QUEUE_DB_ALLOWED_HOSTS':'db','PGHOST':'db','PGPORT':'5432','PGDATABASE':'postgres','PGUSER':name,
                    'PGPASSWORD':passwords[name],'PGSSLMODE':'disable'}
            private_new(path,runtime['env_text'](values).encode())
        acknowledged=original.query(role_sql(passwords),'postgres',readonly=False)
        passwords.clear()
        if acknowledged.strip()!='P6_ROLES_COMMITTED':raise RecoveryError('QueueRoleCommitOutcomeNeedsReconciliation_NoReplay')
        result['roleWrites']=2
        matrix=no_customer_access(original)
        checks=[]
        for name,path in paths.items():
            connected=probe(runtime,container['Image'],name,path,'SELECT current_user;')
            checks.append({'role':name,'case':'password-login','passed':connected['connectedAsExpected']})
            for table in ('auth.users','public.profiles','storage.objects'):
                observed=probe(runtime,container['Image'],name,path,'SELECT * FROM '+table+' LIMIT 0;')
                checks.append({'role':name,'case':'deny-'+table,'passed':observed['exitCode']!=0 and observed['denied42501'],'sqlstate':'42501' if observed['denied42501'] else 'unexpected'})
        store.put(stage,'denied-reads.json',json.dumps(checks).encode())
        if not all(item['passed'] for item in checks):raise RecoveryError('QueueCredentialOrSchemaDenialMismatch_Abort')
        containment,pristine,fixture=after_roles(data,runtime)
        store.put(stage,'pristine-fidelity.json',json.dumps(pristine).encode());store.put(stage,'fixture-fidelity.json',json.dumps(fixture).encode())
        result.update(containment=containment,deniedReadChecks=checks,approvedP6Additions=list(APPROVED_ROLES),
                      customerPrivilegeMatrix=matrix,
                      credentials=[{'path':str(path),'mode':oct(stat.S_IMODE(path.stat().st_mode)),'owner':'ir35'} for path in paths.values()])
        if containment['status']!='PASS':raise RecoveryError('P6PostRoleDataOrPrivilegeMismatch_Abort')
        result.update(status='PASS',queueConsumerEnabled=False,realAcceptance=False)
    except Exception as error:result['code']=str(error) if type(error)is RecoveryError else type(error).__name__
    store.put(stage,'result.json',json.dumps(result,sort_keys=True).encode())
    return result|{'stage':stage.name,'manifestSHA256':store.seal(stage)}
