"""Private staging fixtures: shared Kong login, bounded RAM-only diagnostics."""
import base64
import hashlib
import hmac
import json
import os
from pathlib import Path
import re
import secrets
import stat
import subprocess
import threading
import time
import urllib.error
import urllib.request
from urllib.parse import urlsplit,urlunsplit,urlencode,quote
import uuid
from auth_redaction import response_diagnostic,correlated_logs,redact_known_secrets
from immutable_artifacts import digest
from p4_recovery_guest import Recovery,RecoveryError


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,*unused,**kwargs):raise RecoveryError('AuthRedirectRefused')


def password_request(email,password):
    """The SAME construction is used for synthetic and owner-hidden credentials."""
    return '/auth/v1/token?grant_type=password',{'email':email,'password':password}


def launcher_path(run_id,stage,service):
    suffix='p4-'+run_id[-8:]+'-'+stage+'-'+service
    if not re.fullmatch(r'[a-z0-9-]+',suffix):raise RecoveryError('ProtectedLauncherPathRefused')
    return '/opt/ir35/.env.'+suffix


def detach_observer(process,worker):
    """Detach ONLY the local CLI; --sig-proxy=false protects the Auth process."""
    process.terminate()
    killed=False
    try:process.wait(timeout=2)
    except subprocess.TimeoutExpired:
        process.kill();process.wait(timeout=2);killed=True
    worker.join(timeout=2)
    if worker.is_alive():raise RecoveryError('ObserverReaderDidNotStop')
    return {'cliKillRequired':killed,'containerSignalsProxied':False}


