"""One read-only report after the decoder gate stops; never dispatches/retries."""
import json
import sys
import cloud_schema as schema
from p6_audit_log import Journal

SOURCE=r'''
import hashlib,json,subprocess,ipaddress,urllib.request
from pathlib import Path
def fp(value):
 value=value.encode() if isinstance(value,str) else value
 return {'redacted':True,'length':len(value),'sha256Prefix':hashlib.sha256(value).hexdigest()[:12]}
root=Path('/opt/ir35/.env.p6/33-owner-decoder-isolated-dispatch')
manifest=(root/'manifest.json').read_bytes()
if hashlib.sha256(manifest).hexdigest()!='028b5e3ac651d22a015e50e6ef53a25172fec367d23ece3f0fbbc59a39c1c76b':raise RuntimeError('SealedProbeManifestMismatch')
entries={row['name']:row['sha256'] for row in json.loads(manifest)['artifacts']}
artifact=(root/'one-watchdog-result.json').read_bytes()
if hashlib.sha256(artifact).hexdigest()!=entries['one-watchdog-result.json']:raise RuntimeError('SealedDispatchResultMismatch')
result={'status':'PASS','readOnly':True,'vmWrites':0,'phaseComplete':False,'dispatchGateStatus':'FAIL',
 'sealedNativeManifestSHA256':hashlib.sha256(manifest).hexdigest(),'dispatch':json.loads(artifact)}
unit='ir35-p6-mock-watchdog-decoder2.service'
reply=subprocess.run(['systemctl','show',unit,'--property=ActiveState','--property=SubState','--property=Result','--property=ExecMainCode',
 '--property=ExecMainStatus','--property=InvocationID','--property=ExecMainStartTimestamp','--property=ExecMainExitTimestamp'],capture_output=True,timeout=15)
result['systemdReadExitCode']=reply.returncode
if reply.returncode==0:
 fields=dict(line.split('=',1) for line in reply.stdout.decode().splitlines() if '=' in line)
 allowed=('ActiveState','SubState','Result','ExecMainCode','ExecMainStatus','InvocationID','ExecMainStartTimestamp','ExecMainExitTimestamp')
 result['systemdNow']={key:fields.get(key) for key in allowed}
else:result.update(status='FAIL',systemdError=fp(reply.stderr))
reply=subprocess.run(['docker','inspect','ir35-staging-smtp-1'],capture_output=True,timeout=15)
if reply.returncode:result.update(status='FAIL',smtpReadError=fp(reply.stderr))
else:
 item=json.loads(reply.stdout)[0];address=item['NetworkSettings']['Networks']['ir35-staging_backend']['IPAddress']
 if not ipaddress.ip_address(address) in ipaddress.ip_network('172.16.0.0/12'):raise RuntimeError('PrivateSinkAddressRequired')
 class NoRedirect(urllib.request.HTTPRedirectHandler):
  def redirect_request(self,*args,**kwargs):return None
 opener=urllib.request.build_opener(urllib.request.ProxyHandler({}),NoRedirect())
 with opener.open('http://'+address+':8025/api/v1/messages',timeout=10) as response:
  body=response.read(262145)
 if len(body)>262144:raise RuntimeError('BoundedSinkReadRequired')
 mail=json.loads(body)
 result['smtp']={'messages':mail['total'],'returnedMessages':len(mail['messages']),'RestartCount':item['RestartCount'],
  'StartedAt':item['State']['StartedAt'],'privateUnpublished':not bool(item['HostConfig'].get('PortBindings')),'contentLogged':False}
base=['docker','compose','--env-file','/opt/ir35/.env','-f','/opt/ir35/compose.yml','exec','-T','db','/run/ir35/env-exec','/opt/ir35/.env.db',
 'psql','-XqAt','-v','ON_ERROR_STOP=1','-v','VERBOSITY=sqlstate','-U','supabase_admin','-d','postgres','-f','-']
sql="""BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL TIME ZONE 'UTC';
SELECT jsonb_build_object('applications',(SELECT count(*) FROM pgboss.ir35_mock_application),'terminalApplications',(SELECT count(*) FROM pgboss.ir35_mock_application WHERE state IN ('submitted','failed')),
'jobs',(SELECT count(*) FROM pgboss.job),'scheduleReceipts',(SELECT count(*) FROM pgboss.ir35_mock_schedule),'pendingJobs',(SELECT count(*) FROM pgboss.job WHERE state IN ('created','retry','active')),
'employerURLPayloads',(SELECT count(*) FROM pgboss.job WHERE data ? 'employerURL'),
'newJobs',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'state',state,'kind',data->>'kind','operation',data->>'operation','created_at',created_on,'retry_count',retry_count) ORDER BY id),'[]') FROM pgboss.job WHERE created_on>='2026-10-26T14:11:38Z'));
ROLLBACK;"""
reply=subprocess.run(base,input=sql.encode(),capture_output=True,timeout=30)
result['queueReadExitCode']=reply.returncode
if reply.returncode==0 and len(reply.stdout)<32768:result['queue']=json.loads(reply.stdout)
else:result.update(status='FAIL',queueError=fp(reply.stderr))
print(json.dumps(result))
'''


def main():
    if sys.argv[1:]!=['--read-only']:raise RuntimeError('ExplicitStopReportReadOnlyRequired')
    root=schema.REPO/'docs/evidence/p6/decoder-owner2-stop-report'
    if root.exists():raise RuntimeError('DecoderStopReportRecorded_NoReplay')
    journal=Journal(root);result={'status':'FAIL','readOnly':True,'vmWrites':0,'phaseComplete':False,'noRetry':True}
    try:
        result['observation']=journal.step(1,'sealed-dispatch-and-current-safety',lambda:schema.run_guest(SOURCE,timeout=120))
        result['status']='PASS'
    finally:result['manifestSHA256']=journal.seal(result)
    print(json.dumps({k:v for k,v in result.items() if k!='observation'}))


if __name__=='__main__':
    try:main()
    except Exception as error:
        print(json.dumps({'status':'STOP','code':str(error) if type(error)is RuntimeError else type(error).__name__,'rawErrorWithheld':True}));raise SystemExit(1)
