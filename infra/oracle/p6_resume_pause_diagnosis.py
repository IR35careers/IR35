"""Read-only reconciliation of the first resumed lifecycle's startup flag."""
import json
import sys
import cloud_schema as schema
import p6_resume


def main():
    destination = p6_resume.DIRECTORY/'owner-resume-pause-diagnosis.json'
    if destination.exists():raise RuntimeError('ResumePauseDiagnosisRecorded_NoReplay')
    data = p6_resume.context()
    failure = json.loads((p6_resume.DIRECTORY/'owner-resume-lifecycle.json').read_text())
    data['resumeFailure'] = failure
    source = '''
from p6_queue_boundary_gate import anchored_result,verify_live
from p6_queue_function_scope import audit as function_scope
from p6_status_audit_guest import history,queue,run_case
from p6_mock_guest import ROOT,check_containment
from web_edge_guest import private_env
from p6_mock_control import Control
from p4_recovery_guest import Recovery
from immutable_artifacts import Store,digest
import json
data=DATA
store,receipts=history(data)
failure=data['resumeFailure']
rollback=failure['imageRollback']
anchored_result(store,{k:v for k,v in failure.items() if k != 'imageRollback'})
anchored_result(store,rollback)
manifest=store.verify(failure['stage'],failure['manifestSHA256'])
health_rows=[row for row in manifest['artifacts'] if row['name'].endswith('-mock-health.json')]
publication=[row for row in manifest['artifacts'] if 'publication-intent' in row['name'] or 'schedule-intent' in row['name']]
if len(health_rows)!=1 or publication:raise RuntimeError('ExactPrePublicationPauseFailureRequired')
health=json.loads((store.root/failure['stage']/health_rows[0]['name']).read_bytes())
worker=json.loads(runtime['run'](['docker','inspect','ir35-p6-mock-worker-v4-rollback']))[0]
control=Control(private_env(ROOT/'.env.p6-mock-control')['APPLICATION_WORKER_SECRET'])
current=control.request('GET','/health')[1]
ledger=queue(data,runtime)
smtp=run_case('smtp-empty',data,runtime)
boundary=verify_live(data,Recovery(data['p4'],runtime),store,function_scope(Recovery(data['p4'],runtime)))
containment,_,_=sys.modules['p6_containment'].fidelity(data,runtime)
checks={'allHealthFieldsPassedExceptProcessingPause':health.get('ok') is True and health.get('paused') is True and health.get('active')==0 and health.get('realAcceptance') is False,
 'readonlyOverridePresent': 'IR35_READ_ONLY=true' in worker['Config']['Entrypoint'],
 'rollbackRunningPaused':worker['State']['Running'] is True and current.get('ok') is True and current.get('paused') is True and current.get('active')==0,
 'allTwelveUnchanged':ledger['status']=='PASS','smtpEmpty':smtp['status']=='PASS','containmentPASS':containment['status']=='PASS','queueBoundaryPASS':boundary['status']=='PASS'}
print(json.dumps({'status':'PASS' if all(checks.values()) else 'FAIL','checks':checks,'failureHealth':health,'publicationIntents':len(publication),
 'ledger':ledger,'smtp':smtp,'containment':containment,'queueBoundary':boundary,'vmWrites':0,
 'rootCause':'The public startup override IR35_READ_ONLY=true correctly makes mockConsumerEnabled=false; maintenance resume cannot override a read-only runtime.'}))
'''.replace('DATA',repr(data))
    observed = schema.run_guest(p6_resume.bundle()+source,timeout=400)
    with destination.open('x',encoding='utf-8') as output:json.dump(observed,output,indent=2)
    print(json.dumps(observed))
    if observed['status'] != 'PASS':raise SystemExit(1)


if __name__=='__main__':
    try:main()
    except Exception as error:
        print(json.dumps({'status':'STOP','code':str(error) if type(error)is RuntimeError else type(error).__name__,'rawErrorWithheld':True}))
        raise SystemExit(1)