class PrivateStack:
    def __init__(self,recovery,stage,*,saved=None):
        self.r=recovery;self.stage=stage;self.runtime=recovery.runtime
        self.values=self.runtime['read_env']();self.pins=recovery.payload['pins']
        self.environment_root=recovery.run_root/('runtime-'+stage.name)
        self.containers={};self.files=[];self.diagnostics=[]
        self.opener=urllib.request.build_opener(urllib.request.ProxyHandler({}),NoRedirect())
        db=self.runtime['run'](['docker','compose','--env-file','/opt/ir35/.env','-f','/opt/ir35/compose.yml','ps','-q','db']).strip()
        networks=json.loads(self.runtime['run'](['docker','inspect','--format','{{json .NetworkSettings.Networks}}',db]))
        if len(networks)!=1:raise RecoveryError('ExclusivePrivateNetworkRequired')
        self.network=next(iter(networks))
        if json.loads(self.runtime['run'](['docker','network','inspect',self.network]))[0].get('Internal') is not True:raise RecoveryError('NoOutboundNetworkRequired')
        if saved:
            self.environment_root=Path(saved['environmentRoot']);self.containers=saved['containers'];self.files=saved['files']
            self.check_files()
        else:
            if int(re.search(r'^MemAvailable:\s+(\d+)',Path('/proc/meminfo').read_text(),re.M)[1])<4*1024*1024:raise RecoveryError('AuthFixtureHeadroomInsufficient')
            self.environment_root.mkdir(mode=0o700);os.chown(self.environment_root,1002,1002)

    def check_files(self):
        for record in self.files:
            path=Path(record['path']);info=path.lstat()
            if path.parent!=self.environment_root or not stat.S_ISREG(info.st_mode) or info.st_uid!=1002 or stat.S_IMODE(info.st_mode)!=0o600 or info.st_nlink!=1 or digest(path.read_bytes())!=record['sha256']:raise RecoveryError('RuntimeSecretFileIntegrityMismatch')

    def private_file(self,name,body):
        path=self.environment_root/name
        if path.parent!=self.environment_root or not name.startswith('.env.'):raise RecoveryError('RuntimeSecretPathRefused')
        fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
        try:
            os.fchown(fd,1002,1002)
            with os.fdopen(fd,'wb',closefd=False) as output:output.write(body);output.flush();os.fsync(output.fileno())
        finally:os.close(fd)
        self.files.append({'path':str(path),'sha256':digest(body),'mode':'600'})
        return path

    def info(self,service):
        cid=self.containers[service];row=json.loads(self.runtime['run'](['docker','inspect',cid]))[0]
        label='ir35-p4-'+self.r.run_id[-8:]+'-'+self.stage.name+'-'+service
        if row['Name']!='/'+label or row['Config']['Labels'].get('ir35.recovery')!=self.r.run_id or row['Config']['Image']!=self.pins[service]['image']:raise RecoveryError('TestContainerIdentityMismatch')
        if row['HostConfig'].get('PortBindings') or row['HostConfig']['Privileged'] or set(row['NetworkSettings']['Networks'])!={self.network}:raise RecoveryError('TestContainerIsolationMismatch')
        return row

    def address(self,service,port):
        ip=self.info(service)['NetworkSettings']['Networks'][self.network]['IPAddress']
        if not re.fullmatch(r'172\.(?:1[6-9]|2[0-9]|3[01])\.[0-9]{1,3}\.[0-9]{1,3}|10\.[0-9.]+|192\.168\.[0-9.]+',ip):raise RecoveryError('PrivateServiceAddressRequired')
        return 'http://'+ip+':'+str(port)

    def upstream(self,service,port):
        # Stable, owned Docker DNS name survives the deliberate stop/restart gate.
        return 'http://'+self.info(service)['Name'].removeprefix('/')+':'+str(port)

    def raw(self,path,*,body=None,headers=None,method=None,service='kong',port=8000):
        self.check_files()
        request=urllib.request.Request(self.address(service,port)+path,
          data=None if body is None else json.dumps(body).encode(),headers={'Content-Type':'application/json',**(headers or {})},
          method=method or ('GET' if body is None else 'POST'))
        try:
            with self.opener.open(request,timeout=20) as reply:return reply.status,reply.read(52_428_801),dict(reply.headers)
        except urllib.error.HTTPError as error:return error.code,error.read(65537),dict(error.headers)

    def start_service(self,service,component,extra=()):
        env=self.private_file('.env.'+service,self.runtime['env_text'](component).encode())
        # Keep host custody per-run, but preserve the launcher's strict FLAT
        # container-path contract. Never broaden the original launcher guard.
        container_env=launcher_path(self.r.run_id,self.stage.name,service)
        name='ir35-p4-'+self.r.run_id[-8:]+'-'+self.stage.name+'-'+service
        if self.runtime['run'](['docker','ps','-a','--filter','name=^/'+name+'$','--format','{{.ID}}']).strip():raise RecoveryError('TestContainerCollision_NoReplay')
        args=['docker','run','-d','--name',name,'--label','ir35.recovery='+self.r.run_id,'--network',self.network,'--user','1002:1002',
              '--memory',{'auth':'256m','rest':'256m','kong':'384m','storage':'512m'}[service],'--pids-limit','128','--cap-drop','ALL',
              '--security-opt','no-new-privileges','--restart','no','--log-driver','none',
              '--mount','type=bind,src='+str(env)+',dst='+container_env+',readonly',
              '--mount','type=bind,src=/opt/ir35/bin/env-exec,dst=/run/ir35/env-exec,readonly',*extra]
        pin=self.pins[service]
        cid=self.runtime['run'](args+['--entrypoint','/run/ir35/env-exec',pin['image'],container_env,*pin['entrypoint'],*pin['command']]).strip()
        self.containers[service]=cid;self.info(service)

    def start(self):
        components=self.runtime['component_env'](self.values)
        for service,key in (('auth','GOTRUE_DB_DATABASE_URL'),('rest','PGRST_DB_URI'),('storage','DATABASE_URL')):
            uri=urlsplit(components[service][key])
            if uri.hostname!='db' or uri.port!=5432:raise RecoveryError('PrivateDatabaseHostRequired')
            components[service][key]=urlunsplit((uri.scheme,uri.netloc,'/'+self.r.database,uri.query,''))
        components['auth'].update(GOTRUE_LOG_LEVEL='info',GOTRUE_API_REQUEST_ID_HEADER='X-Request-ID',GOTRUE_DB_MAX_POOL_SIZE='3')
        components['rest']['PGRST_DB_POOL']='3'
        if components['auth'].get('GOTRUE_SMTP_HOST')!='smtp' or components['auth'].get('GOTRUE_SMTP_PORT')!='1025':raise RecoveryError('SMTPSinkRequired')
        self.start_service('auth',components['auth']);self.start_service('rest',components['rest'])
        gateway=self.runtime['kong_config'](self.values['ANON_KEY'],self.values['SERVICE_ROLE_KEY'])
        gateway['services']=[item for item in gateway['services'] if item['name'] in ('auth-v1','rest-v1') or item['name'].startswith('auth-open-')]
        for item in gateway['services']:
            for service,port in (('auth',9999),('rest',3000)):
                item['url']=item['url'].replace('http://'+service+':'+str(port),self.upstream(service,port))
        config=self.private_file('.env.kong-config.json',json.dumps(gateway).encode())
        self.start_service('kong',components['kong'],['--tmpfs','/run/kong:rw,uid=1002,gid=1002,mode=0700','--ulimit','nofile=4096:4096',
                        '--mount','type=bind,src='+str(config)+',dst=/run/ir35/.env.kong-config.json,readonly'])
        self.wait_ready()

    def resume(self):
        self.check_files()
        if any(self.info(s)['State']['Status']!='exited' for s in self.containers):raise RecoveryError('PreparedStoppedContainersRequired')
        for service in self.containers:self.runtime['run'](['docker','start',self.containers[service]])
        self.wait_ready()

    def wait_ready(self):
        deadline=time.monotonic()+120
        while time.monotonic()<deadline:
            try:
                if self.raw('/auth/v1/health',headers={'apikey':self.values['ANON_KEY']})[0]==200:return
            except (urllib.error.URLError,TimeoutError):pass
            if any(self.info(service)['State']['Status']=='exited' for service in self.containers):break
            time.sleep(2)
        raise RecoveryError('PrivateGatewayReadinessFailed')

    def observe(self,path,body,*,bearer=None,method='POST'):
        rid=str(uuid.uuid4());lines=[];size=[0];ready=threading.Event()
        attach=subprocess.Popen(['docker','attach','--no-stdin','--sig-proxy=false',self.containers['auth']],stdout=subprocess.PIPE,stderr=subprocess.STDOUT)
        def collect():
            for line in iter(attach.stdout.readline,b''):
                size[0]+=len(line)
                if size[0]<=131072:lines.append(line)
                if rid.encode() in line:ready.set()
        worker=threading.Thread(target=collect,daemon=True);worker.start();time.sleep(.5)
        headers={'apikey':self.values['ANON_KEY'],'X-Request-ID':rid}
        if bearer:headers.update(apikey=self.values['SERVICE_ROLE_KEY'] if bearer==self.values['SERVICE_ROLE_KEY'] else self.values['ANON_KEY'],Authorization='Bearer '+bearer)
        try:
            status,content,response_headers=self.raw(path,body=body,headers=headers,method=method)
            diagnostic=response_diagnostic(status,content,response_headers,rid)
            ready.wait(3)
        finally:
            observer=detach_observer(attach,worker)
        actual=diagnostic.get('requestId') or rid
        projected=correlated_logs(b''.join(lines).decode('utf-8','replace'),actual)
        public_path=re.sub(r'/[0-9a-f-]{36}$','/:test-user',path.split('?')[0])
        entry={'path':public_path,'method':method,'requestHeaders':sorted(headers),'bodyFields':sorted(body) if isinstance(body,dict) else [],
               'response':diagnostic,'requestLogs':projected,'rawLogsPersisted':False,'logBoundExceeded':size[0]>131072,'observer':observer}
        sensitive=[self.values[k] for k in ('JWT_SECRET','ANON_KEY','SERVICE_ROLE_KEY')]
        if isinstance(body,dict):sensitive.extend(body.get(k) for k in ('password','refresh_token','token','token_hash'))
        entry=redact_known_secrets(entry,sensitive)
        self.diagnostics.append(entry)
        return status,content,entry

    def login(self,email,password):
        path,body=password_request(email,password)
        return self.observe(path,body)

    def session(self,reply,user_id):
        token=reply.get('access_token','');parts=token.split('.')
        if len(parts)!=3:raise RecoveryError('StagingSessionTokenMissing')
        signature=base64.urlsafe_b64encode(hmac.new(self.values['JWT_SECRET'].encode(),'.'.join(parts[:2]).encode(),hashlib.sha256).digest()).decode().rstrip('=')
        claims=json.loads(base64.urlsafe_b64decode(parts[1]+'='*((4-len(parts[1])%4)%4)))
        if not hmac.compare_digest(signature,parts[2]) or claims.get('sub')!=user_id or claims.get('aud')!='authenticated' or claims.get('role')!='authenticated' or claims.get('exp',0)<=time.time():raise RecoveryError('SessionIdentitySignatureAudienceMismatch')
        headers={'apikey':self.values['ANON_KEY'],'Authorization':'Bearer '+token}
        status,body,_=self.raw('/auth/v1/user',headers=headers)
        if status!=200 or json.loads(body).get('id')!=user_id:raise RecoveryError('RealSessionUserEndpointFailed')
        return headers

    def refresh(self,reply,user_id):
        status,body,_=self.observe('/auth/v1/token?grant_type=refresh_token',{'refresh_token':reply['refresh_token']})
        if status!=200:raise RecoveryError('StagingSessionRefreshFailed')
        refreshed=json.loads(body);return refreshed,self.session(refreshed,user_id)

    def rls(self,user_id,headers,*,create_fixture=False):
        if create_fixture:
            status,body,_=self.raw('/rest/v1/profiles?select=id&id=eq.'+user_id,headers=headers)
            if status!=200:raise RecoveryError('AuthenticatedRLSReadFailed')
            if json.loads(body)==[]:
                status,_,_=self.raw('/rest/v1/profiles',headers=headers,body={'id':user_id,'full_name':'IR35 synthetic staging fixture'})
                if status not in (200,201,204):raise RecoveryError('SyntheticOwnerProfileCreationFailed')
        status,body,_=self.raw('/rest/v1/profiles?select=id',headers=headers)
        rows=json.loads(body) if status==200 else None
        if not isinstance(rows,list) or any(row.get('id')!=user_id for row in rows) or create_fixture and not rows:raise RecoveryError('OwnerRLSMismatch')
        status,body,_=self.raw('/rest/v1/profiles?select=id&id=neq.'+user_id,headers=headers)
        if status!=200 or json.loads(body)!=[]:raise RecoveryError('CrossOwnerRLSMismatch')
        status,body,_=self.raw('/rest/v1/profiles?select=id',headers={'apikey':self.values['ANON_KEY']})
        if status not in (401,403) and not (status==200 and json.loads(body)==[]):raise RecoveryError('AnonymousRLSMismatch')
        return {'ownerRead':True,'ownerRows':len(rows),'crossOwnerDenied':True,'anonymousDenied':True}

    def stop(self):
        for service in reversed(self.containers):
            row=self.info(service)
            if row['State']['Status']=='running':self.runtime['run'](['docker','stop','--time','10',self.containers[service]])

    def record(self):return {'environmentRoot':str(self.environment_root),'containers':self.containers,'files':self.files}


