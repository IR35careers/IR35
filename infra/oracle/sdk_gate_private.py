"""Finite stub-only Docker regression. No OCI, SSH, app or DB credentials."""
import argparse
import base64
import hashlib
import ipaddress
import json
import os
from pathlib import Path
import subprocess
import time
import urllib.request
import urllib.error
from immutable_artifacts import Store,digest
from sdk_gate_config import literal_sdk,instrument_sdk,redact_adapted
from sdk_gate_observation import Observer,sdk_cases

HERE=Path(__file__).resolve().parent
CADDY='library/caddy:2.10.2-alpine@sha256:4c6e91c6ed0e2fa03efd5b44747b625fec79bc9cd06ac5235a779726618e530d'
NODE='node:22-bookworm-slim@sha256:de170b39439eb0e5a3444ad7d60b015614a381e10fecae2e30ec9e735122f38d'
TOKEN='public-fixture-sdk-token'
PASSWORD='public-fixture-password'


def command(args,*,input=None,timeout=60):
    result=subprocess.run(args,input=input,capture_output=True,timeout=timeout)
    if result.returncode:raise RuntimeError('PrivateDockerCommandFailed_'+str(result.returncode))
    return result.stdout.decode()


def config(block,password_hash):
    block=instrument_sdk(block).replace('ir35-p5-kong:8000','sdk-stub:8081').replace('{$STAGING_GATE_TOKEN}',TOKEN)
    return '''{
 admin off
 persist_config off
 auto_https off
 storage file_system {
  root /tmp/caddy
 }
}
:8080 {
 header X-Robots-Tag "noindex, nofollow, noarchive"
 header Cache-Control "no-store"
 header >X-Robots-Tag "noindex, nofollow, noarchive"
 header >Cache-Control "no-store"
 header X-Caddy-Request-ID {http.request.uuid}
 header >X-Caddy-Request-ID {http.request.uuid}
 route {
  @sdk path /supabase/*
'''+block+'''
  handle {
   route {
    header X-IR35-Matched-Route "basic-auth-rejection"
    basic_auth {
     ir35 '''+password_hash+'''
    }
    header >Set-Cookie "__Host-ir35-staging='''+TOKEN+'''; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=1800"
    request_header -Authorization
    header X-IR35-Matched-Route "page-proxy"
    reverse_proxy sdk-stub:8081 {
    }
   }
  }
 }
}
'''


def request(address,method,path,headers):
    req=urllib.request.Request('http://'+address+':8080'+path,method=method,headers=headers)
    try:
        with urllib.request.urlopen(req,timeout=8) as response:return response.status,dict(response.headers),response.read(1_000_000)
    except urllib.error.HTTPError as error:
        with error:return error.code,dict(error.headers),error.read(1_000_000)


