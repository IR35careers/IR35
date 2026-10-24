"""Existing Caddy, approved staging hosts only. Old configuration retained."""
import base64
import copy
import http.client
import json
import os
from pathlib import Path
import re
import socket
import ssl
import stat
from immutable_artifacts import Store,digest
from p4_recovery_guest import Recovery,RecoveryError
from web_fixture_guest import private_new
from web_services_guest import require_prepared
import web_stack

ROOT=Path('/opt/ir35')
CA='https://acme-v02.api.letsencrypt.org/directory'


def require_dns(proof):
    import time
    if proof.get('status')!='PASS' or proof.get('dnsWrites')!=0 or not 0<=time.time()-proof.get('checkedAtUnix',0)<=300:
        raise RecoveryError('FreshApprovedStagingDNSRequired')
    expected={(resolver,host) for resolver in ('1.1.1.1','8.8.8.8') for host in ('staging.ir35careers.com','api-staging.ir35careers.com')}
    rows=proof.get('observations',[])
    if len(rows)!=4 or {(row.get('resolver'),row.get('host')) for row in rows}!=expected:raise RecoveryError('DualResolverStagingDNSRequired')
    for row in rows:
        if row.get('a')!={'status':'NOERROR','records':[['132.145.28.134']]} or row.get('aaaa')!={'status':'NOERROR','records':[]} or row.get('caaReady')is not True:
            raise RecoveryError('StagingDNSOrCAANotReady')


def private_env(path):
    info=path.lstat()
    if path.is_symlink() or not stat.S_ISREG(info.st_mode) or info.st_uid!=1002 or stat.S_IMODE(info.st_mode)!=0o600 or info.st_nlink!=1:
        raise RecoveryError('P5EdgeEnvCustodyMismatch')
    result={}
    for line in path.read_text().splitlines():
        match=re.fullmatch(r"([A-Z][A-Z0-9_]*)='([^'\r\n]*)'",line)
        if not match or match[1] in result:raise RecoveryError('P5EdgeEnvFormatRefused')
        result[match[1]]=match[2]
    return result


def edge_compose(original):
    if original.get('name')!='ir35-staging':raise RecoveryError('ExistingStagingComposeRequired')
    result=copy.deepcopy(original);edge=result['services']['caddy']
    if edge.get('ports')!=['80:80/tcp','443:443/tcp'] or edge.get('user')!='1002:1002' or edge.get('mem_limit')!='128m':
        raise RecoveryError('ExistingCaddyEnvelopeRequired')
    edge['entrypoint']=[part.replace('/opt/ir35/.env.caddy','/opt/ir35/.env.p5-caddy') for part in edge['entrypoint']]
    edge['volumes']=[part.replace('/opt/ir35/config/Caddyfile:','/opt/ir35/config/p5-Caddyfile:').replace('/opt/ir35/.env.caddy','/opt/ir35/.env.p5-caddy') for part in edge['volumes']]
    if '/opt/ir35/data/caddy:/data' not in edge['volumes']:raise RecoveryError('ExistingCaddyKeysMustRemainInPlace')
    return result


def repair_paths(repair):
    if type(repair)is not int or repair not in (0,1,2):raise RecoveryError('BoundedEdgeRepairRequired')
    suffix='' if repair==0 else '-r'+str(repair)
    return ROOT/('config/p5-Caddyfile'+suffix),ROOT/('p5-edge-compose'+suffix+'.yml')


