"""Full-copy staging rehearsal. Cloud is read-only; no production destination."""
import base64
from datetime import datetime,timezone
import hashlib
import inspect
import json
from pathlib import Path
import sys
import time
import os
import re
import acl_repair
import cloud_schema as schema
import data_fingerprint as fp
import effective_privileges
import extension_security
import fidelity_gate
import owner_parity
import p4_source
import p4_preflight
import storage_source

TARGETS={1:'ir35_rehearsal_a_20261021',2:'ir35_rehearsal_b_20261021'}
EXPIRY_SQL="SELECT jsonb_object_agg(rolname,jsonb_build_object('hash',md5(coalesce((rolvaliduntil AT TIME ZONE 'UTC')::text,'NULL')),'configured',rolvaliduntil IS NOT NULL,'finite',coalesce(isfinite(rolvaliduntil),false)) ORDER BY rolname) FROM pg_roles WHERE rolname !~ '^pg_';"


def gates():
    native=json.loads((schema.REPO/'docs/evidence/oracle-p3-owner-fidelity.json').read_text())
    transport=json.loads((schema.REPO/'docs/evidence/oracle-p4-schema-preflight.json').read_text())
    if native.get('status')!='PASS' or transport.get('status')!='PASS':raise ValueError('P3 schema/extended transport gates required')
    for gate in native['gates'].values():
        if gate.get('unexplainedDifferences')!=[] or gate.get('conditionsPASS') is not True:raise ValueError('No unresolved schema/security difference permitted')


def capture(key):
    environment=schema.source_environment()
    with schema.Snapshot(environment) as snapshot:
        rows=p4_source.collect(snapshot,environment)
        source={}
        for field,path in (('catalog','oracle_schema_catalog.sql'),('transport','oracle_transport_catalog.sql'),('extensions','oracle_extension_security.sql'),('privileges','oracle_effective_privileges.sql')):
            snapshot.send((schema.REPO/'supabase/verification'/path).read_text());source[field]=json.loads(snapshot.line())
        snapshot.send(EXPIRY_SQL);source['roleExpiry']=json.loads(snapshot.line())
        snapshot.send("SELECT to_char(rolvaliduntil AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS.US')||'+00' FROM pg_roles WHERE rolname='cli_login_postgres' AND isfinite(rolvaliduntil);")
        source['expiry']=snapshot.line().decode()
        storage=storage_source.collect(snapshot,key)
        archive=schema.native('pg_dump',['--no-password','--role=postgres','--format=custom','--snapshot='+snapshot.snapshot],environment,maximum=256_000_000)
        if not archive.startswith(b'PGDMP'):raise ValueError('Native custom archive required')
        if rows['sequences']!=p4_source.sequence_values(snapshot,rows['inventory']):raise RuntimeError('Source sequence moved during dump; abort inconsistent capture')
        with schema.Snapshot(environment) as current:
            current.send(storage_source.SQL)
            if json.loads(current.line())!=storage['metadata']:raise RuntimeError('Source Storage changed during dump; abort inconsistent capture')
    for obj in storage['privateObjects']:obj['body']=base64.b64encode(obj['body']).decode()
    source.update(rows=rows,storage=storage,snapshotBound=True,sequenceStable=True,storageStable=True)
    return archive,source


