import hashlib
from pathlib import Path
import struct
import sys
import unittest

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import data_fingerprint as fp


def binary(rows):
    return b'PGCOPY\n\xff\r\n\x00'+b'\x00'*8+b''.join(struct.pack('!hi',1,len(row))+row for row in rows)+struct.pack('!h',-1)


class FingerprintTests(unittest.TestCase):
    def test_binary_counter_accepts_every_split_and_empty_rows_without_retaining_data(self):
        for rows in ([],[b''],[b'N;',b'V4:caf\xc3\xa9;',b'V4:\xf0\x9f\x98\x80;',b'a'*10000]):
            body=binary(rows)
            for size in (1,2,3,5,19,65536):
                counter=fp.BinaryCounter()
                for start in range(0,len(body),size):counter.update(body[start:start+size])
                self.assertEqual(counter.finish(),len(rows))
                self.assertEqual(counter.buffer,b'')
        with self.assertRaises(ValueError):
            counter=fp.BinaryCounter();counter.update(binary([])[:-1]);counter.finish()
        with self.assertRaises(ValueError):fp.BinaryCounter().update(binary([])+b'private')

    def test_order_framing_null_and_column_quoting_are_explicit(self):
        table={'schema':'public','name':'fixture','columns':['id','with"quote','nullable'],'primaryKey':['id']}
        sql=fp.copy_sql(table)
        self.assertIn('ORDER BY t."id" NULLS FIRST',sql)
        self.assertIn('t."with""quote"',sql)
        self.assertIn("THEN 'N;'",sql)
        self.assertIn('octet_length(convert_to(',sql)
        self.assertIn('FORMAT binary',sql)
        table['primaryKey']=[]
        self.assertIn('::text COLLATE "C" NULLS FIRST',fp.copy_sql(table))
        table['columns'].append('id')
        with self.assertRaises(ValueError):fp.copy_sql(table)
        self.assertNotEqual(hashlib.md5(binary([b'N;'])).hexdigest(),hashlib.md5(binary([b'V0:;'])).hexdigest())


if __name__=='__main__':unittest.main()
