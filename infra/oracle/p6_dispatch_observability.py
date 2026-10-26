"""Sanitised systemd results; raw stderr/messages never enter evidence."""
import hashlib
import json
import re
import subprocess

from p4_recovery_guest import RecoveryError


def redacted(raw):
    if isinstance(raw,str):raw=raw.encode(errors='replace')
    return {'redacted':True,'length':len(raw),'sha256Prefix':hashlib.sha256(raw).hexdigest()[:12]}


def safe_message(raw):
    result={'message':redacted(raw)}
    try:value=json.loads(raw)
    except (ValueError,TypeError):return result
    allowed={'status','code','stage','stderr','httpStatus'}
    codes={'FixedMockOperationRequired','PrivateControlCustodyRequired','EnvValueMalformed','EnvFileMalformed',
        'ExistingMockControlRequired','MockScheduleNotDurablyQueued','DispatcherFailure_RawWithheld'}
    diagnostic=value.get('stderr',{}) if isinstance(value,dict) else {}
    if (not isinstance(value,dict) or set(value)-allowed or value.get('status')!='FAIL' or value.get('code') not in codes
            or value.get('stage')!='decode-or-dispatch' or set(diagnostic)!={'redacted','length','sha256Prefix'}
            or diagnostic.get('redacted')is not True or type(diagnostic.get('length'))is not int or not 0<=diagnostic['length']<=1_000_000
            or not re.fullmatch(r'[a-f0-9]{12}',diagnostic.get('sha256Prefix',''))):return result
    if 'httpStatus' in value and (type(value['httpStatus'])is not int or not 100<=value['httpStatus']<=599):return result
    result['diagnostic']=value
    return result


def dispatch_once(unit,runtime,store,stage,prefix):
    if not re.fullmatch(r'ir35-p6-mock-(?:mock-ingest|mock-automation|watchdog)-decoder2\.service',unit):
        raise RecoveryError('FixedDecoderDispatchUnitRequired')
    store.put(stage,prefix+'-intent.json',json.dumps({'unit':unit,'startAttempts':1,'mockOnly':True}).encode())
    reply=subprocess.run(['systemctl','start',unit],capture_output=True,timeout=40)
    result={'unit':unit,'commandExitCode':reply.returncode,'commandStdout':redacted(reply.stdout),
        'commandStderr':redacted(reply.stderr),'dispatcherStderr':[]}
    observed=subprocess.run(['systemctl','show',unit,'--property=Result','--property=ExecMainStatus',
        '--property=ExecMainCode','--property=InvocationID'],capture_output=True,timeout=15)
    if observed.returncode==0:
        fields=dict(line.split('=',1) for line in observed.stdout.decode().splitlines() if '=' in line)
        invocation=fields.pop('InvocationID','')
        result['service']={name:fields.get(name) for name in ('Result','ExecMainStatus','ExecMainCode')}
        if re.fullmatch(r'[a-f0-9]{32}',invocation):
            journal=subprocess.run(['journalctl','--no-pager','-n','50','-o','json','_SYSTEMD_INVOCATION_ID='+invocation],capture_output=True,timeout=15)
            result['journalReadExitCode']=journal.returncode
            if journal.returncode==0 and len(journal.stdout)<=262144:
                for line in journal.stdout.splitlines():
                    try:item=json.loads(line)
                    except ValueError:continue
                    message=item.get('MESSAGE','')
                    if isinstance(message,str):result['dispatcherStderr'].append(safe_message(message))
            else:result['journalReadError']=redacted(journal.stderr)
    else:result['stateReadError']=redacted(observed.stderr)
    result['status']='PASS' if reply.returncode==0 and result.get('service',{}).get('Result')=='success' and result['service'].get('ExecMainStatus')=='0' else 'FAIL'
    store.put(stage,prefix+'-result.json',json.dumps(result,sort_keys=True).encode())
    if result['status']!='PASS':raise RecoveryError('DecoderMockSystemctlDispatchFailed_SeeSealedRedactedStderr')
    return result
