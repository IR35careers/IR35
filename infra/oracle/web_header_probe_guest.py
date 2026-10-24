"""Finite private HTTP header experiment; never switches the public Caddy."""
import base64
import json
import os
from pathlib import Path
import time
import urllib.error
from immutable_artifacts import Store
from p4_recovery_guest import RecoveryError
from web_services_guest import require_prepared,private_address,probe

ROOT=Path('/opt/ir35')


def configuration(mode):
    if mode not in ('immediate','deferred','paired'):raise RecoveryError('FixedHeaderProbeModeRequired')
    lines=[]
    for prefix in ([''] if mode=='immediate' else ['>'] if mode=='deferred' else ['', '>']):
        lines.extend(['header '+prefix+'X-Robots-Tag "noindex, nofollow, noarchive"','header '+prefix+'Cache-Control "no-store"'])
    return '{\n admin off\n persist_config off\n auto_https off\n storage file_system {\n  root /tmp/caddy\n }\n}\n:8080 {\n'+ '\n'.join(lines)+'''
 route {
  basic_auth {
   ir35 {$STAGING_BASIC_HASH}
  }
  reverse_proxy ir35-p5-web:3000 {
   header_up Host staging.ir35careers.com
   header_up -Authorization
  }
 }
}
'''


def run(data,runtime,repair=0):
    if type(repair)is not int or repair not in (0,1,2):raise RecoveryError('BoundedPrivateProbeRepairRequired')
    require_prepared(data)
    parent=ROOT/'.env.p5-header-probes'
    if not parent.exists():parent.mkdir(mode=0o700);os.chown(parent,1002,1002)
    store=Store(parent,uid=1002)
    if repair:
        previous='01-header-probe' if repair==1 else '02-header-probe-r1'
        store.verify(previous,data['probeAnchor'])
        if json.loads((parent/previous/'result.json').read_bytes()).get('status')!='FAIL':raise RecoveryError('FailedPrivateProbeRequired')
    stage=store.stage('01-header-probe' if repair==0 else f'{repair+1:02d}-header-probe-r{repair}')
    result={'status':'FAIL','publicEdgeChanged':False,'publicPorts':0,'certificateRequests':0,'phaseComplete':False,'cases':{}}
    image=json.loads((ROOT/'compose.yml').read_text())['services']['caddy']['image']
    values=runtime['read_env']();basic='Basic '+base64.b64encode(('ir35:'+values['STAGING_BASIC_PASSWORD']).encode()).decode()
    current=None
    try:
        existing=set(runtime['run'](['docker','container','ls','--all','--format','{{.Names}}']).splitlines())
        if any('ir35-p5-header-probe-'+mode in existing for mode in ('immediate','deferred','paired')):raise RecoveryError('HeaderProbeExists_NoReplay')
        for mode in ('immediate','deferred','paired'):
            store.put(stage,mode+'.caddy',configuration(mode).encode())
            current='ir35-p5-header-probe-'+mode
            runtime['run'](['docker','run','--detach','--pull','never','--name',current,'--restart','no','--network','ir35-staging_backend',
                '--read-only','--memory','128m','--pids-limit','64','--user','1002:1002','--log-driver','none','--cap-drop','ALL','--cap-add','NET_BIND_SERVICE','--security-opt','no-new-privileges:true',
                '--tmpfs','/tmp:rw,size=16m,uid=1002,gid=1002,mode=0700','--tmpfs','/data:rw,size=16m,uid=1002,gid=1002,mode=0700',
                '--tmpfs','/config:rw,size=16m,uid=1002,gid=1002,mode=0700','--volume','/opt/ir35/bin/env-exec:/run/ir35/env-exec:ro',
                '--volume','/opt/ir35/.env.p5-caddy:/opt/ir35/.env.p5-caddy:ro','--volume',str(stage/(mode+'.caddy'))+':/probe.caddy:ro',
                '--entrypoint','/run/ir35/env-exec',image,'/opt/ir35/.env.p5-caddy','caddy','run','--config','/probe.caddy','--adapter','caddyfile'])
            info=json.loads(runtime['run'](['docker','inspect',current]))[0]
            if info['HostConfig'].get('PortBindings'):raise RecoveryError('PrivateProbeHasPublicPorts')
            deadline=time.monotonic()+20
            while True:
                info=json.loads(runtime['run'](['docker','inspect',current]))[0]
                if info['State']['Status']=='exited':raise RecoveryError('PrivateHeaderProbeExited_'+str(info['State']['ExitCode']))
                try:
                    address=private_address(info)
                    code,body,headers=probe(address,8080,'/jobs',{})
                    if code==401:break
                except (urllib.error.URLError,TimeoutError,ConnectionError):pass
                if time.monotonic()>deadline:raise RecoveryError('PrivateHeaderProbeNotReady')
                time.sleep(1)
            def projection(code,headers):
                # HTTP header names are case-insensitive, including fixtures.
                normalized={key.lower():value for key,value in headers.items()}
                return {'status':code,'noindex':'noindex' in normalized.get('x-robots-tag',''),'noStoreExact':normalized.get('cache-control')=='no-store'}
            unauthorized=projection(code,headers)
            code,body,headers=probe(address,8080,'/jobs',{'Authorization':basic})
            result['cases'][mode]={'unauthorized':unauthorized,'authorized':projection(code,headers)}
            runtime['run'](['docker','stop','--time','5',current]);runtime['run'](['docker','rm','--volumes',current]);current=None
        if result['cases']['paired']!={'unauthorized':{'status':401,'noindex':True,'noStoreExact':True},'authorized':{'status':200,'noindex':True,'noStoreExact':True}}:
            raise RecoveryError('PairedPrivateHeaderProofFailed')
        result['status']='PASS';result['temporaryContainersRemoved']=3
    except Exception as error:
        result['code']=str(error) if type(error)is RecoveryError else type(error).__name__
        trace=error.__traceback__;frames=[]
        while trace:
            frames.append({'function':trace.tb_frame.f_code.co_name,'line':trace.tb_lineno});trace=trace.tb_next
        result['frames']=frames # Never messages, locals, credentials or raw logs.
    finally:
        if current:
            runtime['run'](['docker','stop','--time','5',current]);runtime['run'](['docker','rm','--volumes',current])
    store.put(stage,'result.json',json.dumps(result,sort_keys=True).encode())
    return {**result,'stage':stage.name,'manifestSHA256':store.seal(stage)}
