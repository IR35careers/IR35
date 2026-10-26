"""Retained schedule diagnosis; no fixture reset, policy change or source write."""
import json
import re

from immutable_artifacts import digest
from p4_recovery_guest import Recovery,RecoveryError
from p6_status_audit_guest import history as original_history,run_case
from p6_queue_boundary_gate import anchored_result,verify_live
from p6_queue_function_scope import audit as function_scope
from p6_containment import fidelity


def retained(data):
    store,expected=original_history(data)
    failure=data['scheduleFailure']
    anchored_result(store,{k:v for k,v in failure.items() if k!='imageRollback'})
    anchored_result(store,failure['imageRollback'])
    if (failure.get('code')!='NativeMockCaseFailed_schedule-mock_automation'
            or failure.get('failureContainment',{}).get('status')!='PASS' or failure['imageRollback'].get('status')!='PASS'
            or not failure.get('cases') or not all(row.get('passed') is True for row in failure['cases'][:-1])
            or failure['cases'][-1]!={'case':'schedule-mock_automation','passed':False}):
        raise RecoveryError('ExactScheduleFailureAndRollbackRequired')
    manifest=store.verify(failure['stage'],failure['manifestSHA256'])
    new={};intents=[];outcome=None
    for artifact in manifest['artifacts']:
        name=artifact['name']
        row=json.loads((store.root/failure['stage']/name).read_bytes()) if name.endswith('.json') else None
        if re.fullmatch(r'[0-9]{3}-(?:terminal-(?:success|server_error|timeout|lost_ack|captcha|unknown_answer)|concurrent-terminal|queued-cancel|active-cancel|orphan-watchdog)\.json',name):
            if not isinstance(row,dict) or row.get('state') not in ('submitted','failed') or row['applicationId'] in new or row['applicationId'] in expected:
                raise RecoveryError('ExactRetainedTerminalReceiptsRequired')
            new[row['applicationId']]=row
        if re.fullmatch(r'[0-9]{3}-schedule-intent\.json',name):intents.append(row)
        if name.endswith('-schedule-mock_automation.json'):outcome=row
    if len(new)!=11 or [r.get('operation') for r in intents]!=['mock_ingest','mock_automation'] or outcome!={'status':202,'value':{'mock':True,'queued':False}}:
        raise RecoveryError('ExactElevenNewReceiptsAndTwoScheduleIntentsRequired')
    return store,expected|new,intents


SQL="""SELECT jsonb_build_object(
 'applications',(SELECT coalesce(jsonb_agg(jsonb_build_object('applicationId',id,'state',state,'errorCode',error_code,
 'receiptConfirmed',receipt_confirmed,'updatedAt',updated_at,'events',events) ORDER BY id),'[]') FROM pgboss.ir35_mock_application),
 'jobs',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'state',state,'data',data,'singletonKey',singleton_key) ORDER BY id),'[]') FROM pgboss.job),
 'schedules',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'operation',operation) ORDER BY id),'[]') FROM pgboss.ir35_mock_schedule));"""


def observe(data,runtime):
    store,expected,intents=retained(data)
    recovery=Recovery(data['p4'],runtime)
    rows=json.loads(recovery.query(SQL,'postgres'))
    applications=rows['applications'];jobs=rows['jobs'];schedules=rows['schedules']
    matches=len(applications)==23 and {r['applicationId'] for r in applications}==set(expected)
    matches=matches and all(row==expected[row['applicationId']] for row in applications)
    # The synthetic watchdog orphan intentionally has no pg-boss job.
    orphan={identifier for identifier,row in expected.items() if row.get('errorCode')=='runner_timeout'}
    apply=[row for row in jobs if row['name']=='ir35-staging-mock-apply']
    commands=[row for row in jobs if row['name']=='ir35-staging-mock-schedule']
    queue_ok=(len(orphan)==1 and len(apply)==22 and {r['id'] for r in apply}==set(expected)-orphan
        and all(row['state'] in ('completed','failed','cancelled') for row in apply)
        and len(commands)==1 and commands[0]['data']==intents[0] and commands[0]['singletonKey'] is None
        and commands[0]['state'] in ('created','completed') and len(jobs)==23
        and all(row['operation']=='mock_ingest' and row['id']==commands[0]['id'] for row in schedules)
        and len(schedules)==(1 if commands[0]['state']=='completed' else 0))
    if not matches or not queue_ok:raise RecoveryError('RetainedScheduleDataOrSecurityMismatch_Abort')
    return {'status':'PASS','applications':23,'applyJobs':22,'scheduleJobs':1,'scheduleRows':len(schedules),
        'pendingScheduleJobs':int(commands[0]['state']=='created'),'pendingApplicationJobs':0,
        'allRetainedReceiptsMatch':True,'ledgerSHA256':digest(json.dumps(rows,sort_keys=True).encode()),
        'scheduleJobIDSHA256':digest(commands[0]['id'].encode()),'scheduleOperation':'mock_ingest','vmWrites':0},rows


def diagnose(data,runtime):
    observation,_=observe(data,runtime)
    store,_,_=retained(data)
    recovery=Recovery(data['p4'],runtime)
    boundary=verify_live(data,recovery,store,function_scope(recovery))
    containment,_,_=fidelity(data,runtime)
    smtp=run_case('smtp-empty',data,runtime)
    if containment['status']!='PASS' or smtp['status']!='PASS':raise RecoveryError('ScheduleDiagnosisContainmentMismatch_Abort')
    return {'status':'PASS','observation':observation,'queueBoundary':boundary,'containment':containment,'smtp':smtp,
        'rootCause':'The short-policy queue indexes (name, COALESCE(singleton_key, empty)). Distinct schedule operations were published without a singleton key, so the second pending command was not queued.',
        'repair':'Set the validated mock schedule operation as singletonKey; preserve the queue policy and queued=false negative acknowledgement.',
        'queuePolicyChanges':0,'vmWrites':0,'productionChanges':False}
