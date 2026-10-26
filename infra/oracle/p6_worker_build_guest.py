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


def require_receipt_sources(probe, target):
    hashes = probe.get('publicSourceSHA256', {})
    if set(hashes) != {'mock-browser.ts', 'mock-ats.ts'} or any(
            digest((target / 'services/application-worker' / name).read_bytes()) != expected for name, expected in hashes.items()):
        raise RuntimeError('ThirdBuildSourceMustMatchNativeSixScenarioProbe')


def run(data,runtime, *, source_repair_one=False, source_repair_two=False, owner_resume=False):
    if type(owner_resume) is not bool or owner_resume and (source_repair_one or source_repair_two):raise RuntimeError('DistinctOwnerResumeRequired')
    if type(source_repair_one) is not bool or type(source_repair_two) is not bool or source_repair_one and source_repair_two:raise RuntimeError('ExplicitSourceRepairBooleanRequired')
    source_repair = source_repair_one or source_repair_two
    sha=data['sourceSHA'];attempt=data['attempt']
    if not re.fullmatch(r'[a-f0-9]{40}',sha) or type(attempt)is not int or attempt not in (1,2,3):raise RuntimeError('BoundedP6SourceBuildRequired')
    roles=Store(ROOT/'.env.p6',uid=1002)
    for row in (data['p6Inventory'],data['rolePreflight'],data['roleInstall']):roles.verify(row['stage'],row['manifestSHA256'])
    if owner_resume:
        prior = data['resumePriorBuild']
        original = Store(ROOT/'.env.p6-build-source-repairs',uid=1002)
        original.verify(prior['stage'],prior['manifestSHA256'])
        if (json.loads((original.root/prior['stage']/'result.json').read_bytes()) != {k:v for k,v in prior.items() if k not in ('stage','manifestSHA256')}
                or prior.get('status') != 'PASS' or prior.get('containment',{}).get('status') != 'PASS'
                or data.get('pauseReconciliationManifestSHA256') != '5cc51791a86c13913296bd2707c54e279728822e67911b81bd6ff57d81f4d23a'
                or data.get('pidAuditManifestSHA256') != '7e08a4af09655a9be9efd249f5f0adcc1c4c8eb4691839a319d7470a241e1e4a'):
            raise RuntimeError('ActualPriorBuildPauseAndPIDPassRequired')
        probe = data['receiptRepairProbe']
        roles.verify(probe['stage'],probe['manifestSHA256'])
        if json.loads((roles.root/probe['stage']/'result.json').read_bytes()) != {k:v for k,v in probe.items() if k not in ('stage','manifestSHA256')}:
            raise RuntimeError('ResumeReceiptProbeMustMatchNative')
        if data.get('resumePauseRepair') is True:
            failure = data['resumeFailure']
            roles.verify(failure['stage'],failure['manifestSHA256'])
            roles.verify(failure['imageRollback']['stage'],failure['imageRollback']['manifestSHA256'])
            actual_failure=json.loads((roles.root/failure['stage']/'result.json').read_bytes())
            names=[row['name'] for row in roles.verify(failure['stage'],failure['manifestSHA256'])['artifacts']]
            if (actual_failure != {k:v for k,v in failure.items() if k not in ('stage','manifestSHA256','imageRollback')}
                    or failure.get('code') != 'NativeMockCaseFailed_mock-health' or failure.get('failureContainment',{}).get('status') != 'PASS'
                    or failure['imageRollback'].get('status') != 'PASS' or attempt != 2
                    or any('publication-intent' in name or 'schedule-intent' in name for name in names)):
                raise RuntimeError('ExactPrePublicationPauseFailureAndRollbackRequired')
        if data.get('resumeScheduleRepair') is True:
            failure=data['scheduleFailure'];drain=data['scheduleDrain']
            for row in (failure,drain):roles.verify(row['stage'],row['manifestSHA256'])
            if (json.loads((roles.root/failure['stage']/'result.json').read_bytes())!={k:v for k,v in failure.items() if k not in ('stage','manifestSHA256','imageRollback')}
                    or json.loads((roles.root/drain['stage']/'result.json').read_bytes())!={k:v for k,v in drain.items() if k not in ('stage','manifestSHA256')}
                    or drain.get('status')!='PASS' or drain.get('newPublications')!=0 or drain.get('drainedExistingSchedule')!=1
                    or drain.get('containment',{}).get('status')!='PASS' or drain.get('observation',{}).get('pendingScheduleJobs')!=0
                    or failure.get('code')!='NativeMockCaseFailed_schedule-mock_automation' or attempt!=3):
                raise RuntimeError('FinalScheduleRepairRequiresSealedOwnedDrain')
    if attempt == 3:
        probe = data['receiptRepairProbe']
        roles.verify(probe['stage'], probe['manifestSHA256'])
        native = json.loads((roles.root / probe['stage'] / 'result.json').read_bytes())
        if native != {key: value for key, value in probe.items() if key not in ('stage', 'manifestSHA256')}:
            raise RuntimeError('ReceiptRepairProbeMustMatchSealedNativeResult')
        if native.get('status') != 'PASS' or native.get('parentOneSubmissionGuardUnchanged') is not True:
            raise RuntimeError('ReceiptRepairProbeNotPassing')
    if data['roleInstall']['status']!='PASS':raise RuntimeError('VerifiedMinimalRolesRequired')
    journal=ROOT/('.env.p6-resume-builds-20261026' if owner_resume else '.env.p6-builds')
    if not journal.exists():journal.mkdir(mode=0o700);os.chown(journal,1002,1002)
    store=Store(journal,uid=1002);verify_history(store,data['anchors'],sha)
    if source_repair:
        failed = data['failedThirdSource']
        store.verify(failed['stage'], failed['manifestSHA256'])
        actual = json.loads((store.root / failed['stage'] / 'result.json').read_bytes())
        if (failed.get('attempt') != 3 or attempt != 3 or len(data['anchors']) != 3
                or failed.get('code') != 'FileNotFoundError' or failed.get('sourceSHA') != sha
                or actual != {key: value for key, value in failed.items() if key not in ('stage', 'manifestSHA256')}
                or {item.name for item in (store.root / failed['stage']).iterdir()} != {
                    'manifest.json', 'result.json', 'pre-pristine-fidelity.json', 'pre-fixture-fidelity.json',
                    'post-pristine-fidelity.json', 'post-fixture-fidelity.json'}):
            raise RuntimeError('ThirdSlotMustProveNoBuildIntentOrDockerInvocation')
        tag = 'ir35-p6-mock-worker:' + sha
        prior_image = subprocess.run(['docker', 'image', 'inspect', tag], capture_output=True, timeout=10)
        if prior_image.returncode == 0 or b'No such image' not in prior_image.stderr:
            raise RuntimeError('AmbiguousThirdImageOutcome_NoBuildReplay')
        repair_root = ROOT / '.env.p6-build-source-repairs'
        if not repair_root.exists():repair_root.mkdir(mode=0o700);os.chown(repair_root,1002,1002)
        store=Store(repair_root,uid=1002)
        if source_repair_two:
            first = data['failedSourceRepairOne']
            store.verify(first['stage'], first['manifestSHA256'])
            actual_first = json.loads((store.root / first['stage'] / 'result.json').read_bytes())
            if (first.get('sourceRepairAttempt') != 1 or first.get('sourceSHA') != sha
                    or first.get('code') != 'ThirdBuildSourceMustMatchNativeSixScenarioProbe'
                    or actual_first != {key: value for key, value in first.items() if key not in ('stage', 'manifestSHA256')}
                    or {item.name for item in (store.root / first['stage']).iterdir()} != {
                        'manifest.json', 'result.json', 'pre-pristine-fidelity.json', 'pre-fixture-fidelity.json',
                        'post-pristine-fidelity.json', 'post-fixture-fidelity.json'}):
                raise RuntimeError('SourceRepairOneMustProveNoDockerInvocation')
    elif attempt!=len(data['anchors'])+1:raise RuntimeError('P6BuildHistoryMismatch')
    stage=store.stage('02-third-source-repair' if source_repair_two else '01-third-source-repair' if source_repair_one else f'{attempt:02d}-build');started=time.monotonic()
    result={'status':'FAIL','attempt':attempt,'sourceSHA':sha,'productionChanges':False,'serviceChanges':0,'realAcceptance':False}
    if owner_resume:
        result.update(ownerResume=True,journal=str(journal),priorBuildManifestSHA256=prior['manifestSHA256'],
                      historicalBuildSlotsPreserved=True,pauseReconciliationManifestSHA256=data['pauseReconciliationManifestSHA256'],
                      pidAuditManifestSHA256=data['pidAuditManifestSHA256'])
        if data.get('resumePauseRepair') is True:result.update(resumePauseRepair=True,resumeRepairAttempt=1,priorLifecycleFailureManifestSHA256=data['resumeFailure']['manifestSHA256'])
        if data.get('resumeScheduleRepair') is True:result.update(resumeScheduleRepair=True,resumeRepairAttempt=2,finalResumedLifecycleAttempt=True,priorLifecycleFailureManifestSHA256=data['scheduleFailure']['manifestSHA256'],ownedDrainManifestSHA256=data['scheduleDrain']['manifestSHA256'])
    if source_repair:
        result.update(sourceRepairAttempt=2 if source_repair_two else 1, journal=str(store.root), originalFailedBuildManifest=data['failedThirdSource']['manifestSHA256'],
                      originalThreeBuildSlotsPreserved=True, dockerInvocationsBeforeRepair=0)
        if source_repair_two:
            result.update(sourceRepairPreviousManifest=data['failedSourceRepairOne']['manifestSHA256'], noFurtherSourceRepair=True)
    try:
        before,pristine,fixture=fidelity(data,runtime)
        store.put(stage,'pre-pristine-fidelity.json',json.dumps(pristine).encode());store.put(stage,'pre-fixture-fidelity.json',json.dumps(fixture).encode())
        if before['status']!='PASS':raise RuntimeError('P6PreBuildContainmentMismatch_Abort')
        if os.uname().machine!='aarch64':raise RuntimeError('NativeArmRequired')
        available=int(re.search(r'^MemAvailable:\s+(\d+)',Path('/proc/meminfo').read_text(),re.M)[1])
        if available<4*1024*1024:raise RuntimeError('P6BuildMemoryHeadroomInsufficient')
        body=base64.b64decode(data['archive'],validate=True)
        if digest(body)!=data['archiveSHA256']:raise RuntimeError('SourceArchiveHashMismatch')
        target=ROOT/'data/p6-build-source'/(sha+'-source-r2' if source_repair_two else sha+'-source-r1' if source_repair_one else sha);target.parent.mkdir(exist_ok=True);target.mkdir(mode=0o755)
        with tarfile.open(fileobj=io.BytesIO(body),mode='r:') as archive:archive.extractall(target,members=safe_members(archive),filter='data')
        if attempt == 3 or owner_resume:
            require_receipt_sources(probe, target)
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
    previous = data['failedSourceRepairOne']['manifestSHA256'] if source_repair_two else next(reversed(data['anchors'].values()),None)
    return result|{'stage':stage.name,'manifestSHA256':store.seal(stage,previous=previous)}
