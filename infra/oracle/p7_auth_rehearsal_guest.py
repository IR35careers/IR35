"""Source-configured disposable P7 Auth clones; internal SMTP and mock only."""
import base64
import copy
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import subprocess
import time
from html import unescape
from urllib.parse import urlsplit,parse_qs
from p4_auth_probe import PrivateStack,Recovery,RecoveryError,gateway_controls
from p4_mail_probe import MailStack,Anchors,AUTH_HASH_SQL,ACCOUNT_SQL,EMAIL
from p6_restart_diagnosis_guest import containment
import p6_role_policy
import p7_auth_profile as profile

TEMPLATE_SERVER="""import fs from 'node:fs';import http from 'node:http';
const templates=JSON.parse(fs.readFileSync('/run/ir35/.env.p7-templates.json','utf8'));
http.createServer((req,res)=>{const key=req.url.slice(1);res.setHeader('Cache-Control','no-store');res.setHeader('X-Robots-Tag','noindex');
if(req.method!=='GET'||!Object.hasOwn(templates,key)){res.writeHead(404);res.end();return;}
res.setHeader('Content-Type','text/html; charset=utf-8');res.end(templates[key]);}).listen(8080,'0.0.0.0');"""


def parse_link(message,kind,recipient):
    if recipient!=EMAIL and not re.fullmatch(r'qa\+[a-z]+@invalid\.test',recipient):raise RecoveryError('FixtureRecipientRequired')
    if [row.get('Address') for row in message.get('To',[])]!=[recipient]:raise RecoveryError('SinkRecipientMismatch_Abort')
    parser=Anchors();parser.feed(message.get('HTML',''));tokens=[]
    for link in parser.links:
        url=urlsplit(unescape(link));query=parse_qs(url.query)
        if (url.scheme=='https' and url.hostname=='api-staging.ir35careers.com' and url.port in (None,443)
                and not url.username and not url.password and url.path=='/auth/v1/verify' and query.get('type')==[kind]):
            values=query.get('token',[])
            if len(values)==1 and re.fullmatch(r'[0-9a-f]{56}',values[0]):tokens.append(values[0])
    if len(tokens)!=1:raise RecoveryError('SinkVerificationLinkInvalid')
    return tokens[0]


class SourceStack(MailStack):
    def __init__(self,recovery,stage,handoff,app_image):
        super().__init__(recovery,stage)
        self.handoff=handoff;self.app_image=app_image
        self.template_name='ir35-p4-'+self.r.run_id[-8:]+'-'+stage.name+'-templates'
        base=self.runtime['component_env']
        configured,templates,subjects,self.projection=profile.configure(base(self.values)['auth'],handoff,self.template_name)
        self.subject_path=self.private_file('.env.public-subjects',profile.subject_env(subjects).encode())
        self.template_path=self.private_file('.env.templates.json',json.dumps(templates,ensure_ascii=False).encode())
        self.templates=templates
        def components(values):
            result=copy.deepcopy(base(values));result['auth']=copy.deepcopy(configured);return result
        self.runtime=self.runtime|{'component_env':components}

    def start_service(self,service,component,extra=()):
        if service=='auth':extra=[*extra,'--env-file',str(self.subject_path)]
        return super().start_service(service,component,extra)

    def start(self):
        self.pins=dict(self.pins)|{'templates':{'image':self.app_image}}
        cid=self.runtime['run'](['docker','run','-d','--name',self.template_name,'--label','ir35.recovery='+self.r.run_id,
            '--network',self.network,'--user','1002:1002','--read-only','--memory','96m','--pids-limit','32',
            '--cap-drop','ALL','--security-opt','no-new-privileges','--restart','no','--log-driver','none',
            '--mount','type=bind,src='+str(self.template_path)+',dst=/run/ir35/.env.p7-templates.json,readonly',
            '--entrypoint','node',self.app_image,'--input-type=module','-e',TEMPLATE_SERVER]).strip()
        self.containers['templates']=cid;self.info('templates')
        deadline=time.monotonic()+30
        while True:
            try:
                status,body,_=self.raw('/confirmation',service='templates',port=8080)
                if status==200:break
            except Exception:
                if time.monotonic()>=deadline:raise RecoveryError('PrivateTemplateReadinessFailed')
            if time.monotonic()>=deadline:raise RecoveryError('PrivateTemplateReadinessFailed')
            time.sleep(1)
        for kind,expected in self.templates.items():
            status,body,_=self.raw('/'+kind,service='templates',port=8080)
            if status!=200 or body!=expected.encode():raise RecoveryError('SourceTemplateByteMismatch_Abort')
        super().start()

    def consume(self,kind,recipient,seen):
        deadline=time.monotonic()+30
        while time.monotonic()<deadline:
            fresh=[m for m in self.messages() if m.get('ID')not in seen and [r.get('Address')for r in m.get('To',[])]==[recipient]]
            if fresh:
                if len(fresh)!=1:raise RecoveryError('UnexpectedSinkMessages_Abort')
                message_id=fresh[0]['ID']
                if not re.fullmatch(r'[A-Za-z0-9_-]{8,100}',message_id):raise RecoveryError('SinkIdentifierInvalid')
                status,body,_=self.raw('/api/v1/message/'+message_id,service='smtp',port=8025)
                if status!=200:raise RecoveryError('SinkReadFailed')
                token=parse_link(json.loads(body),kind,recipient);seen.add(message_id)
                status,body,_=self.observe('/auth/v1/verify',{'token_hash':token,'type':kind});token=None
                if status!=200:raise RecoveryError('SinkLinkExchangeFailed')
                return json.loads(body)
            time.sleep(1)
        raise RecoveryError('SinkMailNotReceived')


