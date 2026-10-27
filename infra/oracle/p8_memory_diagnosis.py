"""Read-only cgroup/process accounting diagnosis for the preserved P8 failure."""
import inspect
import json
import re
import sys
import cloud_schema as schema
import p6_capture_repair
import p8_staging_readonly as load
from p6_audit_log import Journal
from p6_pause_reconcile import verified_manifest


def counters(text,allowed):
    result={}
    for line in text.splitlines():
        parts=line.split()
        if not parts or parts[0] not in allowed:continue
        if len(parts)!=2 or not re.fullmatch(r'[0-9]+',parts[1]) or parts[0] in result:raise RuntimeError('ExactMemoryCountersRequired')
        result[parts[0]]=int(parts[1])
    if set(result)!=set(allowed):raise RuntimeError('CompleteMemoryCountersRequired')
    return result


def program(data):
    code=p6_capture_repair.bundle()+'\n'+inspect.getsource(counters)+'\ndata='+repr(data)+'\n'
    code+='''
from pathlib import Path
from p6_mock_guest import prepared
from web_services_guest import require_prepared
from p6_restart_diagnosis_guest import containment
prepared(data);require_prepared(data)
row=json.loads(runtime['run'](['docker','inspect','ir35-staging-meta-1']))[0]
pid=row['State']['Pid'];identity=row['Id']
if not re.fullmatch('[a-f0-9]{64}',identity) or not row['State']['Running'] or pid<=0:raise RuntimeError('RunningMetaContainerRequired')
paths=[line[3:] for line in Path('/proc/'+str(pid)+'/cgroup').read_text().splitlines() if line.startswith('0::/')]
if len(paths)!=1 or identity not in paths[0] or '..' in paths[0].split('/'):raise RuntimeError('PinnedMetaCgroupV2Required')
group=Path('/sys/fs/cgroup')/paths[0].lstrip('/')
processes=set()
for current in (group,*group.rglob('*')):
 if current.is_dir() and (current/'cgroup.procs').is_file():processes.update((current/'cgroup.procs').read_text().split())
totals={'Rss:':0,'Pss:':0,'Private_Clean:':0,'Private_Dirty:':0,'Shared_Clean:':0,'Shared_Dirty:':0};exited=0
for process in processes:
 if not re.fullmatch('[0-9]+',process):raise RuntimeError('NumericProcessIdentityRequired')
 try:memory=counters(Path('/proc/'+process+'/smaps_rollup').read_text().replace(' kB',''),set(totals))
 except FileNotFoundError:exited+=1;continue
 for name,value in memory.items():totals[name]+=value*1024
current=int((group/'memory.current').read_text());peak=int((group/'memory.peak').read_text());maximum=int((group/'memory.max').read_text())
events=counters((group/'memory.events').read_text(),{'low','high','max','oom','oom_kill'})
stats=counters((group/'memory.stat').read_text(),{'anon','file','shmem','file_mapped','kernel'})
result={'status':'PASS','readOnly':True,'vmWrites':0,'loadRequests':0,'container':'ir35-staging-meta-1',
 'state':{name:row['State'][name] for name in ('Status','Running','Paused','OOMKilled','ExitCode','StartedAt','FinishedAt')},
 'restartCount':row['RestartCount'],'configuredLimitBytes':row['HostConfig']['Memory'],'kernelLimitBytes':maximum,
 'currentCgroupBytes':current,'allTimeCgroupPeakBytes':peak,'cgroupEvents':events,'cgroupStatBytes':stats,
 'processCount':len(processes),'processesExitedDuringRead':exited,'summedProcessBytes':{key[:-1]:value for key,value in totals.items()},
 'sumRSSCanDoubleCountSharedMappings':True,'configOrLimitsChanged':False,'noOOMObserved':not row['State']['OOMKilled'] and events['oom']==0 and events['oom_kill']==0,
 'cgroupCurrentWithinConfiguredLimit':current<=maximum==row['HostConfig']['Memory'],'phaseComplete':False}
result['fullContainment']=containment(data,runtime,probe_container='ir35-p6-mock-worker-v7-fixedip')
if result['fullContainment']['status']!='PASS':result.update(status='FAIL',code='MemoryDiagnosisContainmentMismatch_Abort')
print(json.dumps(result))
'''
    compile(code,'<read-only-meta-memory>','exec')
    return code


def main():
    if sys.argv[1:]!=['--read-only']:raise RuntimeError('ReadonlyMemoryDiagnosisRequired')
    old=schema.REPO/'docs/evidence/p8/readonly-load-01'
    if verified_manifest(old)!='8c89ba466ce78bac5cc22c1755bf169878b73b25bc8a608914f5da15cc885da2':raise RuntimeError('ExactOriginalFailureRequired')
    data=load.context();code=program(data)
    journal=Journal(schema.REPO/'docs/evidence/p8/memory-diagnosis-01');result={'status':'FAIL','readOnly':True,'phaseComplete':False}
    try:
        result['diagnosis']=journal.step(1,'cgroup-rss-pss-containment',lambda:schema.run_guest(code,timeout=600))
        result['status']=result['diagnosis']['status']
    except Exception as error:result['code']=str(error) if type(error)is RuntimeError else type(error).__name__
    finally:result['manifestSHA256']=journal.seal(result)
    print(json.dumps({key:value for key,value in result.items() if key!='diagnosis'}))
    if result['status']!='PASS':raise SystemExit(1)


if __name__=='__main__':main()
