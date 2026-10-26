"""One bounded drain of an already-journalled mock schedule only."""
import json
import time
import subprocess
from immutable_artifacts import digest
from p4_recovery_guest import Recovery,RecoveryError
from p6_schedule_repair_guest import observe
from p6_status_audit_guest import run_case
from p6_queue_boundary_gate import anchored_result,verify_live
from p6_queue_function_scope import audit as function_scope
from p6_mock_guest import ROOT,prepared,check_containment
from p6_mock_control import Control
from p6_health_repair_guest import SYSTEMD,isolation,units,validate_proxy,write_unit,DRAIN_UNIT,DRAIN_ROLLBACK_UNIT
from web_edge_guest import private_env


def drain(data,runtime):
    """Complete ONLY the already-published, anchored mock_ingest command."""
    store=prepared(data);anchor=data['pauseHandover']
    anchored_result(store,anchor)
    if anchor.get('status')!='PASS' or anchor.get('containerName')!='ir35-p6-mock-worker-v5':
        raise RecoveryError('ExactPreviousPauseHandoverRequired')
    observation,rows=observe(data,runtime)
    if observation['ledgerSHA256']!=data['scheduleDiagnosis']['observation']['ledgerSHA256'] or observation['pendingScheduleJobs']!=1:
        raise RecoveryError('PendingScheduleChangedBeforeDrain_Abort')
    stage=store.stage('23-owner-schedule-intent-drain')
    control=Control(private_env(ROOT/'.env.p6-mock-control')['APPLICATION_WORKER_SECRET'])
    name='ir35-p6-mock-worker-v5';rollback='ir35-p6-mock-worker-v5-rollback'
    unit=DRAIN_UNIT;old_unit='ir35-p6-health-proxy-r4-pause-rollback1'
    result={'status':'FAIL','productionChanges':False,'realAcceptance':False,'newPublications':0,'customerWrites':0,
            'queuePolicyChanges':0,'secretChanges':0,'networkChanges':0,'cases':[]}
    changed=False
    def case(label,value,valid):
        store.put(stage,label+'.json',json.dumps(value,sort_keys=True).encode())
        result['cases'].append({'case':label,'passed':bool(valid)})
        if not valid:raise RecoveryError('ScheduleDrainCaseFailed_'+label)
    try:
        result['preContainment']=check_containment(data,runtime,store,stage,'pre')
        result['preBoundary']=verify_live(data,Recovery(data['p4'],runtime),store,function_scope(Recovery(data['p4'],runtime)))
        item=json.loads(runtime['run'](['docker','inspect',name]))[0]
        prior=json.loads(runtime['run'](['docker','inspect',rollback]))[0]
        network=json.loads(runtime['run'](['docker','inspect','--type','network','ir35-staging_backend']))[0]
        isolation(prior,data['runtimeProof']['image'],network)
        health=control.request('GET','/health')[1]
        case('rollback-preflight',{'paused':health.get('paused'),'active':health.get('active'),'targetStopped':not item['State']['Running']},
             prior['State']['Running'] and health.get('paused') is True and health.get('active')==0 and not item['State']['Running'] and item['Image']==anchor['image'])
        if digest((ROOT/'p6-mock-compose-v5.yml').read_bytes())!=anchor['composeSHA256']:
            raise RecoveryError('RetainedDrainComposeChanged_Abort')
        for filename,expected in anchor['unitSHA256'].items():
            if (SYSTEMD/filename).is_symlink() or digest((SYSTEMD/filename).read_bytes())!=expected:
                raise RecoveryError('RetainedDrainProxyChanged_Abort')
        if any((SYSTEMD/filename).exists() for filename in units('172.30.35.12',unit=unit)):
            raise RecoveryError('DrainProxyAlreadyExists_NoReplay')
        store.put(stage,'intent.json',json.dumps({'operation':'drain-existing-mock_ingest-only','jobIDSHA256':observation['scheduleJobIDSHA256'],
            'beforeLedgerSHA256':observation['ledgerSHA256'],'sourceSHA':anchor['sourceSHA'],'image':anchor['image'],
            'newApplicationsAllowed':0,'newPublicationsAllowed':0}).encode())
        changed=True
        runtime['run'](['systemctl','disable','--now',old_unit+'.socket'])
        runtime['run'](['systemctl','stop',old_unit+'.service'])
        runtime['run'](['docker','stop','--time','30',rollback],timeout=45)
        runtime['run'](['docker','start',name],timeout=45)
        item=json.loads(runtime['run'](['docker','inspect',name]))[0]
        address=isolation(item,anchor['image'],network)
        bodies=units(address,unit=unit)
        for filename,body in bodies.items():
            write_unit(SYSTEMD/filename,body,unit=unit)
            store.put(stage,filename,body.encode())
        with store.sink(stage,'drain-proxy-validation.log') as log:
            if subprocess.run(['systemd-analyze','verify',*[str(SYSTEMD/filename) for filename in bodies]],stdout=log,stderr=log,timeout=20).returncode:
                raise RecoveryError('DrainProxyValidationFailed')
        runtime['run'](['systemctl','daemon-reload'])
        runtime['run'](['systemctl','enable','--now',unit+'.socket'])
        deadline=time.monotonic()+90
        while True:
            try:
                health=control.request('GET','/health')[1]
                if health.get('ok') is True:break
            except RecoveryError:pass
            if time.monotonic()>=deadline:raise RecoveryError('DrainStartupHealthDeadline')
            time.sleep(1)
        case('start-paused',health,health.get('paused') is True and health.get('buildSHA')==anchor['sourceSHA'] and health.get('active')==0 and health.get('peakActive')==0)
        validate_proxy(runtime,bodies,unit=unit)
        # Still no publication. A receipt/job ledger read must remain identical.
        before,_=observe(data,runtime)
        case('ledger-before-resume',before,before['ledgerSHA256']==observation['ledgerSHA256'])
        resumed=control.request('POST','/mock/maintenance',{'action':'resume'})[1]
        case('resume-owned-command',resumed,resumed=={'paused':False,'realAcceptance':False})
        recovery=Recovery(data['p4'],runtime);deadline=time.monotonic()+15
        while True:
            complete=json.loads(recovery.query("SELECT jsonb_build_object('completed',count(*) FILTER(WHERE state='completed'),'other',count(*) FILTER(WHERE state<>'completed')) FROM pgboss.job WHERE name='ir35-staging-mock-schedule';",'postgres'))
            if complete=={'completed':1,'other':0}:break
            if time.monotonic()>=deadline:raise RecoveryError('ExistingMockScheduleDrainDeadline')
            time.sleep(0.4)
        paused=control.request('POST','/mock/maintenance',{'action':'pause'})[1]
        case('pause-after-drain',paused,paused=={'paused':True,'realAcceptance':False})
        after,_=observe(data,runtime)
        case('owned-command-completed',after,after['pendingScheduleJobs']==0 and after['scheduleRows']==1 and after['allRetainedReceiptsMatch'])
        health=control.request('GET','/health')[1]
        case('zero-application-processing',health,health.get('paused') is True and health.get('active')==0 and health.get('peakActive')==0)
        result['postBoundary']=verify_live(data,recovery,store,function_scope(recovery))
        result['smtp']=run_case('smtp-empty',data,runtime)
        if result['smtp']['status']!='PASS':raise RecoveryError('DrainUnexpectedSMTP_Abort')
        result['containment']=check_containment(data,runtime,store,stage,'post')
        result.update(status='PASS',drainedExistingSchedule=1,observation=after,sourceSHA=anchor['sourceSHA'],image=anchor['image'],
            containerName=name,composeSHA256=anchor['composeSHA256'],unitSHA256={k:digest(v.encode()) for k,v in bodies.items()},composePath=anchor['composePath'],
            processingPaused=True,oldArtifactsRetained=True,originalEnvUnchanged=True)
    except Exception as error:
        result['code']=str(error) if isinstance(error,RecoveryError) else type(error).__name__
        if changed:
            try:
                try:control.request('POST','/mock/maintenance',{'action':'pause'})
                except RecoveryError:pass
                runtime['run'](['systemctl','disable','--now',unit+'.socket'])
                runtime['run'](['systemctl','stop',unit+'.service'])
                runtime['run'](['docker','stop','--time','30',name],timeout=45)
                runtime['run'](['docker','start',rollback],timeout=45)
                prior=json.loads(runtime['run'](['docker','inspect',rollback]))[0]
                address=isolation(prior,data['runtimeProof']['image'],network)
                fallback=units(address,unit=DRAIN_ROLLBACK_UNIT)
                for filename,body in fallback.items():
                    write_unit(SYSTEMD/filename,body,unit=DRAIN_ROLLBACK_UNIT)
                    store.put(stage,filename,body.encode())
                runtime['run'](['systemctl','daemon-reload'])
                runtime['run'](['systemctl','enable','--now',DRAIN_ROLLBACK_UNIT+'.socket'])
                result['restoredPausedRollback']=True
            except Exception as rollback_error:result['rollbackError']=type(rollback_error).__name__
        try:result['failureContainment']=check_containment(data,runtime,store,stage,'failure')
        except Exception as failure:result['failureContainment']={'status':'FAIL','code':type(failure).__name__}
    store.put(stage,'result.json',json.dumps(result,sort_keys=True).encode())
    return result|{'stage':stage.name,'manifestSHA256':store.seal(stage)}
