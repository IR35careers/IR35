"""Bounded private mock-worker preparation/setup/start; NEVER production."""
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import time
import urllib.error
import urllib.request
from immutable_artifacts import Store,digest
from p4_recovery_guest import Recovery,RecoveryError
from p6_containment import fidelity
from p6_roles_guest import no_customer_access,probe
from web_edge_guest import private_env

ROOT=Path('/opt/ir35');NAME='ir35-p6-mock-worker';COMPOSE=ROOT/'p6-mock-compose.yml'


def compose(image):
    if not re.fullmatch(r'sha256:[a-f0-9]{64}',image):raise RecoveryError('ImmutableWorkerImageRequired')
    return {'name':'ir35-p6-mock','services':{'worker':{'image':image,'platform':'linux/arm64','container_name':NAME,
      'user':'1002:1002','read_only':True,'restart':'unless-stopped','mem_limit':'2560m','pids_limit':256,
      'cap_drop':['ALL'],'security_opt':['no-new-privileges:true'],'logging':{'driver':'none'},
      'networks':{'backend':{'aliases':['worker']}},'ports':['127.0.0.1:8787:8787/tcp'],
      'tmpfs':['/tmp:rw,size=512m,uid=1002,gid=1002,mode=1777'],
      'volumes':['/opt/ir35/bin/env-exec:/run/ir35/env-exec:ro','/opt/ir35/.env.p6-mock-worker:/opt/ir35/.env.p6-mock-worker:ro'],
      'entrypoint':['/run/ir35/env-exec','/opt/ir35/.env.p6-mock-worker','node','--import','tsx','services/application-worker/mock-main.ts','--run']}},
      'networks':{'backend':{'external':True,'name':'ir35-staging_backend'}}}


def validate_config(value):
    expected={'APPLY_RUNNER':'mock','IR35_STAGING':'true','APPLICATION_WORKER_ACCEPT_JOBS':'false',
      'APPLICATION_WORKER_CONCURRENCY':'1','IR35_READ_ONLY':'false','IR35_SCHEDULER_ENABLED':'false',
      'IR35CAREERS_APP_URL':'https://staging.ir35careers.com','QUEUE_DB_ALLOWED_HOSTS':'db','PORT':'8787'}
    if any(value.get(key)!=item for key,item in expected.items()):raise RecoveryError('IsolatedMockSettingsRequired')
    if any(key.startswith(('SUPABASE','NEXT_PUBLIC','STRIPE','POSTMARK','GOOGLE','OPENAI','RESEND','AWS_')) for key in value):raise RecoveryError('MockDirectDataOrProviderCredentialsRefused')
    if not re.fullmatch(r'[a-f0-9]{64}',value.get('APPLICATION_WORKER_SECRET','')):raise RecoveryError('FreshPrivateMockHMACRequired')
    if not re.fullmatch(r'[a-f0-9]{40}',value.get('IR35_BUILD_SHA','')):raise RecoveryError('MockSourceIdentityRequired')


def private_new(path,body):
    if path.parent!=ROOT or path.name not in ('.env.p6-mock-worker','.env.p6-mock-control'):raise RecoveryError('FixedP6MockEnvPathRequired')
    fd=os.open(path,os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW|os.O_WRONLY,0o600)
    try:
        os.fchown(fd,1002,1002)
        with os.fdopen(fd,'wb',closefd=False) as output:output.write(body);output.flush();os.fsync(output.fileno())
    finally:os.close(fd)


def password_required(image,role,path):
    if role not in ('ir35_queue','ir35_queue_producer'):raise RecoveryError('FixedQueueIdentityRequired')
    # Unset the real password AFTER loading the protected env. No invalid
    # password is invented/stored/passed in argv; -w also forbids a prompt.
    arguments=['docker','run','--rm','-i','--network','ir35-staging_backend','--read-only','--user','1002:1002',
      '--cap-drop','ALL','--security-opt','no-new-privileges:true','--log-driver','none','--memory','128m',
      '--volume','/opt/ir35/bin/env-exec:/run/ir35/env-exec:ro','--volume',str(path)+':'+str(path)+':ro',
      '--entrypoint','/run/ir35/env-exec',image,str(path),'env','-u','PGPASSWORD','psql','-w','-XqAt','-c','SELECT current_user;']
    result=subprocess.run(arguments,capture_output=True,timeout=45)
    return {'role':role,'passwordRequired':result.returncode!=0 and b'no password supplied' in result.stderr,
            'unexpectedUnauthenticatedLogin':result.returncode==0}


