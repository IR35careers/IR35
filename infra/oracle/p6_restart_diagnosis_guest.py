"""Read-only worker/routing/ledger evidence, never a fourth P6 attempt."""
from datetime import datetime,timezone
import base64
import hashlib
import ipaddress
import json
from pathlib import Path
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request

from immutable_artifacts import digest
from p4_recovery_guest import Recovery
from p6_audit_log import AuditFailure,command_kind,stderr_category
from p6_containment import fidelity
from p6_mock_guest import ROOT,prepared,validate_config
from p6_mock_control import Control,NoRedirect
from p6_queue_boundary_gate import anchored_result,verify_live
from p6_queue_function_scope import audit as function_scope
from p6_schedule_repair_guest import retained
from p6_health_repair_guest import SYSTEMD,FINAL_UNIT,FINAL_ROLLBACK_UNIT
from sdk_owner1_guest import tls_request
from web_edge_guest import private_env

FAILED='ir35-p6-mock-worker-v6'
ROLLBACK='ir35-p6-mock-worker-v6-rollback'
SCENARIOS={'success','server_error','timeout','lost_ack','captcha','unknown_answer'}
KONG_SHA256='2dcdd388cee9887bff8952702276d986e3cb43592ae00851ca9a654a5128e1d8'
KONG_UPSTREAMS={'auth-v1':'http://ir35-p5-auth:9999/','rest-v1':'http://ir35-p5-rest:3000/',
    'auth-open-verify':'http://ir35-p5-auth:9999/verify','auth-open-callback':'http://ir35-p5-auth:9999/callback',
    'auth-open-authorize':'http://ir35-p5-auth:9999/authorize',
    'auth-open-.well-known-jwks.json':'http://ir35-p5-auth:9999/.well-known/jwks.json',
    'storage-v1':'http://ir35-p5-storage:5000/'}
PROPERTIES=('ActiveState','SubState','Result','NRestarts','ExecMainStatus','ExecMainCode','ExecMainStartTimestamp',
            'ExecMainExitTimestamp','MainPID','FragmentPath','User','Group','MemoryCurrent','MemoryPeak','MemoryMax','DropInPaths','ExecStart')
BRIDGE_PROBE="""import pg from 'pg';import fs from 'node:fs';
const v=JSON.parse(fs.readFileSync(0,'utf8'));
const c=new pg.Client({host:'db',port:5432,user:v.role,password:v.password,database:v.database,ssl:false,connectionTimeoutMillis:5000,query_timeout:5000,options:'-c default_transaction_read_only=on'});
let r={connected:false,explicitHBAReject:false};
try{await c.connect();const q=await c.query('SELECT current_user AS role,current_database() AS database');r={connected:q.rows[0].role===v.role&&q.rows[0].database===v.database,explicitHBAReject:false};}
catch(e){r={connected:false,explicitHBAReject:e.code==='28000'&&String(e.message).includes('pg_hba.conf rejects connection')};}
finally{await c.end().catch(()=>{});}
console.log(JSON.stringify(r));"""


class ReadOnlyTrace:
    def __init__(self,native,databases=()):self.native=native;self.observations=[];self.databases=set(databases)
    def __call__(self,arguments,*args,**kwargs):
        try:operation=read_command(arguments,kwargs.get('input'),self.databases)
        except AuditFailure as error:
            self.observations.append({'operation':'rejected-before-execution','status':'FAIL','code':str(error)})
            raise
        observation={'operation':operation,'status':'STARTED'};self.observations.append(observation)
        try:reply=self.native(arguments,*args,**kwargs)
        except Exception as error:
            observation.update(status='FAIL',exceptionType=type(error).__name__);raise
        observation.update(status='OBSERVED',exitCode=reply.returncode)
        if reply.returncode:
            body=reply.stderr or b'';body=body.encode() if isinstance(body,str) else body
            observation.update(stderrSHA256=digest(body),stderrCategory=stderr_category(body))
        return reply


