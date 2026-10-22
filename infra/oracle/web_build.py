"""Build a committed source snapshot on existing staging; no OCI creates."""
import base64
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import cloud_schema as schema
import host_ssh
import immutable_artifacts


def build():
    repo=schema.REPO
    if subprocess.check_output(['git','status','--porcelain'],cwd=repo,text=True).strip():raise RuntimeError('CommittedCleanSourceRequired')
    sha=subprocess.check_output(['git','rev-parse','HEAD'],cwd=repo,text=True).strip()
    branch=subprocess.check_output(['git','branch','--show-current'],cwd=repo,text=True).strip()
    if branch!='codex/oracle-migration-p5':raise RuntimeError('P5BranchRequired')
    previous={}
    for path in sorted((repo/'docs/evidence/p5').glob('build-*.json')):
        row=json.loads(path.read_text());previous[row['stage']]=row['manifestSHA256']
        if row['status']=='PASS':raise RuntimeError('BuildAlreadyPassed_NoReplay')
    attempt=len(previous)+1
    if attempt>3:raise RuntimeError('BuildRepairBudgetExhausted')
    body=subprocess.check_output(['git','archive','--format=tar',sha],cwd=repo)
    if len(body)>100_000_000:raise RuntimeError('SourceArchiveLimit')
    data={'sourceSHA':sha,'attempt':attempt,'anchors':previous,'archiveSHA256':hashlib.sha256(body).hexdigest(),'archive':base64.b64encode(body).decode()}
    source=schema.guest_bundle(rehearsal=True)
    source+='\nimport types\n'
    for name in ('immutable_artifacts','web_build_guest'):
        code=(repo/'infra/oracle'/(name+'.py')).read_text()
        source+='module=types.ModuleType('+repr(name)+');sys.modules['+repr(name)+']=module\nexec('+repr(code)+',module.__dict__)\n'
    source+='result=sys.modules["web_build_guest"].run('+repr(data)+',{"run":run,"read_env":read_env,"env_text":env_text})\nprint(json.dumps(result))\n'
    result=schema.run_guest(source,timeout=1500)
    path=repo/'docs/evidence/p5'/('build-'+str(attempt)+'.json');path.parent.mkdir(exist_ok=True)
    with path.open('x') as output:json.dump(result,output,indent=2);output.write('\n')
    print(json.dumps(result))


if __name__=='__main__':
    try:build()
    except Exception as error:
        print(json.dumps({'status':'STOP','code':type(error).__name__,'detail':str(error) if type(error)is RuntimeError else 'Private runtime diagnostic withheld'}));sys.exit(1)