def scoped_runtime(data,runtime):
    original=Recovery(data['p4'],runtime);source=original.source()
    expiry=json.loads(original.query(original.sql['expiry'],'postgres'));baseline=runtime['verifiers']['fidelity_compare']
    def compare(source_catalog,target_catalog,conditions,privileges,unused):
        return p6_role_policy.compare(source_catalog,target_catalog,conditions,privileges,source['roleExpiry'],expiry,baseline)
    return runtime|{'verifiers':runtime['verifiers']|{'fidelity_compare':compare}}


def owned_clone(recovery,stage,case):
    if case not in ('mail','signup','email'):raise RecoveryError('ExplicitP7CaseRequired')
    attempt=recovery.payload['p7AuthAttempt']
    if attempt not in (1,2):raise RecoveryError('BoundedP7AttemptRequired')
    pristine=recovery.database;target=pristine+'_p7a'+str(attempt)+'_'+case
    if recovery.query("SELECT 1 FROM pg_database WHERE datname='"+target+"';",'postgres').strip():raise RecoveryError('P7CloneExists_NoReplay')
    recovery.command(recovery.base+['psql','-XqAt','-v','ON_ERROR_STOP=1','-U','supabase_admin','-d','postgres','-f','-'],
        input=('CREATE DATABASE '+target+' WITH TEMPLATE '+pristine+' OWNER postgres;').encode())
    recovery.query('COMMENT ON DATABASE '+target+' IS '+recovery.verifiers['literal']('ir35-p7:'+recovery.run_id+':'+stage.name)+';','postgres',readonly=False)
    recovery.database=target
    return pristine,target


def destroy_clone(recovery,target,stage,pristine):
    attempt=recovery.payload['p7AuthAttempt']
    if attempt not in (1,2) or target not in tuple(pristine+'_p7a'+str(attempt)+'_'+case for case in ('mail','signup','email')):raise RecoveryError('P7DropTargetRefused')
    annotation=recovery.query("SELECT coalesce(shobj_description(oid,'pg_database'),'') FROM pg_database WHERE datname='"+target+"';",'postgres').strip()
    if annotation!='ir35-p7:'+recovery.run_id+':'+stage.name:raise RecoveryError('P7DropOwnershipMismatch')
    if recovery.query("SELECT count(*) FROM pg_stat_activity WHERE datname='"+target+"';",'postgres').strip()!='0':raise RecoveryError('P7CloneStillConnected')
    recovery.command(recovery.base+['psql','-XqAt','-v','ON_ERROR_STOP=1','-U','supabase_admin','-d','postgres','-f','-'],input=('DROP DATABASE '+target+';').encode())
    return recovery.query("SELECT count(*) FROM pg_database WHERE datname='"+target+"';",'postgres').strip()=='0'


