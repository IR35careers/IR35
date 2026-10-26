"""Owner3: account for the acknowledged row; never republish it."""
import json
import re
import time
from pathlib import Path
from immutable_artifacts import digest
from p4_recovery_guest import Recovery,RecoveryError
from p6_mock_guest import prepared,ROOT
from p6_dispatch_probe_guest import snapshot,restored_equal,digest_json,LEDGER_SQL,NAME as PROBE,COMPOSE as PROBE_COMPOSE,configuration
from p6_fixed_ip_guest import ROLLBACK_NAME,ROLLBACK_ADDRESS,wait_direct,NAME,ADDRESS,COMPOSE,UNIT,NETWORK,verify_fixed_endpoint
from p6_health_repair_guest import FIXED_ROLLBACK_UNIT
from p6_restart_diagnosis_guest import history,external_isolation,containment,private_health
from p6_mock_control import Control
from web_edge_guest import private_env

PENDING='0ec588ee-fbd8-4c05-8367-c7e0d5437fc1'


def retained(data,store):
    proof=data['owner1Full'];store.verify(proof['stage'],proof['manifestSHA256'])
    manifest=store.verify(proof['lifecycle']['stage'],proof['lifecycle']['manifestSHA256'])
    _,receipts,_,_=history(data)
    for artifact in manifest['artifacts']:
        name=artifact['name']
        if re.fullmatch(r'[0-9]{3}-(?:terminal-(?:success|server_error|timeout|lost_ack|captcha|unknown_answer)|concurrent-terminal|queued-cancel|active-cancel|orphan-watchdog)\.json',name):
            value=json.loads((store.root/proof['lifecycle']['stage']/name).read_bytes())
            if value['applicationId'] in receipts:raise RecoveryError('DuplicateRetainedReceipt')
            receipts[value['applicationId']]=value
    if len(receipts)!=45:raise RecoveryError('All45SealedRetainedReceiptsRequired')
    return receipts


def validate_pending(rows,receipts,old_hash):
    pending=[row for row in rows['jobs'] if row['state'] not in ('completed','failed','cancelled')]
    known=[row for row in rows['jobs'] if row['id']==PENDING]
    checks={'all45RetainedReceipts':len(rows['applications'])==45 and all(receipts.get(row['applicationId'])==row for row in rows['applications']),
        'all50JobsPresent':len(rows['jobs'])==50,'all7ReceiptsPresent':rows['schedules']==7,
        'onlyKnownPendingJob':len(pending)==len(known)==1 and pending==known and known[0]['state']=='created' and known[0]['retry_count']==0,
        'knownMockWatchdog':len(known)==1 and known[0]['name']=='ir35-staging-mock-schedule'
            and set(known[0]['data'])=={'kind','operation','requestedAt'} and known[0]['data']['kind']=='staging_mock_schedule' and known[0]['data']['operation']=='watchdog',
        'noEmployerPayloads':all(row['name'] in ('ir35-staging-mock-apply','ir35-staging-mock-schedule') and 'employerURL' not in row['data'] for row in rows['jobs'])}
    old=rows|{'jobs':[row for row in rows['jobs'] if row['id']!=PENDING]}
    checks['allPrior49RowsExact']=digest_json(old)==old_hash
    return {'status':'PASS' if all(checks.values()) else 'FAIL','checks':checks,'pending':known,
        'ledgerSHA256':digest_json(rows),'applications':len(rows['applications']),'jobs':len(rows['jobs']),'schedules':rows['schedules']}


def preflight(data,runtime):
    store=prepared(data);receipts=retained(data,store)
    previous=data['owner2Isolated'];store.verify(previous['stage'],previous['manifestSHA256'])
    before=json.loads((store.root/previous['stage']/'ledger-before.json').read_bytes())
    rows=json.loads(Recovery(data['p4'],runtime).query(LEDGER_SQL,'postgres'))
    ledger=validate_pending(rows,receipts,before['sha256'])
    original=snapshot(data,runtime)
    health=original['operationalState']['health']
    boundary=external_isolation(data,runtime)
    state=json.loads(runtime['run'](['docker','inspect',PROBE]))[0]
    expected=configuration(data['rollbackBuild']['image'],data['rollbackBuild']['sourceSHA'])
    checks={'ledger':ledger['status']=='PASS','originalHardPaused':health.get('paused')is True and health.get('active')==0 and health.get('realAcceptance')is False
            and health.get('ok')is True and health.get('buildSHA')==data['rollbackBuild']['sourceSHA'],
        'sameStoppedProbe':state['Image']==data['rollbackBuild']['image'] and state['State']['Running']is False
            and state['Config']['Entrypoint']==expected['services']['worker']['entrypoint'],
        'sealedProbeCompose':json.loads(PROBE_COMPOSE.read_bytes())==expected,'smtpAndExternalBoundary':boundary['status']=='PASS'}
    return {'status':'PASS' if all(checks.values()) else 'FAIL','readOnly':True,'vmWrites':0,'checks':checks,
        'ledger':ledger,'rollback':original,'smtp':boundary,'probeContainerID':state['Id'],'probeConfigSHA256':digest_json(state['Config']),
        'probeHostConfigSHA256':digest_json(state['HostConfig']),'oldLedgerSHA256':before['sha256']}