def read_command(arguments,supplied_input=None,databases=()):
    args=list(arguments) if isinstance(arguments,(tuple,list)) else []
    if args[:2]==['systemctl','show'] and len(args)>3:
        if args[2] in tuple(unit+suffix for unit in (FINAL_UNIT,FINAL_ROLLBACK_UNIT) for suffix in ('.service','.socket')) and all(
                arg in tuple('--property='+name for name in PROPERTIES) for arg in args[3:]):return 'systemd-proxy-properties'
    if args==['ss','-H','-ltn','sport = :8787']:return 'loopback-listener'
    if args[:2]==['docker','events']:
        if (len(args)==12 and args[2:4]==['--filter','type=container'] and args[4]=='--filter'
                and args[5] in ('container='+FAILED,'container='+ROLLBACK)
                and args[6]=='--since' and args[8]=='--until' and args[10:]==['--format','{{json .}}']):
            try:start,end=float(args[7]),float(args[9])
            except (TypeError,ValueError):raise AuditFailure('BoundedPastDockerEventsRequired') from None
            if 0<start<=end<=time.time()+1 and end-start<=3600:return 'bounded-container-events'
        raise AuditFailure('BoundedPastDockerEventsRequired')
    if args[:6]==['docker','exec','-i','--user','1002:1002',ROLLBACK] and args[6:]==['node','--input-type=module','-e',BRIDGE_PROBE]:
        try:value=json.loads(supplied_input)
        except (TypeError,ValueError):raise AuditFailure('PrivateReadOnlyLoginInputRequired') from None
        if (set(value)=={'role','database','password'} and value['role'] in ('ir35_queue','ir35_queue_producer')
                and value['database'] in databases and re.fullmatch(r'[a-f0-9]{64}',value['password'])):
            return 'private-bridge-read-only-login'
        raise AuditFailure('PrivateReadOnlyLoginInputRequired')
    if args[:6]==['docker','exec','-i','--user','1002:1002','ir35-staging-db-1']:
        shell='IFS= read -r PGPASSWORD; export PGPASSWORD PGSSLMODE=disable PGCONNECT_TIMEOUT=5; exec "$@"'
        if (len(args)==27 and args[6:11]==['/bin/sh','-c',shell,'ir35-hba-probe','psql']
                and args[11:17]==['-w','-XqAt','-v','ON_ERROR_STOP=1','-v','VERBOSITY=sqlstate']
                and args[17]=='-U' and args[18] in ('ir35_queue','ir35_queue_producer')
                and args[19]=='-d' and args[20] in databases and args[21:25]==['-p','5432','-c','SELECT current_user || chr(124) || current_database();']
                and args[25]=='-h' and args[26] in ('/var/run/postgresql','127.0.0.1','::1')):
            return 'private-socket-read-only-login'
        # Exact argv length is checked independently in offline regression tests.
        raise AuditFailure('FixedReadOnlySocketLoginRequired')
    return command_kind(args,supplied_input)


def history(data):
    store,expected,intents=retained(data)
    final=data['finalFailure'];original={k:v for k,v in final.items() if k!='imageRollback'}
    anchored_result(store,{k:v for k,v in data['resumeFailure'].items() if k!='imageRollback'})
    anchored_result(store,data['resumeFailure']['imageRollback'])
    anchored_result(store,data['finalHandover'])
    anchored_result(store,original);anchored_result(store,final['imageRollback'])
    if (final.get('code')!='NativeMockRestartHealthDeadline' or final.get('resumedLifecycleAttempt')!=3
            or final.get('repairAttempt')!=2 or final.get('workerRestarts')!=1 or final['imageRollback'].get('status')!='PASS'
            or len(final.get('cases',[]))!=70 or not all(row.get('passed') is True for row in final['cases'])):
        raise RuntimeError('ExactSeventyCaseThirdRestartFailureRequired')
    manifest=store.verify(final['stage'],final['manifestSHA256']);new={};publications=[];schedule_intents=[];restart=[]
    for item in manifest['artifacts']:
        name=item['name']
        if not name.endswith('.json'):continue
        row=json.loads((store.root/final['stage']/name).read_bytes())
        if re.fullmatch(r'[0-9]{3}-(?:terminal-(?:success|server_error|timeout|lost_ack|captcha|unknown_answer)|concurrent-terminal|queued-cancel|active-cancel|orphan-watchdog)\.json',name):
            if row.get('state') not in ('submitted','failed') or row['applicationId'] in new or row['applicationId'] in expected:
                raise RuntimeError('UnexpectedRetainedFinalReceipt_HardStop')
            new[row['applicationId']]=row
        if re.fullmatch(r'[0-9]{3}-schedule-intent\.json',name):schedule_intents.append(row)
        if re.fullmatch(r'[0-9]{3}-restart-intent\.json',name):
            restart.append({'artifact':name,'value':row,'artifactModifiedUTC':datetime.fromtimestamp((store.root/final['stage']/name).stat().st_mtime,timezone.utc).isoformat()})
    if len(new)!=11 or len(restart)!=1 or [r.get('operation') for r in schedule_intents]!=['mock_ingest','mock_automation','watchdog']:
        raise RuntimeError('FullFinalReceiptScheduleAndRestartIntentRequired')
    return store,expected|new,intents[:1]+schedule_intents,restart[0]


