"""Native ARM, staging PUBLIC build settings only; exclusive private journals."""
import base64
import hashlib
import io
import json
import os
from pathlib import Path,PurePosixPath
import re
import stat
import subprocess
import tarfile
import time
from immutable_artifacts import Store,digest
from web_security import security_versions


def verify_history(store,anchors,sha):
    if set(p.name for p in store.root.iterdir())!=set(anchors):raise RuntimeError('BuildHistoryUnanchoredStage')
    previous=None
    for index,(name,anchor) in enumerate(sorted(anchors.items()),1):
        manifest=store.verify(name,anchor)
        if name!=f'{index:02d}-build' or manifest['previousManifestSHA256']!=previous:raise RuntimeError('BuildHistoryChainMismatch')
        result=json.loads((store.root/name/'result.json').read_text())
        if result.get('attempt')!=index or result.get('status')not in ('PASS','FAIL'):raise RuntimeError('BuildHistoryIdentityMismatch')
        if result.get('status')=='PASS' and result.get('sourceSHA')==sha:raise RuntimeError('BuildAlreadyPassed_NoReplay')
        previous=anchor


def safe_members(archive):
    members=archive.getmembers()
    if len(members)>4000 or sum(m.size for m in members)>100_000_000:raise RuntimeError('SourceArchiveLimit')
    seen=set()
    for member in members:
        path=PurePosixPath(member.name)
        if path.is_absolute() or '..' in path.parts or member.name in seen or not (member.isfile() or member.isdir()):raise RuntimeError('SourceArchivePathRefused')
        if any(part in ('.git','.vercel','node_modules','.cache') for part in path.parts):raise RuntimeError('SourceArchivePrivateDirectoryRefused')
        if any(part.startswith('.env') and not part.endswith('.example') for part in path.parts):raise RuntimeError('SourceArchiveEnvironmentRefused')
        seen.add(member.name)
    return members


def public_build_env(values):
    # The original VM fresh keys were generated for Oracle, NEVER cloud keys.
    key=values['ANON_KEY'];parts=key.split('.')
    if len(parts)!=3 or json.loads(base64.urlsafe_b64decode(parts[1]+'='*(-len(parts[1])%4))).get('role')!='anon':raise RuntimeError('PublicAnonBuildKeyRequired')
    return {'NEXT_PUBLIC_SUPABASE_URL':'https://staging.ir35careers.com/supabase','NEXT_PUBLIC_SUPABASE_ANON_KEY':key}


def run(data,runtime):
    sha=data['sourceSHA'];attempt=data['attempt']
    if not re.fullmatch(r'[a-f0-9]{40}',sha) or type(attempt)is not int or attempt not in (1,2,3):raise RuntimeError('BoundedSourceBuildRequired')
    root=Path('/opt/ir35');journal=root/'.env.p5-builds'
    if not journal.exists():journal.mkdir(mode=0o700);os.chown(journal,1002,1002)
    store=Store(journal,uid=1002)
    verify_history(store,data['anchors'],sha)
    if attempt!=len(data['anchors'])+1:raise RuntimeError('BuildAttemptHistoryMismatch')
    stage=store.stage(f'{attempt:02d}-build')
    result={'status':'FAIL','attempt':attempt,'sourceSHA':sha,'sourceWrites':0,'productionChanges':False,'phaseComplete':False}
    started=time.monotonic()
    try:
        if os.uname().machine!='aarch64':raise RuntimeError('NativeARMRequired')
        available=int(re.search(r'^MemAvailable:\s+(\d+)',Path('/proc/meminfo').read_text(),re.M)[1])
        if available<4*1024*1024:raise RuntimeError('BuildMemoryHeadroomInsufficient')
        if runtime['read_env']()['APPLY_RUNNER']!='mock':raise RuntimeError('MockStagingRequired')
        body=base64.b64decode(data['archive'],validate=True)
        if digest(body)!=data['archiveSHA256']:raise RuntimeError('SourceArchiveHashMismatch')
        target=root/'data/p5-build-source'/sha
        target.parent.mkdir(exist_ok=True)
        if target.exists():raise RuntimeError('SourceDestinationExists_NoOverwrite')
        target.mkdir(mode=0o755)
        with tarfile.open(fileobj=io.BytesIO(body),mode='r:') as archive:
            members=safe_members(archive)
            archive.extractall(target,members=members,filter='data')
        versions=security_versions(json.loads((target/'package-lock.json').read_text()))
        store.put(stage,'intent.json',json.dumps({'sourceSHA':sha,'archiveSHA256':digest(body),'archiveBytes':len(body),'attempt':attempt}).encode())
        env_path=root/('.env.web-build-'+sha[:12])
        fd=os.open(env_path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
        try:
            os.fchown(fd,1002,1002);os.write(fd,runtime['env_text'](public_build_env(runtime['read_env']())).encode());os.fsync(fd)
        finally:os.close(fd)
        tag='ir35-p5-web:'+sha
        command=['docker','build','--platform','linux/arm64','--network','host','--secret','id=web-build,src='+str(env_path),
            '--file',str(target/'services/web/Dockerfile'),'--tag',tag,str(target)]
        with store.sink(stage,'build.log') as log:
            code=subprocess.run(command,stdout=log,stderr=log,timeout=1200).returncode
        if code:raise RuntimeError('WebImageBuildFailed_PrivateLog')
        image=json.loads(runtime['run'](['docker','image','inspect',tag]))[0]
        if image.get('Architecture')!='arm64' or image.get('Os')!='linux' or image['Config'].get('User')!='1002:1002':raise RuntimeError('BuiltImageIdentityMismatch')
        # Read versions from the actual standalone image, not caller metadata.
        script="const fs=require('node:fs');let r={};for(const n of ['next','react','react-dom','sharp'])r[n]=JSON.parse(fs.readFileSync('/app/node_modules/'+n+'/package.json','utf8')).version;console.log(JSON.stringify(r))"
        actual=json.loads(runtime['run'](['docker','run','--rm','--network','none','--read-only','--cap-drop','ALL','--memory','256m','--pids-limit','32','--log-driver','none','--entrypoint','node',image['Id'],'-e',script]))
        if actual!={name:versions[name] for name in ('next','react','react-dom','sharp')}:raise RuntimeError('BuiltImagePatchedVersionsMismatch')
        result.update(status='PASS',image=image['Id'],architecture='linux/arm64',nonroot=True,buildEnvNames=list(public_build_env(runtime['read_env']())),
            sourceArchiveSHA256=digest(body),imageBytes=image['Size'],runtimeDeployed=False,securityVersions=versions)
    except Exception as error:
        # Only our fixed code/type, never native output/args/provider bodies.
        result['code']=str(error) if type(error)is RuntimeError and re.fullmatch(r'[A-Za-z][A-Za-z0-9_]{0,90}',str(error)) else type(error).__name__
    result['elapsedSeconds']=round(time.monotonic()-started,3)
    store.put(stage,'result.json',json.dumps(result,sort_keys=True).encode())
    anchor=store.seal(stage,previous=next(reversed(data['anchors'].values()),None))
    return {**result,'stage':stage.name,'manifestSHA256':anchor}
