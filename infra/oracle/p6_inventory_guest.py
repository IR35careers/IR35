"""P6 read-only prerequisites. No role, schema, queue, container or timer writes."""
import json
import os
from pathlib import Path
from immutable_artifacts import Store
from p4_recovery_guest import Recovery
from sdk_owner1_guest import fidelity


def run(data,runtime):
    root=Path('/opt/ir35');journal=root/'.env.p6'
    journal.mkdir(mode=0o700);os.chown(journal,1002,1002);store=Store(journal,uid=1002);stage=store.stage('01-inventory')
    result={'status':'FAIL','infraCreates':0,'roleWrites':0,'schemaWrites':0,'secretChanges':0,'serviceChanges':0,'productionChanges':False}
    try:
        sdk=Store(root/'.env.p5-sdk-owner1',uid=1002)
        for name,anchor in data['sdkAnchors'].items():sdk.verify(name,anchor)
        previous=data['runtimeAudit'];Store(previous['root'],uid=1002).verify(previous['stage'],previous['manifestSHA256'])
        containment,pristine,fixture=fidelity(data,runtime)
        store.put(stage,'pristine-fidelity.json',json.dumps(pristine).encode());store.put(stage,'fixture-fidelity.json',json.dumps(fixture).encode())
        if containment['status']!='PASS':raise RuntimeError('P6PreflightDataMismatch_Abort')
        original=Recovery(data['p4'],runtime)
        roles=json.loads(original.query("SELECT coalesce(jsonb_agg(jsonb_build_object('name',rolname,'login',rolcanlogin,'superuser',rolsuper,'createRole',rolcreaterole,'createDatabase',rolcreatedb,'inherit',rolinherit,'replication',rolreplication,'bypassRLS',rolbypassrls,'hasPassword',rolpassword IS NOT NULL) ORDER BY rolname),'[]') FROM pg_authid WHERE rolname IN ('ir35_queue','ir35_queue_producer');",'postgres'))
        queue=json.loads(original.query("SELECT jsonb_build_object('exists',EXISTS(SELECT 1 FROM pg_namespace WHERE nspname='pgboss'),'owner',(SELECT pg_get_userbyid(nspowner) FROM pg_namespace WHERE nspname='pgboss'),'tableCount',(SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='pgboss' AND c.relkind IN ('r','p')));",'postgres'))
        containers=json.loads(runtime['run'](['docker','inspect',*runtime['run'](['docker','ps','-aq']).splitlines()]))
        services=[{'name':row['Name'].lstrip('/'),'state':row['State']['Status'],'health':row['State'].get('Health',{}).get('Status'),
                   'memoryLimitBytes':row['HostConfig']['Memory'],'restartPolicy':row['HostConfig']['RestartPolicy']['Name'],
                   'portsPublished':bool(row['HostConfig'].get('PortBindings'))} for row in containers]
        memory={line.split(':')[0]:int(line.split()[1]) for line in Path('/proc/meminfo').read_text().splitlines() if line.split(':')[0] in ('MemTotal','MemAvailable','SwapTotal','SwapFree')}
        result.update(status='PASS',containment=containment,queueRoles=roles,queueSchema=queue,services=services,memoryKiB=memory,
                      dataVolume=runtime['run'](['df','-B1','--output=size,used,avail,pcent,target','/opt/ir35/data']).strip(),
                      queueRolesAvailable={row['name'] for row in roles}=={'ir35_queue','ir35_queue_producer'},
                      limitations=['Current worker config rejects APPLY_RUNNER=mock','P5 branch does not yet include PR48 private-host validator','New roles must not silently invalidate exact cloud role parity'])
    except Exception as error:result['code']=type(error).__name__
    store.put(stage,'result.json',json.dumps(result,sort_keys=True).encode())
    return result|{'stage':stage.name,'manifestSHA256':store.seal(stage)}
