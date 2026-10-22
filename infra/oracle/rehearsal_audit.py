"""Read-only post-startup fidelity audit. No restore, role or service writes."""
import json
import re
import sys
import cloud_schema as schema
import owner_parity
import rehearsal

GUEST=r'''
name='ir35_rehearsal_a_20261021'
ledger=json.loads((ROOT/'config/p4-rehearsal.json').read_text());entry=ledger['cycles']['1']
if entry.get('target')!=name:raise RuntimeError('Fixed target identity required')
path=ROOT/'.env.p4-cycle1-source.json';s=path.lstat()
if not stat.S_ISREG(s.st_mode) or s.st_uid!=1002 or stat.S_IMODE(s.st_mode)!=0o600 or s.st_nlink!=1:raise RuntimeError('Private source custody required')
source=json.loads(path.read_text())
def read(sql):
 result=subprocess.run(base+['psql','-XqAt','-v','ON_ERROR_STOP=1','-U','supabase_admin','-d',name,'-f','-'],input='BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; '+SETTINGS+sql+' ROLLBACK;',capture_output=True,text=True,timeout=120)
 if result.returncode:raise RuntimeError('Audit SQL failed; raw values withheld')
 return result.stdout
target=json.loads(read(CATALOG_SQL))
ext=extension_compare(source['extensions'],json.loads(read(EXTENSION_SQL)))
priv=privilege_compare(source['privileges'],json.loads(read(PRIVILEGE_SQL)))
fidelity=fidelity_compare(source['catalog'],target,ext,priv,json.loads(read(EXPIRY_SQL))==source['roleExpiry'])
transport=transport_compare(source['transport'],json.loads(read(TRANSPORT_SQL)))
inventory=json.loads(read(INVENTORY_SQL));tables=[]
if inventory!=source['rows']['inventory']:raise RuntimeError('Table inventory mismatch; STOP')
sequences=[]
for seq in inventory['sequences']:
 value=json.loads(read("SELECT jsonb_build_object('lastValue',last_value::text,'isCalled',is_called) FROM "+identifier(seq['schema'])+'.'+identifier(seq['name'])+';'))
 sequences.append({'name':seq['schema']+'.'+seq['name'],**value})
for table in inventory['tables']:
 sql='BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; '+SETTINGS+copy_sql(table)+' ROLLBACK;'
 value=fingerprint(base+['psql','-XqAt','-v','ON_ERROR_STOP=1','-U','supabase_admin','-d',name,'-f','-'],{'PATH':'/usr/sbin:/usr/bin:/sbin:/bin','LC_ALL':'C.UTF-8'},sql)
 tables.append({'name':table['schema']+'.'+table['name'],**value})
a={x['name']:x for x in source['rows']['tables']};b={x['name']:x for x in tables}
differences=[key for key in sorted(a.keys()|b.keys()) if a.get(key)!=b.get(key)]
if sequences!=source['rows']['sequences']:differences.append('sequences')
latest=read('SELECT name FROM storage.migrations ORDER BY id DESC LIMIT 1;').strip()
print(json.dumps({'status':'PASS' if not differences and fidelity['status']!='FAIL' and transport['status']=='PASS' else 'FAIL',
 'schema':fidelity,'transport':transport,'extensionChecks':ext,'privileges':priv,'tableChecks':len(tables),'dataDifferences':differences,
 'sequenceChecks':len(sequences),'storageMigrationFreeze':latest,'storageAPIAttempts':entry.get('storageAPIAttempts'),
 'sourceWrites':0,'stagingWrites':0,'phaseComplete':False}))
'''


def run():
    script=GUEST
    replacements={'EXPIRY_SQL':repr(rehearsal.EXPIRY_SQL)}
    for key,file in (('EXTENSION_SQL','oracle_extension_security.sql'),('PRIVILEGE_SQL','oracle_effective_privileges.sql'),('TRANSPORT_SQL','oracle_transport_catalog.sql'),('INVENTORY_SQL','oracle_data_inventory.sql')):
        replacements[key]=repr((schema.REPO/'supabase/verification'/file).read_text())
    script=re.sub(r'\b('+'|'.join(replacements)+r')\b',lambda m:replacements[m[0]],script)
    result=schema.run_guest(schema.guest_bundle(rehearsal=True)+owner_parity.BASE+rehearsal.verification_modules()+script,timeout=240)
    path=schema.REPO/'docs/evidence/oracle-p4-post-api-audit.json';path.write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps({'status':result['status'],'report':str(path.relative_to(schema.REPO)),'sourceWrites':0,'stagingWrites':0}))
    if result['status']!='PASS':raise SystemExit(1)


if __name__=='__main__':
    try:run()
    except Exception as error:
        print(json.dumps({'status':'FAIL','code':type(error).__name__,'rawOutput':'withheld'}));sys.exit(1)