GUEST=r'''
cycle=CYCLE;name=TARGET
ledger_path=ROOT/'config/p4-rehearsal.json'
ledger=json.loads(ledger_path.read_text()) if ledger_path.exists() else {'purpose':'ir35-owner-full-copy-rehearsal','cycles':{}}
if ledger.get('purpose')!='ir35-owner-full-copy-rehearsal':raise RuntimeError('Rehearsal journal identity mismatch')
if str(cycle) in ledger['cycles']:raise RuntimeError('Cycle already journalled; reconcile only, never replay or overwrite')
if cycle==2 and ledger['cycles'].get('1',{}).get('status')!='WIPED':raise RuntimeError('Cycle1 must PASS and wipe before cycle2')
source=SOURCE;archive=base64.b64decode(ARCHIVE,validate=True)
if hashlib.sha256(archive).hexdigest()!=ARCHIVE_HASH:raise RuntimeError('Archive byte hash mismatch')
if {o['kind']+':'+o['name']:o['hash'] for o in source['catalog']['objects']}!={o['kind']+':'+o['name']:o['hash'] for o in cloud['objects']}:
 raise RuntimeError('Cloud schema changed since verified baseline; no data import')
usage=role_usage()
def execute(sql,database='postgres',transaction=True,log=None):
 if database not in ('postgres',name):raise RuntimeError('Fixed rehearsal destination only')
 args=base+['psql','-XqAt','-v','ON_ERROR_STOP=1','-v','VERBOSITY=sqlstate','-U','supabase_admin','-d',database,'-f','-']
 if transaction:args.append('--single-transaction')
 result=subprocess.run(args,input=sql,capture_output=True,text=True,timeout=180)
 if log:log.write(result.stdout.encode());log.write(result.stderr.encode());log.flush();os.fsync(log.fileno())
 if result.returncode:raise RuntimeError('Rehearsal SQL failed; full protected log only, never skip')
 return result.stdout
def catalog(database):return json.loads(execute('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; SET LOCAL search_path=pg_catalog;\n'+CATALOG_SQL+'\nROLLBACK;',database,False))
def read(sql,database=name):return execute('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; '+SETTINGS+sql+' ROLLBACK;',database,False)
roles=lambda cat:{x['kind']+':'+x['name']:x['hash'] for x in cat['objects'] if x['kind'] in ('role','role-membership')}
if roles(catalog('postgres'))!=roles(source['catalog']):raise RuntimeError('Cluster roles differ beyond approved expiry; no import')
if execute("SELECT 1 FROM pg_database WHERE datname='"+name+"';").strip():raise RuntimeError('Unowned rehearsal database collision; no overwrite')
until=source['expiry']
if not re.fullmatch(r'\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{6}\+00',until):raise RuntimeError('Canonical finite snapshot expiry required')
# This is the same approved unused-role expiry-only alignment, never a password.
execute('ALTER ROLE "cli_login_postgres" VALID UNTIL '+literal(until)+';')
if json.loads(read(EXPIRY_SQL,'postgres'))!=source['roleExpiry']:raise RuntimeError('Exact role expiry mismatch; STOP')
entry={'status':'TRANSFER_PENDING','target':name,'archiveSHA256':ARCHIVE_HASH,'attempts':1,'customerData':True}
ledger['cycles'][str(cycle)]=entry;write(ledger_path,json.dumps(ledger),0o600)
def private_file(path,body):
 fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
 with os.fdopen(fd,'wb') as stream:
  os.fchown(stream.fileno(),1002,1002);stream.write(body);stream.flush();os.fsync(stream.fileno())
dump_path=ROOT/('.env.p4-cycle'+str(cycle)+'.dump');bundle_path=ROOT/('.env.p4-cycle'+str(cycle)+'-source.json')
private_file(dump_path,archive);private_file(bundle_path,json.dumps(source,sort_keys=True).encode())
state['dataRehearsalStarted']=True;write(STATE,json.dumps(state),0o600)
entry['status']='CREATE_PENDING';write(ledger_path,json.dumps(ledger),0o600)
execute('CREATE DATABASE '+name+" WITH OWNER postgres TEMPLATE template0 ENCODING 'UTF8' LC_COLLATE 'en_US.UTF-8' LC_CTYPE 'en_US.UTF-8' LOCALE_PROVIDER icu ICU_LOCALE 'en-US';",transaction=False)
logpath=ROOT/('.env.p4-cycle'+str(cycle)+'-restore.log')
fd=os.open(logpath,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600);os.fchown(fd,1002,1002)
entry['status']='RESTORE_PENDING';write(ledger_path,json.dumps(ledger),0o600)
with os.fdopen(fd,'wb') as log:
 result=subprocess.run(base+['pg_restore','--no-password','--verbose','--single-transaction','--exit-on-error','--username=supabase_admin','--dbname='+name],input=archive,stdout=log,stderr=log,timeout=300)
 log.flush();os.fsync(log.fileno())
 if result.returncode:raise RuntimeError('Rehearsal restore failed; retain private evidence/rows, no replay')
 normalized=normalize_restored_cloud(execute,catalog,source['catalog'],name,log)
entry['status']='RESTORED';entry['logSHA256']=hashlib.sha256(logpath.read_bytes()).hexdigest();write(ledger_path,json.dumps(ledger),0o600)
target_catalog=catalog(name)
extension=extension_compare(source['extensions'],json.loads(read(EXTENSION_SQL)))
privileges=privilege_compare(source['privileges'],json.loads(read(PRIVILEGE_SQL)))
schema_gate=fidelity_compare(source['catalog'],target_catalog,extension,privileges,json.loads(read(EXPIRY_SQL))==source['roleExpiry'])
transport=transport_compare(source['transport'],json.loads(read(TRANSPORT_SQL)))
if schema_gate['status']=='FAIL' or transport['status']!='PASS':
 entry['status']='SCHEMA_FAIL';write(ledger_path,json.dumps(ledger),0o600)
 print(json.dumps({'status':'FAIL','schema':schema_gate,'transport':transport,'sourceWrites':0,'phaseComplete':False}));sys.exit(1)
inventory=json.loads(read(INVENTORY_SQL))
if inventory!=source['rows']['inventory']:raise RuntimeError('Target table/column/key inventory mismatch; abort')
tables=[]
for table in inventory['tables']:
 sql='BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; '+SETTINGS+copy_sql(table)+' ROLLBACK;'
 value=fingerprint(base+['psql','-XqAt','-v','ON_ERROR_STOP=1','-U','supabase_admin','-d',name,'-f','-'],{'PATH':'/usr/sbin:/usr/bin:/sbin:/bin','LC_ALL':'C.UTF-8'},sql)
 tables.append({'name':table['schema']+'.'+table['name'],**value})
sequences=[]
for seq in inventory['sequences']:
 value=json.loads(read("SELECT jsonb_build_object('lastValue',last_value::text,'isCalled',is_called) FROM "+identifier(seq['schema'])+'.'+identifier(seq['name'])+';'))
 sequences.append({'name':seq['schema']+'.'+seq['name'],**value})
differences=[]
if source['rows']['tables']!=tables:
 a={x['name']:x for x in source['rows']['tables']};b={x['name']:x for x in tables}
 differences.extend('table:'+key for key in sorted(a.keys()|b.keys()) if a.get(key)!=b.get(key))
if source['rows']['sequences']!=sequences:differences.append('sequences')
if differences:
 entry['status']='DATA_FAIL';write(ledger_path,json.dumps(ledger),0o600)
 print(json.dumps({'status':'FAIL','differences':differences,'sourceWrites':0,'phaseComplete':False}));sys.exit(1)
entry['status']='TABLES_VERIFIED';write(ledger_path,json.dumps(ledger),0o600)
print(json.dumps({'status':'TABLES_VERIFIED','schema':schema_gate,'transport':transport,'tables':tables,
 'sequenceChecks':len(sequences),'authTableChecks':sum(x['name'].startswith('auth.') for x in tables),'roleUsage':usage,
 'extensionChecks':extension,'privileges':privileges,'dataDifferences':[],'sourceWrites':0,'target':name,'cycle':cycle,
 'archiveSHA256':ARCHIVE_HASH,'privateArchive':str(dump_path),'privateBundle':str(bundle_path),'privateLog':str(logpath),
 'phaseComplete':False,'storageTargetVerified':False,'testAccountLogin':False,'stagingWiped':False}))
'''