def prepare(data,runtime,repair=0):
    store,_=require_prepared(data)
    store.verify('02-services',data['servicesAnchor'])
    service=json.loads((store.root/'02-services/result.json').read_bytes())
    if service.get('status')!='PASS' or service.get('fixtureUnchanged')is not True or service.get('pristineUnchanged')is not True:
        raise RecoveryError('P5PrivateServicesRequired')
    original=ROOT/'config/Caddyfile';old=original.read_text()
    if old!=runtime['baseline_caddy']:raise RecoveryError('UnknownExistingCaddyConfiguration')
    values=private_env(ROOT/'.env.caddy')
    if values.get('ACME_CA')!=CA:raise RecoveryError('ExistingTrustedStagingCertificatesRequired')
    config,destination=repair_paths(repair)
    stage=store.stage('03-edge-prepare' if repair==0 else f'{3+2*repair:02d}-edge-repair-{repair}-prepare')
    result={'status':'FAIL','caddyActivated':False,'phaseComplete':False,'productionChanges':False}
    try:
        if repair:
            original_db=Recovery(data['p4'],runtime);fixture=copy.copy(original_db);fixture.database='ir35_p5_app'
            pristine=original_db.check_database();after=fixture.check_database()
            store.put(stage,'pristine-fidelity.json',json.dumps(pristine).encode());store.put(stage,'fixture-fidelity.json',json.dumps(after).encode())
            if pristine['status']!='PASS' or after['status']!='PASS':raise RecoveryError('P5RepairDataMismatch_Abort')
        candidate=web_stack.caddyfile(old)
        with config.open('x') as output:output.write(candidate)
        os.chmod(config,0o644)
        if repair:
            values=private_env(ROOT/'.env.p5-caddy')
            secret={'name':'.env.p5-caddy','sha256':digest((ROOT/'.env.p5-caddy').read_bytes()),'mode':'600','owner':'ir35'}
        else:
            values['STAGING_GATE_TOKEN']=runtime['run'](['openssl','rand','-hex','32']).strip()
            secret=private_new(ROOT/'.env.p5-caddy',runtime['env_text'](values).encode())
        original_compose=ROOT/'compose.yml';document=json.loads(original_compose.read_text())
        compose=edge_compose(document)
        compose['services']['caddy']['volumes']=[part.replace('/opt/ir35/config/p5-Caddyfile:',str(config)+':') for part in compose['services']['caddy']['volumes']]
        with destination.open('x') as output:json.dump(compose,output,indent=2)
        os.chmod(destination,0o644)
        # Adapt output contains private gate/hash values: RAM only, no logs.
        image=document['services']['caddy']['image']
        args=['docker','run','--rm','--network','none','--read-only','--memory','128m','--user','1002:1002','--log-driver','none',
              '--volume','/opt/ir35/bin/env-exec:/run/ir35/env-exec:ro','--volume','/opt/ir35/.env.p5-caddy:/opt/ir35/.env.p5-caddy:ro',
              '--volume',str(config)+':/etc/caddy/Caddyfile:ro','--entrypoint','/run/ir35/env-exec',image,'/opt/ir35/.env.p5-caddy',
              'caddy','adapt','--config','/etc/caddy/Caddyfile','--adapter','caddyfile']
        parsed=json.loads(runtime['run'](args))
        encoded=json.dumps(parsed)
        if parsed.get('admin',{}).get('disabled')is not True or parsed.get('admin',{}).get('config',{}).get('persist')is not False:
            raise RecoveryError('P5CaddyAdminMustStayDisabled')
        if CA not in encoded or 'http_basic' not in encoded or 'noindex, nofollow, noarchive' not in encoded or 'ir35-p5-web:3000' not in encoded or 'ir35-p5-kong:8000' not in encoded:
            raise RecoveryError('P5CaddyAdapterGuardMismatch')
        # Positive source boundaries are independently exercised over TLS after
        # activation; no credential-bearing adapted JSON becomes an artifact.
        result.update(status='PASS',adapter='PASS',envFile=secret,configSHA256=digest(config.read_bytes()),composeSHA256=digest(destination.read_bytes()),
                      originalConfigSHA256=digest(original.read_bytes()),originalComposeSHA256=digest(original_compose.read_bytes()),
                      originalEnvSHA256=digest((ROOT/'.env.caddy').read_bytes()),certificateRequests=0,originalFilesUnchanged=True)
    except Exception as error:result['code']=str(error) if type(error)is RecoveryError else type(error).__name__
    store.put(stage,'result.json',json.dumps(result,sort_keys=True).encode())
    return {**result,'stage':stage.name,'manifestSHA256':store.seal(stage,previous=data['servicesAnchor'])}