def projected_container(item):
    state=item['State'];host=item['HostConfig']
    return {'container':item['Name'].lstrip('/'),'image':item['Image'],'Created':item['Created'],
        **{key:state.get(key) for key in ('Status','Running','Paused','Restarting','StartedAt','FinishedAt','ExitCode','OOMKilled','Dead')},
        'RestartCount':item['RestartCount'],'restartPolicy':host['RestartPolicy']['Name'],
        'healthStatus':state.get('Health',{}).get('Status'),'errorPresent':bool(state.get('Error')),
        'healthObservations':[{'Start':row.get('Start'),'End':row.get('End'),'ExitCode':row.get('ExitCode'),
            'outputSHA256':digest(row.get('Output','').encode()),'outputEmpty':not row.get('Output','').strip()}
            for row in state.get('Health',{}).get('Log',[])],
        'privateAddresses':{name:values.get('IPAddress') for name,values in item['NetworkSettings']['Networks'].items()}}


def projected_events(raw):
    if len(raw)>2_000_000:raise RuntimeError('BoundedDockerEventResponseRequired')
    rows=[]
    for line in raw.splitlines():
        if not line.strip():continue
        event=json.loads(line);attributes=event.get('Actor',{}).get('Attributes',{})
        action=event.get('Action',event.get('status'))
        if action not in ('start','restart','stop','die','kill','oom','health_status: healthy','health_status: unhealthy'):continue
        rows.append({'action':action,'time':event.get('time'),'timeNano':event.get('timeNano'),
            'container':attributes.get('name') if attributes.get('name') in (FAILED,ROLLBACK) else 'redacted',
            'exitCode':attributes.get('exitCode'),'signal':attributes.get('signal')})
    return rows


def worker_state(data,runtime):
    _,_,_,restart=history(data)
    items=json.loads(runtime['run'](['docker','inspect',FAILED,ROLLBACK]))
    observed=[projected_container(item) for item in items]
    if items[0]['Image']!=data['finalBuild']['image'] or items[1]['Image']!=data['finalFailure']['imageRollback']['image']:
        raise RuntimeError('DiagnosedContainerImageMismatch_HardStop')
    start=datetime.fromisoformat(restart['artifactModifiedUTC']).timestamp()-60
    end=min(time.time(),start+3600)
    events=[]
    for name in (FAILED,ROLLBACK):
        args=['docker','events','--filter','type=container','--filter','container='+name,'--since',str(start),'--until',str(end),'--format','{{json .}}']
        reply=subprocess.run(args,capture_output=True,timeout=15)
        events.append({'container':name,'commandExitCode':reply.returncode,'events':projected_events(reply.stdout.decode()) if reply.returncode==0 else [],
            'historyMayBeTruncated':True,'dockerMaximumRetainedEvents':256})
    return {'status':'PASS','containers':observed,'restartIntent':restart,'dockerEvents':events,
        'triggerEvidence':'The sealed lifecycle records an explicit docker restart test step and workerRestarts=1, before the separate rollback deployment.',
        'currentExitCodeIsAfterRollbackStop':True,'historicalOOMExcludedByMissingEvents':False}


