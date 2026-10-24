"""Explicit one-shot P6 mock-only operations; every result is write-once."""
import json
import subprocess
import sys
import cloud_schema as schema
import p6_context
import p6_worker_build
from web_build import git_command


def main():
    if len(sys.argv)!=2 or sys.argv[1]not in ('--prepare','--setup','--start'):raise RuntimeError('ExplicitP6MockOperationRequired')
    operation=sys.argv[1][2:];directory=schema.REPO/'docs/evidence/p6';destination=directory/('mock-'+operation+'.json')
    if destination.exists():raise RuntimeError('P6MockOperationRecorded_NoReplay')
    data=p6_context.context()
    for key,path in [('p6Inventory','p6-inventory.json'),('rolePreflight','p6-role-preflight.json'),('roleInstall','p6-role-install.json')]:
        data[key]=json.loads((schema.REPO/'docs/evidence'/path).read_text())
    builds=sorted(directory.glob('worker-build-*.json'))
    if not builds:raise RuntimeError('NativeMockBuildRequired')
    build=json.loads(builds[-1].read_text());data['workerBuild']=build
    if build.get('status')!='PASS':raise RuntimeError('PassingNativeMockBuildRequired')
    git=git_command(schema.REPO)
    changed=subprocess.run(git+['diff','--quiet',build['sourceSHA'],'HEAD','--','src/lib/queue','services/application-worker','package.json','package-lock.json','supabase/operations/pgboss-producer-grants.sql']).returncode
    if changed:raise RuntimeError('MockRuntimeSourceChanged_NewBuildRequired')
    if operation!='prepare':data['mockPrepare']=json.loads((directory/'mock-prepare.json').read_text())
    if operation=='start':data['mockSetup']=json.loads((directory/'mock-setup.json').read_text())
    script=p6_worker_build.bundle()
    for name in ('p6_roles_guest','p6_mock_guest'):
        code=(schema.REPO/'infra/oracle'/(name+'.py')).read_text()
        script+='module=types.ModuleType('+repr(name)+');sys.modules['+repr(name)+']=module\nexec('+repr(code)+',module.__dict__)\n'
    script+='result=sys.modules["p6_mock_guest"].'+operation+'('+repr(data)+',runtime)\nprint(json.dumps(result))\n'
    result=schema.run_guest(script,timeout=600)
    with destination.open('x') as output:json.dump(result,output,indent=2)
    print(json.dumps({'status':result['status'],'code':result.get('code'),'containment':result.get('containment',{}).get('status'),
                      'manifestSHA256':result['manifestSHA256'],'realAcceptance':False}))
    if result['status']!='PASS':raise SystemExit(1)


if __name__=='__main__':
    try:main()
    except Exception as error:
        print(json.dumps({'status':'STOP','code':str(error) if type(error)is RuntimeError else type(error).__name__}));raise SystemExit(1)
