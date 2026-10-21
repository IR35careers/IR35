"""Read-only protection/runtime audit after P3 role repair; no service restart."""
import json
from pathlib import Path
import cloud_schema as schema

GUEST = r'''
result=subprocess.run(['docker','compose','--env-file',str(ENV),'-f',str(ROOT/'compose.yml'),'ps','--format','json'],capture_output=True,text=True,timeout=30)
if result.returncode:raise RuntimeError('Runtime read-back failed; output withheld')
rows=[json.loads(line) for line in result.stdout.splitlines() if line.strip()]
services={row['Service']:{'state':row.get('State'),'health':row.get('Health')} for row in rows}
if set(services)!={'db','auth','rest','realtime','storage','kong','meta','smtp','caddy'}:
 raise RuntimeError('Unexpected running staging service set')
hosts={}
for host in ('staging.ir35careers.com','api-staging.ir35careers.com'):
 try:
  response=urllib.request.urlopen('https://'+host+'/',context=ssl.create_default_context(),timeout=20)
  code,headers=response.status,response.headers
 except urllib.error.HTTPError as error:
  code,headers=error.code,error.headers
 hosts[host]={'status':code,'basicAuth':headers.get('WWW-Authenticate','').lower().startswith('basic '),
   'noindex':'noindex' in headers.get('X-Robots-Tag','').lower(),'verifiedTLS':True}
if any(row['state']!='running' or row['health'] not in ('','healthy') for row in services.values()) or any(row['status']!=401 or not row['basicAuth'] or not row['noindex'] for row in hosts.values()):
 raise RuntimeError('Protected staging runtime gate failed')
values=read_env()
components={}
for row in rows:
 name=row['Service'];path=ROOT/('.env.'+name);s=path.lstat()
 if not stat.S_ISREG(s.st_mode) or s.st_uid!=1002 or stat.S_IMODE(s.st_mode)!=0o600 or s.st_nlink!=1:
  raise RuntimeError('Component env custody mismatch')
 data={}
 for line in path.read_text().splitlines():
  match=re.fullmatch(r"([A-Z][A-Z0-9_]*)='([^'\r\n]*)'",line)
  if not match or match[1] in data:raise RuntimeError('Invalid private component env; values withheld')
  data[match[1]]=match[2]
 state=subprocess.run(['docker','inspect','--format','{{json .State}}',row['ID']],capture_output=True,text=True,timeout=10)
 if state.returncode:raise RuntimeError('Container bind audit failed; output withheld')
 pid=json.loads(state.stdout)['Pid']
 mounted=(Path('/proc')/str(pid)/'root'/path.relative_to('/')).stat()
 if (s.st_dev,s.st_ino)!=(mounted.st_dev,mounted.st_ino):raise RuntimeError('Stale component env bind')
 components[name]=data
from urllib.parse import urlsplit
for service,key in (('auth','GOTRUE_DB_DATABASE_URL'),('rest','PGRST_DB_URI'),('storage','DATABASE_URL')):
 uri=urlsplit(components[service][key])
 if uri.hostname!='db' or uri.port!=5432 or uri.path!='/postgres':raise RuntimeError('Unexpected database attached to services')
if components['realtime']['DB_NAME']!='postgres' or components['meta']['PG_META_DB_NAME']!='postgres' or components['db']['PGDATABASE']!='postgres':
 raise RuntimeError('Unexpected service database name')
sink=components['auth'].get('GOTRUE_SMTP_HOST')=='smtp' and components['auth'].get('GOTRUE_SMTP_PORT')=='1025' and not components['auth'].get('GOTRUE_SMTP_PASS')
if not sink:raise RuntimeError('Staging SMTP sink changed; stop')
print(json.dumps({'status':'PASS','checkedAt':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'services':services,'hosts':hosts,'applyRunner':values['APPLY_RUNNER'],
 'applicationWorkerAcceptJobs':values['APPLICATION_WORKER_ACCEPT_JOBS']!='false','smtpSinkConfigured':sink,'studioRunning':'studio' in services,'newDatabaseAttachedToServices':False,
 'componentEnvBindAndDatabaseChecks':True,
 'sourceWrites':0,'stagingWrites':0,'phaseComplete':False}))
'''

if __name__=='__main__':
    try:
        result=schema.run_guest(schema.guest_bundle()+GUEST,timeout=120)
        path=Path(schema.REPO)/'docs/evidence/oracle-p3-acl-runtime.json'
        path.write_text(json.dumps(result,indent=2)+'\n')
        print(json.dumps({'status':'PASS','report':'docs/evidence/oracle-p3-acl-runtime.json','sourceWrites':0,'stagingWrites':0}))
    except Exception as error:
        print(json.dumps({'status':'FAIL','code':type(error).__name__,'rawOutput':'withheld'}));raise SystemExit(1)