def prerequisites(data,runtime):
    store=Store(ROOT/'.env.p6',uid=1002)
    for row in (data['p6Inventory'],data['rolePreflight'],data['roleInstall']):store.verify(row['stage'],row['manifestSHA256'])
    build=data['workerBuild']
    if build.get('ownerResume') is True:
        root = ROOT/'.env.p6-resume-builds-20261026'
        if (build.get('journal') != str(root) or build.get('attempt') not in (1,2,3)
                or build.get('stage') != f"{build['attempt']:02d}-build" or build.get('historicalBuildSlotsPreserved') is not True
                or build.get('pidAuditManifestSHA256') != '7e08a4af09655a9be9efd249f5f0adcc1c4c8eb4691839a319d7470a241e1e4a'):
            raise RecoveryError('FixedOwnerResumeBuildProofRequired')
        Store(root,uid=1002).verify(build['stage'],build['manifestSHA256'])
        actual = json.loads((root/build['stage']/'result.json').read_bytes())
        if actual != {k:v for k,v in build.items() if k not in ('stage','manifestSHA256')}:
            raise RecoveryError('ResumeBuildMustEqualSealedNativeResult')
    elif build.get('sourceRepairAttempt') in (1, 2):
        if (build.get('attempt') != 3 or build.get('journal') != str(ROOT/'.env.p6-build-source-repairs')
                or build.get('stage') != ('02-third-source-repair' if build['sourceRepairAttempt'] == 2 else '01-third-source-repair') or build.get('originalThreeBuildSlotsPreserved') is not True):
            raise RecoveryError('FixedThirdSourceRepairProofRequired')
        Store(ROOT/'.env.p6-build-source-repairs',uid=1002).verify(build['stage'],build['manifestSHA256'])
        Store(ROOT/'.env.p6-builds',uid=1002).verify('03-build',build['originalFailedBuildManifest'])
        if build['sourceRepairAttempt'] == 2:
            Store(ROOT/'.env.p6-build-source-repairs',uid=1002).verify('01-third-source-repair',build['sourceRepairPreviousManifest'])
    else:
        Store(ROOT/'.env.p6-builds',uid=1002).verify(build['stage'],build['manifestSHA256'])
    if build['status']!='PASS' or build.get('browser')!={'ok':True,'browserReady':True,'submissions':0} or build['containment']['status']!='PASS':raise RecoveryError('NativeMockBuildAndBrowserRequired')
    information=json.loads(runtime['run'](['docker','image','inspect',build['image']]))[0]
    if information['Id']!=build['image'] or information.get('Architecture')!='arm64' or information['Config'].get('User')!='1002:1002':raise RecoveryError('MockImageReadbackMismatch')
    return store


def check_containment(data,runtime,store,stage,prefix):
    result,pristine,fixture=fidelity(data,runtime)
    store.put(stage,prefix+'-pristine.json',json.dumps(pristine).encode());store.put(stage,prefix+'-fixture.json',json.dumps(fixture).encode())
    if result['status']!='PASS':raise RecoveryError('MockContainmentMismatch_Abort')
    return result


def prepared(data):
    store=Store(ROOT/'.env.p6',uid=1002);report=data['mockPrepare'];store.verify(report['stage'],report['manifestSHA256'])
    if report['status']!='PASS':raise RecoveryError('VerifiedMockPreparationRequired')
    for name,expected in report['privateFileHashes'].items():
        path=ROOT/name;private_env(path)
        if digest(path.read_bytes())!=expected:raise RecoveryError('MockEnvironmentChanged_NoOverwrite')
    if COMPOSE.is_symlink() or digest(COMPOSE.read_bytes())!=report['composeSHA256']:raise RecoveryError('MockComposeChanged')
    return store


