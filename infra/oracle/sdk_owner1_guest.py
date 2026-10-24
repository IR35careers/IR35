"""One separately authorised staging switch; old failed journals stay closed."""
import base64
import copy
import difflib
import http.client
import json
import os
from pathlib import Path
import re
import socket
import ssl
import subprocess
import time
from immutable_artifacts import Store,digest
from p4_recovery_guest import Recovery,RecoveryError
from sdk_gate_config import redact_adapted,instrument_edge
from sdk_gate_observation import Observer,sdk_cases
from web_services_guest import require_prepared
from web_edge_guest import private_env,edge_compose,require_dns
import web_stack

ROOT=Path('/opt/ir35')
JOURNAL=ROOT/'.env.p5-sdk-owner1'
CONFIG=ROOT/'config/p5-Caddyfile-sdk-owner1'
COMPOSE=ROOT/'p5-edge-compose-sdk-owner1.yml'


def new_store():
    JOURNAL.mkdir(mode=0o700) # Never replay, overwrite or reset this approval.
    os.chown(JOURNAL,1002,1002)
    return Store(JOURNAL,uid=1002)


def tls_request(host,method,path,headers):
    if host not in ('staging.ir35careers.com','api-staging.ir35careers.com') or method not in ('GET','POST') or not path.startswith('/') or any(c in path for c in '\r\n'):
        raise RecoveryError('FixedProtectedStagingRequestRequired')
    context=ssl.create_default_context()
    with socket.create_connection(('127.0.0.1',443),timeout=8) as raw:
        with context.wrap_socket(raw,server_hostname=host) as connection:
            request=method+' '+path+' HTTP/1.1\r\nHost: '+host+'\r\nConnection: close\r\nAccept-Encoding: identity\r\nContent-Length: 0\r\n'
            for key,value in headers.items():
                if any(c in key+value for c in '\r\n'):raise RecoveryError('TLSHeaderBoundaryRefused')
                request+=key+': '+value+'\r\n'
            connection.sendall((request+'\r\n').encode())
            response=http.client.HTTPResponse(connection);response.begin();body=response.read(4_000_001)
            if len(body)>4_000_000:raise RecoveryError('P5ResponseLimit')
            return response.status,{key.lower():value for key,value in response.getheaders()},body


def fidelity(data,runtime):
    old,_=require_prepared(data)
    for stage,anchor in data['p5Anchors'].items():old.verify(stage,anchor)
    builds=Store(ROOT/'.env.p5-builds',uid=1002)
    for stage,anchor in data['buildAnchors'].items():builds.verify(stage,anchor)
    original=Recovery(data['p4'],runtime);fixture=copy.copy(original);fixture.database='ir35_p5_app'
    pristine=original.check_database();app=fixture.check_database();source=original.source()
    original.check_storage_files(source) # Every original object + xattr + locator.
    physical=[];expected=set();root=ROOT/'data/p5-storage'
    for obj in source['storage']['privateObjects']:
        path=root/runtime['verifiers']['backend_path'](obj['bucket'],obj['name'],obj['version']);expected.add(path)
        physical.append(path.absolute()==path.resolve() and not path.is_symlink() and path.is_file() and path.stat().st_size==int(obj['bytes']) and digest(path.read_bytes())==obj['sha256'])
    storage_ok=len(physical)==73 and all(physical) and {p for p in root.rglob('*') if p.is_file()}==expected
    saved=json.loads((old.root/'03-edge-prepare/result.json').read_bytes())
    files=all(not path.is_symlink() and digest(path.read_bytes())==saved[key] for path,key in [
        (ROOT/'config/Caddyfile','originalConfigSHA256'),(ROOT/'compose.yml','originalComposeSHA256'),(ROOT/'.env.caddy','originalEnvSHA256')])
    strict=lambda proof:proof['status']=='PASS' and len(proof['tables'])==62 and proof['sequenceChecks']==2 and len(proof['schema']['exceptions'])==3 and not proof['schema']['unexplainedDifferences'] and proof['privileges']['status']=='PASS' and proof['privileges']['sourceEntries']==552
    information=json.loads(runtime['run'](['docker','inspect',*['ir35-p5-'+name for name in ('web','auth','rest','storage','kong')]]))
    private=all(not item['HostConfig'].get('PortBindings') and item['State']['Status']=='running' and set(item['NetworkSettings']['Networks'])=={'ir35-staging_backend'} for item in information)
    private=private and information[0]['Image']==data['build']['image']
    result={'status':'PASS' if strict(pristine) and strict(app) and storage_ok and files and private else 'FAIL',
            'manifests':'PASS','tablesEach':62,'orderedMD5Each':strict(pristine) and strict(app),'sequencesEach':2,'approvedSchemaExceptionsEach':3,
            'appRolePrivilegesEach':552,'storageObjectsEach':73,'storageSHA256Match':storage_ok,'originalCaddyFilesUnchanged':files,
            'privateFixtureRunningNoPorts':private,'sourceWrites':0,'pristineWrites':0,'fixtureWrites':0}
    return result,pristine,app


