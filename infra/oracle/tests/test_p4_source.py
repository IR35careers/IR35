from pathlib import Path
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import p4_source


class Snapshot:
    snapshot='00000001-00000002-1'
    def __init__(self,changed=False):self.calls=[];self.sequences=0;self.changed=changed;self.pending=None
    def send(self,sql):self.calls.append(sql);self.pending=sql
    def line(self):
        import json
        if ' AS inventory;' in self.pending:
            return json.dumps({'version':1,'largeObjectCount':'0','tables':[{'schema':s,'name':'fixture','columns':['id'],'primaryKey':['id']} for s in ('public','auth','storage')],
                'sequences':[{'schema':'public','name':'fixture_seq'}]}).encode()
        if 'last_value' in self.pending:
            self.sequences+=1
            return json.dumps({'lastValue':str(2 if self.changed and self.sequences>1 else 1),'isCalled':True}).encode()
        return b'{"encoding":"UTF8","unicodeRoundTripMD5":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","collation":{}}'


class SourceTests(unittest.TestCase):
    def test_every_table_uses_same_exported_snapshot_and_source_is_read_only(self):
        snapshot=Snapshot();calls=[]
        def stream(args,environment,sql):
            calls.append(sql)
            return {'algorithm':'pg17-copy-binary-framed-text-v1','rows':'0','md5':'a'*32,'serializedBytes':'21'}
        with patch.object(p4_source.fp,'fingerprint',side_effect=stream):
            result=p4_source.collect(snapshot,{})
            self.assertEqual(len(result['tables']),3)
        self.assertEqual(len(calls),3)
        self.assertTrue(all("SET TRANSACTION SNAPSHOT '00000001-00000002-1'" in sql and 'REPEATABLE READ READ ONLY' in sql and 'ROLLBACK;' in sql for sql in calls))
        with patch.object(p4_source.fp,'fingerprint',side_effect=stream):
            with self.assertRaisesRegex(RuntimeError,'sequence changed'):p4_source.collect(Snapshot(True),{})


if __name__=='__main__':unittest.main()
