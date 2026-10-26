"""Owner decoder repair: fresh read-only preflight, no replay of old gates."""
import json
import sys
import cloud_schema as schema
import p6_fixed_ip
from p6_audit_log import Journal


def main():
    if sys.argv[1:]!=['--preflight']:raise RuntimeError('ExplicitDecoderPreflightRequired')
    root=schema.REPO/'docs/evidence/p6/decoder-owner2-preflight'
    if root.exists():raise RuntimeError('DecoderPreflightRecorded_NoReplay')
    data=p6_fixed_ip.context()
    data['owner1Full']=json.loads((schema.REPO/'docs/evidence/p6/fixedip-owner1-full/01-fixedip-full-result.json').read_text())
    journal=Journal(root);result={'status':'FAIL','readOnly':True,'vmWrites':0,'isolatedDispatches':0,'fullP6Runs':0}
    code=p6_fixed_ip.bundle()+'''
from p6_queue_boundary_gate import anchored_result
from p6_fixed_ip_guest import ROLLBACK_NAME,ROLLBACK_ADDRESS
from p6_mock_guest import prepared
from p6_restart_diagnosis_guest import history,external_isolation,private_health
from p4_recovery_guest import Recovery
from immutable_artifacts import digest
data=DATA
store=prepared(data);proof=data['owner1Full'];anchored_result(store,proof)
manifest=store.verify(proof['lifecycle']['stage'],proof['lifecycle']['manifestSHA256'])
_,receipts,_,_=history(data)
for artifact in manifest['artifacts']:
 name=artifact['name']
 if re.fullmatch(r'[0-9]{3}-(?:terminal-(?:success|server_error|timeout|lost_ack|captcha|unknown_answer)|concurrent-terminal|queued-cancel|active-cancel|orphan-watchdog)\\.json',name):
  value=json.loads((store.root/proof['lifecycle']['stage']/name).read_bytes())
  if value['applicationId'] in receipts:raise RuntimeError('DuplicateRetainedReceipt')
  receipts[value['applicationId']]=value
original=Recovery(data['p4'],runtime)
rows=json.loads(original.query("SELECT jsonb_build_object('applications',(SELECT coalesce(jsonb_agg(jsonb_build_object('applicationId',id,'state',state,'errorCode',error_code,'receiptConfirmed',receipt_confirmed,'updatedAt',updated_at,'events',events) ORDER BY id),'[]') FROM pgboss.ir35_mock_application),'jobs',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'state',state,'data',data,'retry_count',retry_count) ORDER BY id),'[]') FROM pgboss.job),'schedules',(SELECT count(*) FROM pgboss.ir35_mock_schedule));",'postgres'))
checks={'all45RetainedReceipts':len(receipts)==45 and len(rows['applications'])==45 and all(receipts.get(row['applicationId'])==row for row in rows['applications']),
 'all49JobsPreserved':len(rows['jobs'])==49,'all7ScheduleReceipts':rows['schedules']==7,
 'noPendingJobs':all(row['state'] in ('completed','failed','cancelled') for row in rows['jobs']),
 'noUnexpectedJobTypes':all(row['name'] in ('ir35-staging-mock-apply','ir35-staging-mock-schedule') and row['data'].get('kind') in ('staging_mock_application','staging_mock_schedule') and 'employerURL' not in row['data'] for row in rows['jobs'])}
worker=json.loads(runtime['run'](['docker','inspect',ROLLBACK_NAME]))[0]
entry=worker['Config'].get('Entrypoint',[])
health=private_health(ROLLBACK_ADDRESS)
checks['samePausedMockRollback']=worker['Image']==data['rollbackBuild']['image'] and worker['State']['Running']is True and health.get('ok')is True and health.get('paused')is True and health.get('realAcceptance')is False and health.get('buildSHA')==data['rollbackBuild']['sourceSHA']
smtp=external_isolation(data,runtime)
result={'status':'PASS' if all(checks.values()) and smtp['status']=='PASS' else 'FAIL','readOnly':True,'vmWrites':0,
 'checks':checks,'applications':len(rows['applications']),'queueJobs':len(rows['jobs']),'schedules':rows['schedules'],
 'ledgerSHA256':digest(json.dumps(rows,sort_keys=True).encode()),'rollbackHealth':health,
 'hardReadOnlyStartupFlag':'IR35_READ_ONLY=true' in entry,'smtp':smtp,'receiptIDs':sorted(receipts)}
print(json.dumps(result))
'''.replace('DATA',repr(data))
    try:
        result['preflight']=journal.step(1,'decoder-prerequisites',lambda:schema.run_guest(code,timeout=180))
        result['status']='PASS'
    finally:result['manifestSHA256']=journal.seal(result)
    print(json.dumps({k:v for k,v in result.items() if k!='preflight'}))


if __name__=='__main__':
    try:main()
    except Exception as error:
        print(json.dumps({'status':'STOP','code':str(error) if type(error)is RuntimeError else type(error).__name__,'rawErrorWithheld':True}));raise SystemExit(1)