def fixture(recovery,suffix):
    original=recovery.database;target=original+suffix
    if suffix not in ('_syn1','_syn2','_syn3','_named'):raise RecoveryError('FixtureSuffixRefused')
    if recovery.query("SELECT 1 FROM pg_database WHERE datname='"+target+"';",'postgres').strip():raise RecoveryError('FixtureAlreadyExists_NoReplay')
    statement='CREATE DATABASE '+target+' WITH TEMPLATE '+original+' OWNER postgres;'
    recovery.command(recovery.base+['psql','-XqAt','-v','ON_ERROR_STOP=1','-U','supabase_admin','-d','postgres','-f','-'],input=statement.encode())
    recovery.database=target


def synthetic(recovery,attempt):
    require_storage_api(recovery)
    if attempt not in (1,2,3):raise RecoveryError('SyntheticRepairBudgetExceeded')
    if attempt>1:
        name='08-synthetic-'+str(attempt-1)
        if name not in recovery.payload['anchors']:raise RecoveryError('PriorSyntheticFailureRequired')
        previous=json.loads((recovery.run_root/name/'result.json').read_bytes())
        diagnosed=False
        if attempt==2 and previous.get('code')=='TimeoutExpired' and '08-synthetic-1-observer-audit' in recovery.payload['anchors']:
            diagnosed=json.loads((recovery.run_root/'08-synthetic-1-observer-audit/result.json').read_bytes()).get('termWaitTimedOut') is True
        eligible=previous.get('code') in ('Controlled400DiagnosticsFailed','SyntheticPasswordGrantFailed','PrivateGatewayReadinessFailed','SyntheticUserCreationFailed','StagingSessionRefreshFailed')
        if previous.get('status')!='FAIL' or previous.get('pristineDatabaseUnchanged') is not True or not (diagnosed or eligible):raise RecoveryError('SyntheticRepairNotAuthorized')
    source=recovery.source();store=recovery.store();stage=store.stage('08-synthetic-'+str(attempt));stack=None;created_id=None
    result={'status':'FAIL','attempt':attempt,'namedPasswordAttempts':0,'sourceWrites':0,'phaseComplete':False}
    try:
        fixture(recovery,'_syn'+str(attempt));stack=PrivateStack(recovery,stage);stack.start()
        proof=recovery.check_database();store.put(stage,'pre-test-fidelity.json',json.dumps(proof).encode())
        if proof['status']!='PASS':raise RecoveryError('FixtureDataMismatch_Abort')
        status,_,diagnostic=stack.observe('/auth/v1/token?grant_type=password',{'email':'','password':''})
        if status!=400 or diagnostic['response']['error_code']!='validation_failed' or not diagnostic['requestLogs']:raise RecoveryError('Controlled400DiagnosticsFailed')
        email='qa+staging@invalid.test'
        if recovery.query("SELECT count(*) FROM auth.users WHERE lower(email)='qa+staging@invalid.test';").strip()!='0':raise RecoveryError('SyntheticIdentityAlreadyExists')
        password=secrets.token_urlsafe(36)
        status,body,_=stack.observe('/auth/v1/admin/users',{'email':email,'password':password,'email_confirm':True},bearer=stack.values['SERVICE_ROLE_KEY'])
        if status not in (200,201):raise RecoveryError('SyntheticUserCreationFailed')
        created_id=json.loads(body).get('id')
        if not re.fullmatch(r'[0-9a-f-]{36}',created_id or ''):raise RecoveryError('SyntheticIdentityInvalid')
        status,body,diagnostic=stack.login(email,password);password=None
        result['passwordDiagnostic']=diagnostic
        if status!=200:raise RecoveryError('SyntheticPasswordGrantFailed')
        reply=json.loads(body);stack.session(reply,created_id)
        refreshed,headers=stack.refresh(reply,created_id)
        result['rls']=stack.rls(created_id,headers,create_fixture=True)
        status,_,_=stack.raw('/auth/v1/logout?scope=local',body={},headers=headers)
        if status not in (200,204):raise RecoveryError('SyntheticLogoutFailed')
        result.update(status='PASS',passwordLogin=True,sessionUserVerified=True,sessionRefresh=True,
                      originalRequestBodyFields=['email','password'],newRequestBodyFields=['email','password'],
                      originalRequestPath='direct Auth /token; no Kong apikey',newRequestPath='/auth/v1/token via isolated Kong with apikey',
                      original400Cause='unproven; original body/log unavailable',plainPasswordPersisted=False)
    except Exception as error:
        result.update(status='FAIL',code=str(error) if isinstance(error,RecoveryError) else type(error).__name__)
    finally:
        try:
            if stack and created_id:
                # Identity-checked admin deletion, never a customer account/SQL truncate.
                count=recovery.query("SELECT count(*) FROM auth.users WHERE id='"+created_id+"'::uuid AND email='qa+staging@invalid.test';").strip()
                if count!='1':raise RecoveryError('SyntheticCleanupIdentityMismatch')
                status,_,_=stack.observe('/auth/v1/admin/users/'+created_id,None,bearer=stack.values['SERVICE_ROLE_KEY'],method='DELETE')
                if status not in (200,204):raise RecoveryError('SyntheticUserDeletionFailed')
                if recovery.query("SELECT count(*) FROM auth.users WHERE id='"+created_id+"'::uuid;").strip()!='0':raise RecoveryError('SyntheticUserDeletionReadbackFailed')
                result['syntheticUserDeleted']=True
        except RecoveryError as error:result.update(status='FAIL',code=str(error))
        finally:
            if stack:
                stack.stop();result['runtime']=stack.record();result['diagnostics']=stack.diagnostics;result['containersStopped']=True
    # Pristine rehearsal DB was never used by the Auth services.
    recovery.database='ir35_'+recovery.run_id.lower()
    after=recovery.check_database();store.put(stage,'pristine-post-test-fidelity.json',json.dumps(after).encode())
    result['pristineDatabaseUnchanged']=after['status']=='PASS'
    if after['status']!='PASS':result.update(status='FAIL',code='PristineDataMismatch_Abort')
    return recovery.seal(store,stage,result)