def prepare(data,runtime):
    store=prerequisites(data,runtime);stage=store.stage('04-mock-prepare')
    result={'status':'FAIL','serviceChanges':0,'productionChanges':False,'realAcceptance':False,'customerWrites':0}
    try:
        result['preContainment']=check_containment(data,runtime,store,stage,'pre')
        names=runtime['run'](['docker','ps','-a','--format','{{.Names}}']).splitlines()
        if NAME in names:raise RecoveryError('MockWorkerExists_ReconcileNoReplay')
        if COMPOSE.exists() or any((ROOT/name).exists() for name in ('.env.p6-mock-worker','.env.p6-mock-control')):raise RecoveryError('MockPreparationIntentExists_NoReplay')
        if runtime['run'](['ss','-H','-ltn','sport = :8787']).strip():raise RecoveryError('MockLoopbackPortAlreadyUsed')
        previous=private_env(ROOT/'.env.p5-web')
        if previous.get('IR35_READ_ONLY')!='true' or previous.get('APPLICATION_WORKER_ACCEPT_JOBS')!='false':raise RecoveryError('P5AppMustRemainReadOnly')
        owner=private_env(ROOT/'.env.p6-queue-owner');producer=private_env(ROOT/'.env.p6-queue-producer')
        controls=[password_required(data['p4']['pins']['db']['image'],role,ROOT/('.env.p6-queue-'+suffix))
                  for role,suffix in [('ir35_queue','owner'),('ir35_queue_producer','producer')]]
        result['passwordRequiredControls']=controls
        if not all(row['passwordRequired'] and not row['unexpectedUnauthenticatedLogin'] for row in controls):raise RecoveryError('UnauthenticatedQueueLoginBoundaryMismatch_Abort')
        value={'PG_BOSS_DATABASE_URL':owner['PG_BOSS_DATABASE_URL'],'PG_BOSS_PRODUCER_DATABASE_URL':producer['PG_BOSS_DATABASE_URL'],
          'QUEUE_DB_ALLOWED_HOSTS':'db','APPLY_RUNNER':'mock','IR35_STAGING':'true','APPLICATION_WORKER_ACCEPT_JOBS':'false',
          'APPLICATION_WORKER_CONCURRENCY':'1','IR35_READ_ONLY':'false','IR35_SCHEDULER_ENABLED':'false',
          'APPLICATION_WORKER_SECRET':runtime['run'](['openssl','rand','-hex','32']).strip(),
          'IR35CAREERS_APP_URL':'https://staging.ir35careers.com','IR35_BUILD_SHA':data['workerBuild']['sourceSHA'],'PORT':'8787'}
        validate_config(value)
        store.put(stage,'intent.json',json.dumps({'image':data['workerBuild']['image'],'containers':[NAME],'ports':['127.0.0.1:8787'],
                  'noSourceWrites':True,'mockOnly':True,'realAcceptance':False}).encode())
        private_new(ROOT/'.env.p6-mock-worker',runtime['env_text'](value).encode())
        private_new(ROOT/'.env.p6-mock-control',runtime['env_text']({'APPLICATION_WORKER_SECRET':value['APPLICATION_WORKER_SECRET']}).encode())
        with COMPOSE.open('x') as output:json.dump(compose(data['workerBuild']['image']),output,indent=2)
        os.chmod(COMPOSE,0o644)
        hashes={name:digest((ROOT/name).read_bytes()) for name in ('.env.p6-mock-worker','.env.p6-mock-control')}
        result.update(status='PASS',privateFileHashes=hashes,composeSHA256=digest(COMPOSE.read_bytes()),
                      envNames=sorted(value),image=data['workerBuild']['image'],credentialsMode='600',credentialsOwner='ir35',
                      mockOnlyMaintenanceOff=True,p5AppStillReadOnly=True,hostHealthBind='127.0.0.1:8787')
    except Exception as error:result['code']=str(error) if type(error)is RecoveryError else type(error).__name__
    store.put(stage,'result.json',json.dumps(result,sort_keys=True).encode())
    return result|{'stage':stage.name,'manifestSHA256':store.seal(stage)}


def setup(data,runtime):
    prerequisites(data,runtime);store=prepared(data);stage=store.stage('05-mock-setup')
    result={'status':'FAIL','productionChanges':False,'realAcceptance':False,'sourceRoleWrites':0,'customerWrites':0,'serviceChanges':0}
    try:
        result['preContainment']=check_containment(data,runtime,store,stage,'pre')
        original=Recovery(data['p4'],runtime)
        count=int(original.query("SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='pgboss';",'postgres').strip())
        if count:raise RecoveryError('QueueSetupObjectsExist_ReconcileNoReplay')
        store.put(stage,'intent.json',json.dumps({'schema':'postgres.pgboss','identity':'ir35_queue','attempts':1,'mockQueues':2,'noCustomerObjects':True}).encode())
        args=['docker','run','--rm','-i','--network','ir35-staging_backend','--read-only','--user','1002:1002','--memory','512m',
          '--pids-limit','64','--cap-drop','ALL','--security-opt','no-new-privileges:true','--log-driver','none',
          '--volume','/opt/ir35/bin/env-exec:/run/ir35/env-exec:ro','--volume','/opt/ir35/.env.p6-mock-worker:/opt/ir35/.env.p6-mock-worker:ro',
          '--tmpfs','/tmp:rw,size=64m,uid=1002,gid=1002,mode=1777','--entrypoint','/run/ir35/env-exec',data['workerBuild']['image'],
          '/opt/ir35/.env.p6-mock-worker','node','--import','tsx','services/application-worker/mock-main.ts','--setup']
        reply=json.loads(runtime['run'](args,timeout=180))
        if reply!={'status':'PASS','queues':2,'mockOnly':True,'realAcceptance':False}:raise RecoveryError('MockQueueSetupAcknowledgementMissing_NoReplay')
        result.update(status='PASS',**queue_access_proof(original,data,runtime))
    except Exception as error:result['code']=str(error) if type(error)is RecoveryError else type(error).__name__
    try:result['containment']=check_containment(data,runtime,store,stage,'post')
    except Exception as error:result.update(status='FAIL',containmentError=type(error).__name__)
    store.put(stage,'result.json',json.dumps(result,sort_keys=True).encode())
    return result|{'stage':stage.name,'manifestSHA256':store.seal(stage)}


