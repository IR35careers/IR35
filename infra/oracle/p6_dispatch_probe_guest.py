"""Pure public unit/config builders for the proposed isolated rollback probe.

No commands execute on import. Execution requires the explicit temporary-probe
owner approval and an unused write-once stage.
"""
import copy
import hashlib
import json
import os
from pathlib import Path
import subprocess
import time
from p4_recovery_guest import RecoveryError
from p6_fixed_ip_guest import fixed_configuration,ROLLBACK_ADDRESS
from p6_health_repair_guest import FIXED_ROLLBACK_UNIT
from p6_fixed_ip_guest import ROOT,ROLLBACK_NAME,ROLLBACK_COMPOSE,NETWORK,launch,wait_direct
from p6_mock_guest import prepared
from p6_mock_control import Control
from p6_restart_diagnosis_guest import private_health,external_isolation,containment
from p6_dispatch_observability import dispatch_once,redacted
from immutable_artifacts import digest
from p4_recovery_guest import Recovery
from web_edge_guest import private_env

NAME='ir35-p6-mock-decoder-probe2'
SCRIPT='/opt/ir35/bin/p6-mock-schedule-decoder2.py'
UNIT='ir35-p6-mock-watchdog-decoder2.service'
COMPOSE=ROOT/'p6-decoder-isolated2.yml'
LEDGER_SQL="""SELECT jsonb_build_object('applications',(SELECT coalesce(jsonb_agg(jsonb_build_object('applicationId',id,'state',state,'errorCode',error_code,'receiptConfirmed',receipt_confirmed,'updatedAt',updated_at,'events',events) ORDER BY id),'[]') FROM pgboss.ir35_mock_application),'jobs',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'state',state,'data',data,'retry_count',retry_count) ORDER BY id),'[]') FROM pgboss.job),'schedules',(SELECT count(*) FROM pgboss.ir35_mock_schedule));"""


def digest_json(value):return digest(json.dumps(value,sort_keys=True).encode())


def snapshot(data,runtime):
    item=json.loads(runtime['run'](['docker','inspect',ROLLBACK_NAME]))[0]
    if item['Image']!=data['rollbackBuild']['image']:raise RecoveryError('OriginalRollbackImageMismatch')
    state=item['State'];health=private_health(ROLLBACK_ADDRESS)
    projected={key:state.get(key) for key in ('Status','Running','Paused','Restarting','Dead','ExitCode','OOMKilled')}
    projected.update(RestartCount=item['RestartCount'],healthStatus=state.get('Health',{}).get('Status'),
        endpoint=item['NetworkSettings']['Networks'][NETWORK].get('IPAddress'),
        health={key:health.get(key) for key in ('ok','browserReady','databaseReady','mode','realAcceptance','paused','active','buildSHA')})
    files={str(path):digest(path.read_bytes()) for path in (ROOT/'.env.p6-mock-worker',ROOT/'.env.p6-mock-control',ROLLBACK_COMPOSE,
        Path('/etc/systemd/system')/(FIXED_ROLLBACK_UNIT+'.socket'),Path('/etc/systemd/system')/(FIXED_ROLLBACK_UNIT+'.service'))}
    return {'container':ROLLBACK_NAME,'containerID':item['Id'],'image':item['Image'],
        'dockerConfigSHA256':digest_json(item['Config']),'dockerEnvSHA256':digest_json(item['Config'].get('Env',[])),
        'hostConfigSHA256':digest_json(item['HostConfig']),'protectedFilesSHA256':files,'operationalState':projected,
        'lifecycleTimestamps':{key:state.get(key) for key in ('StartedAt','FinishedAt')}}


def restored_equal(before,after):
    fields=('container','containerID','image','dockerConfigSHA256','dockerEnvSHA256','hostConfigSHA256','protectedFilesSHA256','operationalState')
    checks={key:before[key]==after[key] for key in fields}
    return {'status':'PASS' if all(checks.values()) else 'FAIL','checks':checks,
        'lifecycleTimestampsBefore':before['lifecycleTimestamps'],'lifecycleTimestampsAfter':after['lifecycleTimestamps'],
        'timestampChangeReason':'Approved stop/start only; no timestamp is claimed byte-identical.'}


def store_public_file(path,body,mode,uid):
    fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,mode)
    with os.fdopen(fd,'wb') as output:output.write(body);output.flush();os.fsync(output.fileno())
    os.chown(path,uid,uid);os.chmod(path,mode)


