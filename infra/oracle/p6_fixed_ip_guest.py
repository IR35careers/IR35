"""Single owner-approved fixed endpoint. No Docker network/OCI creation."""
import ipaddress
import json
import os
from pathlib import Path
import subprocess
import time

from immutable_artifacts import digest
from p6_mock_guest import ROOT,prepared,validate_config
from p6_restart_diagnosis_guest import history,queue_ledger,external_isolation
from web_edge_guest import private_env
from p6_health_repair_guest import FIXED_UNIT,FIXED_ROLLBACK_UNIT,FINAL_ROLLBACK_UNIT,SYSTEMD,units,write_unit,validate_proxy,isolation
from p6_mock_receipt_repair_guest import configuration
from p6_mock_control import Control
from p6_restart_diagnosis_guest import private_health
from p6_mock_guest import check_containment,prerequisites
from p4_recovery_guest import RecoveryError

NETWORK='ir35-staging_backend'
ADDRESS='172.18.0.240'
NAME='ir35-p6-mock-worker-v7-fixedip'
UNIT='ir35-p6-health-proxy-fixedip-owner1'
COMPOSE=ROOT/'p6-mock-compose-v7-fixedip.yml'
ROLLBACK_NAME=NAME+'-rollback'
ROLLBACK_ADDRESS='172.18.0.241'
ROLLBACK_COMPOSE=ROOT/'p6-mock-compose-v7-fixedip-rollback.yml'


def fixed_configuration(image,source,*,rollback=False):
    value=configuration(image,source,owner_resume=True,pause_repair=not rollback)
    name=ROLLBACK_NAME if rollback else NAME
    value['name']='ir35-p6-fixedip-owner1'+('-rollback' if rollback else '')
    service=value['services']['worker'];service['container_name']=name
    service['networks']['backend']['ipv4_address']=ROLLBACK_ADDRESS if rollback else ADDRESS
    return value


def verify_fixed_endpoint(item,anchor,control):
    address=item['NetworkSettings']['Networks'][NETWORK]
    expected=ROLLBACK_ADDRESS if item['Name'].lstrip('/')==ROLLBACK_NAME else ADDRESS
    if address.get('IPAddress')!=expected or address.get('IPAMConfig',{}).get('IPv4Address')!=expected:
        raise RecoveryError('ExplicitFixedIPNotRetained_HardStop')
    direct=private_health(expected);code,local=control.request('GET','/health')
    fields=('ok','browserReady','databaseReady','mode','realAcceptance','paused','active','buildSHA')
    if (code!=200 or direct.get('status')!=200 or any(direct.get(k)!=local.get(k) for k in fields)
            or local.get('buildSHA')!=anchor['sourceSHA'] or local.get('realAcceptance')is not False or local.get('mode')!='staging-mock-only'):
        raise RecoveryError('FixedIPDirectLocalhostIdentityMismatch_HardStop')
    return {'status':'PASS','fixedIP':expected,'IPAMConfigMatches':True,'directLocalhostBuildSHAEqual':True,
        'buildSHA':local['buildSHA'],'browserReady':local['browserReady'],'databaseReady':local['databaseReady'],
        'paused':local['paused'],'active':local['active'],'realAcceptance':False}


def wait_direct(address,source):
    deadline=time.monotonic()+90
    while True:
        health=private_health(address)
        if health.get('status')==200 and health.get('ok')is True:
            if health.get('buildSHA')!=source or health.get('paused')is not True or health.get('active')!=0 or health.get('realAcceptance')is not False:
                raise RecoveryError('FixedIPInitialIdentityOrPauseMismatch')
            return health
        if time.monotonic()>=deadline:raise RecoveryError('FixedIPDirectHealthDeadline')
        time.sleep(1)


