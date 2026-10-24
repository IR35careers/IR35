"""Read-only app audit. No switch/start/stop/config/env/SQL mutation entrypoint."""
import base64
import hashlib
from html.parser import HTMLParser
import json
import os
from pathlib import Path
import re
import uuid
import xml.etree.ElementTree as ET
from immutable_artifacts import Store
from sdk_gate_observation import Observer
from sdk_owner1_guest import fidelity,tls_request


class Page(HTMLParser):
    def __init__(self,body):
        super().__init__(convert_charrefs=True);self.jobs=[];self.assets=[];self.h1s=0;self.nonces=[];self.feed(body.decode('utf8'))

    def handle_starttag(self,tag,attrs):
        attrs=dict(attrs)
        if tag=='h1':self.h1s+=1
        if tag=='a' and re.fullmatch(r'/jobs/[0-9a-f-]{36}',attrs.get('href','')):self.jobs.append(attrs['href'].split('/')[-1])
        if tag=='script' and attrs.get('nonce'):self.nonces.append(attrs['nonce'])
        asset=attrs.get('src') if tag=='script' else attrs.get('href') if tag=='link' and attrs.get('rel')=='stylesheet' else None
        if asset and re.fullmatch(r'/_next/static/[A-Za-z0-9_./-]+\.(?:js|css)',asset):self.assets.append(asset)


def csp_checks(headers,body):
    policy=headers.get('content-security-policy','');nonce=re.search(r"'nonce-([^']+)'",policy)
    page=Page(body)
    return {'h1ExactlyOne':page.h1s==1,'strictDynamic':"'strict-dynamic'" in policy,'noUnsafeEval':"'unsafe-eval'" not in policy,
            'frameAncestorsNone':"frame-ancestors 'none'" in policy,'objectNone':"object-src 'none'" in policy,
            'noncePresentAndApplied':bool(nonce and page.nonces and all(item==nonce[1] for item in page.nonces))}


def sitemap_checks(body):
    root=ET.fromstring(body);locations=[node.text or '' for node in root.findall('.//{http://www.sitemaps.org/schemas/sitemap/0.9}loc')]
    return {'validURLSet':root.tag=='{http://www.sitemaps.org/schemas/sitemap/0.9}urlset','nonempty':bool(locations),
            'uniqueURLs':len(locations)==len(set(locations)),
            'canonicalOrigin':all(url.startswith('https://www.ir35careers.com/') for url in locations),
            'noPrivatePages':not any(re.search(r'/(?:dashboard|admin|account|applications|profile|inbox|api)(?:/|$)',url) for url in locations)}