def private_health(address):
    ip=ipaddress.ip_address(address)
    if ip.version!=4 or not any(ip in ipaddress.ip_network(net) for net in ('127.0.0.0/8','10.0.0.0/8','172.16.0.0/12','192.168.0.0/16')):
        raise RuntimeError('PrivateHealthTargetRequired')
    opener=urllib.request.build_opener(urllib.request.ProxyHandler({}),NoRedirect())
    try:
        with opener.open('http://'+address+':8787/health',timeout=5) as reply:
            value=json.loads(reply.read(16385));code=reply.status
        return {'status':code,**{k:value.get(k) for k in ('ok','browserReady','databaseReady','mode','realAcceptance','paused','active','buildSHA')}}
    except (OSError,ValueError,urllib.error.URLError):return {'status':'unavailable','rawErrorWithheld':True}


def sealed_kong_routes(body):
    if digest(body)!=KONG_SHA256:raise RuntimeError('SealedP5KongConfigurationMismatch_HardStop')
    services=json.loads(body)['services']
    if len(services)!=len(KONG_UPSTREAMS) or {row['name']:row.get('url') for row in services}!=KONG_UPSTREAMS:
        raise RuntimeError('ExactSealedP5KongUpstreamsRequired_HardStop')
    return [{'name':row['name'],'upstream':row['url'],'paths':[path for route in row.get('routes',[]) for path in route.get('paths',[])]}
        for row in services]