def run(root,mode,*,attempt=1):
    if mode not in ('baseline','fixed') or attempt not in (1,2):raise RuntimeError('BoundedPrivateAttemptRequired')
    root=Path(root);root.mkdir(mode=0o700,parents=True,exist_ok=True)
    store=Store(root);stage=store.stage(f'{attempt:02d}-{mode}')
    network=f'ir35-sdk-owner1-a{attempt}-{mode}';names=[network+'-stub',network+'-caddy'];created=[];network_created=False
    result={'status':'FAIL','mode':mode,'attempt':attempt,'publicPorts':0,'existingNetworkConnections':0,'dataOrSecretMounts':0,'stagingEdgeChanged':False,'cases':[]}
    uid=os.getuid();common=['--read-only','--memory','128m','--pids-limit','128','--user',f'{uid}:{uid}',
        '--cap-drop','ALL','--security-opt','no-new-privileges:true','--log-driver','none','--restart','no',
        '--tmpfs',f'/tmp:rw,size=16m,uid={uid},gid={uid},mode=0700',
        '--tmpfs',f'/data:rw,size=1m,uid={uid},gid={uid},mode=0700',
        '--tmpfs',f'/config:rw,size=1m,uid={uid},gid={uid},mode=0700']
    try:
        store.put(stage,'intent.json',json.dumps({'network':network,'containers':names,'internalOnly':True,'stubOnly':True,'attempt':attempt,'mode':mode}).encode())
        if command(['docker','network','ls','--filter','name=^'+network+'$','--format','{{.Name}}']).strip():raise RuntimeError('PrivateNetworkExists_NoReplay')
        for name in names:
            if command(['docker','ps','-a','--filter','name=^/'+name+'$','--format','{{.Names}}']).strip():raise RuntimeError('PrivateContainerExists_NoReplay')
        for image in (CADDY,NODE):command(['docker','pull',image],timeout=180)
        password_hash=command(['docker','run','--rm','-i','--network','none','--log-driver','none',CADDY,'caddy','hash-password','--algorithm','bcrypt'],input=(PASSWORD+'\n').encode()).strip()
        baseline=(HERE/'fixtures/sdk-before.caddy').read_text()
        body=config(baseline if mode=='baseline' else literal_sdk(baseline),password_hash)
        store.put(stage,'Caddyfile',body.encode());store.put(stage,'stub.mjs',(HERE/'fixtures/sdk-stub.mjs').read_bytes())
        caddy_args=['docker','run','--rm','--network','none',*common,'--cap-add','NET_BIND_SERVICE',
                    '--volume',str(stage/'Caddyfile')+':/fixture.caddy:ro',CADDY,'caddy']
        adapted=json.loads(command(caddy_args+['adapt','--config','/fixture.caddy','--adapter','caddyfile']))
        command(caddy_args+['validate','--config','/fixture.caddy','--adapter','caddyfile'])
        redacted=redact_adapted(adapted,{password_hash:'<public-fixture-bcrypt>',TOKEN:'<public-fixture-gate>'})
        store.put(stage,'adapted.json',json.dumps(redacted,sort_keys=True,indent=2).encode())
        command(['docker','network','create','--internal','--label','ir35.purpose=sdk-owner1-isolated',network]);network_created=True
        command(['docker','run','--detach','--name',names[0],'--network',network,'--network-alias','sdk-stub',*common,
                 '--label','ir35.purpose=sdk-owner1-isolated','--volume',str(stage/'stub.mjs')+':/stub.mjs:ro',NODE,'node','/stub.mjs']);created.append(names[0])
        command(['docker','run','--detach','--name',names[1],'--network',network,*common,'--cap-add','NET_BIND_SERVICE',
                 '--label','ir35.purpose=sdk-owner1-isolated','--volume',str(stage/'Caddyfile')+':/fixture.caddy:ro',CADDY,
                 'caddy','run','--config','/fixture.caddy','--adapter','caddyfile']);created.append(names[1])
        net=json.loads(command(['docker','network','inspect',network]))[0]
        if not net['Internal'] or len(net['Containers'])!=2:raise RuntimeError('PrivateIsolationFailed')
        info=json.loads(command(['docker','inspect',*names]))
        if any(item['HostConfig'].get('PortBindings') or set(item['NetworkSettings']['Networks'])!={network} or any(mount['Destination'] not in ('/fixture.caddy','/stub.mjs','/data','/config') for mount in item.get('Mounts',[])) for item in info):raise RuntimeError('PrivateIsolationFailed')
        address=info[1]['NetworkSettings']['Networks'][network]['IPAddress']
        if not ipaddress.ip_address(address).is_private:raise RuntimeError('PrivateAddressRequired')
        deadline=time.monotonic()+20
        while True:
            try:
                if request(address,'GET','/jobs',{})[0]==401:break
            except (urllib.error.URLError,TimeoutError,ConnectionError):pass
            if time.monotonic()>deadline:raise RuntimeError('PrivateReadinessTimeout')
            time.sleep(1)
        observer=Observer(store,stage);call=lambda method,path,headers:request(address,method,path,headers)
        sdk_cases(observer,call,TOKEN)
        basic='Basic '+base64.b64encode(('ir35:'+PASSWORD).encode()).decode()
        observer.case('jobs','GET','/jobs',200,lambda rid:call('GET','/jobs',{'Authorization':basic,'X-IR35-Client-Request-ID':rid}),
            checks=lambda h,b:{'exactRoute':h.get('x-ir35-matched-route')=='page-proxy','h1':b'<h1>Find your next contract</h1>' in b,'secureCookie':all(flag in h.get('set-cookie','') for flag in ('Secure','HttpOnly','SameSite=Strict','Path=/'))})
        observer.case('maintenance','POST','/api/jobs/search',503,lambda rid:call('POST','/api/jobs/search',{'Authorization':basic,'X-IR35-Client-Request-ID':rid}),checks=lambda h,b:{'exactRoute':h.get('x-ir35-matched-route')=='page-proxy'})
        observer.case('basic-rejection','GET','/jobs',401,lambda rid:call('GET','/jobs',{'X-IR35-Client-Request-ID':rid}),checks=lambda h,b:{'exactRoute':h.get('x-ir35-matched-route')=='basic-auth-rejection'})
        observer.case('sdk-fallback','GET','/supabase/not-supported',404,lambda rid:call('GET','/supabase/not-supported',{'Cookie':'__Host-ir35-staging='+TOKEN,'X-IR35-Client-Request-ID':rid}),checks=lambda h,b:{'exactRoute':h.get('x-ir35-matched-route')=='sdk-fallback'})
        result['cases']=observer.records
        if mode=='baseline':
            reproduced=observer.records[2]['actualStatus']==404 and observer.records[2]['matchedRoute']=='sdk-fallback'
            result['status']='REPRODUCED' if reproduced and all(row['passed'] for row in observer.records[:2]+observer.records[3:]) else 'FAIL'
        else:result['status']='PASS' if all(row['passed'] for row in observer.records) else 'FAIL'
        result.update(validate='PASS',adapt='PASS',adaptedRawSHA256=digest(json.dumps(adapted,sort_keys=True).encode()),networkInternal=True)
    except Exception as error:result['code']=str(error) if type(error)is RuntimeError else type(error).__name__
    finally:
        removed=0
        try:
            for name in reversed(created):
                owned=json.loads(command(['docker','inspect',name]))[0]
                if owned['Config']['Labels'].get('ir35.purpose')!='sdk-owner1-isolated':raise RuntimeError('CleanupOwnershipFailed')
                command(['docker','rm','--force','--volumes',name]);removed+=1
            if network_created:command(['docker','network','rm',network])
            result['temporaryContainersRemoved']=removed;result['temporaryNetworkRemoved']=network_created
        except Exception as error:
            result.update(status='FAIL',cleanupError=type(error).__name__,temporaryContainersRemoved=removed)
    store.put(stage,'result.json',json.dumps(result,sort_keys=True).encode())
    return {**result,'stage':stage.name,'manifestSHA256':store.seal(stage)}


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--mode',choices=('baseline','fixed'),required=True);parser.add_argument('--root',required=True);parser.add_argument('--attempt',type=int,choices=(1,2),default=1);parser.add_argument('--export',required=True)
    args=parser.parse_args();result=run(Path(args.root),args.mode,attempt=args.attempt)
    destination=Path(args.export);destination.mkdir(parents=True,exist_ok=True)
    stage=Path(args.root)/result['stage']
    for path in stage.iterdir():
        if path.name=='Caddyfile':continue # Synthetic salted hash need not be published.
        with (destination/(f'a{args.attempt}-'+args.mode+'-'+path.name)).open('xb') as output:output.write(path.read_bytes())
    with (destination/(f'a{args.attempt}-'+args.mode+'-summary.json')).open('x') as output:json.dump(result,output,indent=2)
    print(json.dumps({'status':result['status'],'manifestSHA256':result['manifestSHA256'],'cases':len(result['cases'])}))
    if result['status']not in ('PASS','REPRODUCED'):raise SystemExit(1)


if __name__=='__main__':main()