def tls_get(host,path,headers=None):
    if host not in ('staging.ir35careers.com','api-staging.ir35careers.com') or not path.startswith('/') or any(c in path for c in '\r\n'):
        raise RecoveryError('StagingTLSRequestRequired')
    context=ssl.create_default_context()
    with socket.create_connection(('127.0.0.1',443),timeout=8) as raw:
        with context.wrap_socket(raw,server_hostname=host) as connection:
            request='GET '+path+' HTTP/1.1\r\nHost: '+host+'\r\nConnection: close\r\nAccept-Encoding: identity\r\n'
            for key,value in (headers or {}).items():
                if any(c in key+value for c in '\r\n'):raise RecoveryError('TLSHeaderBoundaryRefused')
                request+=key+': '+value+'\r\n'
            connection.sendall((request+'\r\n').encode())
            response=http.client.HTTPResponse(connection);response.begin()
            body=response.read(4_000_001)
            if len(body)>4_000_000:raise RecoveryError('P5ResponseLimit')
            return response.status,{key.lower():value for key,value in response.getheaders()},body


def activate(data,runtime,repair=0):
    config,destination=repair_paths(repair)
    store,_=require_prepared(data);prepared_stage='03-edge-prepare' if repair==0 else f'{3+2*repair:02d}-edge-repair-{repair}-prepare'
    store.verify(prepared_stage,data['edgeAnchor'])
    saved=json.loads((store.root/prepared_stage/'result.json').read_bytes())
    if saved.get('status')!='PASS':raise RecoveryError('P5AdaptedEdgeRequired')
    for path,key in [(config,'configSHA256'),(destination,'composeSHA256'),(ROOT/'config/Caddyfile','originalConfigSHA256'),(ROOT/'compose.yml','originalComposeSHA256'),(ROOT/'.env.caddy','originalEnvSHA256')]:
        if path.is_symlink() or digest(path.read_bytes())!=saved[key]:raise RecoveryError('P5EdgeFileIntegrityMismatch')
    if digest((ROOT/'.env.p5-caddy').read_bytes())!=saved['envFile']['sha256']:raise RecoveryError('P5EdgeSecretIntegrityMismatch')
    require_dns(data.get('dns',{}))
    stage=store.stage('04-edge-activate' if repair==0 else f'{4+2*repair:02d}-edge-repair-{repair}-activate');changed=False
    result={'status':'FAIL','phaseComplete':False,'productionChanges':False,'dnsWrites':0}
    def switch(file,log_name):
        import subprocess
        with store.sink(stage,log_name) as log:
            code=subprocess.run(['docker','compose','--env-file',str(ROOT/'.env'),'-f',str(file),'up','-d','--no-deps','--force-recreate','caddy'],stdout=log,stderr=log,timeout=90).returncode
        if code:raise RecoveryError('P5CaddySwitchFailed_PrivateLog')
    try:
        store.put(stage,'intent.json',json.dumps({'onlyService':'caddy','edgeManifest':data['edgeAnchor'],'rollback':'original compose/env/config unchanged','dns':data['dns']}).encode())
        changed=True;switch(destination,'activate.log')
        import time
        deadline=time.monotonic()+60
        while True:
            try:
                status,headers,_=tls_get('staging.ir35careers.com','/')
                if status==401:break
            except (OSError,ssl.SSLError):pass
            if time.monotonic()>deadline:raise RecoveryError('P5ProtectedEdgeNotReady')
            time.sleep(2)
        if 'noindex' not in headers.get('x-robots-tag','') or headers.get('cache-control')!='no-store':raise RecoveryError('P5ProtectedHeadersRequired')
        values=runtime['read_env']();gate=private_env(ROOT/'.env.p5-caddy')['STAGING_GATE_TOKEN']
        basic='Basic '+base64.b64encode(('ir35:'+values['STAGING_BASIC_PASSWORD']).encode()).decode()
        status,headers,body=tls_get('staging.ir35careers.com','/jobs',{'Authorization':basic})
        result['authenticatedJobs']={'status':status,'noindex':'noindex' in headers.get('x-robots-tag',''),'noStoreExact':headers.get('cache-control')=='no-store','h1Present':bool(re.search(br'<h1[^>]*>Find your next contract</h1>',body))}
        if status!=200 or 'noindex' not in headers.get('x-robots-tag','') or headers.get('cache-control')!='no-store' or not re.search(br'<h1[^>]*>Find your next contract</h1>',body):raise RecoveryError('P5ProtectedSSRRequired')
        cookie=headers.get('set-cookie','')
        if not cookie.startswith('__Host-ir35-staging='+gate+';') or not all(part in cookie for part in ('Secure','HttpOnly','SameSite=Strict')):raise RecoveryError('P5SecureSDKGateRequired')
        api_headers={'apikey':values['ANON_KEY'],'Authorization':'Bearer '+values['ANON_KEY']}
        cases={}
        for name,extra in [('missing',{}),('suffix',{'Cookie':'__Host-ir35-staging='+gate+'extra'}),('valid',{'Cookie':'__Host-ir35-staging='+gate})]:
            cases[name]=tls_get('staging.ir35careers.com','/supabase/auth/v1/health',api_headers|extra)[0]
        if cases!={'missing':401,'suffix':401,'valid':200}:raise RecoveryError('P5SDKBoundaryMismatch')
        if tls_get('api-staging.ir35careers.com','/auth/v1/health')[0]!=401:raise RecoveryError('P5APIBasicRequired')
        if tls_get('api-staging.ir35careers.com','/auth/v1/health',api_headers|{'X-Staging-Authorization':basic})[0]!=200:raise RecoveryError('P5SeparateAPIProtectionMismatch')
        custody=runtime['caddy_permissions']()
        original=Recovery(data['p4'],runtime);fixture=copy.copy(original);fixture.database='ir35_p5_app'
        pristine=original.check_database();after=fixture.check_database()
        store.put(stage,'pristine-fidelity.json',json.dumps(pristine).encode());store.put(stage,'fixture-fidelity.json',json.dumps(after).encode())
        if pristine['status']!='PASS' or after['status']!='PASS':raise RecoveryError('P5EdgeDataMismatch_Abort')
        result.update(status='PASS',caddyActivated=True,stagingOnly=True,unauthenticatedStatus=401,authenticatedJobsStatus=200,noindex=True,externalCacheControl='no-store',sdkGate=cases,privateKeyCustody=custody)
    except Exception as error:
        result['code']=str(error) if type(error)is RecoveryError else type(error).__name__
        if changed:
            switch(ROOT/'compose.yml','rollback.log');result['rollback']='original Caddy restored'
    store.put(stage,'result.json',json.dumps(result,sort_keys=True).encode())
    return {**result,'stage':stage.name,'manifestSHA256':store.seal(stage,previous=data['edgeAnchor'])}