def proxy_routing(data,runtime):
    store,_,_,_=history(data)
    units=[]
    for unit,proof in ((FINAL_UNIT,data['finalHandover']),(FINAL_ROLLBACK_UNIT,data['finalFailure']['imageRollback'])):
        native=store.verify(proof['stage'],proof['manifestSHA256'])
        expected={row['name']:row['sha256'] for row in native['artifacts']}
        for suffix in ('.socket','.service'):
            path=SYSTEMD/(unit+suffix)
            if path.is_symlink() or digest(path.read_bytes())!=expected.get(path.name):
                raise RuntimeError('SealedProxyFileMismatch_HardStop')
        body=(SYSTEMD/(unit+'.service')).read_text()
        targets=re.findall(r'^ExecStart=/usr/lib/systemd/systemd-socket-proxyd --connections-max=32 ([0-9.]+):8787$',body,re.M)
        if len(targets)!=1:raise RuntimeError('FixedPrivateProxyTargetRequired')
        observed={}
        for suffix in ('.socket','.service'):
            result=runtime['run'](['systemctl','show',unit+suffix,*['--property='+p for p in PROPERTIES]])
            values=dict(line.split('=',1) for line in result.splitlines() if '=' in line)
            memory_targets=re.findall(r'--connections-max=32 ([0-9.]+):8787',values.pop('ExecStart',''))
            values['loadedUpstream']=memory_targets[0]+':8787' if len(memory_targets)==1 else None
            observed[suffix[1:]]=values
        units.append({'unit':unit,'configuredUpstream':targets[0]+':8787','properties':observed,'sealedFilesMatch':True})
    listener=runtime['run'](['ss','-H','-ltn','sport = :8787'])
    if not listener.strip() or any(line.split()[3]!='127.0.0.1:8787' for line in listener.splitlines() if line.strip()):
        raise RuntimeError('HealthListenerBoundaryMismatch_HardStop')
    rollback=json.loads(runtime['run'](['docker','inspect',ROLLBACK]))[0]
    address=rollback['NetworkSettings']['Networks']['ir35-staging_backend']['IPAddress']
    current=Control(private_env(ROOT/'.env.p6-mock-control')['APPLICATION_WORKER_SECRET']).request('GET','/health')[1]
    direct=private_health(address)
    caddy=json.loads(runtime['run'](['docker','inspect','ir35-staging-caddy-1']))[0]
    config=ROOT/'config/p5-Caddyfile-sdk-owner1'
    expected=data['sdkEdge']['preparation']['files'][str(config)]
    if (digest(config.read_bytes())!=expected or not any(row.get('Source')==str(config) and row.get('RW') is False for row in caddy['Mounts'])):
        raise RuntimeError('CaddyActiveConfigurationMismatch_HardStop')
    text=config.read_text()
    proxy_targets=re.findall(r'\breverse_proxy(?:\s+@api)?\s+([^\s{]+)',text)
    if set(proxy_targets)!={'ir35-p5-web:3000','ir35-p5-kong:8000'}:
        raise RuntimeError('UnexpectedStagingProxyTarget_HardStop')
    backends=sealed_kong_routes((ROOT/'.env.p5-kong-config').read_bytes())
    values=runtime['read_env']();gate=private_env(ROOT/'.env.p5-caddy')['STAGING_GATE_TOKEN']
    basic='Basic '+base64.b64encode(('ir35:'+values['STAGING_BASIC_PASSWORD']).encode()).decode()
    auth={'apikey':values['ANON_KEY'],'Authorization':'Bearer '+values['ANON_KEY']}
    routes=[]
    requests=[('staging.ir35careers.com','/jobs',{'Authorization':basic},'page-proxy',200),
              ('staging.ir35careers.com','/api/health',{'Authorization':basic},'page-proxy',503),
              ('staging.ir35careers.com','/supabase/auth/v1/health',auth|{'Cookie':'__Host-ir35-staging='+gate},'sdk-proxy',200),
              ('api-staging.ir35careers.com','/auth/v1/health',auth|{'X-Staging-Authorization':basic},'api-proxy',200)]
    for host,path,headers,branch,expected_status in requests:
        code,response,_=tls_request(host,'GET',path,headers)
        routes.append({'host':host,'path':path,'status':code,'expectedStatus':expected_status,
            'matchedRoute':response.get('x-ir35-matched-route'),'expectedRoute':branch,'caddyRequestID':response.get('x-caddy-request-id'),
            'matchesP5Reference':code==expected_status and response.get('x-ir35-matched-route')==branch})
    checks={'currentProxyTargetsRollback':units[1]['configuredUpstream']==address+':8787',
            'localhostAndDirectHealthMatch':all(current.get(k)==direct.get(k) for k in ('ok','buildSHA','paused','active')),
            'rollbackHealthyPausedMock':current.get('ok') is True and current.get('paused') is True and current.get('active')==0 and current.get('realAcceptance') is False,
            'rollbackBuildMatches':current.get('buildSHA')==data['rollbackBuild']['sourceSHA'],
            'protectedStagingRoutesMatchP5':all(row['matchesP5Reference'] for row in routes)}
    return {'status':'PASS' if all(checks.values()) else 'FAIL','checks':checks,'workerProxies':units,
        'rollbackDirectHealth':direct,'localhostHealth':current,'stagingHTTP':routes,'caddyConfigurationSHA256':expected,
        'stagingPageUpstream':'ir35-p5-web:3000','stagingSDKAndAPIUpstream':'ir35-p5-kong:8000','kongRoutes':backends,'kongConfigurationSHA256':KONG_SHA256,
        'P6AppRealtimeTimerIntegrationComplete':False,'requestSecretsOrCookiesLogged':False}


LEDGER_SQL="""SELECT jsonb_build_object(
 'applications',(SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY id),'[]') FROM pgboss.ir35_mock_application a),
 'jobs',(SELECT coalesce(jsonb_agg(to_jsonb(j) ORDER BY id),'[]') FROM pgboss.job j),
 'schedules',(SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY id),'[]') FROM pgboss.ir35_mock_schedule s),
 'heartbeat',(SELECT coalesce(jsonb_agg(to_jsonb(h) ORDER BY id),'[]') FROM pgboss.ir35_mock_heartbeat h));"""


