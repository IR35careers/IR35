"""Fresh credentials-free curl-I decision; never edits or restarts anything."""
import inspect
import json
from pathlib import Path
import re
import sys
from host_ssh import run_remote
from p6_audit_log import Journal


def parse_head(text):
    lines=text.replace('\r','').splitlines()
    statuses=[int(match[1]) for line in lines if (match:=re.fullmatch(r'HTTP/[0-9.]+ ([0-9]{3})(?: .*)?',line))]
    if len(statuses)!=1:raise RuntimeError('OneUnredirectedHttpResponseRequired')
    headers={}
    allowed={'cache-control','x-robots-tag','www-authenticate','x-caddy-request-id','x-ir35-matched-route','server'}
    for line in lines:
        if ':' in line:
            name,value=line.split(':',1);name=name.lower()
            if name in allowed:headers[name]=value.strip()
    return statuses[0],headers


def program():
    return 'import json,re,subprocess\n'+inspect.getsource(parse_head)+'''
rows=[]
for host,path in [('staging.ir35careers.com','/jobs'),('api-staging.ir35careers.com','/auth/v1/health')]:
    row={'host':host,'path':path,'method':'HEAD','credentialsSent':False}
    try:
        reply=subprocess.run(['curl','-I','--silent','--show-error','--proto','=https',
            '--connect-timeout','8','--max-time','15','--resolve',host+':443:127.0.0.1','https://'+host+path],
            capture_output=True,text=True,timeout=20,env={'PATH':'/usr/bin:/bin','LANG':'C.UTF-8'},check=False)
        if reply.returncode:raise RuntimeError('HeadTransportFailed_RawWithheld')
        code,headers=parse_head(reply.stdout)
        row.update(status='PASS' if code==401 else 'FAIL',actualStatus=code,expectedStatus=401,headers=headers,
            noStore=headers.get('cache-control')=='no-store',noindex='noindex' in headers.get('x-robots-tag',''))
    except Exception as error:row.update(status='FAIL',exceptionType=type(error).__name__,rawWithheld=True)
    rows.append(row)
ok=all(row['status']=='PASS' for row in rows)
present=ok and all(row['noStore'] and row['noindex'] for row in rows)
print(json.dumps({'status':'PASS' if ok else 'FAIL','cases':rows,'initialRequiredHeadersPresent':present,
    'activationRequired':ok and not present,'activationPerformed':False,'configChanges':0,'serviceRestarts':0,
    'phaseComplete':False,'scope':'OWNER_FIRST_TWO_READONLY_HEADS'}))
'''


def main():
    if sys.argv[1:]!=['--read-only']:raise RuntimeError('FixedReadOnlyHeadInvocationRequired')
    journal=Journal(Path(__file__).resolve().parents[2]/'docs/evidence/p8/caddy-head-owner-20261030-01')
    result={'status':'FAIL','configChanges':0,'serviceRestarts':0,'phaseComplete':False}
    try:
        proof=journal.step(1,'first-heads',lambda:run_remote(program(),[],timeout=65))
        result.update(status='PASS',initialRequiredHeadersPresent=proof['initialRequiredHeadersPresent'],
            activationRequired=proof['activationRequired'],activationPerformed=False)
    except Exception as error:result.update(exceptionType=type(error).__name__,rawWithheld=True)
    finally:result['manifestSHA256']=journal.seal(result)
    print(json.dumps(result));return 0 if result['status']=='PASS' else 1


if __name__=='__main__':raise SystemExit(main())
