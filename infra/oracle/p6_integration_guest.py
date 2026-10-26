"""Single P6 staging integration; existing images/credentials/network only."""
import base64
import copy
import hashlib
import json
import os
from pathlib import Path
import socket
import ssl
import struct
import subprocess
import time

from immutable_artifacts import digest
from p4_recovery_guest import Recovery,RecoveryError
from p6_mock_guest import ROOT,prepared,check_containment
from p6_mock_control import Control
from p6_fixed_ip_guest import NAME,NETWORK
from sdk_owner1_guest import tls_request
from sdk_gate_observation import Observer,sdk_cases
from web_edge_guest import private_env

APP_COMPOSE=ROOT/'p6-fixedip-app-compose.yml'
GATEWAY=ROOT/'.env.p6-fixedip-kong-config'
DISPATCHER=ROOT/'bin/p6-mock-schedule-owner1.py'
APP_NAMES=('ir35-p5-web','ir35-p5-kong')


def app_configuration(original,*,capture_repair=False):
    value=copy.deepcopy(original);value['name']='ir35-p6-fixedip-app'
    value['services']={name:value['services'][name] for name in ('web','kong')}
    for service in value['services'].values():service['restart']='unless-stopped'
    entry=value['services']['web']['entrypoint'];entry[2:2]=['/usr/bin/env','IR35_WORKER_HEALTH_ENABLED=true','IR35_REALTIME_HEALTH_ENABLED=true']
    # Original env is loaded by env-exec BEFORE these two public flag overrides.
    value['services']['web']['entrypoint']=[entry[0],entry[1],*entry[2:]]
    kong=value['services']['kong']
    kong['volumes']=[mount.replace(str(ROOT/'.env.p5-kong-config')+':',str(GATEWAY)+':') for mount in kong['volumes']]
    kong['healthcheck']={'test':['CMD','/run/ir35/env-exec','/opt/ir35/.env.p5-kong','kong','health'],'interval':'10s','timeout':'5s','retries':5}
    return value


def routing_configuration(original,platform):
    if any(row['name'].startswith(('realtime-','rt-admin-')) for row in original['services']):raise RecoveryError('ExpectedSealedP5GatewayRequired')
    extra=[row for row in platform['services'] if row['name'] in ('realtime-v1-ws','rt-admin-tenants','rt-admin-openapi')]
    if len(extra)!=3 or platform['consumers']!=original['consumers'] or platform['acls']!=original['acls']:
        raise RecoveryError('RealtimeRoutesMustReuseIdenticalCredentialValuesAndACLs')
    value=copy.deepcopy(original);value['services']+=copy.deepcopy(extra)
    return value


def put_file(path,body,mode=0o644):
    if path.exists() or path.is_symlink():raise RecoveryError('OwnerIntegrationFileExists_NoOverwrite')
    fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,mode)
    with os.fdopen(fd,'wb') as output:output.write(body);output.flush();os.fsync(output.fileno())
    os.chown(path,1002,1002);os.chmod(path,mode)


def timer_units(operation,hour,*,capture_repair=False):
    if operation not in ('mock_ingest','mock_automation','watchdog'):raise RecoveryError('FixedTimerOperationRequired')
    name='ir35-p6-mock-'+operation.replace('_','-')+('-decoder3' if capture_repair else '-owner1')
    dispatcher=ROOT/'bin/p6-mock-schedule-capture3.py' if capture_repair else DISPATCHER
    service=f'''[Unit]
Description=IR35 isolated mock-only {operation}
Requires={"ir35-p6-health-proxy-fixedip-owner1.socket"}
After=docker.service
RequiresMountsFor=/opt/ir35/data
[Service]
Type=oneshot
User=ir35
Group=ir35
ExecStart=/usr/bin/python3 {dispatcher} {operation}
TimeoutStartSec=30
MemoryMax=32M
TasksMax=16
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=yes
PrivateTmp=yes
PrivateDevices=yes
CapabilityBoundingSet=
RestrictAddressFamilies=AF_INET AF_UNIX
IPAddressDeny=any
IPAddressAllow=127.0.0.1/32
StandardOutput=null
StandardError={"journal" if capture_repair else "null"}
'''
    timer=f'''[Unit]
Description=IR35 mock-only daily {operation}
[Timer]
OnCalendar=*-*-* {hour}:00:00 UTC
Persistent=false
Unit={name}.service
[Install]
WantedBy=timers.target
'''
    return name,{name+'.service':service,name+'.timer':timer}


