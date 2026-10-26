"""One owner fixed-IP repair, separate journals, never replays old attempts."""
import json
import sys
import cloud_schema as schema
import p6_restart_diagnosis as diagnosis
from p6_audit_log import Journal,AuditFailure
from p6_pause_reconcile import verified_manifest


def context():
    root=schema.REPO/'docs/evidence/p6/restart-diagnosis-20261026-03'
    if verified_manifest(root)!='9641f3cb64dc1146b66b050f7c4e108e081f9cb2a7c3cd92f8d4004c0ef8f42e':
        raise AuditFailure('ExactOwnerReviewedReadOnlyDiagnosisRequired')
    return diagnosis.payload()


def bundle():
    code=diagnosis.p6_resume.bundle()
    for name in (*diagnosis.MODULES,'p6_fixed_ip_guest'):
        code+='module=types.ModuleType('+repr(name)+');sys.modules['+repr(name)+']=module\nexec('+repr((schema.REPO/'infra/oracle'/(name+'.py')).read_text())+',module.__dict__)\n'
    return code


def main():
    if sys.argv[1:]!=['--preflight']:raise AuditFailure('ExplicitFixedIPPreflightRequired')
    root=schema.REPO/'docs/evidence/p6/fixedip-owner1-preflight'
    if root.exists():raise AuditFailure('FixedIPPreflightRecorded_NoReplay')
    data=context();journal=Journal(root);result={'status':'FAIL','readOnly':True,'vmWrites':0,'newBuilds':0,'restarts':0}
    def observe():
        code=bundle()+'''observer=sys.modules['p6_restart_diagnosis_guest']
trace=observer.ReadOnlyTrace(subprocess.run,DATA['ownerHBABoundary']['databasesWithConnections'])
subprocess.run=trace
try: result=sys.modules['p6_fixed_ip_guest'].preflight(DATA,runtime)
except Exception as error: result={'status':'FAIL','code':str(error) if type(error)is RuntimeError else type(error).__name__,'rawErrorWithheld':True}
result['commands']=trace.observations
print(json.dumps(result))
'''.replace('DATA',repr(data))
        return schema.run_guest(code,timeout=240)
    try:result['preflight']=journal.step(1,'fixedip-readonly',observe);result['status']='PASS'
    except AuditFailure as error:result['code']=str(error)
    result['manifestSHA256']=journal.seal(result)
    print(json.dumps({key:value for key,value in result.items() if key!='preflight'}))
    if result['status']!='PASS':raise SystemExit(1)


if __name__=='__main__':
    try:main()
    except Exception as error:
        print(json.dumps({'status':'STOP','code':str(error) if type(error)is RuntimeError else type(error).__name__,'rawErrorWithheld':True}))
        raise SystemExit(1)
