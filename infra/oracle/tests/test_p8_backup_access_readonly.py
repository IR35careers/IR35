import json
from pathlib import Path
import sys
import unittest
from unittest.mock import patch
import subprocess

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import p8_backup_access_readonly as audit
from key_ceremony import KeySafetyError

PROFILE = {'tenancy': 'ocid1.tenancy.oc1..controlledfixture01', 'user': 'fixture'}


class AccessTests(unittest.TestCase):
    def test_only_lists_in_fixed_scope(self):
        for name in ('groups', 'root-policies', 'child-policies', 'alarms', 'topics', 'subscriptions'):
            args = audit.arguments(name, PROFILE['tenancy'])
            self.assertEqual(args[2], 'list'); self.assertIn('--all', args)
            self.assertNotIn('create', args)
        for name in ('create', 'update', 'delete', 'upload', 'raw-request'):
            with self.assertRaises(KeySafetyError): audit.arguments(name, PROFILE['tenancy'])

    def test_raw_rules_statements_endpoints_are_not_evidence(self):
        private = 'fixture-secret-must-not-be-logged'
        for operation in ('groups', 'root-policies', 'alarms', 'topics', 'subscriptions'):
            result = audit.project(operation, [{'matching-rule': private, 'statements': [private], 'endpoint': private,
                'lifecycle-state': 'ACTIVE', 'query': private}])
            self.assertNotIn(private, json.dumps(result))
        self.assertEqual(audit.project('groups', [])['exactVMRuleGroups'], 0)

    def test_empty_and_paged_lists_are_not_confused(self):
        with patch.object(audit, 'ensure_session', return_value=PROFILE), patch.object(audit.subprocess, 'run') as run:
            run.return_value = subprocess.CompletedProcess([], 0, '', '')
            self.assertEqual(audit.read('groups', PROFILE), [])
            run.return_value = subprocess.CompletedProcess([], 0, '{"data":[],"opc-next-page":"more"}', '')
            with self.assertRaises(KeySafetyError): audit.read('groups', PROFILE)
            run.return_value = subprocess.CompletedProcess([], 1, '', '{"code":"NotAuthorizedOrNotFound","status":404,"message":"private-fixture"}')
            with self.assertRaises(KeySafetyError) as error: audit.read('groups', PROFILE)
            self.assertNotIn('private-fixture', str(error.exception))


if __name__ == '__main__': unittest.main()