def execute(data,runtime):
    if data.get('ownerTemporaryProbeApproved')is not True:raise RecoveryError('ExplicitTemporaryMockProbeApprovalRequired')
    store=prepared(data);stage=store.stage('33-owner-decoder-isolated-dispatch')
    result={'status':'FAIL','isolatedDispatchAllowance':1,'fullP6Runs':0,'productionChanges':False,'secretValuesChanged':False,
        'realAcceptance':False,'newNetworks':0,'originalStopped':False,'probeStarted':False}
    original_stopped=probe_requested=False;before=None;control=None
    try:
        before=snapshot(data,runtime)
        store.put(stage,'original-rollback-before.json',json.dumps(before,sort_keys=True).encode())
        if (before['operationalState']['health'].get('paused')is not True or before['operationalState']['health'].get('realAcceptance')is not False
                or before['operationalState']['health'].get('active')!=0 or before['operationalState']['health'].get('buildSHA')!=data['rollbackBuild']['sourceSHA']):
            raise RecoveryError('OriginalHardPausedMockRollbackRequired')
        loaded=runtime['run'](['systemctl','show',FIXED_ROLLBACK_UNIT+'.service','--property=ExecStart'])
        if ' --connections-max=32 '+ROLLBACK_ADDRESS+':8787' not in loaded or 'IPAddressAllow='+ROLLBACK_ADDRESS+'/32' not in (Path('/etc/systemd/system')/(FIXED_ROLLBACK_UNIT+'.service')).read_text():
            raise RecoveryError('ProbeMustReachOnlyVerifiedPrivate241Proxy')
        original=Recovery(data['p4'],runtime);baseline=json.loads(original.query(LEDGER_SQL,'postgres'))
        store.put(stage,'ledger-before.json',json.dumps({'sha256':digest_json(baseline),'applications':len(baseline['applications']),
            'jobs':len(baseline['jobs']),'schedules':baseline['schedules']}).encode())
        if digest_json(baseline)!=data['decoderPreflight']['ledgerSHA256']:
            raise RecoveryError('RetainedLedgerChangedSincePreflight_HardStop')
        if external_isolation(data,runtime)['status']!='PASS':raise RecoveryError('ProbeSMTPOrProviderBoundaryMismatch')
        names=runtime['run'](['docker','ps','-a','--format','{{.Names}}']).splitlines()
        path=Path(SCRIPT);unit=Path('/etc/systemd/system')/UNIT
        if NAME in names or COMPOSE.exists() or path.exists() or unit.exists():raise RecoveryError('IsolatedProbeAlreadyExists_NoReplay')
        body=data['fixedDispatcherSource'].encode();store_public_file(path,body,0o644,1002)
        store.put(stage,'fixed-dispatcher-source.json',json.dumps({'sha256':digest(body),'publicSourceOnly':True}).encode())
        text=unit_text();store_public_file(unit,text.encode(),0o644,0);store.put(stage,UNIT,text.encode())
        check=subprocess.run(['systemd-analyze','verify',str(unit)],capture_output=True,timeout=20)
        store.put(stage,'unit-preflight.json',json.dumps({'exitCode':check.returncode,'stderr':redacted(check.stderr)}).encode())
        if check.returncode:raise RecoveryError('IsolatedProbeUnitValidationFailed')
        runtime['run'](['systemctl','daemon-reload'])
        store.put(stage,'temporary-mock-config-intent.json',json.dumps({'image':data['rollbackBuild']['image'],'endpoint':ROLLBACK_ADDRESS,
            'retainedOriginal':ROLLBACK_NAME,'temporaryPrivateReadOnlyFalse':True,'realAcceptance':False,'dispatchesAllowed':1}).encode())
        runtime['run'](['docker','stop','--time','30',ROLLBACK_NAME],timeout=45);original_stopped=True;result['originalStopped']=True
        probe_requested=True;launch(configuration(data['rollbackBuild']['image'],data['rollbackBuild']['sourceSHA']),COMPOSE,runtime,store,stage)
        result['probeStarted']=True;wait_direct(ROLLBACK_ADDRESS,data['rollbackBuild']['sourceSHA'])
        control=Control(private_env(ROOT/'.env.p6-mock-control')['APPLICATION_WORKER_SECRET'])
        local=control.request('GET','/health')[1];direct=private_health(ROLLBACK_ADDRESS)
        if local.get('buildSHA')!=direct.get('buildSHA') or local.get('buildSHA')!=data['rollbackBuild']['sourceSHA'] or local.get('realAcceptance')is not False:
            raise RecoveryError('ProbePrivate241LocalhostIdentityMismatch')
        control.request('POST','/mock/maintenance',{'action':'resume'})
        result['dispatch']=dispatch_once(UNIT,runtime,store,stage,'one-watchdog')
        end=time.monotonic()+15
        while True:
            current=json.loads(original.query(LEDGER_SQL,'postgres'))
            old_ids={row['id'] for row in baseline['jobs']};new=[row for row in current['jobs'] if row['id'] not in old_ids]
            if len(new)==1 and new[0]['state']=='completed' and current['schedules']==baseline['schedules']+1:break
            if time.monotonic()>=end:raise RecoveryError('IsolatedDispatchDurableReceiptDeadline')
            time.sleep(0.4)
        old={**current,'jobs':[row for row in current['jobs'] if row['id'] in old_ids],'schedules':baseline['schedules']}
        if digest_json(old)!=digest_json(baseline) or len(new)!=1 or new[0]['name']!='ir35-staging-mock-schedule' or set(new[0]['data'])!={'kind','operation','requestedAt'} or new[0]['data']['kind']!='staging_mock_schedule' or new[0]['data']['operation']!='watchdog':
            raise RecoveryError('IsolatedDispatchLedgerOrEmployerPayloadMismatch')
        result['oneDurableMockReceipt']={'id':new[0]['id'],'state':new[0]['state'],'operation':'watchdog','employerPayloads':0,
            'allPriorRowsUnchanged':True,'applicationsUnchanged':True,'newJobs':1,'newScheduleReceipts':1}
        result['smtp']=external_isolation(data,runtime)
        if result['smtp']['status']!='PASS':raise RecoveryError('ProbePostDispatchSMTPOrProviderBoundaryMismatch')
        result['probePassed']=True
    except Exception as error:
        result['code']=str(error) if type(error)in(RuntimeError,RecoveryError) else type(error).__name__
    finally:
        try:
            if probe_requested:
                item=json.loads(runtime['run'](['docker','inspect',NAME]))[0]
                if item['Image']!=data['rollbackBuild']['image']:raise RecoveryError('ProbeStopIdentityMismatch')
                runtime['run'](['docker','stop','--time','30',NAME],timeout=45)
            if original_stopped:
                runtime['run'](['docker','start',ROLLBACK_NAME]);wait_direct(ROLLBACK_ADDRESS,data['rollbackBuild']['sourceSHA'])
            if before is not None:
                end=time.monotonic()+90
                while True:
                    after=snapshot(data,runtime)
                    if after['operationalState']['healthStatus']=='healthy':break
                    if time.monotonic()>=end:raise RecoveryError('OriginalRollbackDockerHealthRestoreDeadline')
                    time.sleep(1)
                store.put(stage,'original-rollback-after.json',json.dumps(after,sort_keys=True).encode())
                result['restore']=restored_equal(before,after)
                if result['restore']['status']!='PASS':raise RecoveryError('OriginalRollbackConfigEnvOrStateMismatch_HardStop')
            result['containment']=containment(data,runtime,probe_container=ROLLBACK_NAME)
            if result['containment']['status']!='PASS':raise RecoveryError('ProbeContainmentMismatch_HardStop')
            if result.get('probePassed')is True and 'code' not in result:result['status']='PASS'
        except Exception as error:result.update(status='FAIL',restoreError=str(error) if type(error)in(RuntimeError,RecoveryError) else type(error).__name__)
    store.put(stage,'result.json',json.dumps(result,sort_keys=True).encode())
    return result|{'stage':stage.name,'manifestSHA256':store.seal(stage)}


def configuration(image,source):
    value=fixed_configuration(image,source,rollback=True)
    value['name']='ir35-p6-decoder-isolated2';service=value['services']['worker'];service['container_name']=NAME
    entry=service['entrypoint']
    if entry.count('IR35_READ_ONLY=true')!=1:raise RecoveryError('ExpectedHardReadonlyRollbackDefinition')
    entry[entry.index('IR35_READ_ONLY=true')]='IR35_READ_ONLY=false'
    entry.insert(entry.index('node'),'IR35_MOCK_START_PAUSED=true')
    if service['networks']['backend']['ipv4_address']!=ROLLBACK_ADDRESS:raise RecoveryError('OriginalRollbackEndpointRequired')
    return value


def unit_text():
    return f'''[Unit]
Description=IR35 ONE isolated decoder mock watchdog dispatch
Requires={FIXED_ROLLBACK_UNIT}.socket
After=docker.service
RequiresMountsFor=/opt/ir35/data
[Service]
Type=oneshot
User=ir35
Group=ir35
ExecStart=/usr/bin/python3 {SCRIPT} watchdog
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
StandardError=journal
'''