def launch(value,path,runtime,store,stage):
    if path.exists():raise RecoveryError('FixedIPComposeAlreadyExists_NoOverwrite')
    body=json.dumps(value,sort_keys=True,indent=2).encode()
    fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o644)
    with os.fdopen(fd,'wb') as output:output.write(body);output.flush();os.fsync(output.fileno())
    os.chmod(path,0o644)
    store.put(stage,path.name,body)
    with store.sink(stage,path.stem+'-compose.log') as log:
        args=['docker','compose','--env-file',str(ROOT/'.env'),'-f',str(path)]
        if subprocess.run(args+['config','--quiet'],stdout=log,stderr=log,timeout=30).returncode:
            raise RecoveryError('FixedIPComposeValidationFailed')
        if subprocess.run(args+['up','-d','--no-deps','--pull','never','worker'],stdout=log,stderr=log,timeout=120).returncode:
            raise RecoveryError('FixedIPWorkerStartFailed_NoRetry')


def install_proxy(address,unit,runtime,store,stage):
    bodies=units(address,unit=unit)
    for name,body in bodies.items():
        write_unit(SYSTEMD/name,body,unit=unit);store.put(stage,name,body.encode())
    with store.sink(stage,unit+'-validate.log') as log:
        if subprocess.run(['systemd-analyze','verify',*[str(SYSTEMD/name) for name in bodies]],stdout=log,stderr=log,timeout=20).returncode:
            raise RecoveryError('FixedIPProxyValidationFailed')
    runtime['run'](['systemctl','daemon-reload'])
    runtime['run'](['systemctl','enable','--now',unit+'.socket'])
    return bodies


def rollback(data,runtime,store,stage):
    # Single new rollback identity; original container/images/files untouched.
    names=runtime['run'](['docker','ps','-a','--format','{{.Names}}']).splitlines()
    if NAME in names:
        item=json.loads(runtime['run'](['docker','inspect',NAME]))[0]
        if item['Image']!=data['finalBuild']['image']:raise RecoveryError('FixedIPRollbackCandidateIdentityMismatch')
        runtime['run'](['docker','stop','--time','30',NAME],timeout=45)
    if (SYSTEMD/(FIXED_UNIT+'.socket')).exists():
        runtime['run'](['systemctl','disable','--now',FIXED_UNIT+'.socket'])
        runtime['run'](['systemctl','stop',FIXED_UNIT+'.service'])
    network=json.loads(runtime['run'](['docker','inspect','--type','network',NETWORK]))[0]
    network_plan(network,ROLLBACK_ADDRESS)
    prior=data['rollbackBuild'];value=fixed_configuration(prior['image'],prior['sourceSHA'],rollback=True)
    if ROLLBACK_NAME in names:raise RecoveryError('FixedIPRollbackAlreadyExists_NoRetry')
    launch(value,ROLLBACK_COMPOSE,runtime,store,stage)
    wait_direct(ROLLBACK_ADDRESS,prior['sourceSHA'])
    original='ir35-p6-mock-worker-v6-rollback'
    if original in names and json.loads(runtime['run'](['docker','inspect',original]))[0]['State']['Running']:
        runtime['run'](['docker','stop','--time','30',original],timeout=45)
    for old in (FINAL_ROLLBACK_UNIT,FIXED_UNIT):
        if (SYSTEMD/(old+'.socket')).exists():
            runtime['run'](['systemctl','disable','--now',old+'.socket'])
            runtime['run'](['systemctl','stop',old+'.service'])
    bodies=install_proxy(ROLLBACK_ADDRESS,FIXED_ROLLBACK_UNIT,runtime,store,stage)
    control=Control(private_env(ROOT/'.env.p6-mock-control')['APPLICATION_WORKER_SECRET'])
    observed=verify_fixed_endpoint(json.loads(runtime['run'](['docker','inspect',ROLLBACK_NAME]))[0],prior,control)
    validate_proxy(runtime,bodies,unit=FIXED_ROLLBACK_UNIT)
    return {'status':'PASS','image':prior['image'],'sourceSHA':prior['sourceSHA'],'processingPaused':True,'endpoint':observed,
        'originalImagesRetained':True,'noSecretChanges':True}


