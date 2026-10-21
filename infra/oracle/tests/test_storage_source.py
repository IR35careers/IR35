import io
from pathlib import Path
import sys
import unittest

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import storage_source as storage


class Reply(io.BytesIO):
    status=200
    headers={'Content-Type':'application/octet-stream'}
    def geturl(self):return self.url


class Opener:
    def open(self,request,timeout):
        self.request=request
        result=Reply(b'test');result.url=request.full_url;return result


class StorageTests(unittest.TestCase):
    def test_fixed_origin_get_only_and_exact_byte_size(self):
        opener=Opener();key='controlled.private.fixture'
        result=storage.download(key,'private','folder/café.pdf',4,opener=opener)
        self.assertEqual(result['body'],b'test')
        self.assertEqual(opener.request.get_method(),'GET')
        self.assertTrue(opener.request.full_url.startswith(storage.ORIGIN+'/storage/v1/object/authenticated/private/'))
        self.assertNotIn(key,opener.request.full_url)
        with self.assertRaisesRegex(RuntimeError,'length mismatch'):storage.download(key,'private','fixture',3,opener=opener)
        with self.assertRaisesRegex(RuntimeError,'redirect refused'):storage.NoRedirect().redirect_request(None,None,None,None,None,None)
        for path in ('../private','/absolute','a/../b','a\\b','a\x00b','a\nb'):
            with self.assertRaises(ValueError):storage.object_url('private',path)
        with self.assertRaises(ValueError):storage.object_url('a/b','safe')


if __name__=='__main__':unittest.main()
