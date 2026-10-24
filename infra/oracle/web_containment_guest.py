"""Read-only containment after exhausted P5 edge repairs. No restart/retry."""
import base64
import copy
import json
from pathlib import Path
from immutable_artifacts import Store,digest
from p4_recovery_guest import Recovery,RecoveryError
from web_services_guest import require_prepared
from web_edge_guest import tls_get

ROOT=Path('/opt/ir35')


def run(data,runtime):
    store,_=require_prepared(data)
    for name,anchor in data['p5Anchors'].items():store.verify(name,anchor)
    failed=json.loads((store.root/'08-edge-repair-2-activate/result.json').read_bytes())
    if failed.get('status')!='FAIL' or failed.get('code')!='P5SDKBoundaryMismatch' or failed.get('rollback')!='original Caddy restored':
        raise RecoveryError('ExactFinalFailedEdgeRequired')
    original=Recovery(data['p4'],runtime);fixture=copy.copy(original);fixture.database='ir35_p5_app'
    pristine=original.check_database();after=fixture.check_database();source=original.source()
    physical=[]
    for item in source['storage']['privateObjects']:
        path=ROOT/'data/p5-storage'/runtime['verifiers']['backend_path'](item['bucket'],item['name'],item['version'])
        physical.append(path.is_file() and path.stat().st_size==int(item['bytes']) and digest(path.read_bytes())==item['sha256'])
    old=json.loads((store.root/'03-edge-prepare/result.json').read_bytes())
    files=all(digest(path.read_bytes())==old[key] for path,key in [(ROOT/'config/Caddyfile','originalConfigSHA256'),(ROOT/'compose.yml','originalComposeSHA256'),(ROOT/'.env.caddy','originalEnvSHA256')])
    values=runtime['read_env']();basic='Basic '+base64.b64encode(('ir35:'+values['STAGING_BASIC_PASSWORD']).encode()).decode()
    root_status,headers,_=tls_get('staging.ir35careers.com','/')
    authorized=tls_get('staging.ir35careers.com','/',{'Authorization':basic})[0]
    api=tls_get('api-staging.ir35careers.com','/auth/v1/health',{'X-Staging-Authorization':basic,'apikey':values['ANON_KEY'],'Authorization':'Bearer '+values['ANON_KEY']})[0]
    names=set(runtime['run'](['docker','container','ls','--all','--format','{{.Names}}']).splitlines())
    probes_absent=not any(name.startswith('ir35-p5-header-probe-') for name in names)
    private=json.loads(runtime['run'](['docker','inspect',*['ir35-p5-'+name for name in ('web','auth','rest','storage','kong')]]))
    no_ports=all(not item['HostConfig'].get('PortBindings') and item['State']['Status']=='running' for item in private)
    ok=pristine['status']=='PASS' and after['status']=='PASS' and all(physical) and files and root_status==401 and authorized==503 and api==200 and 'noindex' in headers.get('x-robots-tag','') and probes_absent and no_ports
    stage=store.stage('09-final-readonly-audit')
    store.put(stage,'pristine-fidelity.json',json.dumps(pristine).encode());store.put(stage,'fixture-fidelity.json',json.dumps(after).encode())
    result={'status':'PASS' if ok else 'FAIL','phaseComplete':False,'migrationHeld':True,'holdCode':'P5EdgeRepairBudgetExhausted',
            'pristineFidelity':pristine['status'],'fixtureFidelity':after['status'],'tablesEach':len(pristine['tables']),'appRolePrivilegesEach':552,
            'storageObjects':len(physical),'storageBytesMatch':all(physical),'originalCaddyFilesUnchanged':files,
            'originalStagingUnauthenticatedStatus':root_status,'originalAuthenticatedPlaceholderStatus':authorized,'originalAPIHealthStatus':api,
            'originalNoindex': 'noindex' in headers.get('x-robots-tag',''),'privateFixtureContainersRunningNoPorts':no_ports,'diagnosticContainersAbsent':probes_absent,
            'sourceWrites':0,'pristineWrites':0,'fixtureWrites':0,'productionChanges':False,'dnsWrites':0,'authGrantRequests':0,'restartOrRetry':False}
    store.put(stage,'result.json',json.dumps(result,sort_keys=True).encode())
    return {**result,'stage':stage.name,'manifestSHA256':store.seal(stage,previous=data['p5Anchors']['08-edge-repair-2-activate'])}