def handover(data,runtime):
    store=prepared(data);data=data|{'workerBuild':data['finalBuild']};prerequisites(data,runtime)
    stage=store.stage('27-owner-fixedip-handover')
    result={'status':'FAIL','fixedIPOwnerRepair':True,'repairAttempt':1,'ownerLifecycleAllowance':1,'newBuilds':0,
        'newNetworks':0,'ociNetworkChanges':0,'productionChanges':False,'secretChanges':0,'realAcceptance':False}
    requested=False;switched=False;old_stopped=False
    try:
        result['preContainment']=check_containment(data,runtime,store,stage,'pre')
        network=json.loads(runtime['run'](['docker','inspect','--type','network',NETWORK]))[0]
        result['fixedIPPlan']=network_plan(network);network_plan(network,ROLLBACK_ADDRESS)
        before=queue_ledger(data,runtime)
        if before['status']!='PASS' or before['stableLedgerSHA256']!=data['fixedIPPreflight']['ledger']['stableLedgerSHA256']:
            raise RecoveryError('FixedIPRetainedLedgerChanged_HardStop')
        result['retainedLedger']=before
        old=json.loads(runtime['run'](['docker','inspect','ir35-p6-mock-worker-v6-rollback']))[0]
        if old['State']['Running']is not True or old['Image']!=data['rollbackBuild']['image']:
            raise RecoveryError('VerifiedPausedRollbackMustBePresent')
        control=Control(private_env(ROOT/'.env.p6-mock-control')['APPLICATION_WORKER_SECRET'])
        old_health=control.request('GET','/health')[1]
        if old_health.get('paused')is not True or old_health.get('active')!=0:raise RecoveryError('OriginalRollbackMustBePausedIdle')
        preview=units(ADDRESS,unit=FIXED_UNIT+'-preflight')
        for name,body in preview.items():store.put(stage,name,body.encode())
        with store.sink(stage,'proxy-preflight.log') as log:
            if subprocess.run(['systemd-analyze','verify',*[str(stage/name) for name in preview]],stdout=log,stderr=log,timeout=20).returncode:
                raise RecoveryError('FixedIPProxyPreflightFailed')
        store.put(stage,'intent.json',json.dumps({'container':NAME,'image':data['finalBuild']['image'],'fixedIP':ADDRESS,
            'networkID':network['Id'],'rollbackImage':data['rollbackBuild']['image'],'starts':1,'realAcceptance':False}).encode())
        requested=True;launch(fixed_configuration(data['finalBuild']['image'],data['finalBuild']['sourceSHA']),COMPOSE,runtime,store,stage)
        wait_direct(ADDRESS,data['finalBuild']['sourceSHA'])
        runtime['run'](['docker','stop','--time','30','ir35-p6-mock-worker-v6-rollback'],timeout=45);old_stopped=True
        runtime['run'](['systemctl','disable','--now',FINAL_ROLLBACK_UNIT+'.socket'])
        runtime['run'](['systemctl','stop',FINAL_ROLLBACK_UNIT+'.service']);switched=True
        bodies=install_proxy(ADDRESS,FIXED_UNIT,runtime,store,stage)
        item=json.loads(runtime['run'](['docker','inspect',NAME]))[0]
        isolation(item,data['finalBuild']['image'],network)
        endpoint=verify_fixed_endpoint(item,data['finalBuild'],control)
        validate_proxy(runtime,bodies,unit=FIXED_UNIT)
        result['containment']=check_containment(data,runtime,store,stage,'post')
        result.update(status='PASS',image=data['finalBuild']['image'],sourceSHA=data['finalBuild']['sourceSHA'],containerName=NAME,
            composeSHA256=digest(COMPOSE.read_bytes()),unitSHA256={k:digest(v.encode()) for k,v in bodies.items()},endpoint=endpoint,
            previousImageRetained=True,workerRestarts=0,phaseComplete=False)
    except Exception as error:
        result['code']=str(error) if type(error)in(RuntimeError,RecoveryError) else type(error).__name__
        if requested:
            try:result['rollback']=rollback(data,runtime,store,stage)
            except Exception as failure:result['rollback']={'status':'FAIL','code':type(failure).__name__}
        try:result['failureContainment']=check_containment(data,runtime,store,stage,'failure')
        except Exception as failure:result['failureContainment']={'status':'FAIL','code':type(failure).__name__}
    store.put(stage,'result.json',json.dumps(result,sort_keys=True).encode())
    return result|{'stage':stage.name,'manifestSHA256':store.seal(stage)}