def queue_access_proof(original,data,runtime):
        matrix=no_customer_access(original)
        privilege=json.loads(original.query("""SELECT jsonb_build_object(
         'owner',(SELECT pg_get_userbyid(nspowner) FROM pg_namespace WHERE nspname='pgboss'),
         'anonUsage',has_schema_privilege('anon','pgboss','USAGE'),'authenticatedUsage',has_schema_privilege('authenticated','pgboss','USAGE'),
         'producerCreate',has_schema_privilege('ir35_queue_producer','pgboss','CREATE'),
         'producerUnexpectedMutation',EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
           WHERE n.nspname='pgboss' AND c.relkind IN ('r','p') AND (has_any_column_privilege('ir35_queue_producer',c.oid,'UPDATE')
           OR has_table_privilege('ir35_queue_producer',c.oid,'DELETE,TRUNCATE,REFERENCES,TRIGGER'))),
         'queues',(SELECT jsonb_agg(name ORDER BY name) FROM pgboss.queue));""",'postgres'))
        if privilege!={'owner':'ir35_queue','anonUsage':False,'authenticatedUsage':False,'producerCreate':False,'producerUnexpectedMutation':False,
                       'queues':['ir35-staging-mock-apply','ir35-staging-mock-schedule']}:raise RecoveryError('MockQueuePrivilegeMismatch_Abort')
        # Real TCP denial, not SET ROLE with a retained superuser SESSION_USER.
        denied=[];image=data['p4']['pins']['db']['image']
        for role,suffix in [('ir35_queue','owner'),('ir35_queue_producer','producer')]:
            path=ROOT/('.env.p6-queue-'+suffix)
            for table in ('auth.users','public.profiles','storage.objects'):
                observed=probe(runtime,image,role,path,'SELECT * FROM '+table+' LIMIT 0;')
                denied.append({'role':role,'table':table,'passed':observed['exitCode']!=0 and observed['denied42501'],'sqlstate':'42501' if observed['denied42501'] else 'unexpected'})
        if not all(row['passed'] for row in denied):raise RecoveryError('PostSetupCustomerReadDenialMismatch_Abort')
        return {'queueACL':privilege,'customerPrivilegeMatrix':matrix,'actualDeniedReads':denied}


def verify_setup_repair(data,runtime):
    prerequisites(data,runtime);store=prepared(data);failed=data['failedSetup'];store.verify(failed['stage'],failed['manifestSHA256'])
    if failed['status']!='FAIL' or failed.get('code')!='StagingSQLFailed_RawPrivateOnly' or failed.get('containment',{}).get('status')!='PASS':raise RecoveryError('ExactFailedReadbackAndContainmentRequired')
    stage=store.stage('05-mock-setup-r1')
    result={'status':'FAIL','repairAttempt':1,'reason':'ReadbackSQL42601_ExtraClosingParenthesis','schemaWrites':0,'roleWrites':0,
            'serviceChanges':0,'customerWrites':0,'productionChanges':False,'realAcceptance':False,'setupReplayed':False,
            'failedManifestSHA256':failed['manifestSHA256']}
    try:
        store.put(stage,'intent.json',json.dumps({'operation':'verification-only','attempts':1,'replayDDL':False,'failedManifestSHA256':failed['manifestSHA256']}).encode())
        result['preContainment']=check_containment(data,runtime,store,stage,'pre')
        original=Recovery(data['p4'],runtime)
        result.update(status='PASS',**queue_access_proof(original,data,runtime))
    except Exception as error:result['code']=str(error) if type(error)is RecoveryError else type(error).__name__
    try:result['containment']=check_containment(data,runtime,store,stage,'post')
    except Exception as error:result.update(status='FAIL',containmentError=type(error).__name__)
    store.put(stage,'result.json',json.dumps(result,sort_keys=True).encode())
    return result|{'stage':stage.name,'manifestSHA256':store.seal(stage)}


