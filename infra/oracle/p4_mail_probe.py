"""Owner-approved disposable Auth recovery; no original password or real mail."""
from datetime import datetime,timezone
from html import unescape
from html.parser import HTMLParser
import json
import re
import secrets
import time
from urllib.parse import urlsplit,parse_qs
from p4_auth_probe import PrivateStack,Recovery,RecoveryError,fixture,require_synthetic

EMAIL='anvesh.mannuru+ir35test@gmail.com'
AUTH_HASH_SQL="SELECT coalesce(jsonb_agg(jsonb_build_object('idHash',md5(id::text),'passwordMD5',md5(encrypted_password)) ORDER BY id),'[]') FROM auth.users;"
ACCOUNT_SQL="""SELECT jsonb_build_object('userMD5',md5(to_jsonb(u)::text),'identityMD5',
 (SELECT md5(coalesce(jsonb_agg(to_jsonb(i) ORDER BY i.id),'[]')::text) FROM auth.identities i WHERE i.user_id=u.id),
 'identityCount',(SELECT count(*) FROM auth.identities i WHERE i.user_id=u.id))
 FROM auth.users u WHERE lower(email)='anvesh.mannuru+ir35test@gmail.com';"""


class Anchors(HTMLParser):
    def __init__(self):super().__init__();self.links=[]
    def handle_starttag(self,tag,attrs):
        if tag=='a':self.links.extend(v for k,v in attrs if k=='href' and isinstance(v,str))


def sink_token(message,expected_type):
    """Parse only this fresh sink's named-account link; NEVER follow its URL."""
    if [row.get('Address') for row in message.get('To',[])]!=[EMAIL]:raise RecoveryError('SinkRecipientMismatch_Abort')
    parser=Anchors();parser.feed(message.get('HTML',''));matches=[]
    for link in parser.links:
        url=urlsplit(unescape(link));query=parse_qs(url.query)
        if url.scheme=='https' and url.hostname=='api-staging.ir35careers.com' and url.port in (None,443) and not url.username and not url.password and url.path=='/auth/v1/verify' and query.get('type')==[expected_type]:
            values=query.get('token',[])
            # Pinned GoTrue v2.197.0 GenerateTokenHash uses SHA-224, not SHA-256.
            if len(values)==1 and re.fullmatch(r'[0-9a-f]{56}',values[0]):matches.append(values[0])
    if len(matches)!=1:raise RecoveryError('SinkVerificationLinkInvalid')
    return matches[0]


class MailStack(PrivateStack):
    def start(self):
        sink={'MP_DATABASE':'/tmp/mailpit.db','MP_MAX_MESSAGES':'10','MP_SMTP_BIND_ADDR':'0.0.0.0:1025','MP_UI_BIND_ADDR':'0.0.0.0:8025'}
        self.start_service('smtp',sink,['--read-only','--tmpfs','/tmp:rw,size=32m,uid=1002,gid=1002,mode=0700'])
        super().start()
        row=self.info('smtp')
        if not row['HostConfig']['ReadonlyRootfs'] or row['HostConfig']['LogConfig']['Type']!='none' or not row['HostConfig'].get('Tmpfs',{}).get('/tmp'):raise RecoveryError('SinkRAMOnlyCustodyRequired')
        if self.messages():raise RecoveryError('FreshEmptySinkRequired')

    def smtp_host(self):return self.info('smtp')['Name'].removeprefix('/')

    def messages(self):
        status,body,_=self.raw('/api/v1/messages',service='smtp',port=8025)
        if status!=200:raise RecoveryError('PrivateSinkReadFailed')
        result=json.loads(body)
        if not isinstance(result.get('messages'),list):raise RecoveryError('PrivateSinkShapeInvalid')
        return result['messages']

    def consume_link(self,expected_type,seen):
        deadline=time.monotonic()+30
        while time.monotonic()<deadline:
            fresh=[m for m in self.messages() if m.get('ID') not in seen]
            if fresh:
                if len(fresh)!=1:raise RecoveryError('UnexpectedSinkMessages_Abort')
                message_id=fresh[0].get('ID')
                if not isinstance(message_id,str) or not re.fullmatch(r'[A-Za-z0-9_-]{8,100}',message_id):raise RecoveryError('PrivateSinkIdentifierInvalid')
                status,body,_=self.raw('/api/v1/message/'+message_id,service='smtp',port=8025)
                if status!=200:raise RecoveryError('PrivateSinkMessageReadFailed')
                token=sink_token(json.loads(body),expected_type);seen.add(message_id)
                status,body,_=self.observe('/auth/v1/verify',{'token_hash':token,'type':expected_type});token=None
                if status!=200:raise RecoveryError('SinkLinkExchangeFailed')
                return json.loads(body)
            time.sleep(1)
        raise RecoveryError('SinkMailNotReceived')

    def destroy(self):
        self.stop();count=0
        for service in reversed(self.containers):
            if self.info(service)['State']['Status']!='exited':raise RecoveryError('StoppedFixtureRequiredForRemoval')
            self.runtime['run'](['docker','rm',self.containers[service]]);count+=1
        return count