def full(data,runtime):
    from p6_lifecycle_guest import run as lifecycle
    import p6_integration_guest as integration
    from p6_restart_diagnosis_guest import containment
    store=prepared(data);stage=store.stage('28-owner-fixedip-full-p6')
    result={'status':'FAIL','phaseComplete':False,'ownerFullP6Attempt':1,'historicalCountersPreserved':True,
        'realAcceptance':False,'productionChanges':False,'newBuilds':0,'secretValuesChanged':False}
    app_stage=None
    try:
        store.put(stage,'intent.json',json.dumps({'ownerApproval':'26Oct-fixed-IP-one-full-P6','lifecycleRuns':1,
            'image':data['finalBuild']['image'],'rollbackImage':data['rollbackBuild']['image'],'assertionsOrTimeoutsChanged':False}).encode())
        result['lifecycle']=lifecycle(data,runtime,fixed_ip=True)
        if result['lifecycle']['status']!='PASS':raise RecoveryError('OwnerFixedIPLifecycleFailed_StopNoRetry')
        passed={row['case'] for row in result['lifecycle']['cases'] if row['passed']is True}
        if not {'mock-health','schedule-mock_ingest','schedule-mock_automation','schedule-watchdog','restart-health',
                'fixedip-every-owned-schedule-durable','fixedip-direct-localhost-after-restart'}.issubset(passed):
            raise RecoveryError('OwnerFixedIPRequiredRegressionEvidenceMissing')
        app_stage=store.stage('30-owner-fixedip-app-realtime-schedules')
        prepared_app=integration.prepare(data,runtime,store,app_stage)
        result['integration']=integration.verify(data,runtime,store,app_stage,prepared_app)
        store.put(app_stage,'result.json',json.dumps(result['integration'],sort_keys=True).encode())
        result['integration']['stage']=app_stage.name;result['integration']['manifestSHA256']=store.seal(app_stage)
        result['fullContainment']=containment(data,runtime,probe_container=NAME)
        store.put(stage,'full-containment.json',json.dumps(result['fullContainment'],sort_keys=True).encode())
        if result['fullContainment']['status']!='PASS':raise RecoveryError('OwnerFixedIPFullContainmentMismatch_HardStop')
        smtp=external_isolation(data,runtime)
        # This historical helper checks the two retained old images and the SAME
        # sink. The active fixed-IP image is separately checked by isolation().
        if smtp['status']!='PASS':raise RecoveryError('OwnerFixedIPSMTPOrProviderBoundaryMismatch')
        store.put(stage,'smtp-and-retained-isolation.json',json.dumps(smtp).encode())
        active=json.loads(runtime['run'](['docker','inspect',NAME]))[0]
        net=json.loads(runtime['run'](['docker','inspect','--type','network',NETWORK]))[0]
        isolation(active,data['finalBuild']['image'],net)
        endpoint=verify_fixed_endpoint(active,data['finalBuild'],Control(private_env(ROOT/'.env.p6-mock-control')['APPLICATION_WORKER_SECRET']))
        result.update(status='PASS',phaseComplete=True,failuresOneAndTwoRechecked=True,
            restartCheck=result['lifecycle']['workerRestarts']==1,endpoint=endpoint,APPLY_RUNNER='mock',SMTP='private-sink-only')
    except Exception as error:
        result['code']=str(error) if type(error)in(RuntimeError,RecoveryError) else type(error).__name__
        if app_stage is not None:
            try:
                if not (app_stage/'manifest.json').exists():
                    store.put(app_stage,'failure.json',json.dumps({'status':'FAIL','code':result['code']}).encode())
                    result['integrationFailureManifestSHA256']=store.seal(app_stage)
                result['appRollback']=integration.restore(data,runtime,store,stage)
            except Exception as failure:result['appRollback']={'status':'FAIL','code':type(failure).__name__}
        back=store.stage('32-owner-fixedip-failure-rollback')
        try:result['rollback']=rollback(data,runtime,store,back)
        except Exception as failure:result['rollback']={'status':'FAIL','code':type(failure).__name__}
        try:result['failureContainment']=containment(data,runtime,probe_container=ROLLBACK_NAME)
        except Exception as failure:result['failureContainment']={'status':'FAIL','code':type(failure).__name__}
        store.put(back,'result.json',json.dumps({'rollback':result.get('rollback'),'containment':result.get('failureContainment')},sort_keys=True).encode())
        result['rollbackManifestSHA256']=store.seal(back)
    store.put(stage,'result.json',json.dumps(result,sort_keys=True).encode())
    return result|{'stage':stage.name,'manifestSHA256':store.seal(stage)}