def require_storage_api(recovery):
    recovery.verify_previous();chosen=None
    for name in ('05-storage-api','07-storage-api-repair-1','07-storage-api-repair-2'):
        if name in recovery.payload['anchors']:chosen=name
    if not chosen:raise RecoveryError('ActualStorageAPIGateRequired')
    proof=json.loads((recovery.run_root/chosen/'result.json').read_bytes())
    if proof.get('status')!='PASS' or proof.get('fullPostAPIFidelity')!='PASS':raise RecoveryError('ActualStorageAPIGateRequired')


def require_synthetic(recovery):
    require_storage_api(recovery);chosen=None
    for name in ('08-synthetic-1','08-synthetic-2','08-synthetic-3'):
        if name in recovery.payload['anchors']:chosen=name
    if not chosen:raise RecoveryError('ActualSyntheticPASSRequired')
    proof=json.loads((recovery.run_root/chosen/'result.json').read_bytes())
    if proof.get('status')!='PASS' or not all(proof.get(k) is True for k in ('passwordLogin','sessionRefresh','syntheticUserDeleted','pristineDatabaseUnchanged')) or not all(proof.get('rls',{}).get(k) is True for k in ('ownerRead','crossOwnerDenied','anonymousDenied')):raise RecoveryError('ActualSyntheticPASSRequired')
    incident=recovery.payload['incident'];archive=Path(incident['incidentDirectory'])/incident['stage']
    rows={item['originalPath']:item['archivedFile'] for item in incident['artifacts']}
    denied=json.loads((archive/rows['config/p4-auth-login.json']).read_bytes())
    unused=json.loads((archive/rows['config/p4-auth-authorized-2.json']).read_bytes())
    if denied.get('status')!='LOGIN_DENIED' or denied.get('loginAttempts')!=1 or unused.get('passwordAttempts')!=0:raise RecoveryError('OriginalPasswordAttemptHistoryMismatch')


