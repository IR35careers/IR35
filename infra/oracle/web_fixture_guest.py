"""P5 preparation only: separate verified clone, no public route activation."""
import copy
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import stat
from urllib.parse import urlsplit,urlunsplit,urlencode
from immutable_artifacts import Store,digest
from p4_recovery_guest import Recovery,RecoveryError
import web_stack
from web_security import deployable_build

ROOT=Path('/opt/ir35')
TARGET='ir35_p5_app'


def private_new(path,body):
    if path.parent!=ROOT or not re.fullmatch(r'\.env\.p5-[a-z0-9-]+',path.name):raise RecoveryError('P5PrivatePathRefused')
    fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
    try:
        os.fchown(fd,1002,1002)
        with os.fdopen(fd,'wb',closefd=False) as output:output.write(body);output.flush();os.fsync(output.fileno())
    finally:os.close(fd)
    return {'name':path.name,'sha256':digest(body),'mode':'600','owner':'ir35'}


def fixture_components(runtime,values,source):
    components=copy.deepcopy(runtime['component_env'](values))
    for name,key in (('auth','GOTRUE_DB_DATABASE_URL'),('rest','PGRST_DB_URI'),('storage','DATABASE_URL')):
        uri=urlsplit(components[name][key])
        if uri.hostname!='db' or uri.port!=5432:raise RecoveryError('P5PrivateDatabaseRequired')
        # P5 is a read-only app rehearsal. P6/P7 writes need their independently
        # reviewed mock/Auth fixture. Even direct SDK traffic cannot write here.
        components[name][key]=urlunsplit((uri.scheme,uri.netloc,'/'+TARGET,urlencode({'options':'-c default_transaction_read_only=on'}),''))
    components['auth'].update(GOTRUE_DB_MAX_POOL_SIZE='3')
    components['rest'].update(PGRST_DB_POOL='3')
    components['storage'].update(POSTGREST_URL='http://ir35-p5-rest:3000',NODE_OPTIONS='--max-old-space-size=384',
        DATABASE_MAX_CONNECTIONS='3',STORAGE_PUBLIC_URL='https://staging.ir35careers.com/supabase',
        DB_MIGRATIONS_FREEZE_AT=source['storageMigrations'][-1]['name'],DB_ALLOW_MIGRATION_REFRESH='false',DB_INSTALL_ROLES='false',
        TUS_USE_FILE_VERSION_SEPARATOR='false',STORAGE_FILE_ETAG_ALGORITHM='md5',PG_QUEUE_ENABLE='false',PG_QUEUE_WORKERS_ENABLE='false',
        STORAGE_LIFECYCLE_ENABLED='false',TRACING_ENABLED='false')
    if components['auth']['GOTRUE_SMTP_HOST']!='smtp' or components['auth']['GOTRUE_SMTP_PORT']!='1025':raise RecoveryError('P5SMTPSinkRequired')
    return {name:components[name] for name in ('auth','rest','storage','kong')}


def app_env(values,sha,runtime):
    random=lambda:runtime['run'](['openssl','rand','-hex','32']).strip()
    return {'NEXT_PUBLIC_SUPABASE_URL':'https://staging.ir35careers.com/supabase','NEXT_PUBLIC_SUPABASE_ANON_KEY':values['ANON_KEY'],
        'SUPABASE_SECRET_KEY':values['SERVICE_ROLE_KEY'],'SUPABASE_INTERNAL_URL':'http://ir35-p5-kong:8000',
        'IR35_STAGING':'true','IR35_WEB_HOST':'staging.ir35careers.com','IR35_READ_ONLY':'true','IR35_PUBLIC_HTML_CACHE':'true',
        'IR35_BUILD_SHA':sha,'IR35_SESSION_MIGRATED':'true','IR35_SCHEDULER_ENABLED':'false',
        'IR35_WORKER_HEALTH_ENABLED':'false','IR35_REALTIME_HEALTH_ENABLED':'false','APPLY_RUNNER':'mock',
        'APPLICATION_WORKER_ACCEPT_JOBS':'false','APPLICATION_WORKER_ENABLED':'false','APPLICATION_SUBMISSION_ENABLED':'false',
        'APPLICATION_WORKER_SECRET':random(),'CRON_SECRET':random(),'IR35CAREERS_APP_URL':'https://staging.ir35careers.com'}