def create_user(stack,email):
    password=secrets.token_urlsafe(48)
    status,body,_=stack.observe('/auth/v1/admin/users',{'email':email,'password':password,'email_confirm':True},bearer=stack.values['SERVICE_ROLE_KEY'])
    if status not in (200,201):raise RecoveryError('P7SyntheticCreationFailed')
    user_id=json.loads(body).get('id')
    if not re.fullmatch(r'[a-f0-9-]{36}',user_id or ''):raise RecoveryError('P7SyntheticIdentityInvalid')
    status,body,_=stack.login(email,password)
    if status!=200:raise RecoveryError('P7SyntheticPasswordLoginFailed')
    reply=json.loads(body);stack.session(reply,user_id);_,headers=stack.refresh(reply,user_id)
    rls=stack.rls(user_id,headers,create_fixture=True)
    return user_id,password,reply,headers,rls


def queue_clone_denials(recovery,target):
    from p6_hba_guest import actual_login
    from p6_restart_diagnosis_guest import BRIDGE_PROBE
    from web_edge_guest import private_env
    checks=[]
    for role,suffix in (('ir35_queue','owner'),('ir35_queue_producer','producer')):
        credentials=private_env(Path('/opt/ir35')/('.env.p6-queue-'+suffix))
        for transport in ('local','ipv4-loopback','ipv6-loopback'):
            checks.append(actual_login(role,target,transport,credentials))
        reply=subprocess.run(['docker','exec','-i','--user','1002:1002','ir35-p6-mock-worker-v7-fixedip',
            'node','--input-type=module','-e',BRIDGE_PROBE],
            input=json.dumps({'role':role,'database':target,'password':credentials['PGPASSWORD']}).encode(),capture_output=True,timeout=20)
        if reply.returncode:raise RecoveryError('P7PrivateBridgeProbeFailed')
        proof=json.loads(reply.stdout)
        checks.append({'role':role,'database':target,'transport':'docker-tcp','passed':proof['explicitHBAReject'] and not proof['connected'],'applicationFunctionCalled':False})
    if len(checks)!=8 or any(check.get('passed')is not True for check in checks):raise RecoveryError('P7QueueCloneAccessMismatch_Abort')
    return {'status':'PASS','deniedLogins':len(checks),'applicationFunctionCalls':0}


