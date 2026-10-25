"""Hash-bound native build, separate from immutable P5 images/history."""
import base64
import hashlib
import json
import subprocess
import sys
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
    if sys.argv[1:]!=['--build']:raise RuntimeError('ExplicitP6BuildRequired')
    data=p6_context.context();git=git_command(schema.REPO)
    sha=subprocess.check_output(git+['rev-parse','HEAD'],text=True).strip()
    for key,path in [('p6Inventory','p6-inventory.json'),('rolePreflight','p6-role-preflight.json'),('roleInstall','p6-role-install.json')]:
        data[key]=json.loads((schema.REPO/'docs/evidence'/path).read_text())
    previous={}
    directory=schema.REPO/'docs/evidence/p6'
    for path in sorted(directory.glob('worker-build-*.json')):
        report=json.loads(path.read_text());previous[report['stage']]=report['manifestSHA256']
    attempt=len(previous)+1
    if attempt>3:raise RuntimeError('P6WorkerBuildBudgetExhausted')
    if attempt == 3:
        probe = json.loads((directory / 'isolated-receipt-repair-one.json').read_text())
        if (probe.get('status') != 'PASS' or probe.get('repairAttempt') != 1
                or probe.get('parentOneSubmissionGuardUnchanged') is not True
                or probe.get('containment', {}).get('status') != 'PASS'):
            raise RuntimeError('ThirdBuildNeedsActualReceiptRepairProbe')
        data['receiptRepairProbe'] = probe
    archive=subprocess.check_output(git+['archive','--format=tar',sha])
    if len(archive)>100_000_000:raise RuntimeError('P6SourceArchiveBound')
    data.update(sourceSHA=sha,attempt=attempt,anchors=previous,archiveSHA256=hashlib.sha256(archive).hexdigest(),archive=base64.b64encode(archive).decode())
    script=bundle()+'result=sys.modules["p6_worker_build_guest"].run('+repr(data)+',runtime)\nprint(json.dumps(result))\n'
    result=schema.run_guest(script,timeout=1500);directory.mkdir(exist_ok=True)
    with (directory/('worker-build-'+str(attempt)+'.json')).open('x') as output:json.dump(result,output,indent=2)
    print(json.dumps(result))
    if result['status']!='PASS':raise SystemExit(1)


if __name__=='__main__':
    try:main()
    except Exception as error:
        print(json.dumps({'status':'STOP','code':str(error) if type(error)is RuntimeError else type(error).__name__}));raise SystemExit(1)