def health():
    opener=urllib.request.build_opener(urllib.request.ProxyHandler({}))
    with opener.open('http://127.0.0.1:8787/health',timeout=5) as reply:
        body=reply.read(8193)
        if len(body)>8192:raise RecoveryError('MockHealthBodyLimit')
        return json.loads(body)


def start(data,runtime):
    prerequisites(data,runtime);store=prepared(data);previous=data['mockSetup'];store.verify(previous['stage'],previous['manifestSHA256'])
    if previous['status']!='PASS':raise RecoveryError('VerifiedMockQueueSetupRequired')
    stage=store.stage('06-mock-start');result={'status':'FAIL','productionChanges':False,'realAcceptance':False,'customerWrites':0};created=False
    try:
        result['preContainment']=check_containment(data,runtime,store,stage,'pre')
        if NAME in runtime['run'](['docker','ps','-a','--format','{{.Names}}']).splitlines():raise RecoveryError('MockWorkerAlreadyExists_NoRecreate')
        available=int(re.search(r'^MemAvailable:\s+(\d+)',Path('/proc/meminfo').read_text(),re.M)[1])
        if available<3_500_000:raise RecoveryError('MockStartupMemoryHeadroomInsufficient')
        store.put(stage,'intent.json',json.dumps({'container':NAME,'attempts':1,'image':data['workerBuild']['image'],'acceptance':False,'mockOnly':True}).encode())
        created=True
        with store.sink(stage,'compose.log') as log:
            code=subprocess.run(['docker','compose','--env-file',str(ROOT/'.env'),'-f',str(COMPOSE),'up','-d','--no-deps','worker'],stdout=log,stderr=log,timeout=120).returncode
        if code:raise RecoveryError('MockComposeStartFailed_PrivateLog')
        deadline=time.monotonic()+90;observed=None
        while time.monotonic()<deadline:
            if int(runtime['run'](['docker','inspect','--format','{{.RestartCount}}',NAME]).strip())>1:raise RecoveryError('MockStartupRepeatedCrash_Stop')
            try:
                observed=health()
                if observed.get('ok')is True:break
            except (urllib.error.URLError,TimeoutError,ConnectionError):pass
            time.sleep(2)
        if not observed or any(observed.get(key)is not True for key in ('ok','browserReady','databaseReady')) or observed.get('mode')!='staging-mock-only' or observed.get('realAcceptance')is not False or observed.get('buildSHA')!=data['workerBuild']['sourceSHA']:
            raise RecoveryError('NativeMockHealthMismatch')
        item=json.loads(runtime['run'](['docker','inspect',NAME]))[0];host=item['HostConfig']
        if item['Image']!=data['workerBuild']['image'] or item['Config'].get('User')!='1002:1002' or host['Memory']!=2560*1024*1024 or not host['ReadonlyRootfs'] or host['LogConfig']['Type']!='none' or host['RestartPolicy']['Name']!='unless-stopped' or host.get('PortBindings')!={'8787/tcp':[{'HostIp':'127.0.0.1','HostPort':'8787'}]} or set(item['NetworkSettings']['Networks'])!={'ir35-staging_backend'}:
            raise RecoveryError('MockRuntimeIsolationMismatch')
        after=int(re.search(r'^MemAvailable:\s+(\d+)',Path('/proc/meminfo').read_text(),re.M)[1])
        if after<2*1024*1024:raise RecoveryError('MockOSHeadroomBelowTwoGiB')
        result.update(status='PASS',health=observed,nonroot=True,memoryLimitBytes=host['Memory'],hostMemoryAvailableKiB=after,
                      privateLoopbackOnly=True,restart='unless-stopped',noDockerSocket=True)
    except Exception as error:
        result['code']=str(error) if type(error)is RecoveryError else type(error).__name__
        if created:
            with store.sink(stage,'stop-owned-worker.log') as log:
                result['stoppedAfterFailure']=subprocess.run(['docker','stop','--time','30',NAME],stdout=log,stderr=log,timeout=45).returncode==0
    try:result['containment']=check_containment(data,runtime,store,stage,'post')
    except Exception as error:result.update(status='FAIL',containmentError=type(error).__name__)
    store.put(stage,'result.json',json.dumps(result,sort_keys=True).encode())
    return result|{'stage':stage.name,'manifestSHA256':store.seal(stage)}
