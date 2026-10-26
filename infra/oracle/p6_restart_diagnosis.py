"""Owner-authorised read-only investigation. No lifecycle controller is called."""
import json
import sys

import cloud_schema as schema
import p6_resume
from p6_audit_log import AuditFailure,Journal
from p6_pause_reconcile import verified_manifest

CASES=('sealed-history','worker-state','proxy-routing','queue-ledger','external-isolation','full-containment','ledger-after')
MODULES=('p6_audit_log','p6_pause_reconcile_guest','p6_restart_diagnosis_guest')


def payload():
    data=p6_resume.context()
    for key,name in [('resumeFailure','owner-resume-lifecycle.json'),('scheduleFailure','owner-resume-lifecycle-pause-repair-one.json'),
                     ('finalFailure','owner-resume-lifecycle-schedule-repair-two.json'),('finalHandover','owner-resume-handover-schedule-repair-two.json'),
                     ('finalBuild','worker-resume-build-3.json'),('rollbackBuild','worker-resume-build-2.json')]:
        data[key]=json.loads((p6_resume.DIRECTORY/name).read_text())
    data['sdkEdge']=json.loads((schema.REPO/'docs/evidence/p5-sdk-owner1/edge-summary.json').read_text())
    return data


def remote_case(name,data):
    script=p6_resume.bundle()
    for module in MODULES:
        script+='module=types.ModuleType('+repr(module)+');sys.modules['+repr(module)+']=module\nexec('+repr((schema.REPO/'infra/oracle'/(module+'.py')).read_text())+',module.__dict__)\n'
    script+='observer=sys.modules["p6_restart_diagnosis_guest"]\ntrace=observer.ReadOnlyTrace(subprocess.run,'+repr(data['ownerHBABoundary']['databasesWithConnections'])+')\nsubprocess.run=trace\n'
    script+='try:\n result=observer.run_case('+repr(name)+','+repr(data)+',runtime)\n'
    script+='except Exception as error:\n result={"status":"FAIL","exceptionType":type(error).__name__,"code":str(error) if type(error)is RuntimeError else "ReadOnlyDiagnosisFailed_RawWithheld"}\n'
    script+='result.update(operation='+repr(name)+',commands=trace.observations,vmWrites=0)\nprint(json.dumps(result))\n'
    return schema.run_guest(script,timeout=600 if name=='full-containment' else 180)


def main():
    if sys.argv[1:] not in (['--read-only'],['--read-only-tooling-repair-one']):raise AuditFailure('ExplicitOwnerReadOnlyRestartDiagnosisRequired')
    repair=sys.argv[1:]==['--read-only-tooling-repair-one']
    root=p6_resume.DIRECTORY/('restart-diagnosis-20261026-02' if repair else 'restart-diagnosis-20261026-01')
    if root.exists():raise AuditFailure('RestartDiagnosisRecorded_NoReplay')
    previous=None
    if repair:
        first=root.with_name('restart-diagnosis-20261026-01')
        previous=verified_manifest(first)
        failure=json.loads((first/'01-sealed-history-result.json').read_text())
        if previous!='941cec46766f225482fc126802fb2241c71e14e77ffb7851189b18aa72a0f284' or failure.get('exceptionType')!='KeySafetyError':
            raise AuditFailure('ExactFirstCollectionBootstrapFailureRequired')
    data=payload();journal=Journal(root)
    result={'status':'FAIL','readOnly':True,'vmWrites':0,'newBuilds':0,'restarts':0,'jobPublications':0,'configChanges':0,
            'productionChanges':False,'phaseComplete':False,'lifecycleAttemptBudgetReset':False,'cases':[],
            'collectionAttempt':2 if repair else 1,'toolingRepairAttempt':1 if repair else 0,'previousCollectionManifestSHA256':previous}
    try:
        for index,name in enumerate(CASES,1):
            observed=journal.step(index,name,lambda:remote_case(name,data))
            result['cases'].append({'case':name,'status':observed['status']})
            if name=='queue-ledger':before=observed['stableLedgerSHA256']
            if name=='ledger-after' and observed['stableLedgerSHA256']!=before:
                raise AuditFailure('RetainedQueueChangedDuringReadOnlyDiagnosis_HardStop')
        result['status']='PASS'
    except AuditFailure as error:result['code']=str(error)
    result['manifestSHA256']=journal.seal(result)
    print(json.dumps(result))
    if result['status']!='PASS':raise SystemExit(1)


if __name__=='__main__':
    try:main()
    except Exception as error:
        print(json.dumps({'status':'STOP','exceptionType':type(error).__name__,'rawErrorWithheld':True}))
        raise SystemExit(1)