def queue_ledger(data,runtime):
    store,expected,schedule_intents,_=history(data)
    data_rows=json.loads(Recovery(data['p4'],runtime).query(LEDGER_SQL,'postgres'))
    intent_by_id={};orphans=set()
    for proof in (data['failureLifecycle'],data['currentFailure'],data['scheduleFailure'],data['finalFailure']):
        native=store.verify(proof['stage'],proof['manifestSHA256'])
        for item in native['artifacts']:
            if not re.fullmatch(r'[0-9]{3}-(?:publication-intent|concurrent-intent|queued-cancel-intent|active-cancel-intent|orphan-queued-intent)\.json',item['name']):continue
            value=json.loads((store.root/proof['stage']/item['name']).read_bytes())
            if value['applicationId'] in intent_by_id:raise RuntimeError('DuplicateSealedApplicationIntent_HardStop')
            intent_by_id[value['applicationId']]=value
            if item['name'].endswith('-orphan-queued-intent.json'):orphans.add(value['applicationId'])
    checks={'all34SealedApplicationIntents':len(expected)==34 and set(expected)==set(intent_by_id),
        'exact34ApplicationIDs':len(data_rows['applications'])==34 and {r['id'] for r in data_rows['applications']}==set(expected),
        'allSealedReceiptsMatch':True,'allActorsNamedTestAccount':True,'exact32ApplyJobs':False,
        'exact4ScheduleJobs':False,'allJobPayloadsMatchOwnedIntents':True,'noRetries':True,'scheduleRowsAccountedFor':True}
    checks['heartbeatExpectedIdleSource']=(len(data_rows['heartbeat'])==1 and data_rows['heartbeat'][0]['id']=='staging_mock_worker'
        and data_rows['heartbeat'][0]['active']==0 and data_rows['heartbeat'][0]['build_sha']==data['rollbackBuild']['sourceSHA'])
    ledger=[]
    for row in data_rows['applications']:
        receipt={'applicationId':row['id'],'state':row['state'],'errorCode':row['error_code'],'receiptConfirmed':row['receipt_confirmed'],'updatedAt':row['updated_at'],'events':row['events']}
        checks['allSealedReceiptsMatch']=checks['allSealedReceiptsMatch'] and receipt==expected.get(row['id'])
        checks['allActorsNamedTestAccount']=checks['allActorsNamedTestAccount'] and row['actor_email']=='anvesh.mannuru+ir35test@gmail.com'
        ledger.append({'kind':'application','id':row['id'],'status':row['state'],'created_at':None,'requested_at':row['requested_at'],
            'updated_at':row['updated_at'],'attempts':sum(event['state']=='running' for event in row['events']),
            'attempts_source':'count of sealed running events','scenario':row['scenario'],'error_code':row['error_code'],'receipt_confirmed':row['receipt_confirmed']})
    apply=[];commands=[];remaining=list(schedule_intents)
    for row in data_rows['jobs']:
        kind=row['name'];value=row['data']
        if kind=='ir35-staging-mock-apply':
            apply.append(row['id'])
            checks['allJobPayloadsMatchOwnedIntents']=checks['allJobPayloadsMatchOwnedIntents'] and value==intent_by_id.get(row['id']) and row['id'] not in orphans
        elif kind=='ir35-staging-mock-schedule':
            commands.append(row)
            match=next((index for index,v in enumerate(remaining) if v==value),None)
            if match is None:checks['allJobPayloadsMatchOwnedIntents']=False
            else:remaining.pop(match)
            checks['allJobPayloadsMatchOwnedIntents']=checks['allJobPayloadsMatchOwnedIntents'] and row.get('singleton_key') in (None,value.get('operation'))
        else:checks['allJobPayloadsMatchOwnedIntents']=False
        retries=row.get('retry_count')
        checks['noRetries']=checks['noRetries'] and retries==0
        ledger.append({'kind':'queue_job','id':row['id'],'queue':kind,'status':row['state'],'created_at':row.get('created_on'),
            'started_at':row.get('started_on'),'completed_at':row.get('completed_on'),'retry_count':retries,
            'attempts':retries+1 if row.get('started_on') and type(retries)is int else 0,
            'attempts_source':'started_on present ? retry_count+1 :0','operation':value.get('operation'),'mock_payload_matches_sealed_intent':value in intent_by_id.values() or value in schedule_intents})
    checks['exact32ApplyJobs']=len(apply)==32 and set(apply)==set(expected)-orphans and len(orphans)==2
    checks['exact4ScheduleJobs']=len(commands)==4 and not remaining and len(data_rows['jobs'])==36
    command_by_id={row['id']:row for row in commands}
    for row in data_rows['schedules']:
        command=command_by_id.get(row['id'])
        checks['scheduleRowsAccountedFor']=checks['scheduleRowsAccountedFor'] and command is not None and row['operation']==command['data']['operation']
        ledger.append({'kind':'schedule_receipt','id':row['id'],'status':'completed','created_at':None,'completed_at':row['completed_at'],
            'attempts':None,'attempts_source':'not stored; corresponding queue_job has execution count','operation':row['operation']})
    checks['scheduleRowsAccountedFor']=checks['scheduleRowsAccountedFor'] and len(data_rows['schedules'])==4 and {r['id'] for r in data_rows['schedules']}==set(command_by_id)
    stable={key:value for key,value in data_rows.items() if key!='heartbeat'}
    return {'status':'PASS' if all(checks.values()) else 'FAIL','checks':checks,'rows':ledger,'rowCounts':{k:len(v) for k,v in data_rows.items()},
        'heartbeat':[{'id':r['id'],'seen_at':r['seen_at'],'build_sha':r['build_sha'],'active':r['active']} for r in data_rows['heartbeat']],
        'stableLedgerSHA256':digest(json.dumps(stable,sort_keys=True).encode()),'heartbeatExcludedFromStableHash':'Expected15second internal heartbeat, not application processing.',
        'timestampSources':{'application.created_at':'not stored; requested_at and updated_at shown without inventing a creation time',
            'queue_job.created_at':'pgboss.job.created_on','schedule_receipt.created_at':'not stored; completed_at shown'},
        'realEmployerDestinations':0 if checks['allJobPayloadsMatchOwnedIntents'] else None,'actorEmailsLogged':False}


