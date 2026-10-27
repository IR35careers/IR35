"""Bounded GET-only staging load and backup readiness; no cloud/secret writes."""
import inspect
import json
import subprocess
import sys
from pathlib import Path
import cloud_schema as schema
import p6_capture_repair
import p6_context
import p6_resume
import p6_restart_diagnosis
from p6_audit_log import Journal
from p6_pause_reconcile import verified_manifest
from web_build import git_command


def percentile95(values):
    import math
    if not values or any(type(x) not in (int,float) or x<0 for x in values):
        raise RuntimeError('CompleteNonnegativeLatenciesRequired')
    return sorted(values)[math.ceil(len(values)*0.95)-1]


def memory_checks(samples):
    if not samples or any(row['availableBytes']<2*1024**3 for row in samples):
        raise RuntimeError('OSHeadroomBelowTwoGiB_Abort')
    for row in samples:
        if not row['containers']:raise RuntimeError('CompleteMemorySamplesRequired')
        for container in row['containers']:
            if container['limitBytes']<=0 or container['rssBytes']>container['limitBytes'] or container['oomKilled']:
                raise RuntimeError('ContainerMemoryBudgetExceeded_Abort')
    return True


def kernel_memory_checks(samples):
    """Enforce the kernel's budget metric; still report unmodified process RSS.

    RSS/PSS map resident pages, not which cgroup owns the charge. Keep the old
    raw-RSS guard/tests for historical evidence; never relabel charge as RSS.
    """
    if not samples or any(row['availableBytes']<2*1024**3 for row in samples):raise RuntimeError('OSHeadroomBelowTwoGiB_Abort')
    for row in samples:
        if not row['containers']:raise RuntimeError('CompleteMemorySamplesRequired')
        for container in row['containers']:
            required=('limitBytes','kernelLimitBytes','chargedBytes','kernelPeakBytes','rssBytes','oomEvents','oomKillEvents')
            if any(type(container.get(key))is not int or container[key]<0 for key in required):raise RuntimeError('ExactKernelMemoryCountersRequired')
            if (container['limitBytes']<=0 or container['kernelLimitBytes']!=container['limitBytes']
                or container['chargedBytes']>container['limitBytes'] or container['kernelPeakBytes']>container['limitBytes']
                or container['oomKilled'] or container['oomEvents'] or container['oomKillEvents']):
                raise RuntimeError('ContainerMemoryBudgetExceeded_Abort')
    return True


def context():
    git=git_command(schema.REPO)
    if subprocess.check_output(git+['branch','--show-current'],text=True).strip()!='codex/oracle-migration-p8':raise RuntimeError('P8BranchRequired')
    if subprocess.check_output(git+['status','--porcelain'],text=True).strip():raise RuntimeError('CommittedCleanP8SourceRequired')
    anchors={'auth-rehearsal-03':'67a1051c0930d544a02d86706a0b02fb29bab59de910266a46f0020f5c219595',
             'storage-readonly-01':'f0c38ace30f2dc3dc87e2704567014706afb51ed3be60e37b364e721477c3ffe'}
    for slot,anchor in anchors.items():
        path=schema.REPO/'docs/evidence/p7'/slot
        if verified_manifest(path)!=anchor or json.loads((path/'result.json').read_bytes())['status']!='PASS':raise RuntimeError('ActualScopedP7PassRequired')
    return p6_restart_diagnosis.evidence_context(p6_resume.evidence_context(p6_context.read_evidence()))