def audit(data,runtime):
    root=Path('/opt/ir35')
    existing=Store(root/'.env.p5-sdk-owner1',uid=1002)
    for name,anchor in data['sdkAnchors'].items():existing.verify(name,anchor)
    # New evidence only, separate from every earlier failed/passing journal.
    journal=root/('.env.p5-readonly-'+uuid.uuid4().hex)
    journal.mkdir(mode=0o700);os.chown(journal,1002,1002);store=Store(journal,uid=1002);stage=store.stage('01-audit')
    observe=Observer(store,stage);result={'status':'FAIL','serviceChanges':0,'configChanges':0,'envChanges':0,'authGrantRequests':0,'productionChanges':False,'cases':[]}
    values=runtime['read_env']();basic='Basic '+base64.b64encode(('ir35:'+values['STAGING_BASIC_PASSWORD']).encode()).decode()
    request=lambda path,rid:tls_request('staging.ir35careers.com','GET',path,{'Authorization':basic,'X-IR35-Client-Request-ID':rid})
    pages={};api={}
    def get(path,rid):
        reply=request(path,rid);pages[path]=reply;return reply
    try:
        for name,path in [('home','/'),('jobs','/jobs')]:
            observe.case(name,'GET',path,200,lambda rid,path=path:get(path,rid),checks=csp_checks)
        # Fixed public filter values only; request path + separate query digest.
        query='ir35=outside&remote=remote&per_page=12&sort=recent'
        def capture_api(rid):
            reply=request('/api/jobs/search?'+query,rid)
            if reply[0]==200:api.update(json.loads(reply[2]))
            return reply
        observe.case('filter-api','GET','/api/jobs/search',200,capture_api,checks=lambda h,b:{
            'liveData':api.get('data_source')=='live','boundedRows':len(api.get('jobs',[]))<=12,
            'exactFilters':all(job['ir35_status']=='outside' and job['remote_type']=='remote' for job in api.get('jobs',[]))})
        def filtered(h,b):
            actual=Page(b).jobs;expected=[job['id'] for job in api.get('jobs',[])]
            return csp_checks(h,b)|{'ssrMatchesAPI':actual==expected,'realAPIResultAvailable':api.get('data_source')=='live'}
        observe.case('filtered-ssr','GET','/jobs',200,lambda rid:get('/jobs?'+query,rid),checks=filtered)
        observe.case('sitemap','GET','/sitemap.xml',200,lambda rid:get('/sitemap.xml',rid),checks=lambda h,b:sitemap_checks(b))
        observe.case('robots','GET','/robots.txt',200,lambda rid:get('/robots.txt',rid),checks=lambda h,b:{'privateDisallows':all(text in b for text in (b'Disallow: /dashboard',b'Disallow: /admin',b'Disallow: /api/'))})
        observe.case('llms','GET','/llms.txt',200,lambda rid:get('/llms.txt',rid),checks=lambda h,b:{'identifiesSite':b'IR35Careers' in b,'linksSitemap':b'/sitemap.xml' in b})
        observe.case('favicon','GET','/favicon.ico',200,lambda rid:get('/favicon.ico',rid),checks=lambda h,b:{'nonempty':len(b)>0,'imageType':h.get('content-type','').startswith('image/')})
        assets=Page(pages.get('/jobs',(None,None,b''))[2]).assets
        selected=[next((asset for asset in assets if asset.endswith(suffix)),None) for suffix in ('.js','.css')]
        for suffix,path in zip(('js','css'),selected):
            if path is None:
                def absent(_):raise RuntimeError('SSRAssetReferenceMissing')
                observe.case('asset-'+suffix,'GET','/_next/static/{buildAsset}',200,absent)
            else:observe.case('asset-'+suffix,'GET','/_next/static/{buildAsset}',200,lambda rid,path=path:get(path,rid),checks=lambda h,b:{'nonempty':len(b)>0})
        def health(h,b):
            body=json.loads(b)
            return {'buildSHA':body.get('buildSHA')==data['build']['sourceSHA'],'oracleCoreReady':all(body.get('checks',{}).get(name)=='ready' for name in ('database','auth','storage')),
                    'pendingServicesReportedHonestly':all(body.get('checks',{}).get(name)=='not-configured' for name in ('realtime','worker'))}
        observe.case('health-partial','GET','/api/health',503,lambda rid:get('/api/health',rid),checks=health)
        result.update(status='PASS' if all(row['passed'] for row in observe.records) else 'FAIL',cases=observe.records,
                      publicQuerySHA256=hashlib.sha256(query.encode()).hexdigest(),assetsChecked=len([path for path in selected if path]),
                      wholeStackReady=False,p6ReviewStillRequired=True)
    except Exception as error:result.update(code=type(error).__name__,cases=observe.records)
    # Audit requests are reads, but unchanged-data claims still require proof.
    try:
        containment,pristine,fixture=fidelity(data,runtime)
        store.put(stage,'pristine-fidelity.json',json.dumps(pristine).encode());store.put(stage,'fixture-fidelity.json',json.dumps(fixture).encode())
        result['containment']=containment
        if containment['status']!='PASS':result['status']='FAIL'
    except Exception as error:result.update(status='FAIL',containmentError=type(error).__name__)
    store.put(stage,'result.json',json.dumps(result,sort_keys=True).encode());anchor=store.seal(stage)
    return result|{'manifestSHA256':anchor,'journal':str(journal),'stage':stage.name}