def prepare(data,runtime,store,stage):
    capture_repair=data.get('captureOwner3')is True
    app_compose=ROOT/'p6-capture3-app-compose.yml' if capture_repair else APP_COMPOSE
    dispatcher=ROOT/'bin/p6-mock-schedule-capture3.py' if capture_repair else DISPATCHER
    suffix='-before-capture-owner3' if capture_repair else '-before-fixedip-owner1'
    original=json.loads((ROOT/'p5-compose.yml').read_bytes())
    before=json.loads((ROOT/'.env.p5-kong-config').read_bytes())
    platform=json.loads((ROOT/'.env.kong-config.json').read_bytes())
    gateway=routing_configuration(before,platform)
    original_hash=digest((ROOT/'.env.p5-kong-config').read_bytes())
    if capture_repair:
        # Reuse the sealed VM-only routing copy with IDENTICAL credential
        # values, never overwrite/regenerate it or the old failed artifacts.
        if json.loads(GATEWAY.read_bytes())!=gateway or GATEWAY.stat().st_mode&0o777!=0o600 or GATEWAY.stat().st_uid!=1002:
            raise RecoveryError('RetainedPrivateGatewayCopyMismatch')
    else:put_file(GATEWAY,json.dumps(gateway).encode(),0o600)
    value=app_configuration(original,capture_repair=capture_repair)
    if capture_repair:value['name']='ir35-p6-capture-owner3-app'
    body=json.dumps(value,sort_keys=True,indent=2).encode()
    put_file(app_compose,body);store.put(stage,app_compose.name,body)
    put_file(dispatcher,data['scheduleDispatcherSource'].encode(),0o644)
    store.put(stage,'prepare-intent.json',json.dumps({'newCredentialValues':0,'credentialValuesUnchanged':True,
        'originalGatewaySHA256':original_hash,'newPrivateRoutingConfigSHA256':digest(GATEWAY.read_bytes()),
        'images':{name:original['services'][name]['image'] for name in ('web','kong')},'originalFilesUntouched':True}).encode())
    command=['docker','compose','--env-file',str(ROOT/'.env'),'-f',str(app_compose)]
    with store.sink(stage,'app-config-validation.log') as log:
        if subprocess.run(command+['config','--quiet'],stdout=log,stderr=log,timeout=30).returncode:raise RecoveryError('P6AppComposeInvalid')
    names=runtime['run'](['docker','ps','-a','--format','{{.Names}}']).splitlines()
    for name in APP_NAMES:
        if name+suffix in names:raise RecoveryError('P6AppHandoverAlreadyExists_NoReplay')
        store.put(stage,name+'-stop-intent.json',json.dumps({'container':name,'preservedAs':name+suffix}).encode())
        runtime['run'](['docker','stop','--time','30',name],timeout=45)
        runtime['run'](['docker','rename',name,name+suffix])
    with store.sink(stage,'app-start.log') as log:
        if subprocess.run(command+['up','-d','--no-deps','--pull','never','kong','web'],stdout=log,stderr=log,timeout=120).returncode:
            raise RecoveryError('P6AppIntegrationStartFailed')
    # Docker metadata persists across daemon reboots; separate public overrides
    # document the same policies without editing the sealed P3/P5 compose files.
    policies=[]
    for row in data['fixedIPPreflight']['services']:
        name=row['name']
        if name=='ir35-p6-mock-worker-v6-rollback':continue
        actual=json.loads(runtime['run'](['docker','inspect',name]))[0]
        if actual['Image']!=row['image']:raise RecoveryError('P6RestartPolicyImageIdentityMismatch')
        policies.append({'name':name,'before':row['restartPolicy'],'after':'unless-stopped','image':row['image']})
    store.put(stage,'restart-policy-intents.json',json.dumps(policies).encode())
    for row in policies:runtime['run'](['docker','update','--restart','unless-stopped',row['name']])
    timers=[]
    for operation,hour in (('mock_ingest','03'),('mock_automation','04'),('watchdog','05')):
        name,bodies=timer_units(operation,hour,capture_repair=capture_repair);timers.append(name)
        for filename,content in bodies.items():
            path=Path('/etc/systemd/system')/filename
            put_file(path,content.encode());os.chown(path,0,0);store.put(stage,filename,content.encode())
    with store.sink(stage,'schedule-units-validation.log') as log:
        args=['systemd-analyze','verify',*[str(Path('/etc/systemd/system')/(name+'.service')) for name in timers],
            *[str(Path('/etc/systemd/system')/(name+'.timer')) for name in timers]]
        if subprocess.run(args,stdout=log,stderr=log,timeout=20).returncode:raise RecoveryError('P6ScheduleUnitsInvalid')
    runtime['run'](['systemctl','daemon-reload'])
    return {'status':'PASS','timers':timers,'restartPolicies':policies,'privateGatewayConfigCreated':True,'credentialValuesChanged':False}