def program(data):
    code=p6_capture_repair.bundle()+'\n'+inspect.getsource(percentile95)+'\n'+inspect.getsource(memory_checks)+'\n'+inspect.getsource(kernel_memory_checks)
    code+='\ndata='+repr(data)+'\n'
    code+='''
import base64,concurrent.futures,threading,time,os,shutil
from pathlib import Path
from p6_mock_guest import prepared,ROOT
from web_services_guest import require_prepared
from web_edge_guest import private_env
from sdk_owner1_guest import tls_request
from p6_restart_diagnosis_guest import containment
prepared(data);require_prepared(data)
values=runtime['read_env']();web=private_env(ROOT/'.env.p5-web')
if web.get('IR35_READ_ONLY')!='true' or web.get('APPLY_RUNNER')!='mock' or web.get('APPLICATION_WORKER_ACCEPT_JOBS')!='false':raise RuntimeError('ProtectedReadonlyMockFixtureRequired')
basic='Basic '+base64.b64encode(('ir35:'+values['STAGING_BASIC_PASSWORD']).encode()).decode()
gate=private_env(ROOT/'.env.p5-caddy')['STAGING_GATE_TOKEN']
headers={'Authorization':basic};host='staging.ir35careers.com'

def sample():
 names=runtime['run'](['docker','ps','--format','{{.Names}}']).splitlines()
 if not names or any(not re.fullmatch('[a-zA-Z0-9_.-]+',n) for n in names):raise RuntimeError('FixedContainerNamesRequired')
 rows=json.loads(runtime['run'](['docker','inspect',*names]));containers=[]
 for row in rows:
  pid=row['State']['Pid'];identity=row['Id']
  if not re.fullmatch('[a-f0-9]{64}',identity) or not row['State']['Running'] or pid<=0:raise RuntimeError('RunningContainerIdentityRequired')
  memberships=Path('/proc/'+str(pid)+'/cgroup').read_text().splitlines()
  entries=[line[3:] for line in memberships if line.startswith('0::/')]
  if len(entries)!=1 or identity not in entries[0] or '..' in entries[0].split('/'):raise RuntimeError('CgroupV2ContainerIdentityRequired')
  group=Path('/sys/fs/cgroup')/entries[0].lstrip('/')
  groups=[group,*group.rglob('*')];pids=set()
  for current in groups:
   if current.is_dir() and (current/'cgroup.procs').is_file():pids.update((current/'cgroup.procs').read_text().split())
  rss=0
  for process in pids:
   try:
    lines=Path('/proc/'+process+'/status').read_text().splitlines()
    rss+=sum(int(line.split()[1])*1024 for line in lines if line.startswith('VmRSS:'))
   except FileNotFoundError:pass # A completed process no longer has resident pages.
  events=dict(line.split() for line in (group/'memory.events').read_text().splitlines())
  containers.append({'name':row['Name'].lstrip('/'),'rssBytes':rss,'limitBytes':row['HostConfig']['Memory'],
    'kernelLimitBytes':int((group/'memory.max').read_text()),'chargedBytes':int((group/'memory.current').read_text()),
    'kernelPeakBytes':int((group/'memory.peak').read_text()),'oomEvents':int(events['oom']),'oomKillEvents':int(events['oom_kill']),
    'maxEvents':int(events['max']),'oomKilled':row['State']['OOMKilled'],'restartCount':row['RestartCount']})
 available=int(next(line.split()[1] for line in Path('/proc/meminfo').read_text().splitlines() if line.startswith('MemAvailable:')))*1024
 return {'availableBytes':available,'containers':containers}

result={'status':'FAIL','readOnly':True,'users':50,'requestsPerUser':4,'phaseComplete':False,
 'scope':'50 concurrent anonymous read-only sessions, co-located generator; not authenticated-write or remote-network load',
 'productionRequests':0,'authMutations':0,'newServices':0,'cloudRequests':0,'samplingIntervalSeconds':0.25}
samples=[];stop=threading.Event();sampling_errors=[]
def monitor():
 while not stop.is_set():
  try:samples.append(sample());kernel_memory_checks([samples[-1]])
  except Exception as error:sampling_errors.append(type(error).__name__);return
  stop.wait(0.25)
try:
 samples.append(sample());kernel_memory_checks(samples)
 paths=('/jobs','/tools/ir35-status','/tools/take-home','/api/health')
 barrier=threading.Barrier(50,timeout=30)
 def visitor(number):
  barrier.wait();observations=[]
  for path in paths:
   started=time.monotonic();status,response,body=tls_request(host,'GET',path,headers)
   observations.append({'path':path,'status':status,'milliseconds':round((time.monotonic()-started)*1000,3),
    'noindex':'noindex' in response.get('x-robots-tag',''),'noStore':'no-store' in response.get('cache-control',''),
    'h1':bool(re.search(br'<h1(?: |>)',body)) if path!='/api/health' else True})
  return observations
 thread=threading.Thread(target=monitor,daemon=True);thread.start();started=time.monotonic()
 try:
  with concurrent.futures.ThreadPoolExecutor(max_workers=50) as pool:
   observations=[case for group in pool.map(visitor,range(50)) for case in group]
 finally:stop.set();thread.join(timeout=15)
 samples.append(sample());kernel_memory_checks(samples)
 if sampling_errors or thread.is_alive():raise RuntimeError('MemorySamplingIncomplete_Abort')
 if len(observations)!=200 or any(row['status']!=200 or not row['noindex'] or not row['noStore'] or not row['h1'] for row in observations):raise RuntimeError('ReadonlyLoadResponseGateFailed')
 result['load']={'requests':len(observations),'seconds':round(time.monotonic()-started,3),
  'p95Milliseconds':percentile95([r['milliseconds'] for r in observations]),'errors':0,
  'perRoute':[{'path':path,'requests':50,'p95Milliseconds':percentile95([r['milliseconds'] for r in observations if r['path']==path])} for path in paths]}
 edge=[]
 for path in ('/robots.txt','/sitemap.xml','/llms.txt','/account','/dashboard'):
  status,response,body=tls_request(host,'GET',path,headers)
  edge.append({'path':path,'status':status,'noindex':'noindex' in response.get('x-robots-tag',''),
   'noStore':'no-store' in response.get('cache-control',''),'bytes':len(body)})
 # Authenticated pages may redirect the anonymous visitor, but must not leak data.
 if any(r['status'] not in ((200,302,303,307) if r['path'] in ('/account','/dashboard') else (200,)) or not r['noindex'] or not r['noStore'] for r in edge):raise RuntimeError('ProtectedEdgeReadGateFailed')
 result['edgeReads']=edge
 result['status']='PASS'
except Exception as error:
 result['code']=str(error) if type(error)is RuntimeError else type(error).__name__
finally:
 stop.set()
 names=sorted({c['name'] for row in samples for c in row['containers']})
 result['memory']={'samples':len(samples),'minimumOSAvailableBytes':min((r['availableBytes'] for r in samples),default=0),
  'metric':'process VmRSS sum reported separately; enforce exact kernel memory.current/peak/max plus OOM events and OS headroom; no counter reset',
  'containers':[{'name':name,'sampledPeakRSSBytes':max(c['rssBytes'] for r in samples for c in r['containers'] if c['name']==name),
   'sampledPeakChargedBytes':max(c['chargedBytes'] for r in samples for c in r['containers'] if c['name']==name),
   'allTimeKernelPeakBytes':max(c['kernelPeakBytes'] for r in samples for c in r['containers'] if c['name']==name),
   'maxEventsBefore':next(c['maxEvents'] for r in samples for c in r['containers'] if c['name']==name),
   'maxEventsAfter':next(c['maxEvents'] for r in reversed(samples) for c in r['containers'] if c['name']==name),
   'limitBytes':next(c['limitBytes'] for r in samples for c in r['containers'] if c['name']==name)} for name in names]}
 # Known PUBLIC backup-recipient location only; no key search/read or secret generation.
 public=ROOT/'config/backup-age-recipient.txt'
 result['backupReadiness']={'ageInstalled':shutil.which('age')is not None,'publicRecipientFilePresent':public.is_file() and not public.is_symlink(),
  'nightlyTimerPresent':Path('/etc/systemd/system/ir35-backup.timer').is_file(),
  'diskAlertTimerPresent':Path('/etc/systemd/system/ir35-disk-alert.timer').is_file(),
  'freeDataVolumeBytes':shutil.disk_usage(ROOT/'data').free,'cloudEligibility':'WAIT_G2_REFRESH_ALREADY_FAILED',
  'encryptedBackupRestoreProven':False,'reverseSyncProven':False,'keysRead':0,'objectsUploaded':0}
 result['fullContainment']=containment(data,runtime,probe_container='ir35-p6-mock-worker-v7-fixedip')
 if result['fullContainment']['status']!='PASS':result.update(status='FAIL',code='P8ContainmentMismatch_Abort')
 print(json.dumps(result))
'''
    compile(code,'<p8-readonly-load>','exec')
    return code