def external_isolation(data,runtime):
    values=private_env(ROOT/'.env.p6-mock-worker');validate_config(values)
    network=json.loads(runtime['run'](['docker','inspect','--type','network','ir35-staging_backend']))[0]
    rows=json.loads(runtime['run'](['docker','inspect',FAILED,ROLLBACK]));reports=[]
    for row in rows:
        keys={value.split('=',1)[0].upper() for value in row['Config'].get('Env',[]) if '=' in value and value.split('=',1)[1]}|{key.upper() for key,value in values.items() if value}
        checks={'onlyInternalNetwork':network.get('Internal')is True and set(row['NetworkSettings']['Networks'])=={'ir35-staging_backend'},
            'noHostNetwork':row['HostConfig']['NetworkMode']!='host','noProxy':not(keys&{'HTTP_PROXY','HTTPS_PROXY','ALL_PROXY'}),
            'noDirectProviderCredentials':not any(re.match(r'^(?:SUPABASE|NEXT_PUBLIC|STRIPE|POSTMARK|RESEND|OPENAI|OPENROUTER|AWS_|GOOGLE_)',key) for key in keys),
            'noDockerSocket':not any(m['Destination'].endswith('docker.sock') for m in row['Mounts']),
            'readOnlyUnprivileged':row['HostConfig']['ReadonlyRootfs'] is True and not row['HostConfig']['Privileged']}
        reports.append({'container':row['Name'].lstrip('/'),'checks':checks})
    smtp=sys.modules['p6_pause_reconcile_guest'].run_case('smtp-sink',data,runtime)
    return {'status':'PASS' if all(all(r['checks'].values()) for r in reports) and smtp['status']=='PASS' else 'FAIL',
        'workers':reports,'smtp':smtp,'APPLY_RUNNER':values['APPLY_RUNNER'],'APPLICATION_WORKER_ACCEPT_JOBS':values['APPLICATION_WORKER_ACCEPT_JOBS'],
        'expectedInternalTraffic':['database heartbeat','empty-queue watchdog','read-only diagnostic probes'],
        'historicalPacketCaptureClaimed':False,'proofScope':'Exact sealed mock-only payloads and immutable mock program plus internal-only network/provider-free execution; no retrospective packet-capture claim.'}


