"""Sanitised systemd results; raw stderr/messages never enter evidence."""
import hashlib
import json
import re
import subprocess
import time
from datetime import datetime, timezone

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


def capture(command,timeout):
    try:return subprocess.run(command,capture_output=True,timeout=timeout)
    except Exception as error:
        # Type only. TimeoutExpired may contain output/argv: never serialise it.
        return subprocess.CompletedProcess(command,1,b'',type(error).__name__.encode())


def dispatch_once(unit,runtime,store,stage,prefix):
    if not re.fullmatch(r'ir35-p6-mock-(?:mock-ingest|mock-automation|watchdog)-decoder[23]\.service',unit):
        raise RecoveryError('FixedDecoderDispatchUnitRequired')
    store.put(stage,prefix+'-intent.json',json.dumps({'unit':unit,'startAttempts':1,'mockOnly':True}).encode())
    start=datetime.now(timezone.utc)
    result={'unit':unit,'dispatcherStderr':[],'windowStart':start.isoformat(),'startAttempts':1}
    invocation=''
    # Exactly one start. Observe the ID while start is still waiting for the
    # oneshot; an extremely fast unit may finish before our first observation.
    try:process=subprocess.Popen(['systemctl','start',unit],stdout=subprocess.PIPE,stderr=subprocess.PIPE)
    except Exception as error:
        result.update(status='FAIL',captureError=type(error).__name__)
        store.put(stage,prefix+'-result.json',json.dumps(result,sort_keys=True).encode())
        raise RecoveryError('DecoderMockSystemctlDispatchFailed_SeeSealedRedactedStderr') from None
    deadline=time.monotonic()+40
    try:
        while process.poll() is None:
            active=capture(['systemctl','show',unit,'--property=InvocationID'],15)
            if active.returncode==0:
                candidate=active.stdout.decode(errors='replace').strip().removeprefix('InvocationID=')
                if re.fullmatch(r'[a-f0-9]{32}',candidate):invocation=candidate
            remaining=deadline-time.monotonic()
            if remaining<=0:raise subprocess.TimeoutExpired('systemctl',40)
            try:
                stdout,stderr=process.communicate(timeout=min(0.1,remaining))
                break
            except subprocess.TimeoutExpired:pass
        else:stdout,stderr=process.communicate(timeout=max(0.01,deadline-time.monotonic()))
        result.update(commandExitCode=process.returncode,commandStdout=redacted(stdout),commandStderr=redacted(stderr))
    except Exception as error:
        process.kill();stdout,stderr=process.communicate()
        result.update(commandExitCode=process.returncode,commandStdout=redacted(stdout),commandStderr=redacted(stderr),
            captureError=type(error).__name__)
    observed=capture(['systemctl','show',unit,'--property=Result','--property=ExecMainStatus',
        '--property=ExecMainCode','--property=InvocationID'],15)
    if observed.returncode==0:
        fields=dict(line.split('=',1) for line in observed.stdout.decode().splitlines() if '=' in line)
        late_invocation=fields.pop('InvocationID','')
        if not invocation and re.fullmatch(r'[a-f0-9]{32}',late_invocation):invocation=late_invocation
        result['service']={name:fields.get(name) for name in ('Result','ExecMainStatus','ExecMainCode')}
    else:result['stateReadError']=redacted(observed.stderr)
    end=datetime.now(timezone.utc);result['windowEnd']=end.isoformat()
    result['invocationCaptured']=bool(invocation)
    # Bound BOTH routes to this dispatch window. Unit+window is essential when
    # systemd has already garbage-collected InvocationID. Never read all logs.
    selector=['_SYSTEMD_INVOCATION_ID='+invocation] if invocation else ['-u',unit]
    result['journalScope']='invocation-and-window' if invocation else 'unit-and-window'
    journal=capture(['journalctl','--no-pager','-n','50','-o','json','--since',start.isoformat(),
        '--until',end.isoformat(),*selector],15)
    result['journalReadExitCode']=journal.returncode
    result['journalWithinSizeLimit']=len(journal.stdout)<=262144
    result['journalValidJSON']=True
    if journal.returncode==0 and result['journalWithinSizeLimit']:
        for line in journal.stdout.splitlines():
            try:item=json.loads(line)
            except ValueError:result['journalValidJSON']=False;continue
            message=item.get('MESSAGE','')
            if isinstance(message,str):result['dispatcherStderr'].append(safe_message(message))
    else:result['journalReadError']=redacted(journal.stderr)
    result['status']='PASS' if (result.get('commandExitCode')==0 and 'captureError' not in result
        and result.get('service',{}).get('Result')=='success' and result['service'].get('ExecMainStatus')=='0'
        and result.get('journalReadExitCode')==0 and result['journalWithinSizeLimit'] and result['journalValidJSON']) else 'FAIL'
    store.put(stage,prefix+'-result.json',json.dumps(result,sort_keys=True).encode())
    if result['status']!='PASS':raise RecoveryError('DecoderMockSystemctlDispatchFailed_SeeSealedRedactedStderr')
    return result
