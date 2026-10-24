"""One read-only P6 inventory, write-once evidence; never starts the worker."""
import json
import sys
import cloud_schema as schema
import p6_context


def main():
    if sys.argv[1:]!=['--audit']:raise RuntimeError('ExplicitReadOnlyInventoryRequired')
    path=schema.REPO/'docs/evidence/p6-inventory.json'
    if path.exists():raise RuntimeError('P6InventoryRecorded_NoReplay')
    data=p6_context.context()
    script=p6_context.bundle()+'result=sys.modules["p6_inventory_guest"].run('+repr(data)+',runtime)\nprint(json.dumps(result))\n'
    result=schema.run_guest(script,timeout=600)
    with path.open('x') as output:json.dump(result,output,indent=2)
    print(json.dumps({'status':result['status'],'queueRolesAvailable':result.get('queueRolesAvailable'),'containment':result.get('containment',{}).get('status'),'manifestSHA256':result['manifestSHA256'],'infraCreates':0}))
    if result['status']!='PASS':raise SystemExit(1)


if __name__=='__main__':
    try:main()
    except Exception as error:
        print(json.dumps({'status':'STOP','code':str(error) if type(error)is RuntimeError else type(error).__name__}));raise SystemExit(1)
