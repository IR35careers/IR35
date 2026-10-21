from pathlib import Path
import sys
import unittest

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import p4_preflight


class TransportTests(unittest.TestCase):
    def test_no_platform_exception_for_missing_or_changed_transport_object(self):
        source={'version':1,'checkedAt':'source','objects':[{'kind':'publication','name':'fixture','hash':'a'*32}]}
        target={'version':1,'checkedAt':'target','objects':[{'kind':'publication','name':'fixture','hash':'a'*32}]}
        self.assertEqual(p4_preflight.compare(source,target)['status'],'PASS')
        target['objects'][0]['hash']='b'*32
        self.assertEqual(p4_preflight.compare(source,target)['status'],'FAIL')
        target['objects'].append(target['objects'][0])
        with self.assertRaises(ValueError):p4_preflight.compare(source,target)
        target['objects']=[]
        with self.assertRaises(ValueError):p4_preflight.compare(source,target)
        target['objects']=[source['objects'][0]|{'definition':'private'}]
        with self.assertRaises(ValueError):p4_preflight.compare(source,target)


if __name__=='__main__':unittest.main()