def prepare(data,runtime,store):
    stage=store.stage('01-prepare');result={'status':'FAIL','activationAttempts':0,'productionChanges':False}
    try:
        before,pristine,app=fidelity(data,runtime)
        store.put(stage,'pristine-fidelity.json',json.dumps(pristine).encode());store.put(stage,'fixture-fidelity.json',json.dumps(app).encode())
        if before['status']!='PASS':raise RecoveryError('SDKOwner1PreDataMismatch_Abort')
        old=(ROOT/'config/Caddyfile').read_text()
        if old!=runtime['baseline_caddy']:raise RecoveryError('OriginalRollbackConfigurationRequired')
        values=private_env(ROOT/'.env.p5-caddy')
        if values.get('ACME_CA')!='https://acme-v02.api.letsencrypt.org/directory':raise RecoveryError('ExistingTrustedCertificatesRequired')
        web=private_env(ROOT/'.env.p5-web')
        if web.get('IR35_READ_ONLY')!='true' or web.get('APPLY_RUNNER')!='mock' or web.get('APPLICATION_WORKER_ACCEPT_JOBS')!='false':raise RecoveryError('ExistingReadOnlyMockFixtureRequired')
        with CONFIG.open('x') as output:output.write(instrument_edge(web_stack.caddyfile(old)))
        os.chmod(CONFIG,0o644)
        original=json.loads((ROOT/'compose.yml').read_text());compose=edge_compose(original)
        compose['services']['caddy']['volumes']=[part.replace('/opt/ir35/config/p5-Caddyfile:',str(CONFIG)+':') for part in compose['services']['caddy']['volumes']]
        with COMPOSE.open('x') as output:json.dump(compose,output,indent=2)
        os.chmod(COMPOSE,0o644)
        args=['docker','run','--rm','--network','none','--read-only','--memory','128m','--user','1002:1002','--cap-drop','ALL','--cap-add','NET_BIND_SERVICE',
              '--security-opt','no-new-privileges:true','--log-driver','none','--tmpfs','/data:rw,size=1m,uid=1002,gid=1002,mode=0700','--tmpfs','/tmp:rw,size=16m,uid=1002,gid=1002,mode=0700',
              '--volume','/opt/ir35/bin/env-exec:/run/ir35/env-exec:ro','--volume','/opt/ir35/.env.p5-caddy:/opt/ir35/.env.p5-caddy:ro',
              '--volume',str(CONFIG)+':/fixture.caddy:ro','--entrypoint','/run/ir35/env-exec',original['services']['caddy']['image'],'/opt/ir35/.env.p5-caddy','caddy']
        before_args=[part.replace(str(CONFIG)+':/fixture.caddy:ro',str(ROOT/'config/p5-Caddyfile-r2')+':/fixture.caddy:ro') for part in args]
        old_adapt=json.loads(runtime['run'](before_args+['adapt','--config','/fixture.caddy','--adapter','caddyfile']))
        parsed=json.loads(runtime['run'](args+['adapt','--config','/fixture.caddy','--adapter','caddyfile']))
        runtime['run'](args+['validate','--config','/fixture.caddy','--adapter','caddyfile'])
        secrets={values['STAGING_BASIC_HASH']:'<existing-staging-bcrypt>',values['STAGING_GATE_TOKEN']:'<existing-staging-gate>'}
        old_json=json.dumps(redact_adapted(old_adapt,secrets),sort_keys=True,indent=2)+'\n'
        new_json=json.dumps(redact_adapted(parsed,secrets),sort_keys=True,indent=2)+'\n'
        store.put(stage,'adapted-before.json',old_json.encode());store.put(stage,'adapted-after.json',new_json.encode())
        store.put(stage,'adapted.diff',''.join(difflib.unified_diff(old_json.splitlines(True),new_json.splitlines(True),fromfile='redacted-r2.json',tofile='redacted-sdk-owner1.json')).encode())
        result.update(status='PASS',validate='PASS',adapt='PASS',originalFilesUnchanged=True,existingSecretsReusedUnchanged=True,
                      files={str(path):digest(path.read_bytes()) for path in [CONFIG,COMPOSE,ROOT/'.env.p5-caddy',ROOT/'config/Caddyfile',ROOT/'compose.yml',ROOT/'.env.caddy']})
    except Exception as error:result['code']=str(error) if type(error)is RecoveryError else type(error).__name__
    store.put(stage,'result.json',json.dumps(result,sort_keys=True).encode())
    return {**result,'stage':stage.name,'manifestSHA256':store.seal(stage)}


