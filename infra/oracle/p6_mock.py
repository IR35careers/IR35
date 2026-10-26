"""Explicit one-shot P6 mock-only operations; every result is write-once."""
import json
import subprocess
import sys
import cloud_schema as schema
import p6_context
import p6_worker_build
from web_build import git_command


def main():
    if len(sys.argv)!=2 or sys.argv[1]not in ('--prepare','--setup','--setup-verify-repair-1','--start','--network-diagnose','--health-repair-one'):raise RuntimeError('ExplicitP6MockOperationRequired')
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
    if operation=='setup-verify-repair-1':data['failedSetup']=json.loads((directory/'mock-setup.json').read_text())
    if operation=='start':
        repair=directory/'mock-setup-verify-repair-1.json'
        data['mockSetup']=json.loads((repair if repair.exists() else directory/'mock-setup.json').read_text())
    if operation=='network-diagnose':data['failedStart']=json.loads((directory/'mock-start.json').read_text())
    if operation=='health-repair-one':
        data['failedStart']=json.loads((directory/'mock-start.json').read_text())
        data['networkDiagnosis']=json.loads((directory/'mock-network-diagnose.json').read_text())
        recovery=json.loads((directory/'bastion-owner1-session-four-hour.json').read_text())
        if recovery.get('status')!='PASS' or recovery.get('sessionCreates')!=1 or recovery.get('sessionClosed')is not True or recovery.get('postCloseContainment',{}).get('containment',{}).get('status')!='PASS':raise RuntimeError('OneClosedRecoveryAndFullContainmentRequired')
    script=p6_worker_build.bundle()
    for name in ('p6_roles_guest','p6_mock_guest','p6_port_probe_guest','p6_health_repair_guest'):
        code=(schema.REPO/'infra/oracle'/(name+'.py')).read_text()
        script+='module=types.ModuleType('+repr(name)+');sys.modules['+repr(name)+']=module\nexec('+repr(code)+',module.__dict__)\n'
    function='verify_setup_repair' if operation=='setup-verify-repair-1' else operation
    module='p6_port_probe_guest' if operation=='network-diagnose' else 'p6_mock_guest'
    if operation=='network-diagnose':function='run'
    if operation=='health-repair-one':module='p6_health_repair_guest';function='run'
    script+='result=sys.modules['+repr(module)+'].'+function+'('+repr(data)+',runtime)\nprint(json.dumps(result))\n'
    result=schema.run_guest(script,timeout=600)
    with destination.open('x') as output:json.dump(result,output,indent=2)
    print(json.dumps({'status':result['status'],'code':result.get('code'),'containment':result.get('containment',{}).get('status'),
                      'manifestSHA256':result['manifestSHA256'],'realAcceptance':False}))
    if result['status']!='PASS':raise SystemExit(1)


if __name__=='__main__':
    try:main()
    except Exception as error:
        print(json.dumps({'status':'STOP','code':str(error) if type(error)is RuntimeError else type(error).__name__}));raise SystemExit(1)