def mail_case(stack,recovery,handoff):
    synthetic,password,reply,headers,rls=create_user(stack,'qa+staging@invalid.test');password=None
    status,_,_=stack.observe('/auth/v1/admin/users/'+synthetic,None,bearer=stack.values['SERVICE_ROLE_KEY'],method='DELETE')
    if status not in (200,204):raise RecoveryError('P7SyntheticDeletionFailed')
    user_id=recovery.query("SELECT id::text FROM auth.users WHERE lower(email)='"+EMAIL+"';").strip()
    if not re.fullmatch(r'[a-f0-9-]{36}',user_id):raise RecoveryError('P7NamedIdentityMissing')
    seen=set();sent=time.monotonic()
    status,_,_=stack.observe('/auth/v1/otp',{'email':EMAIL,'create_user':False})
    if status!=200:raise RecoveryError('P7MagicLinkRequestFailed')
    old=stack.consume('magiclink',EMAIL,seen);old_headers=stack.session(old,user_id)
    magic_rls=stack.rls(user_id,old_headers)
    cooldown=handoff['settings']['smtp_max_frequency']+5
    while time.monotonic()-sent<cooldown:time.sleep(min(5,cooldown-(time.monotonic()-sent)))
    status,_,_=stack.observe('/auth/v1/recover',{'email':EMAIL})
    if status!=200:raise RecoveryError('P7RecoveryRequestFailed')
    recovered=stack.consume('recovery',EMAIL,seen);stack.session(recovered,user_id)
    session=json.loads(base64.urlsafe_b64decode(recovered['access_token'].split('.')[1]+'==')).get('session_id')
    if not re.fullmatch(r'[a-f0-9-]{36}',session or ''):raise RecoveryError('P7RecoverySessionMissing')
    previous=json.loads(recovery.query("SELECT coalesce(jsonb_agg(id::text ORDER BY id),'[]') FROM auth.sessions WHERE user_id='"+user_id+"' AND id<>'"+session+"';"))
    if not previous:raise RecoveryError('P7PriorSessionControlMissing')
    password=secrets.token_urlsafe(48)
    status,_,_=stack.observe('/auth/v1/user',{'password':password},bearer=recovered['access_token'],method='PUT')
    if status!=200:raise RecoveryError('P7RecoveryPasswordUpdateFailed')
    remaining=json.loads(recovery.query("SELECT coalesce(jsonb_agg(id::text ORDER BY id),'[]') FROM auth.sessions WHERE user_id='"+user_id+"';"))
    if remaining!=[session]:raise RecoveryError('P7OldSessionsNotRevoked_Abort')
    status,_,_=stack.observe('/auth/v1/token?grant_type=refresh_token',{'refresh_token':old['refresh_token']})
    if status not in (400,401):raise RecoveryError('P7OldRefreshStillAccepted_Abort')
    status,body,_=stack.login(EMAIL,password);password=None
    if status!=200:raise RecoveryError('P7RecoveredPasswordLoginFailed')
    _,headers=stack.refresh(json.loads(body),user_id);recovery_rls=stack.rls(user_id,headers)
    if len(stack.messages())!=2:raise RecoveryError('P7UnexpectedMailCount_Abort')
    return {'syntheticGrantRefreshRLS':rls,'syntheticDeleted':True,'magicLinkRLS':magic_rls,'recoveryRLS':recovery_rls,
        'oldSessionsRevoked':True,'oldRefreshDenied':True,'sourceCooldownHonoured':True,'sinkMessages':2,'originalPasswordAttempts':0}


def signup_case(stack):
    seen=set();email='qa+signup@invalid.test';password=secrets.token_urlsafe(48)
    status,body,_=stack.observe('/auth/v1/signup',{'email':email,'password':password})
    if status!=200:raise RecoveryError('P7SignupFailed')
    initial=json.loads(body)
    if initial.get('access_token'):raise RecoveryError('P7UnconfirmedSignupGotSession_Abort')
    confirmed=stack.consume('signup',email,seen);user_id=confirmed.get('user',{}).get('id')
    stack.session(confirmed,user_id)
    status,body,_=stack.login(email,password);password=None
    if status!=200:raise RecoveryError('P7ConfirmedSignupPasswordLoginFailed')
    _,headers=stack.refresh(json.loads(body),user_id);rls=stack.rls(user_id,headers,create_fixture=True)
    invited_email='qa+invite@invalid.test'
    status,_,_=stack.observe('/auth/v1/invite',{'email':invited_email},bearer=stack.values['SERVICE_ROLE_KEY'])
    if status not in (200,201):raise RecoveryError('P7InviteRequestFailed')
    invited=stack.consume('invite',invited_email,seen);stack.session(invited,invited.get('user',{}).get('id'))
    if len(stack.messages())!=2:raise RecoveryError('P7UnexpectedMailCount_Abort')
    return {'signupRequiresConfirmation':True,'confirmationExchanged':True,'passwordLogin':True,'sessionRefresh':True,
        'signupRLS':rls,'inviteExchanged':True,'sinkMessages':2}


