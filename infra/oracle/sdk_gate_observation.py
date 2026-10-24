"""Record before asserting; no credentials/cookies/nonces in public evidence."""
import hashlib
import json
import re
import uuid


def response_headers(headers):
    safe={}
    for name,value in headers.items():
        name=name.lower()
        if name=='set-cookie':
            parts=value.split(';')
            safe[name]=parts[0].split('=',1)[0]+'=<redacted>;'+ ';'.join(parts[1:])
        elif name in ('cache-control','x-robots-tag','content-type','content-length','date','server','www-authenticate','x-caddy-request-id','x-ir35-matched-route','x-upstream-route'):
            safe[name]=value
        elif name=='content-security-policy':safe[name]={'sha256':hashlib.sha256(value.encode()).hexdigest(),'value':'<redacted>'}
        else:safe[name]='<redacted>'
    return safe


class Observer:
    def __init__(self,store,stage):self.store=store;self.stage=stage;self.records=[]

    def case(self,name,method,path,expected,call,*,checks=None):
        if not re.fullmatch(r'[a-z][a-z0-9-]{0,60}',name) or method not in ('GET','POST') or not path.startswith('/') or '?' in path:
            raise RuntimeError('FixedGateCaseRequired')
        record={'case':name,'method':method,'path':path,'expectedStatus':expected,'actualStatus':None,'matchedRoute':None,
                'responseHeaders':{},'caddyRequestId':None,'clientRequestId':str(uuid.uuid4()),'checks':{},'passed':False}
        self.store.put(self.stage,'intent-'+name+'.json',json.dumps({key:record[key] for key in ('case','method','path','expectedStatus','clientRequestId')},sort_keys=True).encode())
        try:
            status,headers,body=call(record['clientRequestId'])
            headers={key.lower():value for key,value in headers.items()}
            record.update(actualStatus=status,matchedRoute=headers.get('x-ir35-matched-route'),responseHeaders=response_headers(headers),caddyRequestId=headers.get('x-caddy-request-id'))
            record['checks']={
                'requestId':bool(re.fullmatch(r'[0-9a-f-]{36}',record['caddyRequestId'] or '')),
                'matchedRoute':bool(record['matchedRoute']),
                'noindex':'noindex' in headers.get('x-robots-tag',''),
                'noStore':headers.get('cache-control')=='no-store',
                **(checks(headers,body) if checks else {}),
            }
            record['passed']=status==expected and all(record['checks'].values())
        except Exception as error:record['transportError']=type(error).__name__ # Never message/args/locals.
        # O_EXCL + fsync + read-only. Even failed transport/status/assertions are
        # durable before a caller can throw. A repeated case cannot overwrite.
        self.store.put(self.stage,'case-'+name+'.json',json.dumps(record,sort_keys=True).encode())
        self.records.append(record)
        return record


def sdk_cases(observer,request,gate,*,headers=None,check_path=True):
    if type(check_path)is not bool:raise RuntimeError('ExplicitPathCheckRequired')
    common=headers or {}
    for name,cookie,expected in [('missing',None,401),('suffix',gate+'extra',401),('valid',gate,200)]:
        extra={} if cookie is None else {'Cookie':'__Host-ir35-staging='+cookie}
        def checks(h,b,name=name):
            result={'exactRoute':h.get('x-ir35-matched-route')==('sdk-proxy' if name=='valid' else 'sdk-guard')}
            if name=='valid' and check_path:result['upstreamPath']=json.loads(b).get('path')=='/auth/v1/health'
            return result
        observer.case('sdk-'+name,'GET','/supabase/auth/v1/health',expected,
            lambda rid,extra=extra:request('GET','/supabase/auth/v1/health',common|extra|{'X-IR35-Client-Request-ID':rid}),
            checks=checks)