def main():
    if sys.argv[1:]!=['--read-only-load','--repair-one']:raise RuntimeError('ExplicitBoundedReadonlyLoadRepairRequired')
    original=schema.REPO/'docs/evidence/p8/readonly-load-01'
    diagnosis=schema.REPO/'docs/evidence/p8/memory-diagnosis-01'
    if verified_manifest(original)!='8c89ba466ce78bac5cc22c1755bf169878b73b25bc8a608914f5da15cc885da2':raise RuntimeError('OriginalFailureRequired_NoReset')
    if verified_manifest(diagnosis)!='d44312fed7e73cc9d67b3cb974473a98e405685dcc910ef6d3c03cbfc081d675':raise RuntimeError('ExactReadonlyMemoryDiagnosisRequired')
    report=json.loads((diagnosis/'01-cgroup-rss-pss-containment-result.json').read_bytes())
    if report['status']!='PASS' or not report['noOOMObserved'] or not report['cgroupCurrentWithinConfiguredLimit']:raise RuntimeError('NoBudgetOrOOMWaiverAllowed')
    data=context();code=program(data);parent=schema.REPO/'docs/evidence/p8'
    if not parent.exists():parent.mkdir(mode=0o700)
    if parent.is_symlink() or parent.resolve()!=schema.REPO/'docs/evidence/p8':raise RuntimeError('ControlledP8ParentRequired')
    journal=Journal(parent/'readonly-load-02');result={'status':'FAIL','phaseComplete':False,'attempt':2,'originalFailureRetained':True}
    try:
        result['audit']=journal.step(1,'load-memory-edge-containment',lambda:schema.run_guest(code,timeout=900))
        result['status']=result['audit']['status']
    except Exception as error:result['code']=str(error) if type(error)is RuntimeError else type(error).__name__
    finally:result['manifestSHA256']=journal.seal(result)
    print(json.dumps({key:value for key,value in result.items() if key!='audit'}))
    if result['status']!='PASS':raise SystemExit(1)


if __name__=='__main__':main()
