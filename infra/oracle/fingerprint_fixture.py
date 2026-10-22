"""Native ARM synthetic/transaction-rollback proof; no customer data."""
import hashlib
import json
from pathlib import Path
import struct
import data_fingerprint as fp
import cloud_schema as schema
import owner_parity


def run():
    table={'schema':'pg_temp','name':'ir35_hash_fixture','columns':['id','label','payload'],'primaryKey':['id']}
    rows=[b'V1:1;V10:caf\xc3\xa9 \xf0\x9f\x98\x80;N;',b'V1:2;V0:;V6:\\x00ff;']
    binary=b'PGCOPY\n\xff\r\n\x00'+b'\x00'*8+b''.join(struct.pack('!hi',1,len(row))+row for row in rows)+struct.pack('!h',-1)
    sql="BEGIN; "+fp.SETTINGS+" CREATE TEMP TABLE ir35_hash_fixture(id integer PRIMARY KEY,label text,payload bytea); INSERT INTO ir35_hash_fixture VALUES (2,'',decode('00ff','hex')),(1,'café 😀',NULL); "+fp.copy_sql(table)+" ROLLBACK;"
    guest=Path(fp.__file__).read_text()+r'''
result=fingerprint(base+['psql','-XqAt','-v','ON_ERROR_STOP=1','-U','supabase_admin','-d','ir35_baseline_proof_20261021','-f','-'],
 {'PATH':'/usr/sbin:/usr/bin:/sbin:/bin','LC_ALL':'C.UTF-8'},FIXTURE_SQL)
if result['md5']!=EXPECTED_MD5 or result['rows']!='2':raise RuntimeError('Native fingerprint fixture mismatch; no customer-data export')
print(json.dumps({'status':'PASS','algorithm':ALGORITHM,'nativeARM':True,'rows':result['rows'],'md5':result['md5'],
 'serializedBytes':result['serializedBytes'],'transactionRolledBack':True,'sourceWrites':0,'customerRowsImported':0,'phaseComplete':False}))
'''
    guest=guest.replace('FIXTURE_SQL',repr(sql)).replace('EXPECTED_MD5',repr(hashlib.md5(binary).hexdigest()))
    result=schema.run_guest(schema.guest_bundle()+owner_parity.BASE+guest,timeout=180)
    (schema.REPO/'docs/evidence/oracle-p4-fingerprint-fixture.json').write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps({'status':'PASS','report':'docs/evidence/oracle-p4-fingerprint-fixture.json','sourceWrites':0,'customerRowsImported':0}))


if __name__=='__main__':
    try:run()
    except Exception as error:
        print(json.dumps({'status':'FAIL','code':type(error).__name__,'rawOutput':'withheld'}));raise SystemExit(1)
