"""Native ARM mock-worker image only; no service, schedule or public activation."""
import base64
import io
import json
import os
from pathlib import Path
import re
import subprocess
import tarfile
import time
from immutable_artifacts import Store,digest
from p6_containment import fidelity
from web_build_guest import safe_members,verify_history

ROOT=Path('/opt/ir35')


def run(data,runtime):
    sha=data['sourceSHA'];attempt=data['attempt']
    if not re.fullmatch(r'[a-f0-9]{40}',sha) or type(attempt)is not int or attempt not in (1,2,3):raise RuntimeError('BoundedP6SourceBuildRequired')
    roles=Store(ROOT/'.env.p6',uid=1002)
    for row in (data['p6Inventory'],data['rolePreflight'],data['roleInstall']):roles.verify(row['stage'],row['manifestSHA256'])
    if data['roleInstall']['status']!='PASS':raise RuntimeError('VerifiedMinimalRolesRequired')
    journal=ROOT/'.env.p6-builds'
    if not journal.exists():journal.mkdir(mode=0o700);os.chown(journal,1002,1002)
    store=Store(journal,uid=1002);verify_history(store,data['anchors'],sha)
    if attempt!=len(data['anchors'])+1:raise RuntimeError('P6BuildHistoryMismatch')
    stage=store.stage(f'{attempt:02d}-build');started=time.monotonic()
    result={'status':'FAIL','attempt':attempt,'sourceSHA':sha,'productionChanges':False,'serviceChanges':0,'realAcceptance':False}
    try:
        before,pristine,fixture=fidelity(data,runtime)
        store.put(stage,'pre-pristine-fidelity.json',json.dumps(pristine).encode());store.put(stage,'pre-fixture-fidelity.json',json.dumps(fixture).encode())
        if before['status']!='PASS':raise RuntimeError('P6PreBuildContainmentMismatch_Abort')
        if os.uname().machine!='aarch64':raise RuntimeError('NativeArmRequired')
        available=int(re.search(r'^MemAvailable:\s+(\d+)',Path('/proc/meminfo').read_text(),re.M)[1])
        if available<4*1024*1024:raise RuntimeError('P6BuildMemoryHeadroomInsufficient')
        body=base64.b64decode(data['archive'],validate=True)
        if digest(body)!=data['archiveSHA256']:raise RuntimeError('SourceArchiveHashMismatch')
        target=ROOT/'data/p6-build-source'/sha;target.parent.mkdir(exist_ok=True);target.mkdir(mode=0o755)
        with tarfile.open(fileobj=io.BytesIO(body),mode='r:') as archive:archive.extractall(target,members=safe_members(archive),filter='data')
        store.put(stage,'intent.json',json.dumps({'sourceSHA':sha,'archiveSHA256':digest(body),'attempt':attempt,'runtime':'mock-only','publication':False}).encode())
        tag='ir35-p6-mock-worker:'+sha
        with store.sink(stage,'build.log') as log:
            code=subprocess.run(['docker','build','--platform','linux/arm64','--network','host','--file',str(target/'services/application-worker/Dockerfile.mock'),'--tag',tag,str(target)],stdout=log,stderr=log,timeout=1200).returncode
        if code:raise RuntimeError('P6WorkerBuildFailed_PrivateLog')
        image=json.loads(runtime['run'](['docker','image','inspect',tag]))[0]
        if image.get('Architecture')!='arm64' or image['Config'].get('User')!='1002:1002':raise RuntimeError('P6ImageIdentityMismatch')
        script="console.log(JSON.stringify({playwright:require('playwright-core/package.json').version,pgBoss:require('pg-boss/package.json').version,architecture:process.arch}))"
        actual=json.loads(runtime['run'](['docker','run','--rm','--network','none','--read-only','--cap-drop','ALL','--memory','256m','--log-driver','none','--entrypoint','node',image['Id'],'-e',script]))
        if actual!={'playwright':'1.61.0','pgBoss':'12.38.0','architecture':'arm64'}:raise RuntimeError('P6RuntimeVersionMismatch')
        # No worker/queue/HMAC/env mount: real native browser health only.
        arguments=['docker','run','--rm','-i','--network','none','--read-only','--user','1002:1002','--cap-drop','ALL',
                   '--security-opt','no-new-privileges:true','--memory','2560m','--pids-limit','256','--log-driver','none',
                   '--tmpfs','/tmp:rw,size=512m,uid=1002,gid=1002,mode=1777','--entrypoint','node',image['Id'],
                   '--import','tsx','services/application-worker/mock-browser.ts']
        browser=json.loads(runtime['run'](arguments,input=json.dumps({'operation':'health'}),timeout=90))
        if browser!={'ok':True,'browserReady':True,'submissions':0}:raise RuntimeError('P6NativeBrowserSmokeFailed')
        result.update(status='PASS',image=image['Id'],architecture='linux/arm64',nonroot=True,imageBytes=image['Size'],versions=actual,
                      browser=browser,archiveSHA256=digest(body),registryPublished=False)
    except Exception as error:result['code']=str(error) if type(error)is RuntimeError and re.fullmatch(r'[A-Za-z0-9_]+',str(error)) else type(error).__name__
    try:
        after,pristine,fixture=fidelity(data,runtime)
        store.put(stage,'post-pristine-fidelity.json',json.dumps(pristine).encode());store.put(stage,'post-fixture-fidelity.json',json.dumps(fixture).encode())
        result['containment']=after
        if after['status']!='PASS':result['status']='FAIL';result['code']='P6PostBuildContainmentMismatch_Abort'
    except Exception as error:result.update(status='FAIL',containmentError=type(error).__name__)
    result['elapsedSeconds']=round(time.monotonic()-started,3)
    store.put(stage,'result.json',json.dumps(result,sort_keys=True).encode())
    return result|{'stage':stage.name,'manifestSHA256':store.seal(stage,previous=next(reversed(data['anchors'].values()),None))}
