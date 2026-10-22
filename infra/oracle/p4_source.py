"""Read-only every-table source fingerprint, reusable inside one dump snapshot."""
import hashlib
import json
import re
import time
import cloud_schema as schema
import data_fingerprint as fp


def sequence_values(snapshot,inventory):
    result=[]
    for sequence in inventory['sequences']:
        name=sequence['schema']+'.'+sequence['name']
        sql="SELECT jsonb_build_object('lastValue',last_value::text,'isCalled',is_called) FROM "+fp.identifier(sequence['schema'])+'.'+fp.identifier(sequence['name'])+';'
        snapshot.send(sql);value=json.loads(snapshot.line())
        result.append({'name':name,**value})
    return result


def collect(snapshot,environment):
    snapshot.send(fp.SETTINGS)
    snapshot.send((schema.REPO/'supabase/verification/oracle_data_inventory.sql').read_text())
    inventory=json.loads(snapshot.line())
    if inventory.get('version')!=1 or not inventory.get('tables') or inventory.get('largeObjectCount')!='0':
        raise ValueError('Complete table inventory/large-object support required; no partial PASS')
    tables=inventory['tables'];keys=[(x['schema'],x['name']) for x in tables]
    if len(set(keys))!=len(keys) or not {'public','auth','storage'}.issubset({key[0] for key in keys}):
        raise ValueError('Duplicate/incomplete source table inventory')
    before=sequence_values(snapshot,inventory)
    results=[]
    for table in tables:
        if not re.fullmatch(r'[0-9A-Fa-f]{8}-[0-9A-Fa-f]{8}-[0-9]+',snapshot.snapshot):raise ValueError('Exported snapshot identifier required')
        sql="BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; SET TRANSACTION SNAPSHOT '"+snapshot.snapshot+"'; SET LOCAL ROLE postgres; "+fp.SETTINGS+fp.copy_sql(table)+' ROLLBACK;'
        record=fp.fingerprint([schema.PG+'psql','-XqAt','--no-password','-v','ON_ERROR_STOP=1','-v','VERBOSITY=sqlstate','-f','-'],environment,sql)
        results.append({'name':table['schema']+'.'+table['name'],**record})
    after=sequence_values(snapshot,inventory)
    if before!=after:raise RuntimeError('Source sequence changed during capture; inconsistent snapshot, no rehearsal PASS')
    # Synthetic read-only encoding round-trip; never inserts/edits customer rows.
    snapshot.send("SELECT jsonb_build_object('encoding',current_setting('server_encoding'),'unicodeRoundTripMD5',md5(convert_from(convert_to('😀 café Ελληνικά 日本語 العربية','UTF8'),'UTF8')),'collation',(SELECT jsonb_build_object('collate',datcollate,'ctype',datctype,'provider',datlocprovider,'locale',datlocale) FROM pg_database WHERE datname=current_database()));")
    metadata=json.loads(snapshot.line())
    return {'tables':results,'sequences':before,'inventory':inventory,'metadata':metadata}


def run():
    gate=json.loads((schema.REPO/'docs/evidence/oracle-p4-schema-preflight.json').read_text())
    if gate.get('status')!='PASS':raise RuntimeError('P4 extended schema gate must pass before reading customer rows')
    started=time.monotonic();environment=schema.source_environment()
    with schema.Snapshot(environment) as snapshot:
        result=collect(snapshot,environment)
        snapshot.send("SELECT to_char(transaction_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"');")
        checked=snapshot.line().decode()
    public={'status':'SOURCE_CAPTURE_ONLY','phaseComplete':False,'snapshotBound':True,'sourceCheckedAt':checked,
      'tables':result['tables'],'sequences':[{'name':x['name'],'hash':hashlib.md5(json.dumps(x,sort_keys=True,separators=(',',':')).encode()).hexdigest()} for x in result['sequences']],
      'tableCount':len(result['tables']),'sequenceCount':len(result['sequences']),'sequenceStable':True,
      'encoding':result['metadata']['encoding'],'unicodeRoundTripMD5':result['metadata']['unicodeRoundTripMD5'],
      'durationSeconds':round(time.monotonic()-started,3),'sourceWrites':0,'stagingWrites':0,'customerRowsImported':0,
      'storageBytesVerified':False,'targetCompared':False,'zeroLossVerified':False}
    path=schema.REPO/'docs/evidence/oracle-p4-source-fingerprints.json'
    path.write_text(json.dumps(public,indent=2)+'\n')
    print(json.dumps({'status':'PASS','operation':'p4-source-fingerprints','report':'docs/evidence/oracle-p4-source-fingerprints.json','objects':len(result['tables']),'sourceWrites':0}))
