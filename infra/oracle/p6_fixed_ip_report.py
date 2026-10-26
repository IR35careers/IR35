"""Read sealed failure/rollback evidence only. Never retries a native operation."""
import hashlib
import json
import re
import sys
import cloud_schema as schema
import p6_fixed_ip
from p6_audit_log import Journal


def main():
    if sys.argv[1:]!=['--read-sealed-stop']:raise RuntimeError('ExplicitSealedStopReadRequired')
    root=schema.REPO/'docs/evidence/p6/fixedip-owner1-stop-readback'
    if root.exists():raise RuntimeError('StopReadbackAlreadyRecorded_NoReplay')
    data=p6_fixed_ip.context()
    data['fixedFull']=json.loads((schema.REPO/'docs/evidence/p6/fixedip-owner1-full/01-fixedip-full-result.json').read_text())
    data['dispatcherSHA256']=hashlib.sha256((schema.REPO/'infra/oracle/p6_schedule_dispatch.py').read_text().replace('\r\n','\n').encode()).hexdigest()
    journal=Journal(root)
    code=p6_fixed_ip.bundle()+'''
from p6_queue_boundary_gate import anchored_result
from p6_mock_guest import prepared
from p6_restart_diagnosis_guest import external_isolation
from p4_recovery_guest import Recovery
from p6_integration_guest import DISPATCHER,timer_units
data=DATA
store=prepared(data);proof=data['fixedFull'];anchored_result(store,proof)
manifest=store.verify('30-owner-fixedip-app-realtime-schedules',proof['integrationFailureManifestSHA256'])
store.verify('32-owner-fixedip-failure-rollback',proof['rollbackManifestSHA256'])
result={'status':'PASS','readOnly':True,'vmWrites':0,'sealedFullManifestSHA256':proof['manifestSHA256'],'integration':{},'scheduleServiceStates':[]}
for artifact in manifest['artifacts']:
 name=artifact['name']
 if name in ('app-health.json','realtime-websocket.json','failure.json'):
  result['integration'][name]=json.loads((store.root/'30-owner-fixedip-app-realtime-schedules'/name).read_bytes())
 if name.startswith('case-') and name.endswith('.json'):
  row=json.loads((store.root/'30-owner-fixedip-app-realtime-schedules'/name).read_bytes())
  result['integration'].setdefault('sdkCases',[]).append({k:row.get(k) for k in ('case','expectedStatus','actualStatus','passed','matchedRoute')})
for operation,hour in (('mock_ingest','03'),('mock_automation','04'),('watchdog','05')):
 name,_=timer_units(operation,hour)
 values={}
 for suffix in ('.service','.timer'):
  body=runtime['run'](['systemctl','show',name+suffix,'--property=ActiveState','--property=Result','--property=ExecMainCode','--property=ExecMainStatus'])
  values[suffix]={line.split('=',1)[0]:line.split('=',1)[1] for line in body.splitlines() if '=' in line}
 result['scheduleServiceStates'].append({'unit':name,'state':values})
result['smtp']=external_isolation(data,runtime)
result['dispatcherPublicSourceSHA256']=digest(DISPATCHER.read_bytes())
result['dispatcherSourceMatchesReviewedSource']=result['dispatcherPublicSourceSHA256']==data['dispatcherSHA256']
original=Recovery(data['p4'],runtime)
result['queue']=json.loads(original.query("SELECT jsonb_build_object('applications',(SELECT count(*) FROM pgboss.ir35_mock_application),'terminalApplications',(SELECT count(*) FROM pgboss.ir35_mock_application WHERE state IN ('submitted','failed')),'queueJobs',(SELECT count(*) FROM pgboss.job),'pendingJobs',(SELECT count(*) FROM pgboss.job WHERE state IN ('created','retry','active')),'schedules',(SELECT count(*) FROM pgboss.ir35_mock_schedule),'unexpectedJobKinds',(SELECT count(*) FROM pgboss.job WHERE name NOT IN ('ir35-staging-mock-apply','ir35-staging-mock-schedule')),'employerURLPayloads',(SELECT count(*) FROM pgboss.job WHERE data ? 'employerURL'));",'postgres'))
if result['smtp']['status']!='PASS' or not result['dispatcherSourceMatchesReviewedSource'] or result['queue']!={'applications':45,'terminalApplications':45,'queueJobs':49,'pendingJobs':0,'schedules':7,'unexpectedJobKinds':0,'employerURLPayloads':0}:
 result['status']='FAIL'
print(json.dumps(result))
'''.replace('DATA',repr(data))
    result={'status':'FAIL','readOnly':True,'vmWrites':0,'noRepairOrRetry':True}
    try:
        result['readback']=journal.step(1,'sealed-failure-rollback',lambda:schema.run_guest(code,timeout=180))
        result['status']='PASS'
    finally:
        encoded="APPLICATION_WORKER_SECRET='"+'a'*64+"'\n"
        raw=dict(line.split('=',1) for line in encoded.splitlines())['APPLICATION_WORKER_SECRET']
        result['offlineDummyReproduction']={'existingFormat':'KEY=single-quoted-value','rawParsedLength':len(raw),
            'rawValuePassesDispatcherRegex':re.fullmatch(r'[a-f0-9]{64}',raw)is not None,
            'decodedDummyLength':64,'actualSecretReadOrLogged':False,'HTTPReachedByFailingCodePath':False,'repairApplied':False}
        result['manifestSHA256']=journal.seal(result)
    print(json.dumps({k:v for k,v in result.items() if k!='readback'}))


if __name__=='__main__':
    try:main()
    except Exception as error:
        print(json.dumps({'status':'STOP','code':str(error) if type(error)is RuntimeError else type(error).__name__,'rawErrorWithheld':True}));raise SystemExit(1)
