"""Mocked OCI-only entry flow: no SSH access, VM process or private state.

Historical helper imports may remain inert. These tests forbid actual SSH/VM
calls and leave the existing slot/hash/protocol/freshness/rollback tests intact.
"""
from contextlib import ExitStack, redirect_stdout
from datetime import datetime, timezone
import copy
import io
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import cloud_schema
import host_ssh
import p6_audit_log
import p8_backup_iam_owner
import p8_lifecycle_owner23 as entry
import p8_lifecycle_owner31 as owner
import p8_oci_readonly
import resource_audit
import security_session
import ssh_agent_session
import visibility
from key_ceremony import KeySafetyError
from test_p8_lifecycle_eligibility import observation
from test_p8_lifecycle_owner31 import BASE, FakeApi, ROOT, immediate


class CloudOnlyEntryTests(unittest.TestCase):
    def setUp(self):
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        directory = self.stack.enter_context(tempfile.TemporaryDirectory(prefix='ir35-cloud-only-fixture-'))
        self.journal = p6_audit_log.Journal(Path(directory) / 'mocked-native-journal')
        self.profile = {'tenancy': ROOT, 'user': 'publicfixtureuser', 'region': owner.scope.REGION}
        self.api = FakeApi()
        denied = AssertionError('SSH_VM_private_or_native_process_call_forbidden')
        self.ssh = self.stack.enter_context(patch.object(ssh_agent_session, 'ensure_agent', side_effect=denied))
        self.remote = self.stack.enter_context(patch.object(host_ssh, 'run_remote', side_effect=denied))
        self.guest = self.stack.enter_context(patch.object(cloud_schema, 'run_guest', side_effect=denied))
        self.process = self.stack.enter_context(patch.object(subprocess, 'run', side_effect=denied))
        self.spawn = self.stack.enter_context(patch.object(subprocess, 'Popen', side_effect=denied))
        self.output = self.stack.enter_context(patch.object(subprocess, 'check_output', side_effect=denied))
        self.stack.enter_context(patch.object(security_session, 'private_file', side_effect=denied))
        self.session = self.stack.enter_context(patch.object(security_session, 'ensure_session', return_value=self.profile))
        self.checked_entry = self.stack.enter_context(patch.object(entry, 'check_entry',
            return_value=entry.PREVIOUS_FAILURE_MANIFEST))
        self.make_journal = self.stack.enter_context(patch.object(p6_audit_log, 'Journal', return_value=self.journal))
        self.native_api = self.stack.enter_context(patch.object(entry, 'NativeApi', return_value=self.api))
        self.stack.enter_context(patch.object(owner, 'ROOT_POLICY_SHA', owner.sha(BASE['statements'])))
        self.stack.enter_context(patch.object(visibility, 'wait_for_visible', side_effect=immediate))
        self.measurements = []

        def inventory(client, journal, _storage):
            value = observation(datetime.now(timezone.utc))
            value['inventory']['objectStorage'].update(buckets=1,
                bucketReports=[{'bucket': owner.scope.BUCKET}])
            client.namespace = 'publicnamespace'
            client.buckets.add(owner.scope.BUCKET)
            journal.put('inventory.json', value['inventory'])
            self.measurements.append(journal)
            return value['freeInventory']

        bucket = {'name': owner.scope.BUCKET, 'compartment-id': owner.scope.COMPARTMENT,
            'storage-tier': 'Standard', 'public-access-type': 'NoPublicAccess', 'versioning': 'Disabled',
            'auto-tiering': 'Disabled', 'is-read-only': False, 'replication-enabled': False, 'kms-key-id': None}

        def read(_client, operation, **selectors):
            if operation != 'bucket' or selectors != {'bucket': owner.scope.BUCKET}:
                raise AssertionError('Unexpected mocked OCI read')
            return copy.deepcopy(bucket)

        self.stack.enter_context(patch.object(resource_audit.ReadOnlyOci, 'read', new=read))
        self.stack.enter_context(patch.object(resource_audit, 'session_account_audit',
            return_value=observation(datetime.now(timezone.utc))['account']))
        self.stack.enter_context(patch.object(p8_oci_readonly, 'execute', side_effect=inventory))

    def call_main(self):
        output = io.StringIO()
        with redirect_stdout(output):
            code = entry.main([entry.FLAG])
        result = json.loads(output.getvalue().splitlines()[-1])
        self.ssh.assert_not_called()
        self.remote.assert_not_called()
        self.guest.assert_not_called()
        self.process.assert_not_called()
        self.spawn.assert_not_called()
        self.output.assert_not_called()
        return code, result

    def test_success_never_checks_a_loaded_ssh_key_or_calls_vm_and_keeps_cloud_scope(self):
        code, result = self.call_main()
        self.assertEqual(code, 0)
        self.assertEqual(result['status'], 'PASS')
        self.assertEqual(len(self.measurements), 5)  # Initial inventory + every create.
        self.session.assert_called_once_with(minimum_seconds=1800)
        self.checked_entry.assert_called_once()
        intent = json.loads((self.journal.root / 'owner23-intent.json').read_bytes())
        self.assertEqual(intent['auth'], 'SecurityToken')
        self.assertTrue(intent['cloudOnly'])
        self.assertEqual(intent['vmOperations'], 0)
        self.assertNotIn('keyLoaded', intent)
        self.assertNotIn('keyFingerprint', intent)
        self.assertEqual(intent['previousFailureManifestSHA256'], entry.PREVIOUS_FAILURE_MANIFEST)
        self.assertFalse(intent['previousSlotReplayed'])
        self.assertFalse(intent['observerPermissions'])
        self.assertFalse(result['nativeRetryAllowed'])
        self.assertEqual(result['vmChanges'], 0)
        self.assertEqual(result['productionChanges'], 0)
        self.assertEqual([name for name, _ in self.api.calls if name.startswith('create-')],
            ['create-group', 'create-vm-policy', 'create-service-policy', 'create-lifecycle'])
        self.assertEqual(result['policyTexts']['vm'], owner.scope.policy_statement())
        self.assertEqual(result['policyTexts']['service'], owner.service_statements())

    def test_failure_still_rolls_back_only_the_one_mocked_run_creation(self):
        self.api.failure = 'create-vm-policy'
        code, result = self.call_main()
        self.assertEqual(code, 1)
        self.assertEqual(result['status'], 'FAIL')
        self.assertEqual(result['rollback']['status'], 'PASS')
        self.assertEqual(result['rollback']['createdResourcesRemoved'], 1)
        self.assertEqual(result['rollback']['originalRootPolicySHA256'], owner.ROOT_POLICY_SHA)
        self.assertEqual(self.api.rows, {'groups': [], 'root-policies': [BASE], 'child-policies': []})
        self.assertEqual(sum(name == 'create-vm-policy' for name, _ in self.api.calls), 1)

    def test_real_security_token_gate_failure_stops_before_new_journal_or_mutation(self):
        self.session.side_effect = KeySafetyError('G2_browser_session_required_public_fixture')
        with self.assertRaisesRegex(KeySafetyError, 'G2_browser_session_required'):
            entry.main([entry.FLAG])
        self.make_journal.assert_not_called()
        self.native_api.assert_not_called()
        self.ssh.assert_not_called()
        self.remote.assert_not_called()
        self.process.assert_not_called()
        self.assertEqual(self.api.calls, [])


if __name__ == '__main__':
    unittest.main()