def repair(data,runtime,index):
    repair_paths(index)
    if index not in (1,2):raise RecoveryError('BoundedEdgeRepairRequired')
    store,_=require_prepared(data)
    previous_stage='04-edge-activate' if index==1 else '06-edge-repair-1-activate'
    store.verify(previous_stage,data['failedEdgeAnchor'])
    previous=json.loads((store.root/previous_stage/'result.json').read_bytes())
    if previous.get('status')!='FAIL' or previous.get('code')not in ('P5ProtectedSSRRequired','P5ProtectedHeadersRequired','P5SDKBoundaryMismatch','P5SecureSDKGateRequired','P5SeparateAPIProtectionMismatch') or previous.get('rollback')!='original Caddy restored':
        raise RecoveryError('DocumentedRolledBackConfigurationFailureRequired')
    if index==2:
        probes=Store(ROOT/'.env.p5-header-probes',uid=1002)
        probes.verify('03-header-probe-r2',data['headerProbeAnchor'])
        proof=json.loads((probes.root/'03-header-probe-r2/result.json').read_bytes())
        if proof.get('status')!='PASS' or proof.get('publicEdgeChanged')is not False or proof.get('cases',{}).get('paired')!={'unauthorized':{'status':401,'noindex':True,'noStoreExact':True},'authorized':{'status':200,'noindex':True,'noStoreExact':True}}:
            raise RecoveryError('PrivatePairedHeaderProofRequired')
    prepared=prepare(data,runtime,index)
    if prepared['status']!='PASS':return {'status':'FAIL','repair':index,'preparation':prepared,'phaseComplete':False}
    active=activate(data|{'edgeAnchor':prepared['manifestSHA256']},runtime,index)
    return {'status':active['status'],'repair':index,'preparation':prepared,'activation':active,'phaseComplete':False}
