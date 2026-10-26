"""26Oct owner-resumed staging work, with new journals and immutable old gates."""
import base64
import hashlib
import io
import json
import subprocess
import sys
import tarfile

import cloud_schema as schema
import p6_context
import p6_worker_build
from p6_pause_reconcile import verified_manifest, verify_passed_reconciliation
from p6_status_audit import CASES, MODULES
from ssh_agent_session import ensure_agent
from web_build import git_command
from web_build_guest import safe_members

DIRECTORY = schema.REPO / 'docs/evidence/p6'
PID_ANCHOR = '7e08a4af09655a9be9efd249f5f0adcc1c4c8eb4691839a319d7470a241e1e4a'


def gates():
    pause = verify_passed_reconciliation(DIRECTORY/'pause-reconciliation-20261026-02')
    root = DIRECTORY/'status-resume-pid-audit-01'
    anchor = verified_manifest(root)
    result = json.loads((root/'result.json').read_bytes())
    if (anchor != PID_ANCHOR or result.get('status') != 'PASS' or result.get('vmWrites') != 0
            or result.get('steps') != [{'case':case,'status':'PASS'} for case in CASES]):
        raise RuntimeError('ActualPIDCorrectedReadOnlyAuditRequired')
    return {'pauseReconciliationManifestSHA256':pause,'pidAuditManifestSHA256':anchor}


def context():
    proof = gates()
    if ensure_agent().get('keyLoaded') is not True:
        raise RuntimeError('MatchingSSHIdentityRequired_NoAutomaticPrompt')
    data = p6_context.context() | proof
    for key,name in [('p6Inventory','p6-inventory.json'),('rolePreflight','p6-role-preflight.json'),('roleInstall','p6-role-install.json')]:
        data[key] = json.loads((schema.REPO/'docs/evidence'/name).read_text())
    for key,name in [('mockPrepare','mock-prepare.json'),('ownerHBABoundary','queue-hba-owner-boundary.json'),
                     ('scopeFailure','mock-runtime-update-two.json'),('runtimeProof','mock-receipt-repair-one-handover.json'),
                     ('failureLifecycle','native-mock-lifecycle.json'),('currentFailure','native-mock-lifecycle-repair-one.json'),
                     ('receiptRepairProbe','isolated-receipt-repair-one.json'),('resumePriorBuild','worker-build-3-source-repair-two.json')]:
        data[key] = json.loads((DIRECTORY/name).read_text())
    return data


def bundle():
    script = p6_worker_build.bundle()
    for name in MODULES:
        script += 'module=types.ModuleType('+repr(name)+');sys.modules['+repr(name)+']=module\nexec('+repr((schema.REPO/'infra/oracle'/(name+'.py')).read_text())+',module.__dict__)\n'
    return script


def build():
    data = context()
    git = git_command(schema.REPO)
    sha = subprocess.check_output(git+['rev-parse','HEAD'],text=True).strip()
    previous = {}
    for path in sorted(DIRECTORY.glob('worker-resume-build-[123].json')):
        row = json.loads(path.read_text())
        previous[row['stage']] = row['manifestSHA256']
        if row['status'] == 'PASS':raise RuntimeError('ResumeBuildAlreadyPassed_NoReplay')
        if row.get('containment',{}).get('status') != 'PASS':raise RuntimeError('PreviousBuildContainmentFailed_HardStop')
    attempt = len(previous)+1
    if attempt > 3:raise RuntimeError('ResumeBuildThreeFailures_Stop')
    archive = subprocess.check_output(git+['-c','core.autocrlf=false','archive','--format=tar',sha],cwd=schema.REPO)
    with tarfile.open(fileobj=io.BytesIO(archive),mode='r:') as snapshot:
        safe_members(snapshot)
        if not {'package.json','package-lock.json','services/application-worker/Dockerfile.mock'}.issubset(snapshot.getnames()):
            raise RuntimeError('RootArchiveRequired_BeforeSSH')
    data.update(sourceSHA=sha,attempt=attempt,anchors=previous,archiveSHA256=hashlib.sha256(archive).hexdigest(),archive=base64.b64encode(archive).decode())
    script = bundle()+'result=sys.modules["p6_worker_build_guest"].run('+repr(data)+',runtime,owner_resume=True)\nprint(json.dumps(result))\n'
    result = schema.run_guest(script,timeout=1500)
    destination = DIRECTORY/('worker-resume-build-'+str(attempt)+'.json')
    with destination.open('x',encoding='utf-8') as output:json.dump(result,output,indent=2)
    print(json.dumps(result))
    if result['status'] != 'PASS':raise SystemExit(1)


