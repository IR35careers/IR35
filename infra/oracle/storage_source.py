"""Read-only fixed-origin Storage download; never log keys, paths or bytes."""
import hashlib
import json
import os
from pathlib import PurePosixPath
import re
import ssl
import time
import urllib.error
import urllib.parse
import urllib.request
import cloud_schema as schema

ORIGIN='https://kxcbgflleqnjzjbkevwd.supabase.co'
SQL="""SELECT jsonb_build_object('buckets',coalesce((SELECT jsonb_agg(jsonb_build_object('name',b.id,'restrictionsMD5',md5(to_jsonb(b)::text)) ORDER BY b.id) FROM storage.buckets b),'[]'::jsonb),
 'objects',coalesce((SELECT jsonb_agg(jsonb_build_object('bucket',o.bucket_id,'name',o.name,'version',o.version,'metadata',o.metadata) ORDER BY o.bucket_id,o.name) FROM storage.objects o),'[]'::jsonb)) AS storage;"""


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,*args,**kwargs):raise RuntimeError('Storage redirect refused; credentials never forwarded')


def object_url(bucket,name):
    for part in (bucket,name):
        if (not isinstance(part,str) or not part or any(c in part for c in ('\x00','\r','\n','\\')) or
            PurePosixPath(part).is_absolute() or any(x in ('','..','.') for x in part.split('/'))):
            raise ValueError('Unsafe object locator; raw path withheld')
    if '/' in bucket:raise ValueError('Bucket must be one path component')
    return ORIGIN+'/storage/v1/object/authenticated/'+urllib.parse.quote(bucket,safe='')+'/'+urllib.parse.quote(name,safe='/')


def download(key,bucket,name,expected_size,*,opener=None):
    if not isinstance(key,str) or not re.fullmatch(r'[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+',key):raise ValueError('Private source Storage read credential required')
    if not isinstance(expected_size,int) or not 0<=expected_size<=52_428_800:raise ValueError('Object size outside reviewed bound; no truncation')
    url=object_url(bucket,name)
    opener=opener or urllib.request.build_opener(urllib.request.ProxyHandler({}),NoRedirect(),urllib.request.HTTPSHandler(context=ssl.create_default_context()))
    request=urllib.request.Request(url,headers={'Authorization':'Bearer '+key,'apikey':key,'Accept-Encoding':'identity'},method='GET')
    try:
        with opener.open(request,timeout=30) as response:
            if response.status!=200 or response.geturl()!=url:raise RuntimeError('Unexpected Storage response origin/status')
            body=response.read(expected_size+1)
            if len(body)!=expected_size:raise RuntimeError('Storage byte length mismatch; abort, no edit or skip')
            return {'body':body,'sha256':hashlib.sha256(body).hexdigest(),
                'contentType':response.headers.get('Content-Type','application/octet-stream'),
                'cacheControl':response.headers.get('Cache-Control','no-cache'),'contentEncoding':response.headers.get('Content-Encoding')}
    except urllib.error.HTTPError as error:
        raise RuntimeError('Source Storage GET HTTP '+str(error.code)+'; raw path/body/credential withheld') from None
    except (urllib.error.URLError,TimeoutError):raise RuntimeError('Source Storage transport failure; raw diagnostics withheld') from None


def collect(snapshot,key):
    snapshot.send(SQL);metadata=json.loads(snapshot.line())
    bucket_names=[x['name'] for x in metadata['buckets']]
    if not bucket_names or len(set(bucket_names))!=len(bucket_names):raise ValueError('Complete unique bucket inventory required')
    paths=set();objects=[];private=[];total=0
    for obj in metadata['objects']:
        locator=(obj['bucket'],obj['name'])
        if locator in paths or obj['bucket'] not in bucket_names:raise ValueError('Storage locator coverage mismatch')
        paths.add(locator)
        size=obj.get('metadata',{}).get('size')
        if isinstance(size,str) and re.fullmatch(r'\d+',size):size=int(size)
        if type(size) is not int:raise ValueError('Every object must have exact size metadata')
        blob=download(key,obj['bucket'],obj['name'],size);total+=size
        if total>256_000_000:raise RuntimeError('Aggregate Storage capture bound; no partial PASS')
        framed=json.dumps([obj['bucket'],obj['name']],ensure_ascii=False,separators=(',',':')).encode()
        public={'pathHash':hashlib.sha256(framed).hexdigest(),'bytes':str(size),'sha256':blob['sha256']}
        objects.append({'bucket':obj['bucket'],**public});private.append({**obj,**blob,**public})
    # A new read-only snapshot sees changes hidden by the exported DB snapshot.
    with schema.Snapshot(snapshot.environment) as current:
        current.send(SQL);after=json.loads(current.line())
    if metadata!=after:raise RuntimeError('Storage metadata changed during capture; abort inconsistent object snapshot')
    buckets=[]
    for bucket in metadata['buckets']:
        entries=sorted(({k:v for k,v in x.items() if k!='bucket'} for x in objects if x['bucket']==bucket['name']),key=lambda x:x['pathHash'])
        buckets.append({**bucket,'objects':entries,'objectCount':str(len(entries)),'totalBytes':str(sum(int(x['bytes']) for x in entries))})
    return {'buckets':buckets,'privateObjects':private,'metadata':metadata,'totalBytes':total}


def run():
    key=os.environ.pop('IR35_SOURCE_STORAGE_KEY',None)
    if not key:raise ValueError('Private source Storage read credential missing')
    started=time.monotonic()
    with schema.Snapshot(schema.source_environment()) as snapshot:
        result=collect(snapshot,key)
    key=None
    public={'status':'SOURCE_STORAGE_ONLY','phaseComplete':False,'storageStable':True,'buckets':result['buckets'],
      'objectCount':sum(int(x['objectCount']) for x in result['buckets']),'totalBytes':result['totalBytes'],
      'durationSeconds':round(time.monotonic()-started,3),'sourceWrites':0,'stagingWrites':0,'customerRowsImported':0,
      'targetCompared':False,'zeroLossVerified':False,'rawPathsPublished':False,'secretsPersisted':False}
    path=schema.REPO/'docs/evidence/oracle-p4-source-storage.json'
    path.write_text(json.dumps(public,indent=2)+'\n')
    print(json.dumps({'status':'PASS','operation':'p4-source-storage','report':'docs/evidence/oracle-p4-source-storage.json','objects':public['objectCount'],'sourceWrites':0}))
