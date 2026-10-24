"""Read-only current-edge audit; never reuses a mutation operation."""
import json
import sys
import cloud_schema as schema
import sdk_owner1
import web_fixture


def main():
    if sys.argv[1:]!=['--audit']:raise RuntimeError('ExplicitReadOnlyAuditRequired')
    path=schema.REPO/'docs/evidence/p5-runtime-audit.json'
    if path.exists():raise RuntimeError('AuditAlreadyRecorded_NoReplay')
    data=sdk_owner1.context()
    previous=json.loads((schema.REPO/'docs/evidence/p5-sdk-owner1/edge-summary.json').read_text())
    if previous['status']!='PASS':raise RuntimeError('PassingSDKRepairRequired')
    data['sdkAnchors']={previous[key]['stage']:previous[key]['manifestSHA256'] for key in ('preparation','activation','containment')}
    script=web_fixture.runtime_bundle()
    for name in ('sdk_gate_observation','sdk_owner1_guest','p5_readonly_guest'):
        code=(schema.REPO/'infra/oracle'/(name+'.py')).read_text()
        script+='module=types.ModuleType('+repr(name)+');sys.modules['+repr(name)+']=module\nexec('+repr(code)+',module.__dict__)\n'
    script+='result=sys.modules["p5_readonly_guest"].audit('+repr(data)+',runtime)\nprint(json.dumps(result))\n'
    result=schema.run_guest(script,timeout=600)
    with path.open('x') as output:json.dump(result,output,indent=2)
    print(json.dumps({'status':result['status'],'cases':len(result['cases']),'failedCases':[row['case'] for row in result['cases'] if not row['passed']],'containment':result.get('containment',{}).get('status'),'manifestSHA256':result['manifestSHA256'],'serviceChanges':0}))
    if result['status']!='PASS':raise SystemExit(1)


if __name__=='__main__':
    try:main()
    except Exception as error:
        print(json.dumps({'status':'STOP','code':str(error) if type(error)is RuntimeError else type(error).__name__}));raise SystemExit(1)