def gateway_controls(stack):
    status,body,_=stack.raw('/auth/v1/settings',headers={'apikey':stack.values['ANON_KEY']})
    config=json.loads(body) if status==200 else {}
    checks={'emailEnabled':config.get('external',{}).get('email') is True,'confirmationRequired':config.get('mailer_autoconfirm') is False,
      'missingApikeyDenied':stack.raw('/auth/v1/settings')[0]==401,
      'invalidApikeyDenied':stack.raw('/auth/v1/settings',headers={'apikey':'invalid-test-key'})[0] in (401,403)}
    status,_,entry=stack.observe('/auth/v1/token?grant_type=password',{'email':'','password':''})
    checks['controlled400Captured']=status==400 and entry['response']['error_code']=='validation_failed' and bool(entry['requestLogs'])
    if not all(checks.values()):raise RecoveryError('NamedPasswordFreePreflightFailed')
    return checks


def named_ready(recovery):
    require_synthetic(recovery);store=recovery.store();stage=store.stage('09-named-ready');stack=None
    result={'status':'FAIL','namedPasswordAttempts':0,'globalPasswordAttempts':1,'sourceWrites':0,'phaseComplete':False}
    try:
        fixture(recovery,'_named');stack=PrivateStack(recovery,stage);stack.start()
        for cycle in ('initial','restart'):
            if cycle=='restart':stack.stop();stack.resume()
            checks=gateway_controls(stack)
            proof=recovery.check_database();store.put(stage,cycle+'-fidelity.json',json.dumps(proof).encode())
            if proof['status']!='PASS':raise RecoveryError('NamedFixtureDataMismatch_Abort')
            result[cycle+'Controls']=checks
        # No hash, identity or email values are published. Whole-table hashes already matched.
        account=json.loads(recovery.query("SELECT jsonb_build_object('count',count(*),'ready',bool_and(email_confirmed_at IS NOT NULL AND banned_until IS NULL AND deleted_at IS NULL AND NOT is_sso_user AND aud='authenticated' AND role='authenticated' AND encrypted_password LIKE '$2%')) FROM auth.users WHERE lower(email)='anvesh.mannuru+ir35test@gmail.com';"))
        if account!={'count':1,'ready':True}:raise RecoveryError('NamedAccountStateMismatch_Abort')
        result.update(status='READY_STOPPED',preloginFidelity=True,restartTested=True,remainingPasswordAttempts=1,
                      previousDenialPreserved=True,plainPasswordRequested=False)
    except Exception as error:result.update(status='FAIL',code=str(error) if isinstance(error,RecoveryError) else type(error).__name__)
    finally:
        if stack:stack.stop();result.update(runtime=stack.record(),diagnostics=stack.diagnostics,containersStopped=True)
    recovery.database='ir35_'+recovery.run_id.lower();proof=recovery.check_database()
    store.put(stage,'pristine-fidelity.json',json.dumps(proof).encode());result['pristineDatabaseUnchanged']=proof['status']=='PASS'
    if proof['status']!='PASS':result.update(status='FAIL',code='PristineDataMismatch_Abort')
    return recovery.seal(store,stage,result)