def guest_source(cycle,archive,source):
    align='\n\n'.join(inspect.getsource(fn) for fn in (acl_repair.identifier,acl_repair.literal,acl_repair.normalize_restored_cloud))
    modules=Path(fp.__file__).read_text()+'\n'+align+'\n'+Path(extension_security.__file__).read_text()+'\nextension_compare=compare\n'+Path(effective_privileges.__file__).read_text()+'\nprivilege_compare=compare\n'+Path(fidelity_gate.__file__).read_text().replace('import extension_security','').replace('extension_security.EXTENSIONS','EXTENSIONS')+'\nfidelity_compare=compare\n'+inspect.getsource(p4_preflight.compare)+'\ntransport_compare=compare\n'
    replacements={'CYCLE':repr(cycle),'TARGET':repr(TARGETS[cycle]),'SOURCE':repr(source),
      'ARCHIVE_HASH':repr(hashlib.sha256(archive).hexdigest()),'ARCHIVE':repr(base64.b64encode(archive).decode()),'EXPIRY_SQL':repr(EXPIRY_SQL)}
    for token,path in (('EXTENSION_SQL','oracle_extension_security.sql'),('PRIVILEGE_SQL','oracle_effective_privileges.sql'),('TRANSPORT_SQL','oracle_transport_catalog.sql'),('INVENTORY_SQL','oracle_data_inventory.sql')):
        replacements[token]=repr((schema.REPO/'supabase/verification'/path).read_text())
    # One pass only: never replace token-like text inside customer filenames or
    # base64 bytes inserted by another replacement.
    script=re.sub(r'\b('+'|'.join(replacements)+r')\b',lambda match:replacements[match[0]],GUEST)
    return schema.guest_bundle(rehearsal=True)+owner_parity.BASE+modules+script


def main():
    gates()
    if sys.argv[1:]==['--dry-run']:
        print(json.dumps({'status':'DRY_RUN','sourceWrites':0,'stagingWrites':0,'productionDestinations':False,'cycles':2,'phaseComplete':False}));return
    if sys.argv[1:] not in (['--staging','--cycle','1'],['--staging','--cycle','2']):raise ValueError('Explicit fixed staging cycle required; production destination refused')
    cycle=int(sys.argv[-1]);key=os.environ.pop('IR35_SOURCE_STORAGE_KEY',None)
    if not key:raise ValueError('Private local source Storage read credential required')
    started=time.monotonic();archive,source=capture(key);key=None
    result=schema.run_guest(guest_source(cycle,archive,source),timeout=600)
    result.update(durationSeconds=round(time.monotonic()-started,3),sourceCheckedAt=source['catalog']['checkedAt'])
    path=schema.REPO/('docs/evidence/oracle-p4-cycle'+str(cycle)+'.json')
    path.write_text(json.dumps(result,indent=2)+'\n')
    if result.get('status')!='TABLES_VERIFIED':raise RuntimeError('Rehearsal comparison FAIL; no edits, truncation, retry or wipe')
    print(json.dumps({'status':'PASS','operation':'p4-rehearse-'+str(cycle),'report':str(path.relative_to(schema.REPO)),'objects':len(result['tables']),'sourceWrites':0}))


if __name__=='__main__':
    try:main()
    except Exception as error:
        print(json.dumps({'status':'FAIL','code':type(error).__name__,'rawOutput':'withheld'}));raise SystemExit(1)