def read_pair(recovery,pristine,target,sql):
    if target!=pristine+'_mail'+str(recovery.payload['mailAttempt']):raise RecoveryError('MailFixtureIdentityMismatch')
    saved=recovery.database;values=[]
    try:
        for database in (pristine,target):
            recovery.database=database;values.append(json.loads(recovery.query(sql)))
    finally:recovery.database=saved
    if values[0]!=values[1]:raise RecoveryError('AuthSnapshotParityMismatch_Abort')
    return values[0]


def drop_fixture(recovery,target,stage,pristine):
    expected=pristine+'_mail'+str(recovery.payload['mailAttempt'])
    if target!=expected or target==pristine or not re.fullmatch(r'ir35_p4_[0-9]{8}t[0-9]{6}z_[0-9a-f]{8}_mail[123]',target):raise RecoveryError('DisposableDropTargetRefused')
    owner='ir35-p4-mail:'+recovery.run_id+':'+stage.name
    row=recovery.query("SELECT coalesce(shobj_description(oid,'pg_database'),'') FROM pg_database WHERE datname='"+target+"';",'postgres').strip()
    if row!=owner:raise RecoveryError('DisposableDropOwnershipMismatch')
    count=recovery.query("SELECT count(*) FROM pg_stat_activity WHERE datname='"+target+"';",'postgres').strip()
    if count!='0':raise RecoveryError('DisposableDropHasActiveConnections')
    recovery.command(recovery.base+['psql','-XqAt','-v','ON_ERROR_STOP=1','-U','supabase_admin','-d','postgres','-f','-'],input=('DROP DATABASE '+target+';').encode())
    if recovery.query("SELECT count(*) FROM pg_database WHERE datname='"+target+"';",'postgres').strip()!='0':raise RecoveryError('DisposableDropReadbackFailed')
    return True