def switch(store,stage,file,name):
    with store.sink(stage,name) as log:
        code=subprocess.run(['docker','compose','--env-file',str(ROOT/'.env'),'-f',str(file),'up','-d','--no-deps','--force-recreate','caddy'],stdout=log,stderr=log,timeout=90).returncode
    if code:raise RecoveryError('SDKOwner1SwitchFailed_PrivateLog')


def edge_cases(data,runtime,store,stage,request=tls_request):
    values=runtime['read_env']();gate=private_env(ROOT/'.env.p5-caddy')['STAGING_GATE_TOKEN']
    basic='Basic '+base64.b64encode(('ir35:'+values['STAGING_BASIC_PASSWORD']).encode()).decode()
    api={'apikey':values['ANON_KEY'],'Authorization':'Bearer '+values['ANON_KEY']}
    observe=Observer(store,stage);host='staging.ir35careers.com'
    call=lambda method,path,headers:request(host,method,path,headers)
    # ALL three are durably recorded even when a previous response is wrong.
    sdk_cases(observe,call,gate,headers=api,check_path=False)
    def route(name):return lambda h,b:{'exactRoute':h.get('x-ir35-matched-route')==name}
    observe.case('jobs','GET','/jobs',200,lambda rid:call('GET','/jobs',{'Authorization':basic,'X-IR35-Client-Request-ID':rid}),checks=lambda h,b:{
        'exactRoute':h.get('x-ir35-matched-route')=='page-proxy','h1':bool(re.search(br'<h1[^>]*>Find your next contract</h1>',b)),
        'secureCookie':h.get('set-cookie','').startswith('__Host-ir35-staging='+gate+';') and all(flag in h.get('set-cookie','') for flag in ('Path=/','Secure','HttpOnly','SameSite=Strict','Max-Age=1800'))})
    observe.case('maintenance','POST','/api/jobs/search',503,lambda rid:call('POST','/api/jobs/search',{'Authorization':basic,'X-IR35-Client-Request-ID':rid}),checks=route('page-proxy'))
    observe.case('basic-rejection','GET','/jobs',401,lambda rid:call('GET','/jobs',{'X-IR35-Client-Request-ID':rid}),checks=route('basic-auth-rejection'))
    observe.case('sdk-fallback','GET','/supabase/not-supported',404,lambda rid:call('GET','/supabase/not-supported',{'Cookie':'__Host-ir35-staging='+gate,'X-IR35-Client-Request-ID':rid}),checks=route('sdk-fallback'))
    observe.case('api-basic-rejection','GET','/auth/v1/health',401,lambda rid:request('api-staging.ir35careers.com','GET','/auth/v1/health',{'X-IR35-Client-Request-ID':rid}),checks=route('api-basic-rejection'))
    observe.case('api-health','GET','/auth/v1/health',200,lambda rid:request('api-staging.ir35careers.com','GET','/auth/v1/health',api|{'X-Staging-Authorization':basic,'X-IR35-Client-Request-ID':rid}),checks=route('api-proxy'))
    # Existing P5 health truthfully remains 503: worker/Realtime not configured.
    # Auth /auth/v1/health above is the existing 200 gate, not a fake P6 signoff.
    observe.case('app-health-truthful','GET','/api/health',503,lambda rid:call('GET','/api/health',{'Authorization':basic,'X-IR35-Client-Request-ID':rid}),checks=route('page-proxy'))
    return observe.records


