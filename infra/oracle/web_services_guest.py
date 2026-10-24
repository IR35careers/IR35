"""Start only the separately prepared P5 read-only fixture, no Caddy change."""
import copy
import ipaddress
import json
import os
from pathlib import Path
import stat
import subprocess
import time
import urllib.request
import urllib.error
from immutable_artifacts import Store,digest
from p4_recovery_guest import Recovery,RecoveryError

ROOT=Path('/opt/ir35')
NAMES=['ir35-p5-'+name for name in ('auth','rest','storage','kong','web')]


def require_prepared(data):
    store=Store(ROOT/'.env.p5-fixture',uid=1002)
    store.verify('01-prepare',data['prepareAnchor'])
    saved=json.loads((store.root/'01-prepare/result.json').read_bytes())
    if saved.get('status')!='PASS' or saved.get('target')!='ir35_p5_app' or saved.get('pristineUnchanged')is not True:
        raise RecoveryError('P5PreparedFixtureRequired')
    compose=ROOT/'p5-compose.yml'
    if compose.is_symlink() or digest(compose.read_bytes())!=saved['composeSHA256']:raise RecoveryError('P5ComposeIntegrityMismatch')
    expected={'.env.p5-'+name for name in ('auth','rest','storage','kong','kong-config','web')}
    if {item['name'] for item in saved['envFiles']}!=expected:raise RecoveryError('P5EnvironmentSetMismatch')
    for item in saved['envFiles']:
        path=ROOT/item['name'];info=path.lstat()
        if path.is_symlink() or not stat.S_ISREG(info.st_mode) or info.st_uid!=1002 or stat.S_IMODE(info.st_mode)!=0o600 or info.st_nlink!=1 or digest(path.read_bytes())!=item['sha256']:
            raise RecoveryError('P5EnvironmentIntegrityMismatch')
    return store,saved


def private_address(container):
    networks=container['NetworkSettings']['Networks']
    if set(networks)!={'ir35-staging_backend'}:raise RecoveryError('P5PrivateNetworkRequired')
    address=ipaddress.ip_address(networks['ir35-staging_backend']['IPAddress'])
    if address.version!=4 or not address.is_private or address.is_loopback:raise RecoveryError('P5PrivateServiceAddressRequired')
    return str(address)


def probe(address,port,path,headers):
    request=urllib.request.Request('http://'+address+':'+str(port)+path,headers=headers)
    try:
        with urllib.request.urlopen(request,timeout=5) as response:return response.status,response.read(4_000_001),dict(response.headers)
    except urllib.error.HTTPError as error:
        with error:return error.code,error.read(4_000_001),dict(error.headers)