def run(operation,payload,runtime):
    recovery=Recovery(payload,runtime);require_synthetic(recovery)
    if operation not in ('mail-1','mail-2','mail-3'):raise RecoveryError('MailOperationRefused')
    attempt=int(operation[-1]);payload['mailAttempt']=attempt
    if attempt>1:
        prior='11-mail-'+str(attempt-1)
        if prior not in payload['anchors']:raise RecoveryError('PriorMailFailureRequired')
        failed=json.loads((recovery.run_root/prior/'result.json').read_bytes())
        diagnosed_rate_limit=(failed.get('code')=='RecoveryRequestFailed' and any(d.get('path')=='/auth/v1/recover' and d.get('response',{}).get('status')==429 and d.get('response',{}).get('error_code')=='over_email_send_rate_limit' for d in failed.get('diagnostics',[])))
        eligible=failed.get('code') in ('PrivateSinkReadFailed','PrivateSinkShapeInvalid','SinkVerificationLinkInvalid','SinkMailNotReceived','SinkLinkExchangeFailed','NativeCommandFailed_docker','PrivateGatewayReadinessFailed')
        if failed.get('status')!='FAIL' or failed.get('pristineDatabaseUnchanged') is not True or failed.get('disposableDatabaseDestroyed') is not True or not (diagnosed_rate_limit or eligible):raise RecoveryError('MailRepairNotAuthorized')
    store=recovery.store();stage=store.stage('11-mail-'+str(attempt));pristine=recovery.database
    target=pristine+'_mail'+str(attempt);stack=None;created=False
    result={'status':'FAIL','attempt':attempt,'sourceWrites':0,'realPasswordAttempts':0,'realMailboxRequests':0,'phaseComplete':False,
      'startedUTC':datetime.now(timezone.utc).isoformat()}
    store.put(stage,'intent.json',json.dumps({'authorization':'owner-revised-P4-sink-recovery-only','pristine':pristine,'disposable':target,'destroyAfterwards':True,'realPasswordAttempts':0}).encode())
    try:
        before=recovery.check_database();store.put(stage,'pristine-before.json',json.dumps(before).encode())
        if before['status']!='PASS':raise RecoveryError('PristineDataMismatch_Abort')
        fixture(recovery,'_mail'+str(attempt));created=True
        annotation='ir35-p4-mail:'+recovery.run_id+':'+stage.name
        recovery.query('COMMENT ON DATABASE '+target+' IS '+recovery.verifiers['literal'](annotation)+';','postgres',readonly=False)
        stack=MailStack(recovery,stage);stack.start()
        clone=recovery.check_database();store.put(stage,'clone-before-auth.json',json.dumps(clone).encode())
        if clone['status']!='PASS':raise RecoveryError('MailCloneDataMismatch_Abort')
        hashes=read_pair(recovery,pristine,target,AUTH_HASH_SQL);account=read_pair(recovery,pristine,target,ACCOUNT_SQL)
        if not isinstance(account,dict) or account.get('identityCount',0)<1:raise RecoveryError('NamedIdentityMissing_Abort')
        result['authParity']={'usersChecked':len(hashes),'everyPasswordMD5Matches':True,'namedUserAllFieldsMatch':True,
          'namedIdentityAllFieldsMatch':True,'identityCount':account['identityCount'],'hashValuesPrinted':False,
          'sourceBinding':'verified snapshot whole-row fingerprints plus identical Auth projections on fresh clone'}
        hashes=None;account=None
        ids=json.loads(recovery.query("SELECT jsonb_agg(id::text) FROM auth.users WHERE lower(email)='"+EMAIL+"';"))
        if not isinstance(ids,list) or len(ids)!=1:raise RecoveryError('NamedIdentityMismatch_Abort')
        user_id=ids[0];seen=set()
        profile_count=int(recovery.query("SELECT count(*) FROM public.profiles WHERE id='"+user_id+"'::uuid;").strip())
        if profile_count<1:raise RecoveryError('PositiveOwnerRLSFixtureMissing')
        # Pinned GoTrue's default is 1m and magic/recovery SHARE this timer.
        # Respect it; do not weaken config, edit RecoverySentAt or retry a 429.
        sent_at=time.monotonic()
        status,_,_=stack.observe('/auth/v1/otp',{'email':EMAIL,'create_user':False})
        if status!=200:raise RecoveryError('MagicLinkRequestFailed')
        old=stack.consume_link('magiclink',seen);old_headers=stack.session(old,user_id)
        result['magicLink']={'requestAccepted':True,'sinkLinkExchanged':True,'sessionUserVerified':True,'rls':stack.rls(user_id,old_headers)}
        if result['magicLink']['rls']['ownerRows']!=profile_count:raise RecoveryError('MagicOwnerRLSMismatch_Abort')
        while time.monotonic()-sent_at<65:time.sleep(min(5,65-(time.monotonic()-sent_at)))
        result['sharedEmailCooldownRespected']=True
        status,_,_=stack.observe('/auth/v1/recover',{'email':EMAIL})
        if status!=200:raise RecoveryError('RecoveryRequestFailed')
        recovered=stack.consume_link('recovery',seen);recovery_headers=stack.session(recovered,user_id)
        claims=json.loads(__import__('base64').urlsafe_b64decode(recovered['access_token'].split('.')[1]+'=='))
        recovery_session=claims.get('session_id')
        if not re.fullmatch(r'[0-9a-f-]{36}',recovery_session or ''):raise RecoveryError('RecoverySessionIdentityMissing')
        prior_ids=json.loads(recovery.query("SELECT coalesce(jsonb_agg(id::text ORDER BY id),'[]') FROM auth.sessions WHERE user_id='"+user_id+"'::uuid AND id<>'"+recovery_session+"'::uuid;"))
        if not prior_ids:raise RecoveryError('OldSessionControlMissing')
        password=secrets.token_urlsafe(48)
        status,_,_=stack.observe('/auth/v1/user',{'password':password},bearer=recovered['access_token'],method='PUT')
        if status!=200:raise RecoveryError('RecoveryPasswordUpdateFailed')
        remaining=json.loads(recovery.query("SELECT coalesce(jsonb_agg(id::text ORDER BY id),'[]') FROM auth.sessions WHERE user_id='"+user_id+"'::uuid;"))
        if remaining!=[recovery_session]:raise RecoveryError('OldSessionsNotRevoked_Abort')
        status,_,_=stack.observe('/auth/v1/token?grant_type=refresh_token',{'refresh_token':old['refresh_token']})
        if status not in (400,401):raise RecoveryError('OldRefreshStillAccepted_Abort')
        result['sessionRevocation']={'priorSessionCount':len(prior_ids),'priorSessionRowsRemoved':True,'oldRefreshDenied':True,
          'currentRecoverySessionRetained':True,'contract':'pinned GoTrue User.UpdatePassword -> LogoutAllExceptMe; existing stateless access JWTs expire by TTL'}
        status,body,_=stack.login(EMAIL,password);password=None
        if status!=200:raise RecoveryError('GeneratedRecoveryPasswordLoginFailed')
        reply=json.loads(body);stack.session(reply,user_id);new,headers=stack.refresh(reply,user_id)
        result['recovery']={'requestAccepted':True,'sinkLinkExchanged':True,'newRandomPasswordRAMOnly':True,'passwordLogin':True,
          'sessionRefresh':True,'sessionUserVerified':True,'rls':stack.rls(user_id,headers),'originalPasswordUsed':False}
        if result['recovery']['rls']['ownerRows']!=profile_count:raise RecoveryError('RecoveryOwnerRLSMismatch_Abort')
        for session_headers in (headers,recovery_headers):
            status,_,_=stack.raw('/auth/v1/logout?scope=local',body={},headers=session_headers)
            if status not in (200,204):raise RecoveryError('RecoveryLogoutFailed')
        if len(stack.messages())!=2:raise RecoveryError('UnexpectedSinkMessages_Abort')
        result.update(status='PASS',sinkMessages=2,sinkRAMOnly=True,sinkOutboundNetworkBlocked=True)
    except Exception as error:result.update(status='FAIL',code=str(error) if isinstance(error,RecoveryError) else type(error).__name__)
    finally:
        try:
            if stack:
                stack.stop();result.update(runtime=stack.record(),diagnostics=stack.diagnostics,containersStopped=True)
                result['disposableContainersRemoved']=stack.destroy()
            if created:result['disposableDatabaseDestroyed']=drop_fixture(recovery,target,stage,pristine)
        except Exception as error:result.update(status='FAIL',cleanupCode=str(error) if isinstance(error,RecoveryError) else type(error).__name__)
    recovery.database=pristine;after=recovery.check_database();store.put(stage,'pristine-after.json',json.dumps(after).encode())
    result['pristineDatabaseUnchanged']=after['status']=='PASS'
    if after['status']!='PASS':result.update(status='FAIL',code='PristineDataMismatch_Abort')
    if result.get('disposableDatabaseDestroyed') is not True:result.update(status='FAIL',code='DisposableCleanupIncomplete')
    result['endedUTC']=datetime.now(timezone.utc).isoformat()
    return recovery.seal(store,stage,result)