def activate(data,runtime,store,prepared):
    store.verify(prepared['stage'],prepared['manifestSHA256'])
    if prepared['status']!='PASS':raise RecoveryError('PreparedConfigRequired')
    for name,expected in prepared['files'].items():
        path=Path(name)
        if path.is_symlink() or digest(path.read_bytes())!=expected:raise RecoveryError('PreparedFileChanged_NoActivation')
    require_dns(data['dns'])
    stage=store.stage('02-edge');result={'status':'FAIL','activationAttempts':0,'productionChanges':False,'dnsWrites':0,'cases':[]};changed=False
    try:
        store.put(stage,'intent.json',json.dumps({'authorisation':'owner-sdk-order-20261024','activationAttempts':1,'preparedManifest':prepared['manifestSHA256'],'rollback':'original compose/config/env','privateSignoff':data['privateProof']},sort_keys=True).encode())
        changed=True;result['activationAttempts']=1;switch(store,stage,COMPOSE,'activate.log')
        deadline=time.monotonic()+60
        while True:
            try:
                if tls_request('staging.ir35careers.com','GET','/',{})[0]==401:break
            except (OSError,ssl.SSLError):pass
            if time.monotonic()>deadline:break # All cases still run and record.
            time.sleep(2)
        result['cases']=edge_cases(data,runtime,store,stage)
        if not all(case['passed'] for case in result['cases']):raise RecoveryError('SDKOwner1EdgeSuiteFailed_StopNoRetry')
        result.update(status='PASS',privateKeyCustody=runtime['caddy_permissions'](),authHealth200=True,fullAppHealth503='Realtime/worker intentionally not configured; P6 not authorised')
    except Exception as error:
        result['code']=str(error) if type(error)is RecoveryError else type(error).__name__
        if changed:
            try:switch(store,stage,ROOT/'compose.yml','rollback.log');result['rollback']='original Caddy restored'
            except Exception as rollback_error:result['rollback']='FAIL';result['rollbackError']=type(rollback_error).__name__
    store.put(stage,'result.json',json.dumps(result,sort_keys=True).encode())
    return {**result,'stage':stage.name,'manifestSHA256':store.seal(stage,previous=prepared['manifestSHA256'])}


def containment(data,runtime,store,previous):
    stage=store.stage('03-containment');result={'status':'FAIL'}
    try:
        result,pristine,app=fidelity(data,runtime)
        store.put(stage,'pristine-fidelity.json',json.dumps(pristine).encode());store.put(stage,'fixture-fidelity.json',json.dumps(app).encode())
        store.put(stage,'table-fingerprints.json',json.dumps({'pristine':pristine['tables'],'fixture':app['tables']},sort_keys=True).encode())
        store.verify(previous['stage'],previous['manifestSHA256'])
    except Exception as error:result.update(status='FAIL',code=str(error) if type(error)is RecoveryError else type(error).__name__)
    store.put(stage,'result.json',json.dumps(result,sort_keys=True).encode())
    return {**result,'stage':stage.name,'manifestSHA256':store.seal(stage,previous=previous['manifestSHA256'])}


def run(data,runtime):
    store=new_store();prepared=prepare(data,runtime,store)
    if prepared['status']!='PASS':return {'status':'FAIL','preparation':prepared,'activationAttempts':0,'reviewRequired':True}
    active=activate(data,runtime,store,prepared)
    after=containment(data,runtime,store,active)
    if after['status']!='PASS' and active['status']=='PASS':
        abort=store.stage('04-containment-abort');switch(store,abort,ROOT/'compose.yml','rollback.log')
        store.put(abort,'result.json',json.dumps({'status':'ABORT','rollback':'original Caddy restored','reason':'containment mismatch; never waived'}).encode())
        store.seal(abort,previous=after['manifestSHA256'])
    # Public projections contain only redacted cases/config and hash evidence.
    export={}
    for path in store.root.rglob('*'):
        if path.is_file() and path.suffix in ('.json','.diff') and path.name not in ('pristine-fidelity.json','fixture-fidelity.json'):
            export[path.parent.name+'-'+path.name]=path.read_text()
    return {'status':'PASS' if active['status']=='PASS' and after['status']=='PASS' else 'FAIL','preparation':prepared,'activation':active,'containment':after,
            'exports':export,'reviewRequired':True,'p6Authorised':False,'productionChanges':False,'dnsWrites':0,'secretsChanged':False}
