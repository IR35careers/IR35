from pathlib import Path
import sys
import unittest
from unittest.mock import patch
import ast
import json

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import rehearsal


class RehearsalTests(unittest.TestCase):
    def test_compatibility_hold_refuses_before_source_or_ssh(self):
        with patch.object(sys,'argv',['rehearsal.py','--staging','--cycle','1']),patch.object(rehearsal.Path,'exists',return_value=True),patch.object(rehearsal.Path,'read_text',return_value=json.dumps({'status':'FAIL'})),patch.object(rehearsal,'capture') as capture,patch.object(rehearsal.schema,'run_guest') as remote:
            with self.assertRaisesRegex(ValueError,'compatibility FAIL'):rehearsal.main()
            capture.assert_not_called();remote.assert_not_called()
    def test_compiled_fixed_destination_keeps_failures_and_never_truncates_or_replays(self):
        with patch.object(rehearsal.schema,'guest_bundle',return_value=''):
            guest=rehearsal.guest_source(1,b'PGDMP-controlled-fixture',{})
        compile(guest,'staging-rehearsal','exec')
        self.assertNotIn('SOURCE',guest)
        self.assertNotIn('ARCHIVE_HASH',guest)
        self.assertIn("if str(cycle) in ledger['cycles']",guest)
        self.assertIn('Unowned rehearsal database collision',guest)
        self.assertIn('TABLES_VERIFIED',guest)
        self.assertIn('--single-transaction',guest)
        self.assertIn('--exit-on-error',guest)
        self.assertNotIn('--no-owner',guest)
        self.assertNotIn('--no-acl',guest)
        # The shared ACL keyword allowlist contains TRUNCATE; no data command.
        self.assertNotRegex(rehearsal.GUEST,r'(?i)TRUNCATE\s+(?:TABLE|public\.|auth\.|storage\.)')
        self.assertNotIn('DROP DATABASE',guest)
        self.assertIn('DATA_FAIL',guest)
        self.assertIn('SCHEMA_FAIL',guest)
        self.assertIn('dataRehearsalStarted',guest)

    def test_dry_run_never_authenticates_reads_source_or_connects_to_vm(self):
        with patch.object(sys,'argv',['rehearsal.py','--dry-run']),patch.object(rehearsal,'gates'),patch.object(rehearsal,'capture') as capture,patch.object(rehearsal.schema,'run_guest') as remote:
            rehearsal.main()
            capture.assert_not_called();remote.assert_not_called()
        with patch.object(sys,'argv',['rehearsal.py','--production']),patch.object(rehearsal,'gates'),patch.object(rehearsal,'capture') as capture:
            with self.assertRaises(ValueError):rehearsal.main()
            capture.assert_not_called()

    def test_customer_locator_text_is_not_recursively_substituted(self):
        source={'locator':'SOURCE ARCHIVE CYCLE ARCHIVE_HASH EXTENSION_SQL 日本語'}
        with patch.object(rehearsal.schema,'guest_bundle',return_value=''):
            guest=rehearsal.guest_source(1,b'PGDMP-control',source)
        tree=ast.parse(guest)
        assignments=[node for node in tree.body if isinstance(node,ast.Assign) and any(isinstance(x,ast.Name) and x.id=='source' for x in node.targets)]
        self.assertEqual(ast.literal_eval(assignments[-1].value),source)


if __name__=='__main__':unittest.main()
