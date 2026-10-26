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


def main():
    if len(sys.argv)!=2 or sys.argv[1] not in ('mock_ingest','mock_automation','watchdog'):raise RuntimeError('FixedMockOperationRequired')
    path=Path('/opt/ir35/.env.p6-mock-control');info=path.stat()
    if path.is_symlink() or info.st_uid!=1002 or stat.S_IMODE(info.st_mode)!=0o600:raise RuntimeError('PrivateControlCustodyRequired')
    values=dict(line.split('=',1) for line in path.read_text().splitlines() if line and not line.startswith('#'))
    secret=values.get('APPLICATION_WORKER_SECRET','')
    if not re.fullmatch(r'[a-f0-9]{64}',secret):raise RuntimeError('ExistingMockControlRequired')
    payload={'kind':'staging_mock_schedule','operation':sys.argv[1],
        'requestedAt':datetime.now(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00','Z')}
    body=json.dumps(payload,separators=(',',':'));stamp=str(int(time.time()*1000))
    signature=base64.urlsafe_b64encode(hmac.new(secret.encode(),f'ir35-staging-mock-v1.{stamp}.POST./mock/schedule.{body}'.encode(),hashlib.sha256).digest()).decode().rstrip('=')
    request=urllib.request.Request('http://127.0.0.1:8787/mock/schedule',data=body.encode(),method='POST',
        headers={'Content-Type':'application/json','X-Ir35-Mock-Timestamp':stamp,'X-Ir35-Mock-Signature':signature})
    opener=urllib.request.build_opener(urllib.request.ProxyHandler({}))
    with opener.open(request,timeout=10) as reply:
        raw=reply.read(4097)
        if reply.status!=202 or len(raw)>4096 or json.loads(raw)!={'mock':True,'queued':True}:raise RuntimeError('MockScheduleNotDurablyQueued')
    print(json.dumps({'status':'PASS','operation':sys.argv[1],'requestedAt':payload['requestedAt'],'realSideEffects':0}))


if __name__=='__main__':
    try:main()
    except Exception:
        print(json.dumps({'status':'FAIL','code':'MockScheduleDispatchFailed_RawWithheld'}));raise SystemExit(1)