def network_plan(network,address=ADDRESS):
    if network.get('Name')!=NETWORK or network.get('Driver')!='bridge' or network.get('Internal')is not True:
        raise RuntimeError('ExistingPrivateBridgeRequired_NoNetworkChange')
    configs=network.get('IPAM',{}).get('Config',[])
    subnets=[ipaddress.ip_network(row['Subnet']) for row in configs if row.get('Subnet') and ':' not in row['Subnet']]
    ip=ipaddress.ip_address(address)
    if ip.version!=4 or len(subnets)!=1 or ip not in subnets[0] or not ip.is_private or ip in (subnets[0].network_address,subnets[0].broadcast_address):
        raise RuntimeError('FixedIPv4InsideExistingIPAMRequired')
    used={str(ipaddress.ip_interface(row['IPv4Address']).ip) for row in network.get('Containers',{}).values() if row.get('IPv4Address')}
    reserved={row['Gateway'] for row in configs if row.get('Gateway')}|{str(v) for row in configs for v in row.get('AuxiliaryAddresses',{}).values()}
    if address in used|reserved:raise RuntimeError('FixedIPv4AlreadyAllocated_NoDisconnectOrRetry')
    return {'status':'PASS','network':NETWORK,'networkID':network['Id'],'internal':True,'driver':'bridge',
        'subnet':str(subnets[0]),'ipv4_address':address,'addressUnallocated':True,'existingEndpoints':len(used),
        'newNetworks':0,'networkRulesChanged':False}


def preflight(data,runtime):
    history(data);prepared(data)
    network=json.loads(runtime['run'](['docker','inspect','--type','network',NETWORK]))[0]
    plan=network_plan(network)
    ledger=queue_ledger(data,runtime);external=external_isolation(data,runtime)
    if ledger['status']!='PASS' or external['status']!='PASS':raise RuntimeError('FixedIPPrerequisiteDataOrSecurityMismatch')
    names=runtime['run'](['docker','ps','-a','--format','{{.Names}}']).splitlines()
    if NAME in names or COMPOSE.exists() or any((Path('/etc/systemd/system')/(UNIT+suffix)).exists() for suffix in ('.service','.socket')):
        raise RuntimeError('FixedIPRepairAlreadyExists_NoReplay')
    images=json.loads(runtime['run'](['docker','image','inspect',data['finalBuild']['image'],data['rollbackBuild']['image']]))
    if [row['Id'] for row in images]!=[data['finalBuild']['image'],data['rollbackBuild']['image']] or any(row['Architecture']!='arm64' for row in images):
        raise RuntimeError('BothRetainedPinnedARMImagesRequired')
    values=private_env(ROOT/'.env.p6-mock-worker');validate_config(values)
    containers=json.loads(runtime['run'](['docker','inspect',*runtime['run'](['docker','ps','-q']).splitlines()]))
    services=[{'name':row['Name'].lstrip('/'),'image':row['Image'],'state':row['State']['Status'],
        'health':row['State'].get('Health',{}).get('Status'),'restartPolicy':row['HostConfig']['RestartPolicy']['Name'],
        'memoryLimitBytes':row['HostConfig']['Memory']} for row in containers]
    memory={key:int(value.split()[0]) for line in Path('/proc/meminfo').read_text().splitlines() for key,value in [line.split(':',1)]
        if key in ('MemAvailable','MemTotal','SwapFree','SwapTotal')}
    return {'status':'PASS','readOnly':True,'vmWrites':0,'plan':plan,'ledger':ledger,'externalIsolation':external,'services':services,
        'memoryKiB':memory,'candidateImage':images[0]['Id'],'rollbackImage':images[1]['Id'],
        'secretsUnchanged':True,'privateWorkerEnvSHA256':digest((ROOT/'.env.p6-mock-worker').read_bytes())}