def named_status(recovery):
    require_synthetic(recovery)
    if (recovery.run_root/'10-named-login').exists():raise RecoveryError('NamedAttemptAlreadyReserved_NeverReplay')
    if '09-named-ready' not in recovery.payload['anchors']:raise RecoveryError('NamedReadinessAnchorRequired')
    ready=json.loads((recovery.run_root/'09-named-ready/result.json').read_bytes())
    if ready.get('status')!='READY_STOPPED' or ready.get('namedPasswordAttempts')!=0 or not all(ready.get(k) is True for k in ('preloginFidelity','restartTested','pristineDatabaseUnchanged','containersStopped')):raise RecoveryError('NamedAttemptNotReady')
    stack=PrivateStack(recovery,recovery.run_root/'09-named-ready',saved=ready['runtime'])
    if any(stack.info(s)['State']['Status']!='exited' for s in stack.containers):raise RecoveryError('PreparedStoppedContainersRequired')
    return {'status':'READY_STOPPED','namedPasswordAttempts':0,'globalPasswordAttempts':1,'remainingPasswordAttempts':1,'passwordRequested':False,'sourceWrites':0}


def named_login(recovery):
    named_status(recovery);store=recovery.store();stage=store.stage('10-named-login');stack=None
    result={'status':'FAIL','namedPasswordAttempts':0,'globalPasswordAttempts':1,'slotConsumed':True,'sourceWrites':0,'phaseComplete':False}
    # Reserving the write-once stage precedes startup and the one HTTP password grant.
    store.put(stage,'intent.json',json.dumps({'authorization':'owner-approved-one-remaining-hidden-password-attempt','maxPasswordRequests':1,'automaticRetries':0}).encode())
    try:
        ready=json.loads((recovery.run_root/'09-named-ready/result.json').read_bytes())
        recovery.database+='_named';stack=PrivateStack(recovery,recovery.run_root/'09-named-ready',saved=ready['runtime']);stack.resume()
        proof=recovery.check_database();store.put(stage,'prelogin-fidelity.json',json.dumps(proof).encode())
        if proof['status']!='PASS':raise RecoveryError('NamedPreloginDataMismatch_Abort')
        ids=json.loads(recovery.query("SELECT jsonb_agg(id::text) FROM auth.users WHERE lower(email)='anvesh.mannuru+ir35test@gmail.com';"))
        if not isinstance(ids,list) or len(ids)!=1:raise RecoveryError('NamedIdentityMismatch_Abort')
        password=recovery.payload.pop('password',None)
        if not isinstance(password,str) or not 1<=len(password)<=1024:raise RecoveryError('OwnerHiddenInputRequired')
        result.update(namedPasswordAttempts=1,globalPasswordAttempts=2)
        status,body,diagnostic=stack.login('anvesh.mannuru+ir35test@gmail.com',password);password=None
        result['passwordDiagnostic']=diagnostic
        if status!=200:raise RecoveryError('NamedPasswordGrantDenied_StopNoRetry')
        reply=json.loads(body);stack.session(reply,ids[0]);refreshed,headers=stack.refresh(reply,ids[0])
        result['rls']=stack.rls(ids[0],headers)
        expected=int(recovery.query("SELECT count(*) FROM public.profiles WHERE id='"+ids[0]+"'::uuid;").strip())
        if result['rls']['ownerRows']!=expected:raise RecoveryError('NamedOwnerRLSMismatch_Abort')
        status,_,_=stack.raw('/auth/v1/logout?scope=local',body={},headers=headers)
        if status not in (200,204):raise RecoveryError('NamedLogoutFailed')
        result.update(status='PASS',passwordLogin=True,sessionUserVerified=True,sessionRefresh=True,testSessionLoggedOut=True)
    except Exception as error:result.update(status='FAIL',code=str(error) if isinstance(error,RecoveryError) else type(error).__name__)
    finally:
        recovery.payload.pop('password',None)
        if stack:stack.stop();result.update(diagnostics=stack.diagnostics,containersStopped=True,runtimeStage='09-named-ready')
    recovery.database='ir35_'+recovery.run_id.lower();proof=recovery.check_database()
    store.put(stage,'pristine-post-login-fidelity.json',json.dumps(proof).encode());result['pristineDatabaseUnchanged']=proof['status']=='PASS'
    if proof['status']!='PASS':result.update(status='FAIL',code='PristineDataMismatch_Abort')
    return recovery.seal(store,stage,result)


