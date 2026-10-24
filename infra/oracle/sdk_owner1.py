"""Explicit one-shot SDK approval. Does not lift old web_fixture mutation hold."""
import json
import sys
from pathlib import Path
from immutable_artifacts import Store
from sdk_gate_proof import verify
import web_fixture
import cloud_schema as schema


def context():
    evidence=schema.REPO/'docs/evidence/p5-sdk-owner1'
    proof,diff=verify(evidence,2)
    if json.loads((evidence/'private-signoff.json').read_text())!=proof:raise RuntimeError('CommittedPrivateProofMismatch')
    if (evidence/'adapted-ordering.diff').read_text()!=diff:raise RuntimeError('CommittedAdaptedDiffMismatch')
    local=Store(Path.home()/'.ir35/sdk-owner1-private')
    for attempt in (1,2):
        for mode in ('baseline','fixed'):
            saved=json.loads((evidence/f'a{attempt}-{mode}-summary.json').read_text())
            local.verify(saved['stage'],saved['manifestSHA256'])
    data=web_fixture.payload(readonly=True)
    data['privateProof']=proof;data['p5Anchors']={}
    for name in ('prepare','services','edge-prepare','edge-activate','edge-repair-1','edge-repair-2','containment-audit'):
        record=json.loads((schema.REPO/('docs/evidence/p5/'+name+'.json')).read_text())
        for item in (record.get('preparation'),record.get('activation')) if name.startswith('edge-repair-') else (record,):
            data['p5Anchors'][item['stage']]=item['manifestSHA256']
    data['prepareAnchor']=data['p5Anchors']['01-prepare']
    return data


def guest(data):
    script=web_fixture.runtime_bundle()
    for name in ('sdk_gate_observation','sdk_owner1_guest'):
        code=(schema.REPO/'infra/oracle'/(name+'.py')).read_text()
        script+='module=types.ModuleType('+repr(name)+');sys.modules['+repr(name)+']=module\nexec('+repr(code)+',module.__dict__)\n'
    return script+'result=sys.modules["sdk_owner1_guest"].run('+repr(data)+',runtime)\nprint(json.dumps(result))\n'


def main():
    if sys.argv[1:]!=['--activate-once']:raise RuntimeError('ExplicitOwnerOneShotRequired')
    destination=schema.REPO/'docs/evidence/p5-sdk-owner1/edge-summary.json'
    if destination.exists():raise RuntimeError('OwnerOneShotRecorded_NoReplay')
    data=context()
    import staging_dns
    data['dns']=web_fixture.wait_staging_dns(staging_dns.observe)
    result=schema.run_guest(guest(data),timeout=900)
    exports=result.pop('exports',{})
    with destination.open('x') as output:json.dump(result,output,indent=2)
    for name,body in exports.items():
        if '/' in name or '\\' in name:raise RuntimeError('FixedEvidenceFilenameRequired')
        with (destination.parent/('edge-'+name)).open('x') as output:output.write(body)
    print(json.dumps({'status':result['status'],'preparation':result['preparation']['status'],'activation':result.get('activation',{}).get('status'),'containment':result.get('containment',{}).get('status'),'reviewRequired':True,'p6Authorised':False}))
    if result['status']!='PASS':raise SystemExit(1)


if __name__=='__main__':
    try:main()
    except Exception as error:
        print(json.dumps({'status':'STOP','code':str(error) if type(error)is RuntimeError else type(error).__name__}));raise SystemExit(1)