def ws_message(connection,value):
    body=json.dumps(value,separators=(',',':')).encode();mask=os.urandom(4)
    length=len(body);header=bytes([0x81,0x80|length]) if length<126 else bytes([0x81,0x80|126])+struct.pack('!H',length)
    connection.sendall(header+mask+bytes(byte^mask[i%4] for i,byte in enumerate(body)))


def receive_exact(connection,length):
    body=b''
    while len(body)<length:
        part=connection.recv(length-len(body))
        if not part:raise RecoveryError('P6RealtimeSocketClosed')
        body+=part
    return body


def ws_receive(connection):
    first,second=receive_exact(connection,2);length=second&127
    if length==126:length=struct.unpack('!H',receive_exact(connection,2))[0]
    if length==127:raise RecoveryError('P6RealtimeFrameTooLarge')
    if length>16384 or second&128 or first&15!=1:raise RecoveryError('P6RealtimeUnexpectedFrame')
    return json.loads(receive_exact(connection,length))


def realtime_socket(values,gate):
    # Host-side loopback TLS retains owner/basic-cookie controls. Never log the
    # credentialed query or socket frames; only booleans leave this function.
    key=base64.b64encode(os.urandom(16)).decode();host='staging.ir35careers.com'
    path='/supabase/realtime/v1/websocket?apikey='+values['ANON_KEY']+'&vsn=1.0.0'
    context=ssl.create_default_context();raw=socket.create_connection(('127.0.0.1',443),timeout=8)
    with context.wrap_socket(raw,server_hostname=host) as connection:
        connection.settimeout(8)
        connection.sendall(('GET '+path+' HTTP/1.1\r\nHost: '+host+'\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: '+key+
            '\r\nCookie: __Host-ir35-staging='+gate+'\r\n\r\n').encode())
        headers=b''
        while not headers.endswith(b'\r\n\r\n'):
            if len(headers)>16384:raise RecoveryError('P6RealtimeHandshakeTooLarge')
            headers+=receive_exact(connection,1)
        lines=headers.decode().split('\r\n');mapped={line.split(':',1)[0].lower():line.split(':',1)[1].strip() for line in lines[1:] if ':' in line}
        expected=base64.b64encode(hashlib.sha1((key+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').encode()).digest()).decode()
        if ' 101 ' not in lines[0] or mapped.get('sec-websocket-accept')!=expected:raise RecoveryError('P6RealtimeUpgradeFailed_RawWithheld')
        topic='realtime:p6-fixedip-owner1'
        ws_message(connection,{'topic':topic,'event':'phx_join','payload':{'config':{'broadcast':{'self':True},'presence':{'enabled':False},'private':False},'access_token':values['ANON_KEY']},'ref':'1','join_ref':'1'})
        joined=False
        for _ in range(8):
            row=ws_receive(connection)
            if row.get('event')=='phx_reply' and row.get('ref')=='1':joined=row.get('payload',{}).get('status')=='ok';break
        if not joined:raise RecoveryError('P6RealtimeJoinFailed_RawWithheld')
        marker=digest(os.urandom(16))
        ws_message(connection,{'topic':topic,'event':'broadcast','payload':{'type':'broadcast','event':'probe','payload':{'marker':marker}},'ref':'2','join_ref':'1'})
        echoed=False
        for _ in range(8):
            row=ws_receive(connection)
            if row.get('event')=='broadcast' and row.get('payload',{}).get('payload',{}).get('marker')==marker:echoed=True;break
        if not echoed:raise RecoveryError('P6RealtimeBroadcastEchoFailed_RawWithheld')
        return {'status':'PASS','TLSWebsocket101':True,'anonymousPublicChannelJoin':True,'broadcastEcho':True,'customerWrites':0,'tokenLogged':False}


def verify(data,runtime,store,stage,prepared):
    values=runtime['read_env']();gate=private_env(ROOT/'.env.p5-caddy')['STAGING_GATE_TOKEN']
    basic='Basic '+base64.b64encode(('ir35:'+values['STAGING_BASIC_PASSWORD']).encode()).decode()
    deadline=time.monotonic()+90
    while True:
        code,headers,body=tls_request('staging.ir35careers.com','GET','/api/health',{'Authorization':basic})
        if code==200:break
        if time.monotonic()>=deadline:raise RecoveryError('P6FullAppReadinessDeadline')
        time.sleep(1)
    report=json.loads(body)
    if report.get('ok')is not True or set(report.get('checks',{}))!={'database','auth','storage','realtime','worker'} or any(v!='ready' for v in report['checks'].values()) or report.get('buildSHA')!=data['build']['sourceSHA']:
        raise RecoveryError('P6FullAppDependencyIdentityMismatch')
    store.put(stage,'app-health.json',json.dumps(report).encode())
    observer=Observer(store,stage)
    sdk_cases(observer,lambda method,path,h:tls_request('staging.ir35careers.com',method,path,h),gate,
        headers={'apikey':values['ANON_KEY'],'Authorization':'Bearer '+values['ANON_KEY']},check_path=False)
    if not all(case['passed'] for case in observer.records):raise RecoveryError('P6SDK401401200Regression')
    code,headers,_=tls_request('staging.ir35careers.com','POST','/api/jobs/search',{'Authorization':basic})
    if code!=503 or 'no-store' not in headers.get('cache-control',''):raise RecoveryError('P6MaintenanceGuardRegression')
    rt=realtime_socket(values,gate);store.put(stage,'realtime-websocket.json',json.dumps(rt).encode())
    control=Control(private_env(ROOT/'.env.p6-mock-control')['APPLICATION_WORKER_SECRET'])
    store.put(stage,'resume-mock-scheduler-intent.json',json.dumps({'mockOnly':True,'realAcceptance':False}).encode())
    control.request('POST','/mock/maintenance',{'action':'resume'})
    recovery=Recovery(data['p4'],runtime)
    before=json.loads(recovery.query("SELECT coalesce(jsonb_agg(id),'[]') FROM pgboss.ir35_mock_schedule;",'postgres'))
    for name in prepared['timers']:
        runtime['run'](['systemctl','enable','--now',name+'.timer'])
        if data.get('captureOwner3')is True:
            from p6_dispatch_observability import dispatch_once
            dispatch_once(name+'.service',runtime,store,stage,name+'-execution')
        else:
            runtime['run'](['systemctl','start',name+'.service'],timeout=40)
            output=runtime['run'](['systemctl','show',name+'.service','--property=Result','--property=ExecMainStatus'])
            state=dict(row.split('=',1) for row in output.splitlines() if '=' in row)
            store.put(stage,name+'-execution.json',json.dumps(state).encode())
            if state!={'Result':'success','ExecMainStatus':'0'}:raise RecoveryError('P6ActualScheduleDispatchFailed')
    end=time.monotonic()+15
    while True:
        receipts=json.loads(recovery.query("SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'operation',operation)),'[]') FROM pgboss.ir35_mock_schedule;",'postgres'))
        fresh=[row for row in receipts if row['id'] not in before]
        if len(fresh)==3 or time.monotonic()>=end:break
        time.sleep(0.4)
    if len(fresh)!=3 or sorted(row['operation'] for row in fresh)!=['mock_automation','mock_ingest','watchdog']:raise RecoveryError('P6ScheduleDurableReceiptMismatch')
    store.put(stage,'actual-systemd-schedule-receipts.json',json.dumps(fresh).encode())
    heartbeat=json.loads(recovery.query("SELECT jsonb_build_object('buildSHA',build_sha,'fresh',seen_at>clock_timestamp()-interval '45 seconds','active',active) FROM pgboss.ir35_mock_heartbeat WHERE id='staging_mock_worker';",'postgres'))
    if heartbeat!={'buildSHA':data['finalBuild']['sourceSHA'],'fresh':True,'active':0}:raise RecoveryError('P6HeartbeatIdentityOrFreshnessMismatch')
    for row in prepared['restartPolicies']:
        item=json.loads(runtime['run'](['docker','inspect',row['name']]))[0]
        if item['HostConfig']['RestartPolicy']['Name']!='unless-stopped':raise RecoveryError('P6ServiceRestartPolicyMismatch')
    return {'status':'PASS','appHealth':report,'sdk401401200':observer.records,'maintenance503':True,'realtime':rt,
        'actualSystemdSchedules':fresh,'heartbeat':heartbeat,'restartPolicies':'unless-stopped','realAcceptance':False,'phaseComplete':False}


def restore(data,runtime,store,stage):
    capture_repair=data.get('captureOwner3')is True
    suffix='-before-capture-owner3' if capture_repair else '-before-fixedip-owner1'
    failed_suffix='-failed-capture-owner3' if capture_repair else '-failed-fixedip-owner1'
    # Called at most once by the owner-full-run wrapper; originals never removed.
    for operation,hour in (('mock_ingest','03'),('mock_automation','04'),('watchdog','05')):
        name,_=timer_units(operation,hour,capture_repair=capture_repair)
        if (Path('/etc/systemd/system')/(name+'.timer')).exists():runtime['run'](['systemctl','disable','--now',name+'.timer'])
    names=runtime['run'](['docker','ps','-a','--format','{{.Names}}']).splitlines()
    for name in APP_NAMES:
        old=name+suffix
        if old not in names:continue
        if name in names:
            runtime['run'](['docker','stop','--time','30',name],timeout=45)
            runtime['run'](['docker','rename',name,name+failed_suffix])
        runtime['run'](['docker','rename',old,name])
        runtime['run'](['docker','start',name])
    for row in data['fixedIPPreflight']['services']:
        if row['name']=='ir35-p6-mock-worker-v6-rollback':continue
        runtime['run'](['docker','update','--restart',row['restartPolicy'],row['name']])
    return {'status':'PASS','originalAppContainersRestored':True,'timersDisabled':True,'originalRestartPoliciesRestored':True,'credentialValuesChanged':False}
