"""VM-only mock schedule dispatcher; no credentials in arguments or output."""
import base64
from datetime import datetime,timezone
import hashlib
import hmac
import json
import os
from pathlib import Path
import re
import stat
import sys
import time
import urllib.request
import urllib.error


class DispatchError(RuntimeError):
    pass


def decode_env_value(raw):
    if not isinstance(raw,str) or any(c in raw for c in ('\n','\r','\0')):raise DispatchError('EnvValueMalformed')
    value=raw.strip(' \t')
    if value.startswith(("'",'"')):
        if len(value)<2 or value[-1]!=value[0]:raise DispatchError('EnvValueMalformed')
        value=value[1:-1]
    if not value or any(c in value for c in ("'",'"')):raise DispatchError('EnvValueMalformed')
    return value


def decode_env(text):
    if '\r' in text or '\0' in text:raise DispatchError('EnvFileMalformed')
    values={}
    for line in text.split('\n'):
        if not line.strip(' \t') or line.lstrip(' \t').startswith('#'):continue
        if '=' not in line:raise DispatchError('EnvFileMalformed')
        key,raw=line.split('=',1);key=key.strip(' \t')
        if not re.fullmatch(r'[A-Z][A-Z0-9_]*',key) or key in values:raise DispatchError('EnvFileMalformed')
        values[key]=decode_env_value(raw)
    return values


def error_event(error,stage):
    # Even an unexpected vendor exception containing a secret is never copied.
    raw=str(error).encode(errors='replace')
    codes={'FixedMockOperationRequired','PrivateControlCustodyRequired','EnvValueMalformed','EnvFileMalformed',
        'ExistingMockControlRequired','MockScheduleNotDurablyQueued'}
    code=str(error) if type(error)is DispatchError and str(error) in codes else 'DispatcherFailure_RawWithheld'
    event={'status':'FAIL','code':code,'stage':stage,'stderr':{'redacted':True,'length':len(raw),'sha256Prefix':hashlib.sha256(raw).hexdigest()[:12]}}
    if isinstance(error,urllib.error.HTTPError) and type(error.code)is int and 100<=error.code<=599:event['httpStatus']=error.code
    return event


def read_control(path):
    descriptor=os.open(path,os.O_RDONLY|os.O_NOFOLLOW)
    try:
        info=os.fstat(descriptor)
        if not stat.S_ISREG(info.st_mode) or info.st_uid!=1002 or stat.S_IMODE(info.st_mode)!=0o600 or info.st_nlink!=1:
            raise DispatchError('PrivateControlCustodyRequired')
        with os.fdopen(descriptor,'r',closefd=False) as stream:text=stream.read(8193)
        if len(text)>8192:raise DispatchError('PrivateControlCustodyRequired')
        return decode_env(text)
    finally:os.close(descriptor)


def dispatch(operation,*,path=Path('/opt/ir35/.env.p6-mock-control'),opener=None):
    if operation not in ('mock_ingest','mock_automation','watchdog'):raise DispatchError('FixedMockOperationRequired')
    values=read_control(path)
    secret=values.get('APPLICATION_WORKER_SECRET','')
    if not re.fullmatch(r'[a-f0-9]{64}',secret):raise DispatchError('ExistingMockControlRequired')
    payload={'kind':'staging_mock_schedule','operation':operation,
        'requestedAt':datetime.now(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00','Z')}
    body=json.dumps(payload,separators=(',',':'));stamp=str(int(time.time()*1000))
    signature=base64.urlsafe_b64encode(hmac.new(secret.encode(),f'ir35-staging-mock-v1.{stamp}.POST./mock/schedule.{body}'.encode(),hashlib.sha256).digest()).decode().rstrip('=')
    request=urllib.request.Request('http://127.0.0.1:8787/mock/schedule',data=body.encode(),method='POST',
        headers={'Content-Type':'application/json','X-Ir35-Mock-Timestamp':stamp,'X-Ir35-Mock-Signature':signature})
    opener=opener or urllib.request.build_opener(urllib.request.ProxyHandler({}))
    with opener.open(request,timeout=10) as reply:
        raw=reply.read(4097)
        if reply.status!=202 or len(raw)>4096 or json.loads(raw)!={'mock':True,'queued':True}:raise DispatchError('MockScheduleNotDurablyQueued')
    return {'status':'PASS','operation':operation,'requestedAt':payload['requestedAt'],'realSideEffects':0}


def main():
    stage='decode-or-dispatch'
    try:
        if len(sys.argv)!=2:raise DispatchError('FixedMockOperationRequired')
        result=dispatch(sys.argv[1]);print(json.dumps(result));return 0
    except Exception as error:
        print(json.dumps(error_event(error,stage)),file=sys.stderr);return 1


if __name__=='__main__':
    raise SystemExit(main())
