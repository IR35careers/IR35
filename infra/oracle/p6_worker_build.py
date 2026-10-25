"""Hash-bound native build, separate from immutable P5 images/history."""
import base64
import hashlib
import json
import subprocess
import sys
import io
import re
import tarfile
import cloud_schema as schema
import p6_context
from web_build import git_command


def bundle():
    script=p6_context.bundle()
    for name in ('p6_role_policy','p6_containment','web_build_guest','p6_worker_build_guest'):
        code=(schema.REPO/'infra/oracle'/(name+'.py')).read_text()
        script+='module=types.ModuleType('+repr(name)+');sys.modules['+repr(name)+']=module\nexec('+repr(code)+',module.__dict__)\n'
    return script


def main():
    if sys.argv[1:] not in (['--build'], ['--repair-third-source-once'], ['--repair-third-source-eol-once']):raise RuntimeError('ExplicitP6BuildRequired')
    source_repair_two = sys.argv[1:] == ['--repair-third-source-eol-once']
    source_repair = sys.argv[1:] in (['--repair-third-source-once'], ['--repair-third-source-eol-once'])
    data=p6_context.context();git=git_command(schema.REPO)
    sha=subprocess.check_output(git+['rev-parse','HEAD'],text=True).strip()
    for key,path in [('p6Inventory','p6-inventory.json'),('rolePreflight','p6-role-preflight.json'),('roleInstall','p6-role-install.json')]:
        data[key]=json.loads((schema.REPO/'docs/evidence'/path).read_text())
    previous={}
    directory=schema.REPO/'docs/evidence/p6'
    for path in sorted(directory.glob('worker-build-*.json')):
        if not re.fullmatch(r'worker-build-[1-3]\.json', path.name):continue
        report=json.loads(path.read_text());previous[report['stage']]=report['manifestSHA256']
    attempt=3 if source_repair else len(previous)+1
    if attempt>3:raise RuntimeError('P6WorkerBuildBudgetExhausted')
    if source_repair:
        destination = directory / ('worker-build-3-source-repair-two.json' if source_repair_two else 'worker-build-3-source-repair-one.json')
        if destination.exists():raise RuntimeError('ThirdSourceRepairAlreadyRecorded_NoReplay')
        failed = json.loads((directory / 'worker-build-3.json').read_text())
        if (failed.get('attempt') != 3 or failed.get('code') != 'FileNotFoundError'
                or failed.get('status') != 'FAIL' or failed.get('containment', {}).get('status') != 'PASS' or len(previous) != 3):
            raise RuntimeError('ExactPreDockerThirdSourceFailureRequired')
        sha = failed['sourceSHA']
        if subprocess.run(git + ['diff', '--quiet', sha, 'HEAD', '--', 'services/application-worker', 'src/lib/queue', 'package.json', 'package-lock.json']).returncode:
            raise RuntimeError('ThirdSourceRepairCannotChangeIntendedRuntime')
        data['failedThirdSource'] = failed
        if source_repair_two:
            first = json.loads((directory / 'worker-build-3-source-repair-one.json').read_text())
            if (first.get('status') != 'FAIL' or first.get('sourceRepairAttempt') != 1
                    or first.get('code') != 'ThirdBuildSourceMustMatchNativeSixScenarioProbe'
                    or first.get('containment', {}).get('status') != 'PASS'):
                raise RuntimeError('ExactPreDockerEOLFailureRequired_NoThirdRepair')
            data['failedSourceRepairOne'] = first
    if attempt == 3:
        probe = json.loads((directory / 'isolated-receipt-repair-one.json').read_text())
        if (probe.get('status') != 'PASS' or probe.get('repairAttempt') != 1
                or probe.get('parentOneSubmissionGuardUnchanged') is not True
                or probe.get('containment', {}).get('status') != 'PASS'):
            raise RuntimeError('ThirdBuildNeedsActualReceiptRepairProbe')
        data['receiptRepairProbe'] = probe
    # Status uses core.autocrlf=true for the Windows worktree. The archive must
    # instead contain the committed Git blob bytes, identical to native14.
    archive=subprocess.check_output(git+['-c','core.autocrlf=false','archive','--format=tar',sha],cwd=schema.REPO)
    if len(archive)>100_000_000:raise RuntimeError('P6SourceArchiveBound')
    with tarfile.open(fileobj=io.BytesIO(archive), mode='r:') as snapshot:
        names = set(snapshot.getnames())
        if not {'package.json', 'package-lock.json', 'services/application-worker/Dockerfile.mock', 'services/application-worker/mock-browser.ts'}.issubset(names):
            raise RuntimeError('RepositoryRootSourceArchiveRequired_BeforeSSH')
    data.update(sourceSHA=sha,attempt=attempt,anchors=previous,archiveSHA256=hashlib.sha256(archive).hexdigest(),archive=base64.b64encode(archive).decode())
    script=bundle()+'result=sys.modules["p6_worker_build_guest"].run('+repr(data)+',runtime,source_repair_one='+repr(source_repair and not source_repair_two)+',source_repair_two='+repr(source_repair_two)+')\nprint(json.dumps(result))\n'
    result=schema.run_guest(script,timeout=1500);directory.mkdir(exist_ok=True)
    destination = directory / ('worker-build-3-source-repair-two.json' if source_repair_two else 'worker-build-3-source-repair-one.json' if source_repair else 'worker-build-'+str(attempt)+'.json')
    with destination.open('x') as output:json.dump(result,output,indent=2)
    print(json.dumps(result))
    if result['status']!='PASS':raise SystemExit(1)


if __name__=='__main__':
    try:main()
    except Exception as error:
        print(json.dumps({'status':'STOP','code':str(error) if type(error)is RuntimeError else type(error).__name__}));raise SystemExit(1)
