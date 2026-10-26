"""Post-G3 read-only runtime-file proof and complete containment, no Auth writes."""
import inspect
import json
import sys
import cloud_schema as schema
import p6_capture_repair
import p7_auth_inventory as inventory
from p6_audit_log import Journal


def private_auth_launcher(row):
    path='/opt/ir35/.env.p5-auth'
    command=(row['Config'].get('Entrypoint')or[])+(row['Config'].get('Cmd')or[])
    return (command[:2]==['/run/ir35/env-exec',path] and row['State']['Running']is True
        and any(mount.get('Source')==path and mount.get('Destination')==path and mount.get('RW')is False for mount in row.get('Mounts',[])))


def program(data):
    code=p6_capture_repair.bundle()
    code+='\n'+inspect.getsource(private_auth_launcher)+'\n'+inspect.getsource(inventory.project)
    code+='\nTEMPLATES='+repr(inventory.TEMPLATES)+'\nRATES='+repr(inventory.RATES)+'\n'
    code+=inventory.bind_data('''
from p6_mock_guest import prepared,ROOT
from web_edge_guest import private_env
from web_services_guest import require_prepared
from p6_restart_diagnosis_guest import containment
data=DATA
store=prepared(data)
store.verify(data['p6Pass']['stage'],data['p6Pass']['manifestSHA256'])
require_prepared(data)
config=private_env(ROOT/'.env.p5-auth')
row=json.loads(runtime['run'](['docker','inspect','ir35-p5-auth']))[0]
projection=project(config,{'external':{'email':config.get('GOTRUE_EXTERNAL_EMAIL_ENABLED')=='true'},'mailer_autoconfirm':config.get('GOTRUE_MAILER_AUTOCONFIRM')=='true'})
checks={'privateRuntimeFileIsMountedAndLaunched':private_auth_launcher(row),
 'smtpSink':projection['smtpSink'],'mockOnly':runtime['read_env']().get('APPLY_RUNNER')=='mock',
 'realAcceptanceFalse':runtime['read_env']().get('APPLICATION_WORKER_ACCEPT_JOBS')=='false'}
full=containment(data,runtime,probe_container='ir35-p6-mock-worker-v7-fixedip')
memory=int(next(line.split()[1] for line in Path('/proc/meminfo').read_text().splitlines() if line.startswith('MemAvailable:')))
print(json.dumps({'status':'PASS' if all(checks.values()) and full['status']=='PASS' else 'FAIL',
 'readOnly':True,'vmWrites':0,'mailRequests':0,'authMutations':0,'checks':checks,'memAvailableKiB':memory,
 'declaredDockerEnvironmentNotUsedAsEffectiveConfig':True,'fullContainment':full,'phaseComplete':False}))
''',data)
    compile(code,'<p7-effective-runtime-readonly>','exec')
    return code


def main():
    if sys.argv[1:]!=['--read-only']:raise RuntimeError('ExplicitReadOnlyReadinessRequired')
    data=inventory.context()
    root=schema.REPO/'docs/evidence/p7/g3-runtime-readiness-01'
    journal=Journal(root)
    journal.put('intent.json',{'readOnly':True,'vmWrites':0,'newAuthAttempts':0,'previousProbeFailures':2,
        'repair':'effective private mounted env, not Docker image Config.Env','thirdFailureHardStop':True})
    result={'status':'FAIL','phaseComplete':False,'readOnly':True,'vmWrites':0}
    try:
        result['readiness']=journal.step(1,'effective-config-containment',lambda:schema.run_guest(program(data),timeout=600))
        result['status']=result['readiness']['status']
    except Exception as error:result['code']=str(error) if type(error)is RuntimeError else type(error).__name__
    finally:result['manifestSHA256']=journal.seal(result)
    print(json.dumps({key:value for key,value in result.items() if key!='readiness'}))
    if result['status']!='PASS':raise SystemExit(1)


if __name__=='__main__':main()
