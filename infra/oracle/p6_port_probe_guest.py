"""Credential-free network diagnosis, never replay the stopped worker."""
import ipaddress
import json
import subprocess
import time
import urllib.request
import urllib.error
from p4_recovery_guest import RecoveryError
from p6_mock_guest import prerequisites,prepared,check_containment,ROOT,NAME

PROBE='ir35-p6-port-probe-1'


def fetch(url):
    opener=urllib.request.build_opener(urllib.request.ProxyHandler({}))
    try:
        with opener.open(url,timeout=3) as response:
            value=json.loads(response.read(1024));return {'status':response.status,'marker':value=={'fixture':True}}
    except (urllib.error.URLError,TimeoutError,ConnectionError):return {'status':0,'marker':False}


def run(data,runtime):
    prerequisites(data,runtime);store=prepared(data);failed=data['failedStart']
    if failed.get('status')!='FAIL' or failed.get('code')!='NativeMockHealthMismatch' or failed.get('containment',{}).get('status')!='PASS' or failed.get('stoppedAfterFailure')is not True:
        raise RecoveryError('ExactStoppedFailedHealthGateRequired')
    store.verify(failed['stage'],failed['manifestSHA256'])
    original=json.loads(runtime['run'](['docker','inspect',NAME]))[0]
    if original['State']['Status']!='exited' or original['Image']!=data['workerBuild']['image']:raise RecoveryError('FailedWorkerMustRemainStopped')
    stage=store.stage('07-network-diagnose');result={'status':'FAIL','workerRestarts':0,'customerWrites':0,'productionChanges':False,'secretMounts':0};created=False
    try:
        if PROBE in runtime['run'](['docker','ps','-a','--format','{{.Names}}']).splitlines():raise RecoveryError('NetworkProbeExists_NoReplay')
        if runtime['run'](['ss','-H','-ltn','sport = :18788']).strip():raise RecoveryError('ProbeLoopbackPortBusy')
        result['preContainment']=check_containment(data,runtime,store,stage,'pre')
        store.put(stage,'intent.json',json.dumps({'probe':PROBE,'image':data['workerBuild']['image'],'port':'127.0.0.1:18788','network':'ir35-staging_backend','secrets':False,'workerReplay':False}).encode())
        code="require('node:http').createServer((q,r)=>{r.setHeader('content-type','application/json');r.end(JSON.stringify({fixture:true}))}).listen(18788,'0.0.0.0')"
        runtime['run'](['docker','run','-d','--name',PROBE,'--label','ir35-purpose=p6-internal-port-probe','--network','ir35-staging_backend',
          '--publish','127.0.0.1:18788:18788','--read-only','--user','1002:1002','--memory','128m','--pids-limit','32',
          '--cap-drop','ALL','--security-opt','no-new-privileges:true','--log-driver','none','--no-healthcheck',
          '--entrypoint','node',data['workerBuild']['image'],'-e',code])
        created=True;item=json.loads(runtime['run'](['docker','inspect',PROBE]))[0]
        if item['Image']!=data['workerBuild']['image'] or item['Mounts'] or item['Config']['Labels'].get('ir35-purpose')!='p6-internal-port-probe' or set(item['NetworkSettings']['Networks'])!={'ir35-staging_backend'}:raise RecoveryError('ProbeIdentityOrIsolationMismatch')
        address=item['NetworkSettings']['Networks']['ir35-staging_backend']['IPAddress']
        ip=ipaddress.ip_address(address)
        if ip.version!=4 or not ip.is_private or ip.is_loopback:raise RecoveryError('ProbePrivateBridgeAddressRequired')
        direct=None;deadline=time.monotonic()+20
        while time.monotonic()<deadline:
            direct=fetch('http://'+address+':18788/')
            if direct=={'status':200,'marker':True}:break
            time.sleep(1)
        local=fetch('http://127.0.0.1:18788/')
        mapping=item['NetworkSettings']['Ports'].get('18788/tcp')
        result.update(directBridge=direct,requestedLoopback=local,actualPublishedMapping=mapping,
          requestedBinding=item['HostConfig']['PortBindings'],networkInternal=True,
          originalInternalHealthExitCodes=[row['ExitCode'] for row in original['State'].get('Health',{}).get('Log',[])])
        if direct!={'status':200,'marker':True} or local!={'status':0,'marker':False} or mapping is not None:raise RecoveryError('InternalPortDiagnosisDidNotMatch_NoRepairAssumption')
        result.update(status='PASS',cause='Docker omits port publication when container has only an internal bridge',
          evidence='https://github.com/moby/moby/issues/36174',proposedRepair='Keep internal-only worker; use a bounded localhost-only host proxy, no public ingress or egress expansion')
    except Exception as error:result['code']=str(error) if type(error)is RecoveryError else type(error).__name__
    finally:
        if created:
            result['probeStopped']=subprocess.run(['docker','stop','--time','5',PROBE],capture_output=True,timeout=15).returncode==0
            # Owned no-mount fixture only; never a source/worker/data volume.
            if result.get('status')=='PASS' and result['probeStopped']:
                result['probeRemoved']=subprocess.run(['docker','rm',PROBE],capture_output=True,timeout=15).returncode==0
                if not result['probeRemoved']:result['status']='FAIL'
    try:result['containment']=check_containment(data,runtime,store,stage,'post')
    except Exception as error:result.update(status='FAIL',containmentError=type(error).__name__)
    store.put(stage,'result.json',json.dumps(result,sort_keys=True).encode())
    return result|{'stage':stage.name,'manifestSHA256':store.seal(stage)}