def storage_api(recovery,repair=0):
    source=recovery.source();store=recovery.store();stage=store.stage('05-storage-api' if repair==0 else '07-storage-api-repair-'+str(repair));stack=None
    result={'status':'FAIL','sourceWrites':0,'databaseWrites':0,'phaseComplete':False}
    try:
        stack=PrivateStack(recovery,stage);components=stack.runtime['component_env'](stack.values)
        uri=urlsplit(components['rest']['PGRST_DB_URI']);components['rest']['PGRST_DB_URI']=urlunsplit((uri.scheme,uri.netloc,'/'+recovery.database,uri.query,''));components['rest']['PGRST_DB_POOL']='3'
        stack.start_service('rest',components['rest'])
        component=components['storage'];uri=urlsplit(component['DATABASE_URL'])
        component['DATABASE_URL']=urlunsplit((uri.scheme,uri.netloc,'/'+recovery.database,urlencode({'options':'-c default_transaction_read_only=on'}),''))
        component.update(POSTGREST_URL=stack.address('rest',3000),NODE_OPTIONS='--max-old-space-size=384',
          DB_MIGRATIONS_FREEZE_AT=source['storageMigrations'][-1]['name'],DB_ALLOW_MIGRATION_REFRESH='false',DB_INSTALL_ROLES='false',
          TUS_USE_FILE_VERSION_SEPARATOR='false',STORAGE_FILE_ETAG_ALGORITHM='md5',PG_QUEUE_ENABLE='false',PG_QUEUE_WORKERS_ENABLE='false',
          STORAGE_LIFECYCLE_ENABLED='false',TRACING_ENABLED='false')
        data_root=recovery.root/'data/p4-runs'/recovery.run_id
        stack.start_service('storage',component,['--mount','type=bind,src='+str(data_root)+',dst=/var/lib/storage,readonly'])
        deadline=time.monotonic()+120;healthy=False
        while time.monotonic()<deadline:
            try:healthy=stack.raw('/status',service='storage',port=5000)[0]==200
            except (urllib.error.URLError,TimeoutError):pass
            if healthy:break
            if stack.info('storage')['State']['Status']=='exited':break
            time.sleep(2)
        if not healthy:raise RecoveryError('FrozenStorageAPIHealthFailed')
        objects=[];signed=0
        for obj in source['storage']['privateObjects']:
            locator=quote(obj['bucket'],safe='')+'/'+quote(obj['name'],safe='/')
            status,body,_=stack.raw('/object/authenticated/'+locator,headers={'Authorization':'Bearer '+stack.values['SERVICE_ROLE_KEY'],'Accept-Encoding':'identity'},service='storage',port=5000)
            if status!=200 or len(body)!=int(obj['bytes']) or digest(body)!=obj['sha256']:raise RecoveryError('StorageAPIByteMismatch_Abort')
            status,body,_=stack.raw('/object/sign/'+locator,body={'expiresIn':60},headers={'Authorization':'Bearer '+stack.values['SERVICE_ROLE_KEY']},service='storage',port=5000)
            if status!=200:raise RecoveryError('SignedURLCreationFailed')
            relative=json.loads(body).get('signedURL','');parsed=urlsplit(relative)
            if parsed.scheme or parsed.netloc or not parsed.path.startswith('/object/sign/'):raise RecoveryError('SignedURLOriginRefused')
            status,body,_=stack.raw(relative,service='storage',port=5000)
            if status!=200 or len(body)!=int(obj['bytes']) or digest(body)!=obj['sha256']:raise RecoveryError('SignedURLByteMismatch_Abort')
            signed+=1;objects.append({k:obj[k] for k in ('pathHash','bytes','sha256')})
        result.update(status='PASS',objectCount=len(objects),signedURLChecks=signed,totalBytes=sum(int(o['bytes']) for o in objects),objects=objects,
                      fileMountReadOnly=True,databaseReadOnly=True,migrationRefresh=False)
    except Exception as error:result.update(status='FAIL',code=str(error) if isinstance(error,RecoveryError) else type(error).__name__)
    finally:
        if stack:stack.stop();result.update(runtime=stack.record(),containersStopped=True)
    after=recovery.check_database();store.put(stage,'post-api-fidelity.json',json.dumps(after).encode())
    result['fullPostAPIFidelity']=after['status']
    if after['status']!='PASS':result.update(status='FAIL',code='StorageAPIDataMismatch_Abort')
    return recovery.seal(store,stage,result)