def email_case(stack):
    email='qa+emailchange@invalid.test';changed='qa+changed@invalid.test'
    user_id,password,reply,headers,rls=create_user(stack,email);seen=set()
    status,_,_=stack.observe('/auth/v1/user',{'email':changed},bearer=reply['access_token'],method='PUT')
    if status!=200:raise RecoveryError('P7EmailChangeRequestFailed')
    stack.consume('email_change',email,seen)
    current=json.loads(stack.raw('/auth/v1/user',headers=headers)[1])
    if current.get('email')!=email:raise RecoveryError('P7SecureEmailChangedBeforeBothConfirmations_Abort')
    stack.consume('email_change',changed,seen)
    status,body,_=stack.login(changed,password);password=None
    if status!=200:raise RecoveryError('P7ChangedEmailPasswordLoginFailed')
    _,headers=stack.refresh(json.loads(body),user_id);verified=json.loads(stack.raw('/auth/v1/user',headers=headers)[1])
    if verified.get('email')!=changed:raise RecoveryError('P7ChangedIdentityMismatch_Abort')
    if len(stack.messages())!=2:raise RecoveryError('P7UnexpectedMailCount_Abort')
    return {'initialRLS':rls,'bothEmailConfirmationsRequired':True,'changedEmailLoginRefresh':True,
        'changedEmailRLS':stack.rls(user_id,headers),'sinkMessages':2}


def run(data,runtime,handoff):
    profile.validate(handoff);scoped=scoped_runtime(data,runtime)
    attempt=data['p7AuthAttempt']
    if attempt not in (1,2):raise RecoveryError('BoundedP7AttemptRequired')
    p4=dict(data['p4'])|{'p7AuthAttempt':attempt}
    result={'status':'FAIL','phaseComplete':False,'sourceWrites':0,'realPasswordAttempts':0,'realEmailRequests':0,
        'cases':{},'providerProof':'DEFERRED_NO_GOOGLE_CHANGES','nativeAttempt':attempt}
    for case,action in (('mail',lambda s,r:mail_case(s,r,handoff)),('signup',lambda s,r:signup_case(s)),('email',lambda s,r:email_case(s))):
        recovery=Recovery(p4,scoped);pristine=recovery.database
        store=recovery.store();stage=store.stage('13-p7-auth-'+str(attempt)+'-'+case);stack=None;target=None
        observed={'status':'FAIL','case':case,'realEmailRequests':0,'originalPasswordAttempts':0}
        store.put(stage,'intent.json',json.dumps({'case':case,'disposableOnly':True,'smtpSink':True,'sourceConfigSHA256':handoff['source_sha256'],'g3SupplementSHA256':handoff['supplement_sha256']}).encode())
        try:
            pristine,target=owned_clone(recovery,stage,case)
            before=recovery.check_database();store.put(stage,'clone-before.json',json.dumps(before).encode())
            if before['status']!='PASS':raise RecoveryError('P7CloneFidelityMismatch_Abort')
            observed['queueCloneDenials']=queue_clone_denials(recovery,target)
            stack=SourceStack(recovery,stage,handoff,data['build']['image']);stack.start()
            observed.update(controls=gateway_controls(stack),sourceProfile=stack.projection,checks=action(stack,recovery),status='PASS')
        except Exception as error:observed['code']=str(error) if type(error)in(RecoveryError,profile.ProfileError) else type(error).__name__
        finally:
            try:
                if stack:
                    stack.stop();observed.update(runtime=stack.record(),diagnostics=stack.diagnostics,disposableContainersRemoved=stack.destroy())
                if target:observed['disposableDatabaseDestroyed']=destroy_clone(recovery,target,stage,pristine)
            except Exception as error:observed.update(status='FAIL',cleanupCode=str(error) if type(error)is RecoveryError else type(error).__name__)
        recovery.database=pristine
        result['cases'][case]=recovery.seal(store,stage,observed)
        if observed['status']!='PASS' or observed.get('disposableDatabaseDestroyed')is not True:break
    result['fullContainment']=containment(data,runtime,probe_container='ir35-p6-mock-worker-v7-fixedip')
    if len(result['cases'])==3 and all(v['status']=='PASS' for v in result['cases'].values()) and result['fullContainment']['status']=='PASS':
        result['status']='PASS';result['emailAuthRehearsalComplete']=True
    return result