def start(data,runtime):
    store,saved=require_prepared(data)
    original=Recovery(data['p4'],runtime);fixture=copy.copy(original);fixture.database='ir35_p5_app'
    if original.check_database()['status']!='PASS' or fixture.check_database()['status']!='PASS':raise RecoveryError('P5PreServiceFidelityMismatch_Abort')
    existing=set(runtime['run'](['docker','container','ls','--all','--format','{{.Names}}']).splitlines())
    if existing.intersection(NAMES):raise RecoveryError('P5ContainersExist_ReconcileNoReplay')
    stage=store.stage('02-services')
    result={'status':'FAIL','phaseComplete':False,'caddyActivated':False,'productionChanges':False,'sourceWrites':0,'pristineWrites':0}
    created=False
    def inspect():return json.loads(runtime['run'](['docker','inspect',*NAMES]))
    def command(args):
        with store.sink(stage,'command-'+str(len(list(stage.glob('command-*.log')))+1)+'.log') as log:
            code=subprocess.run(args,stdout=log,stderr=log,timeout=180).returncode
        if code:raise RecoveryError('P5ServiceCommandFailed_PrivateLog')
    try:
        store.put(stage,'intent.json',json.dumps({'containers':NAMES,'composeSHA256':saved['composeSHA256'],'prepareManifest':data['prepareAnchor']}).encode())
        command(['docker','compose','-f',str(ROOT/'p5-compose.yml'),'create'])
        created=True
        information=inspect()
        for item in information:
            limits={'auth':256,'rest':256,'storage':512,'kong':384,'web':1536}
            service=item['Name'].removeprefix('/ir35-p5-');host=item['HostConfig']
            if item['Config'].get('User')!='1002:1002' or not host['ReadonlyRootfs'] or host.get('PortBindings') or host['LogConfig']['Type']!='none' or host['Memory']!=limits[service]*1024*1024 or item['Config']['Labels'].get('com.docker.compose.project')!='ir35-p5':
                raise RecoveryError('P5ContainerIsolationMismatch')
        command(['docker','start','ir35-p5-rest','ir35-p5-auth','ir35-p5-storage','ir35-p5-kong','ir35-p5-web'])
        values=runtime['read_env']();deadline=time.monotonic()+120;last={}
        while time.monotonic()<deadline:
            information=inspect();by_name={item['Name'].removeprefix('/'):item for item in information}
            if any(item['State']['Status']!='running' for item in information):break
            try:
                gateway=private_address(by_name['ir35-p5-kong']);web=private_address(by_name['ir35-p5-web'])
                headers={'apikey':values['ANON_KEY'],'Authorization':'Bearer '+values['ANON_KEY']}
                last={name:probe(gateway,8000,path,headers)[0] for name,path in [('auth','/auth/v1/health'),('database','/rest/v1/jobs?select=id&limit=0'),('storage','/storage/v1/status')]}
                last['web']=probe(web,3000,'/robots.txt',{'Host':'staging.ir35careers.com'})[0]
                if all(value==200 for value in last.values()):break
            except (urllib.error.URLError,TimeoutError,ConnectionError):pass
            time.sleep(2)
        if set(last)!={'auth','database','storage','web'} or any(value!=200 for value in last.values()):raise RecoveryError('P5PrivateServicesNotReady')
        # No auth grant or data mutation here. Full P6/P7 dependencies truthfully
        # remain not-configured; do not change health to fake a ready stack.
        code,body,_=probe(web,3000,'/api/health',{'Host':'staging.ir35careers.com'})
        health=json.loads(body) if code in (200,503) else None
        if code!=503 or not isinstance(health,dict) or set(health)!={'ok','checks','buildSHA'} or health.get('ok')is not False or health.get('buildSHA')!=saved['sourceSHA'] or health.get('checks')!={'database':'ready','auth':'ready','storage':'ready','realtime':'not-configured','worker':'not-configured'}:
            raise RecoveryError('P5TruthfulPartialHealthRequired')
        after=fixture.check_database();pristine=original.check_database()
        store.put(stage,'fixture-fidelity.json',json.dumps(after).encode());store.put(stage,'pristine-fidelity.json',json.dumps(pristine).encode())
        if after['status']!='PASS' or pristine['status']!='PASS':raise RecoveryError('P5PostServiceDataMismatch_Abort')
        result.update(status='PASS',privateReadiness=last,health=health,fixtureUnchanged=True,pristineUnchanged=True,containersCreated=5,publicPorts=0)
    except Exception as error:
        result['code']=str(error) if type(error)is RecoveryError else type(error).__name__
        if created:
            # Contain only our label-verified fixture containers; never remove
            # DBs/volumes, reset journals or stop the original P3 services.
            info=inspect()
            result['containerStates']={item['Name'].removeprefix('/'): {'status':item['State']['Status'],'exitCode':item['State']['ExitCode'],'oomKilled':item['State'].get('OOMKilled',False)} for item in info}
            if all(item['Config']['Labels'].get('com.docker.compose.project')=='ir35-p5' for item in info):
                command(['docker','stop','--time','10',*NAMES]);result['fixtureContainersStopped']=True
        after=fixture.check_database();pristine=original.check_database()
        store.put(stage,'failure-fixture-fidelity.json',json.dumps(after).encode());store.put(stage,'failure-pristine-fidelity.json',json.dumps(pristine).encode())
        result['postFailureFidelity']='PASS' if after['status']=='PASS' and pristine['status']=='PASS' else 'FAIL'
        if result['postFailureFidelity']=='FAIL':result['code']='P5PostServiceDataMismatch_Abort'
    store.put(stage,'result.json',json.dumps(result,sort_keys=True).encode())
    return {**result,'stage':stage.name,'manifestSHA256':store.seal(stage,previous=data['prepareAnchor'])}
