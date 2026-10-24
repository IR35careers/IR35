"""Guarded P5 fixture preparation. Default is offline; no activation/cutover."""
import inspect
import json
from pathlib import Path
import subprocess
import sys
import cloud_schema as schema
import owner_parity
import p4_recovery
import rehearsal
import storage_target
from web_build import git_command
from web_security import deployable_build


def payload():
    history=p4_recovery.reports();signoff=history.get('revised_signoff',{})
    if signoff.get('status')!='PASS' or signoff.get('phaseComplete')is not True or not all(signoff.get('criteria',{}).values()):
        raise RuntimeError('OwnerRevisedP4SignoffRequired')
    paths=sorted((schema.REPO/'docs/evidence/p5').glob('build-*.json'))
    if not paths:raise RuntimeError('PatchedNativeBuildRequired')
    build=json.loads(paths[-1].read_text());deployable_build(build)
    # Infrastructure/docs-only commits after a build are allowed; app changes
    # require a NEW image. Never substitute a mutable tag for its sealed ID.
    git=git_command(schema.REPO)
    if subprocess.check_output(git+['status','--porcelain'],text=True).strip():raise RuntimeError('CommittedCleanSourceRequired')
    if subprocess.check_output(git+['branch','--show-current'],text=True).strip()!='codex/oracle-migration-p5':raise RuntimeError('P5BranchRequired')
    result=subprocess.run(git+['diff','--quiet',build['sourceSHA'],'HEAD','--','src','public','services/web','next.config.ts','package.json','package-lock.json'])
    if result.returncode:raise RuntimeError('BuiltAppSourceChanged')
    pins=json.loads((schema.REPO/'infra/oracle/staging-images.json').read_text())['images']
    storage=json.loads((schema.REPO/'infra/oracle/storage-compatible-image.json').read_text())
    if storage.get('migrationFixtureVerified')is not True:raise RuntimeError('ExactStorageHistoryProofRequired')
    pins['storage']=storage['image']
    return {'p4':p4_recovery.payload()|{'pins':pins},'build':build,
            'buildAnchors':{row['stage']:row['manifestSHA256'] for row in (json.loads(path.read_text()) for path in paths)}}


def guest(data,operation='prepare'):
    if operation not in ('prepare','services','edge-prepare','edge-activate','edge-repair-1','edge-repair-2','header-probe','header-probe-repair-1','header-probe-repair-2'):raise RuntimeError('FixedP5OperationRequired')
    script=schema.guest_bundle(rehearsal=True)+owner_parity.BASE+'\nimport types\n'
    for name in ('immutable_artifacts','p4_recovery_guest','web_security','web_stack','web_fixture_guest','web_services_guest','web_edge_guest','web_header_probe_guest'):
        code=(schema.REPO/'infra/oracle'/(name+'.py')).read_text()
        script+='module=types.ModuleType('+repr(name)+');sys.modules['+repr(name)+']=module\nexec('+repr(code)+',module.__dict__)\n'
    verifiers=rehearsal.verification_modules()+'\nfrom pathlib import PurePosixPath\n'+inspect.getsource(storage_target.backend_path)
    script+='verification_namespace={}\nexec('+repr(verifiers)+',verification_namespace)\n'
    script+='runtime={"run":run,"read_env":read_env,"verifiers":verification_namespace,"component_env":component_env,"env_text":env_text,"kong_config":stack.kong_config,"baseline_caddy":stack.CADDYFILE,"caddy_permissions":caddy_permissions}\n'
    if operation.startswith('header-probe-repair-'):
        script+='result=sys.modules["web_header_probe_guest"].run('+repr(data)+',runtime,'+operation[-1]+')\nprint(json.dumps(result))\n'
    elif operation.startswith('edge-repair-'):
        script+='result=sys.modules["web_edge_guest"].repair('+repr(data)+',runtime,'+operation[-1]+')\nprint(json.dumps(result))\n'
    else:
        module,function={'prepare':('web_fixture_guest','prepare'),'services':('web_services_guest','start'),'edge-prepare':('web_edge_guest','prepare'),'edge-activate':('web_edge_guest','activate'),'header-probe':('web_header_probe_guest','run')}[operation]
        script+='result=sys.modules['+repr(module)+'].'+function+'('+repr(data)+',runtime)\nprint(json.dumps(result))\n'
    return script


def main():
    if sys.argv[1:]==['--dry-run']:
        print(json.dumps({'status':'DRY_RUN','target':'ir35_p5_app','sourceWrites':0,'pristineWrites':0,'containersCreated':False,'caddyActivated':False}));return
    if sys.argv[1:] not in (['--prepare'],['--services'],['--edge-prepare'],['--edge-activate'],['--edge-repair-1'],['--edge-repair-2'],['--header-probe'],['--header-probe-repair-1'],['--header-probe-repair-2']):raise RuntimeError('ExplicitStagingOperationRequired')
    operation=sys.argv[1][2:]
    path=schema.REPO/('docs/evidence/p5/'+operation+'.json')
    if path.exists():raise RuntimeError('PreparationRecorded_NoReplay')
    data=payload()
    if operation.startswith('header-probe-repair-'):
        previous_name='header-probe' if operation.endswith('-1') else 'header-probe-repair-1'
        previous=json.loads((schema.REPO/('docs/evidence/p5/'+previous_name+'.json')).read_text())
        if previous.get('status')!='FAIL' or previous.get('publicEdgeChanged')is not False:raise RuntimeError('FailedPrivateProbeRequired')
        data['probeAnchor']=previous['manifestSHA256']
    if operation!='prepare':
        prepare=json.loads((schema.REPO/'docs/evidence/p5/prepare.json').read_text())
        if prepare.get('status')!='PASS':raise RuntimeError('PreparedFixtureRequired')
        data['prepareAnchor']=prepare['manifestSHA256']
    if operation.startswith('edge-'):
        services=json.loads((schema.REPO/'docs/evidence/p5/services.json').read_text())
        if services.get('status')!='PASS':raise RuntimeError('PrivateServicesRequired')
        data['servicesAnchor']=services['manifestSHA256']
    if operation=='edge-activate' or operation.startswith('edge-repair-'):
        import staging_dns,time
        if operation=='edge-activate':
            edge=json.loads((schema.REPO/'docs/evidence/p5/edge-prepare.json').read_text())
            if edge.get('status')!='PASS':raise RuntimeError('PreparedEdgeRequired')
            data['edgeAnchor']=edge['manifestSHA256']
        else:
            previous_name='edge-activate' if operation=='edge-repair-1' else 'edge-repair-1'
            failed=json.loads((schema.REPO/('docs/evidence/p5/'+previous_name+'.json')).read_text())
            if previous_name=='edge-repair-1':failed=failed['activation']
            if failed.get('status')!='FAIL' or failed.get('rollback')!='original Caddy restored':raise RuntimeError('PriorRolledBackFailureRequired')
            data['failedEdgeAnchor']=failed['manifestSHA256']
        ready,observations=staging_dns.observe()
        if not ready:raise RuntimeError('StagingDNSNotReady_NoActivation')
        data['dns']={'status':'PASS','observations':observations,'checkedAtUnix':time.time(),'dnsWrites':0}
    result=schema.run_guest(guest(data,operation),timeout=600)
    with path.open('x') as output:json.dump(result,output,indent=2);output.write('\n')
    print(json.dumps(result))
    if result['status']!='PASS':raise SystemExit(1)


if __name__=='__main__':
    try:main()
    except Exception as error:
        print(json.dumps({'status':'STOP','code':str(error) if type(error)is RuntimeError else type(error).__name__}));raise SystemExit(1)