def drained_exact(before,after):
    old={row['id']:row for row in before['jobs']};new={row['id']:row for row in after['jobs']}
    changed=new.get(PENDING,{})
    expected=dict(old.get(PENDING,{}));expected['state']='completed'
    checks={'sameApplicationRows':before['applications']==after['applications'],'same50JobIDs':set(old)==set(new) and len(new)==50,
        'allOtherJobsExact':all(new.get(key)==row for key,row in old.items() if key!=PENDING),
        'knownJobCompletedOnly':changed==expected,'exactlyOneNewReceipt':before['schedules']==7 and after['schedules']==8}
    return {'status':'PASS' if all(checks.values()) else 'FAIL','checks':checks,'id':PENDING,'state':changed.get('state'),
        'newPublications':0,'newReceipts':after['schedules']-before['schedules'],'ledgerSHA256':digest_json(after)}


def drain(data,runtime):
    store=prepared(data);stage=store.stage('34-owner-capture-known-watchdog-drain')
    result={'status':'FAIL','pendingID':PENDING,'dispatches':0,'newPublications':0,'realAcceptance':False,'fullP6Runs':0}
    original_stopped=probe_started=False;before=None
    try:
        current=preflight(data,runtime)
        store.put(stage,'preflight.json',json.dumps(current,sort_keys=True).encode())
        if current['status']!='PASS' or current['ledger']['ledgerSHA256']!=data['capturePreflight']['ledger']['ledgerSHA256']:
            raise RecoveryError('KnownPendingPreflightMismatch_HardStop')
        before=current['rollback'];recovery=Recovery(data['p4'],runtime)
        baseline=json.loads(recovery.query(LEDGER_SQL,'postgres'))
        store.put(stage,'known-job-intent.json',json.dumps({'id':PENDING,'state':'created','retry_count':0,
            'processOnlyExisting':True,'newPublications':0,'endpoint':ROLLBACK_ADDRESS,'image':data['rollbackBuild']['image']}).encode())
        runtime['run'](['docker','stop','--time','30',ROLLBACK_NAME],timeout=45);original_stopped=True
        runtime['run'](['docker','start',PROBE]);probe_started=True
        wait_direct(ROLLBACK_ADDRESS,data['rollbackBuild']['sourceSHA'])
        control=Control(private_env(ROOT/'.env.p6-mock-control')['APPLICATION_WORKER_SECRET'])
        direct=private_health(ROLLBACK_ADDRESS);local=control.request('GET','/health')[1]
        if any(direct.get(k)!=local.get(k) for k in ('ok','paused','active','buildSHA','realAcceptance')) or local.get('realAcceptance')is not False:
            raise RecoveryError('KnownJobPrivate241IdentityMismatch')
        control.request('POST','/mock/maintenance',{'action':'resume'})
        deadline=time.monotonic()+15
        while True:
            rows=json.loads(recovery.query(LEDGER_SQL,'postgres'))
            receipt=json.loads(recovery.query("SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'operation',operation)),'[]') FROM pgboss.ir35_mock_schedule WHERE id='"+PENDING+"';",'postgres'))
            if any(row['id']==PENDING and row['state']=='completed' for row in rows['jobs']) and len(receipt)==1:break
            if time.monotonic()>=deadline:raise RecoveryError('KnownJobDurableReceiptDeadline')
            time.sleep(0.4)
        control.request('POST','/mock/maintenance',{'action':'pause'})
        result['ledger']=drained_exact(baseline,rows);result['receipt']=receipt
        store.put(stage,'known-job-result.json',json.dumps({'ledger':result['ledger'],'receipt':receipt},sort_keys=True).encode())
        if result['ledger']['status']!='PASS' or receipt!=[{'id':PENDING,'operation':'watchdog'}]:
            raise RecoveryError('KnownJobLedgerMismatch_HardStop')
        result['smtp']=external_isolation(data,runtime)
        if result['smtp']['status']!='PASS':raise RecoveryError('KnownJobSMTPOrEmployerBoundaryMismatch')
        result['processingPassed']=True
    except Exception as error:result['code']=str(error) if type(error)in(RuntimeError,RecoveryError) else type(error).__name__
    finally:
        try:
            if probe_started:runtime['run'](['docker','stop','--time','30',PROBE],timeout=45)
            if original_stopped:
                runtime['run'](['docker','start',ROLLBACK_NAME]);wait_direct(ROLLBACK_ADDRESS,data['rollbackBuild']['sourceSHA'])
            if before is not None:
                deadline=time.monotonic()+90
                while True:
                    after=snapshot(data,runtime)
                    if after['operationalState']['healthStatus']=='healthy':break
                    if time.monotonic()>=deadline:raise RecoveryError('OriginalRollbackDockerHealthRestoreDeadline')
                    time.sleep(1)
                result['restore']=restored_equal(before,after)
                store.put(stage,'original-rollback-after.json',json.dumps(after,sort_keys=True).encode())
                if result['restore']['status']!='PASS':raise RecoveryError('OriginalRollbackConfigEnvOrStateMismatch_HardStop')
            result['containment']=containment(data,runtime,probe_container=ROLLBACK_NAME)
            if result['containment']['status']!='PASS':raise RecoveryError('KnownJobContainmentMismatch_HardStop')
            if result.get('processingPassed')is True and 'code' not in result:result['status']='PASS'
        except Exception as error:result.update(status='FAIL',restoreError=str(error) if type(error)in(RuntimeError,RecoveryError) else type(error).__name__)
    store.put(stage,'result.json',json.dumps(result,sort_keys=True).encode())
    return result|{'stage':stage.name,'manifestSHA256':store.seal(stage)}
