from pathlib import Path
import sys
import unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import p8_bucket_metadata_diagnosis as diagnosis
from key_ceremony import KeySafetyError


class BucketDiagnosisTests(unittest.TestCase):
    def test_only_explicit_public_flags_preserve_null_and_missing(self):
        result=diagnosis.project({'is-read-only':None,'auto-tiering':'Disabled','password':'PRIVATE',
            'kms-key-id':'PRIVATE-NOT-PRINTED','compartment-id':'wrong'})
        self.assertEqual(result['is-read-only'],{'present':True,'value':None})
        self.assertEqual(result['replication-enabled'],{'present':False,'value':None})
        self.assertEqual(result['kms-key-id'],{'present':True,'configured':True})
        self.assertNotIn('PRIVATE',str(result))
        self.assertFalse(result['compartment-id']['matchesApproved'])

    def test_unexpected_values_fail_without_echo(self):
        for value in ('PRIVATE',{'token':'PRIVATE'},['PRIVATE'],3):
            with self.assertRaises(KeySafetyError) as error:
                diagnosis.project({'versioning':value})
            self.assertNotIn('PRIVATE',str(error.exception))


if __name__=='__main__':unittest.main()