def prepare(data,runtime):
    build=data['build']
    deployable_build(build) # Refuse old/unattested vulnerable builds BEFORE DB access.
    builds=Store(ROOT/'.env.p5-builds',uid=1002)
    anchors=data['buildAnchors']
    if set(p.name for p in builds.root.iterdir())!=set(anchors) or anchors.get(build['stage'])!=build['manifestSHA256']:raise RecoveryError('P5BuildHistoryMismatch')
    for name,anchor in sorted(anchors.items()):builds.verify(name,anchor)
    saved=json.loads((builds.root/build['stage']/'result.json').read_text())
    if saved!={key:value for key,value in build.items() if key not in ('stage','manifestSHA256')}:raise RecoveryError('P5BuildAttestationMismatch')
    original=Recovery(data['p4'],runtime);source=original.source()
    signoff=original.run_root/'12-revised-p4-signoff/result.json'
    if '12-revised-p4-signoff' not in data['p4']['anchors'] or json.loads(signoff.read_bytes()).get('status')!='PASS':raise RecoveryError('P4SealedSignoffRequired')
    expected_storage='supabase/storage-api:v1.80.2@sha256:5e290c10a57893024dea5b41764e2fd81d02b379e5853bdd1da11e74bd58783e'
    if data['p4']['pins']['storage']['image']!=expected_storage:raise RecoveryError('ExactStorageHistoryImageRequired')
    if original.check_database()['status']!='PASS':raise RecoveryError('P4PristineMismatch_Abort')
    journal=ROOT/'.env.p5-fixture'
    if not journal.exists():journal.mkdir(mode=0o700);os.chown(journal,1002,1002)
    store=Store(journal,uid=1002);stage=store.stage('01-prepare')
    result={'status':'FAIL','phaseComplete':False,'sourceWrites':0,'pristineStagingWrites':0,'target':TARGET,'databaseCreated':False,'containersCreated':False,'caddyActivated':False}
    try:
        available=int(re.search(r'^MemAvailable:\s+(\d+)',Path('/proc/meminfo').read_text(),re.M)[1])
        if available<5*1024*1024:raise RecoveryError('P5HeadroomInsufficient')
        if original.query("SELECT 1 FROM pg_database WHERE datname='"+TARGET+"';",'postgres').strip():raise RecoveryError('P5DatabaseExists_ReconcileNoReplay')
        if original.query("SELECT count(*) FROM pg_stat_activity WHERE datname='"+original.database+"';",'postgres').strip()!='0':raise RecoveryError('P4PristineMustHaveNoConnections')
        store.put(stage,'intent.json',json.dumps({'target':TARGET,'template':original.database,'purpose':'ir35-disposable-p5-readonly','build':build['manifestSHA256']}).encode())
        original.command(original.base+['psql','-XqAt','-v','ON_ERROR_STOP=1','-U','supabase_admin','-d','postgres','-f','-'],
            input=('CREATE DATABASE '+TARGET+' WITH TEMPLATE '+original.database+' OWNER postgres;').encode())
        result['databaseCreated']=True
        original.query("COMMENT ON DATABASE "+TARGET+" IS 'ir35-disposable-p5-readonly';",'postgres',readonly=False)
        fixture=copy.copy(original);fixture.database=TARGET
        proof=fixture.check_database();store.put(stage,'fixture-fidelity.json',json.dumps(proof).encode())
        if proof['status']!='PASS':raise RecoveryError('P5CloneDataMismatch_Abort')
        destination=ROOT/'data/p5-storage'
        destination.mkdir(mode=0o700);os.chown(destination,1002,1002)
        records=[];expected_files=set()
        for obj in source['storage']['privateObjects']:
            relative=runtime['verifiers']['backend_path'](obj['bucket'],obj['name'],obj['version'])
            origin=ROOT/'data/p4-runs'/original.run_id/relative;target=destination/relative
            if target.absolute()!=target.resolve() or not target.is_relative_to(destination):raise RecoveryError('P5StoragePathRefused')
            target.parent.mkdir(parents=True,exist_ok=True)
            with origin.open('rb') as incoming:
                fd=os.open(target,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
                with os.fdopen(fd,'wb') as outgoing:shutil.copyfileobj(incoming,outgoing);outgoing.flush();os.fsync(outgoing.fileno())
            os.chown(target,1002,1002);os.chmod(target,0o400)
            for key in os.listxattr(origin):os.setxattr(target,key,os.getxattr(origin,key))
            if target.stat().st_size!=int(obj['bytes']) or digest(target.read_bytes())!=obj['sha256']:raise RecoveryError('P5StorageByteMismatch_Abort')
            if {key:os.getxattr(target,key) for key in os.listxattr(target)}!={key:os.getxattr(origin,key) for key in os.listxattr(origin)}:raise RecoveryError('P5StorageMetadataMismatch_Abort')
            expected_files.add(target)
            records.append({'pathSHA256':hashlib.sha256(str(relative).encode()).hexdigest(),'sha256':obj['sha256'],'bytes':int(obj['bytes'])})
        if {path for path in destination.rglob('*') if path.is_file()}!=expected_files:raise RecoveryError('P5StorageCoverageMismatch_Abort')
        for directory in destination.rglob('*'):
            if directory.is_dir():os.chown(directory,1002,1002);os.chmod(directory,0o700)
        values=runtime['read_env']();components=fixture_components(runtime,values,source);files=[]
        for name,value in components.items():files.append(private_new(ROOT/('.env.p5-'+name),runtime['env_text'](value).encode()))
        gateway=runtime['kong_config'](values['ANON_KEY'],values['SERVICE_ROLE_KEY'])
        gateway['services']=[item for item in gateway['services'] if not item['name'].startswith(('realtime-','rt-admin-'))]
        for item in gateway['services']:
            for name in ('auth','rest','storage'):item['url']=item['url'].replace('http://'+name+':','http://ir35-p5-'+name+':')
        files.append(private_new(ROOT/'.env.p5-kong-config',json.dumps(gateway).encode()))
        files.append(private_new(ROOT/'.env.p5-web',runtime['env_text'](app_env(values,build['sourceSHA'],runtime)).encode()))
        cache=ROOT/'data/p5-next-cache';cache.mkdir(mode=0o700);os.chown(cache,1002,1002)
        config=web_stack.app_compose(build['image'],'ir35-staging_backend',data['p4']['pins'])
        with (ROOT/'p5-compose.yml').open('x') as output:json.dump(config,output,indent=2)
        os.chmod(ROOT/'p5-compose.yml',0o644)
        if original.check_database()['status']!='PASS':raise RecoveryError('P4PristineChanged_Abort')
        store.put(stage,'storage.json',json.dumps(records).encode())
        result.update(status='PASS',cloneFidelity='PASS',tablesChecked=len(proof['tables']),privilegesChecked=552,
            storageObjects=len(records),storageBytes=sum(row['bytes'] for row in records),envFiles=files,
            image=build['image'],sourceSHA=build['sourceSHA'],pristineUnchanged=True,readonlyDatabaseConnections=True,
            composeSHA256=digest((ROOT/'p5-compose.yml').read_bytes()))
    except Exception as error:
        result['code']=str(error) if isinstance(error,RecoveryError) and re.fullmatch(r'[A-Za-z0-9_]+',str(error)) else type(error).__name__
    store.put(stage,'result.json',json.dumps(result,sort_keys=True).encode())
    return {**result,'stage':stage.name,'manifestSHA256':store.seal(stage)}