def containment(data,runtime,*,probe_container=ROLLBACK):
    if probe_container not in (ROLLBACK,'ir35-p6-mock-worker-v7-fixedip','ir35-p6-mock-worker-v7-fixedip-rollback'):
        raise RuntimeError('FixedExistingOwnerWorkerProbeRequired')
    store,_,_,_=history(data);recovery=Recovery(data['p4'],runtime)
    scope=function_scope(recovery);boundary=verify_live(data,recovery,store,scope)
    summary,pristine,fixture=fidelity(data,runtime)
    result={'status':'PASS' if summary['status']=='PASS' and boundary['status']=='PASS' else 'FAIL',
        'containment':summary,'pg_hba':boundary,'pristine':pristine,'P5Fixture':fixture,'rawFunctionFindingRetained':scope['status'],'freshLoginChecks':[]}
    if result['status']!='PASS':return result
    from p6_hba_guest import INFO_SQL,actual_login
    information=json.loads(recovery.query(INFO_SQL,'postgres'))
    for role,suffix in (('ir35_queue','owner'),('ir35_queue_producer','producer')):
        credentials=private_env(ROOT/('.env.p6-queue-'+suffix))
        if credentials.get('PGUSER')!=role or credentials.get('PGDATABASE')!='postgres' or not re.fullmatch(r'[a-f0-9]{64}',credentials.get('PGPASSWORD','')):
            raise RuntimeError('ExistingReadOnlyQueueCredentialIdentityRequired')
        try:
            for database in information['databases']:
                if not database['allowConnections']:continue
                for transport in ('docker-tcp','local','ipv4-loopback','ipv6-loopback'):
                    if transport=='docker-tcp':
                        reply=subprocess.run(['docker','exec','-i','--user','1002:1002',probe_container,'node','--input-type=module','-e',BRIDGE_PROBE],
                            input=json.dumps({'role':role,'database':database['name'],'password':credentials['PGPASSWORD']}).encode(),capture_output=True,timeout=20)
                        if reply.returncode or len(reply.stdout)>4096:raise RuntimeError('ReadOnlyBridgeLoginProbeFailed_RawWithheld')
                        observed=json.loads(reply.stdout)
                        expected=database['name']=='postgres'
                        check={'role':role,'database':database['name'],'transport':transport,'connectedAsExpected':observed['connected'],
                            'explicitHBAReject':observed['explicitHBAReject'],'applicationFunctionCalled':False,
                            'passed':observed['connected'] if expected else observed['explicitHBAReject'] and not observed['connected']}
                    else:check=actual_login(role,database['name'],transport,credentials)
                    result['freshLoginChecks'].append(check)
                    if check.get('passed')is not True:
                        result.update(status='FAIL',code='FreshReadOnlyHBABoundaryMismatch_HardStop');return result
        finally:credentials.clear()
    if len(result['freshLoginChecks'])!=112:raise RuntimeError('ExactFresh112ReadOnlyLoginChecksRequired')
    result['freshReadOnlyHBAProof']={'status':'PASS','checks':112,'queueSuccesses':8,'applicationRejections':104,'functionCalls':0,
        'noContainerCreated':True,'noReloadRestartOrConfigWrite':True}
    return result


def run_case(name,data,runtime):
    if name=='sealed-history':
        _,receipts,_,restart=history(data)
        return {'status':'PASS','retainedReceiptsExpected':len(receipts),'restartIntent':restart,
            'failures':[{'artifact':'docs/evidence/p6/'+filename,'stage':data[key]['stage'],'error':data[key]['code'],'manifestSHA256':data[key]['manifestSHA256']}
                for key,filename in [('resumeFailure','owner-resume-lifecycle.json'),('scheduleFailure','owner-resume-lifecycle-pause-repair-one.json'),('finalFailure','owner-resume-lifecycle-schedule-repair-two.json')]]}
    if name=='worker-state':return worker_state(data,runtime)
    if name=='proxy-routing':return proxy_routing(data,runtime)
    if name in ('queue-ledger','ledger-after'):return queue_ledger(data,runtime)
    if name=='external-isolation':return external_isolation(data,runtime)
    if name=='full-containment':return containment(data,runtime)
    raise RuntimeError('ReadOnlyDiagnosisCaseNotImplemented')
