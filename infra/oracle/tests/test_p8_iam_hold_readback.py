import ast
from pathlib import Path
import sys
import unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import p8_iam_hold_readback as hold
from key_ceremony import KeySafetyError


class HoldReconciliationTests(unittest.TestCase):
    def test_exact_unchanged_public_metadata_only(self):
        value={'count':0,'statementSHA256':[]}
        self.assertTrue(hold.compare(value,dict(value))['unchanged'])
        with self.assertRaises(KeySafetyError):hold.compare(value,value|{'count':1})

    def test_source_only_lists_fixed_metadata_and_no_native_import_action(self):
        tree=ast.parse(Path(hold.__file__).read_text())
        self.assertIsNotNone(tree)
        self.assertEqual([item[0] for item in hold.CASES],['groups','root-policies','child-policies'])
        source=Path(hold.__file__).read_text()
        for bad in ('subprocess','ApprovedApi','run_remote','--force','create-group','put-lifecycle'):
            self.assertNotIn(bad,source)


if __name__=='__main__':unittest.main()
