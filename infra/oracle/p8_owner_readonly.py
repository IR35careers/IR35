"""Fresh owner-resume preflight. Read-only APIs/SSH; exclusive local journal.

No CLI dispatch, IAM writer, old native-slot replay, config change or secret
value is exposed. An absent/ambiguous lifecycle service grant is NOT supplied
by the owner's separate three-permission VM policy.
"""
from datetime import datetime, timezone
import json
from pathlib import Path
import re
import sys
import time

from host_ssh import run_remote
from key_ceremony import KeySafetyError
from p6_audit_log import Journal
from p8_backup_access_readonly import project, read
from p8_oci_readonly import RecordedReads, execute
from object_storage_exact import SecurityTokenReads
from security_session import ensure_session

GUEST = r'''import hashlib,json,re,subprocess
from pathlib import Path
def command(args):
    reply=subprocess.run(args,capture_output=True,text=True,timeout=20,check=False)
    if reply.returncode:raise RuntimeError('FixedReadOnlyCaddyCommandFailed_RawWithheld')
    return reply.stdout
try:
    name='ir35-staging-caddy-1'
    container=json.loads(command(['docker','inspect',name]))[0]
    path=Path('/opt/ir35/config/p5-Caddyfile-sdk-owner1')
    if path.is_symlink() or not path.is_file():raise RuntimeError('ExactPhysicalExistingCaddyConfigRequired')
    body=path.read_bytes();text=body.decode()
    version=command(['docker','exec',name,'caddy','version']).strip().split()[0]
    if not re.fullmatch(r'v?\d+\.\d+\.\d+',version):raise RuntimeError('PublicVersionProjectionRequired')
    state=container['State']
    admin_off=bool(re.search(r'^\s*admin\s+off\s*$',text,re.M))
    readonly_mount=any(row.get('Source')==str(path) and row.get('RW') is False for row in container['Mounts'])
    out={'status':'PASS' if state.get('Running') is True and readonly_mount else 'FAIL',
      'connected':True,'readOnly':True,'container':name,'version':version,'imageId':container['Image'],
      'state':{key:state.get(key) for key in ('Status','Running','Paused','ExitCode','StartedAt','FinishedAt','OOMKilled')},
      'RestartCount':container.get('RestartCount'),'configSha256':hashlib.sha256(body).hexdigest(),
      'exactReadonlyConfigMount':readonly_mount,'adminOff':admin_off,
      'persistenceOff':bool(re.search(r'^\s*persist_config\s+off\s*$',text,re.M)),
      'pinned210ReloadOnlyUnsupported':version.lstrip('v')=='2.10.2' and admin_off,
      'configValuesPrinted':False,'responseCasesChecked':False,'configChanges':0}
    print(json.dumps(out))
except Exception as error:
    print(json.dumps({'status':'FAIL','exceptionType':type(error).__name__,'rawErrorWithheld':True,'configChanges':0}))
'''


def lifecycle_projection(policy_rows):
    """Inventory signal only; never infer effective IAM from matching text."""
    if type(policy_rows) is not list or any(type(row) is not dict for row in policy_rows):
        raise KeySafetyError('CompletePolicyListsRequired')
    active=[row for row in policy_rows if row.get('lifecycle-state')=='ACTIVE']
    statements=[]
    for row in active:
        values=row.get('statements')
        if type(values) is not list or any(type(value) is not str for value in values):
            raise KeySafetyError('CompleteActivePolicyStatementsRequired')
        statements.extend(values)
    candidates=[value for value in statements if 'objectstorage' in value.lower() or 'request.service' in value.lower()]
    return {'status':'REQUIRES_SCOPE_REVIEW' if candidates else 'ABSENT_IN_ROOT_AND_CHILD_LISTS',
        'activePolicies':len(active),'statementCount':len(statements),
        'possibleObjectStorageServiceStatements':len(candidates),'effectiveLifecycleAccessProven':False,
        'newGrantApproved':False,'iamChanges':0}


def main(argv=None):
    args=sys.argv[1:] if argv is None else argv
    if args!=['--read-only']:
        raise KeySafetyError('FixedOwnerReadOnlyInvocationRequired')
    root=Path(__file__).resolve().parents[2]/'docs/evidence/p8/owner-resume-readonly-20261030-01'
    journal=Journal(root)
    result={'status':'FAIL','readOnly':True,'cloudWrites':0,'vmChanges':0,'iamChanges':0,
        'keyGenerationCalls':0,'phaseComplete':False,'cutover':False}
    try:
        profile=ensure_session(minimum_seconds=1800)
        journal.put('access.json',{'profile':'ir35','auth':'security_token','region':'uk-london-1',
            'remainingSeconds':int(profile['expiresAt']-time.time()),'apiPassphraseRequested':False})
        journal.step(1,'caddy-inspection',lambda:run_remote(GUEST,[],timeout=65))
        client=RecordedReads(profile,journal)
        inventory_result=execute(client,journal,SecurityTokenReads(profile))
        policies=[]
        for index,operation in enumerate(('groups','root-policies','child-policies','alarms','topics','subscriptions'),2):
            journal.put(f'{index:02d}-{operation}-intent.json',{'readOnly':True,'operation':operation})
            rows=read(operation,profile)
            journal.put(f'{index:02d}-{operation}-result.json',project(operation,rows))
            if operation.endswith('policies'):policies.extend(rows)
        lifecycle=lifecycle_projection(policies)
        journal.put('lifecycle-service-prerequisite.json',lifecycle)
        result.update(status='READ_ONLY_COMPLETE_NATIVE_WRITES_HELD',inventory=inventory_result,
            lifecycleService=lifecycle['status'],checkedAt=datetime.now(timezone.utc).isoformat(),
            supportedReloadProven=False,backupAccessProven=False)
    except Exception as error:
        result.update(exceptionType=type(error).__name__,rawErrorWithheld=True)
        if isinstance(error,KeySafetyError) and re.fullmatch('[A-Za-z0-9_]+',str(error)):
            result['code']=str(error)
    finally:
        result['manifestSHA256']=journal.seal(result)
    print(json.dumps(result))
    return 0 if result['status']=='READ_ONLY_COMPLETE_NATIVE_WRITES_HELD' else 1


if __name__=='__main__':raise SystemExit(main())