def run(operation,payload,runtime):
    recovery=Recovery(payload,runtime)
    if operation=='named-ready':return named_ready(recovery)
    if operation=='named-status':return named_status(recovery)
    if operation=='named-login':return named_login(recovery)
    if operation=='observer-audit':
        recovery.verify_previous();store=recovery.store();stage=store.stage('08-synthetic-1-observer-audit')
        stack=PrivateStack(recovery,recovery.run_root/'08-synthetic-1',saved=payload['priorRuntime'])
        if any(stack.info(s)['State']['Status']!='exited' for s in stack.containers):raise RecoveryError('FailedFixtureMustRemainStopped')
        cid=runtime['run'](['docker','compose','--env-file','/opt/ir35/.env','-f','/opt/ir35/compose.yml','ps','-q','auth']).strip()
        before=json.loads(runtime['run'](['docker','inspect',cid]))[0]
        process=subprocess.Popen(['docker','attach','--no-stdin','--sig-proxy=false',cid],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        time.sleep(.5);process.terminate();term_timeout=False
        try:process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            term_timeout=True;process.kill();process.wait(timeout=2)
        after=json.loads(runtime['run'](['docker','inspect',cid]))[0]
        unchanged=before['State']['StartedAt']==after['State']['StartedAt'] and after['State']['Status']=='running'
        if not unchanged:raise RecoveryError('ObserverChangedContainerState_Abort')
        return recovery.seal(store,stage,{'status':'PASS','auditOnly':True,'termWaitTimedOut':term_timeout,
          'rootCause':'local docker attach CLI ignores TERM with signal proxy disabled' if term_timeout else 'not reproduced',
          'originalAuthUnchanged':True,'failedFixtureStillStopped':True,'authRequests':0,'sourceWrites':0,'databaseWrites':0})
    if operation=='runtime-audit':
        recovery.verify_previous();store=recovery.store();stage=store.stage('06-runtime-audit')
        stack=PrivateStack(recovery,recovery.run_root/'05-storage-api',saved=payload['priorRuntime'])
        states={}
        for service in stack.containers:
            row=stack.info(service)
            states[service]={'status':row['State']['Status'],'exitCode':row['State']['ExitCode'],'oomKilled':row['State']['OOMKilled'],
              'privateIPAssigned':bool(row['NetworkSettings']['Networks'][stack.network]['IPAddress']),'daemonErrorPresent':bool(row['State']['Error'])}
        return recovery.seal(store,stage,{'status':'PASS','auditOnly':True,'previousAPIStepStillFAIL':True,'states':states,'sourceWrites':0,'databaseWrites':0})
    if operation in ('storage-api','storage-api-repair-1','storage-api-repair-2'):
        recovery.verify_previous();return storage_api(recovery,0 if operation=='storage-api' else int(operation[-1]))
    if operation in ('synthetic-1','synthetic-2','synthetic-3'):
        recovery.verify_previous()
        return synthetic(recovery,int(operation[-1]))
    raise RecoveryError('AuthOperationRefused')