def run_runtime(operation):
    if operation not in ('handover','lifecycle'):raise RuntimeError('FixedResumeRuntimeOperationRequired')
    destination = DIRECTORY/('owner-resume-'+operation+'.json')
    if destination.exists():raise RuntimeError('ResumeStageRecorded_NoReplay')
    data = context()
    builds = [json.loads(path.read_text()) for path in sorted(DIRECTORY.glob('worker-resume-build-[123].json'))]
    if not builds or builds[-1].get('status') != 'PASS':raise RuntimeError('ActualResumeBuildRequired')
    data['workerBuild'] = builds[-1]
    if subprocess.run(git_command(schema.REPO)+['diff','--quiet',builds[-1]['sourceSHA'],'HEAD','--',
        'services/application-worker','src/lib/queue','package.json','package-lock.json']).returncode:
        raise RuntimeError('ResumeRuntimeChangedAfterBuild')
    if operation == 'lifecycle':
        data['previousRuntimeProof'] = data['runtimeProof']
        data['runtimeProof'] = json.loads((DIRECTORY/'owner-resume-handover.json').read_text())
        if data['runtimeProof'].get('status') != 'PASS':raise RuntimeError('ActualResumeHandoverRequired')
    script = bundle()
    module = 'p6_mock_receipt_repair_guest'
    code = (schema.REPO/'infra/oracle'/ (module+'.py')).read_text()
    script += 'module=types.ModuleType('+repr(module)+');sys.modules['+repr(module)+']=module\nexec('+repr(code)+',module.__dict__)\n'
    selected = module if operation == 'handover' else 'p6_lifecycle_guest'
    script += 'result=sys.modules['+repr(selected)+'].run('+repr(data)+',runtime,owner_resume=True)\n'
    if operation == 'lifecycle':
        # Failure rollback is an explicit retained-old-image, paused launch.
        # Do not briefly restart an old unpaused Compose definition.
        script += '''
if result['status'] != 'PASS':
 store=sys.modules['p6_mock_guest'].prepared(DATA)
 rollback_stage=store.stage('19-owner-resume-rollback')
 rollback={'status':'FAIL'}
 try:
  runtime['run'](['docker','stop','--time','30','ir35-p6-mock-worker-v4'],timeout=45)
  runtime['run'](['systemctl','disable','--now','ir35-p6-health-proxy-r4.socket'])
  runtime['run'](['systemctl','stop','ir35-p6-health-proxy-r4.service'])
  rollback=sys.modules['p6_mock_receipt_repair_guest'].paused_rollback(DATA,runtime,store,rollback_stage,DATA['previousRuntimeProof'])
 except Exception as error:rollback['code']=type(error).__name__
 rollback['containment']=sys.modules['p6_mock_guest'].check_containment(DATA,runtime,store,rollback_stage,'post')
 store.put(rollback_stage,'result.json',json.dumps(rollback,sort_keys=True).encode())
 result['imageRollback']=rollback|{'stage':rollback_stage.name,'manifestSHA256':store.seal(rollback_stage)}
'''.replace('DATA',repr(data))
    script += 'print(json.dumps(result))\n'
    result = schema.run_guest(script,timeout=900)
    with destination.open('x',encoding='utf-8') as output:json.dump(result,output,indent=2)
    print(json.dumps({k:result.get(k) for k in ('status','code','cases','scenarios','containment','failureContainment','imageRollback','manifestSHA256')}))
    if result['status'] != 'PASS':raise SystemExit(1)


if __name__ == '__main__':
    try:
        if sys.argv[1:] == ['--build']:build()
        elif sys.argv[1:] == ['--handover']:run_runtime('handover')
        elif sys.argv[1:] == ['--lifecycle']:run_runtime('lifecycle')
        else:raise RuntimeError('ExplicitResumeOperationRequired')
    except Exception as error:
        print(json.dumps({'status':'STOP','code':str(error) if type(error)is RuntimeError else type(error).__name__,'rawErrorWithheld':True}))
        raise SystemExit(1)
