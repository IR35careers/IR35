"""Explicit write-once P6 preflight / owner-authorised queue-role addition."""
import json
import sys
import cloud_schema as schema
import p6_context


def main():
    if sys.argv[1:] not in (['--preflight'],['--install']):raise RuntimeError('ExplicitP6RoleOperationRequired')
    operation=sys.argv[1][2:];path=schema.REPO/('docs/evidence/p6-role-'+operation+'.json')
    if path.exists():raise RuntimeError('P6RoleEvidenceRecorded_NoReplay')
    data=p6_context.context();data['p6Inventory']=json.loads((schema.REPO/'docs/evidence/p6-inventory.json').read_text())
    if operation=='install':data['rolePreflight']=json.loads((schema.REPO/'docs/evidence/p6-role-preflight.json').read_text())
    script=p6_context.bundle()
    for name in ('p6_role_policy','p6_containment','p6_roles_guest'):
        code=(schema.REPO/'infra/oracle'/(name+'.py')).read_text()
        script+='module=types.ModuleType('+repr(name)+');sys.modules['+repr(name)+']=module\nexec('+repr(code)+',module.__dict__)\n'
    script+='result=sys.modules["p6_roles_guest"].'+operation+'('+repr(data)+',runtime)\nprint(json.dumps(result))\n'
    result=schema.run_guest(script,timeout=600)
    with path.open('x') as output:json.dump(result,output,indent=2)
    print(json.dumps({'status':result['status'],'code':result.get('code'),'roleWrites':result.get('roleWrites'),
                      'containment':result.get('containment',{}).get('status'),'manifestSHA256':result['manifestSHA256']}))
    if result['status']!='PASS':raise SystemExit(1)


if __name__=='__main__':
    try:main()
    except Exception as error:
        print(json.dumps({'status':'STOP','code':str(error) if type(error)is RuntimeError else type(error).__name__}));raise SystemExit(1)
