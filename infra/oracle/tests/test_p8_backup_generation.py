"""Synthetic files/transport only: never actual dump, age, OCI or private key."""
import ast
from datetime import datetime, timedelta, timezone
import hashlib
import inspect
import io
import json
import os
from pathlib import Path
import stat
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import p8_backup_generation as generation
from p8_backup_policy import BackupScopeError


class Body:
    def __init__(self, body): self.body, self.closed, self.raw = body, False, self
    def stream(self, size, decode_content):
        if decode_content is not False: raise AssertionError('Raw ciphertext only')
        for offset in range(0, len(self.body), size): yield self.body[offset:offset + size]
    def close(self): self.closed = True


class Transport:
    def __init__(self): self.objects, self.calls, self.tamper, self.fail = {}, [], False, False
    def put_object(self, **args):
        self.calls.append(('put', args['object_name']))
        if self.fail: raise RuntimeError('private-value-must-not-escape')
        if args['if_none_match'] != '*' or args['storage_tier'] != 'Standard': raise AssertionError('Create-only Standard')
        if args['object_name'] in self.objects: raise RuntimeError('Already exists')
        body = args['put_object_body'].read()
        if len(body) != args['content_length']: raise AssertionError('Exact single-part length')
        self.objects[args['object_name']] = body
        return SimpleNamespace(status=200)
    def head_object(self, **args):
        self.calls.append(('head', args['object_name']))
        return SimpleNamespace(status=200, headers={'content-length': str(len(self.objects[args['object_name']]))})
    def get_object(self, **args):
        self.calls.append(('get', args['object_name']))
        body = self.objects[args['object_name']]
        return SimpleNamespace(status=200, data=Body(body[:-1] + b'?' if self.tamper else body))


@unittest.skipUnless(hasattr(os, 'geteuid'), 'POSIX native target custody; Windows never used as VM')
class BackupGenerationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name); self.root.chmod(0o700)
        self.base = patch.object(generation, 'BASE', self.root); self.base.start(); self.addCleanup(self.base.stop)
        self.recipient = self.root / 'public-recipient.txt'
        self.recipient.write_text('age1' + 'q' * 58 + '\n'); self.recipient.chmod(0o400)
        self.encrypted = []
        def fake(part, recipient, destination, **kwargs):
            self.encrypted.append((part, kwargs))
            body = generation.HEADER + b'PUBLIC-FIXTURE-NOT-CRYPTO\n' + part.encode()
            if part == 'verification': body += kwargs['input_bytes']
            with destination.open('xb') as output: output.write(body)
            destination.chmod(0o400)
            return {'ciphertextBytes': len(body), 'ciphertextSHA256': hashlib.sha256(body).hexdigest()}
        self.fake = patch.object(generation, 'encrypt_part', side_effect=fake); self.fake.start(); self.addCleanup(self.fake.stop)
        self.when = datetime(2026, 10, 30, 2, 15, tzinfo=timezone.utc)
        self.transport = Transport(); self.records = {}

    def prepare(self, **overrides):
        values = {'generation': self.when, 'recipient': self.recipient,
                  'snapshots': {'database': '00000004-000000B1-1', 'queue': '00000005-000000C1-1'},
                  'verification_bytes': b'{"synthetic":true}', 'source_sha': 'a' * 40}
        return generation.prepare_generation(**(values | overrides))

    def capacity(self):
        return {'bucket_bytes': sum(map(len, self.transport.objects.values())),
                'tenancy_standard_bytes': sum(map(len, self.transport.objects.values())),
                'tenancy_all_tier_bytes': sum(map(len, self.transport.objects.values())),
                'monthly_requests_so_far': len(self.transport.calls), 'exact_inventory': True,
                'exact_request_count': True, 'account_state': 'FREE_TRIAL',
                'checked_at': datetime.now(timezone.utc)}

    def record(self, name, value):
        if name in self.records: raise AssertionError('O_EXCL fixture journal')
        self.records[name] = value

    def upload(self, index, capacity=None):
        return generation.upload_generation(index, 'namespace1', capacity or self.capacity,
                                            self.record, _transport=self.transport)

    def test_prepares_all_five_parts_plus_encrypted_commit_without_plaintext_archive(self):
        result = self.prepare()
        self.assertEqual(result['status'], 'ENCRYPTED_NOT_UPLOADED')
        self.assertEqual([row['part'] for row in result['parts']], list(generation.PARTS))
        self.assertEqual([row[0] for row in self.encrypted], [*generation.PARTS, 'verification'])
        self.assertEqual(self.encrypted[0][1]['snapshot'], '00000004-000000B1-1')
        self.assertEqual(self.encrypted[2][1]['snapshot'], '00000005-000000C1-1')
        folder = self.root / result['generation']
        self.assertEqual({path.name for path in folder.iterdir()}, {*(part + '.age' for part in generation.PARTS), 'complete'})
        self.assertEqual(stat.S_IMODE((folder / 'database.age').stat().st_mode), 0o400)
        self.assertEqual(result['plaintextIntermediateFiles'], 0)
        self.assertFalse(result['restoreVerified'])
        self.assertFalse(result['phaseComplete'])

    def test_same_generation_is_never_overwritten_or_replayed(self):
        self.prepare(); calls = len(self.encrypted)
        with self.assertRaises(FileExistsError): self.prepare()
        self.assertEqual(len(self.encrypted), calls)

    def test_missing_snapshot_source_sha_invalid_json_and_subsecond_clock_fail_before_ciphertext(self):
        for bad in ({'snapshots': {'database': '00000004-000000B1-1'}}, {'source_sha': 'bad'},
                    {'verification_bytes': b'not-json'}, {'generation': self.when.replace(microsecond=1)}):
            with self.assertRaises(generation.GenerationError): self.prepare(**bad)
        self.assertEqual(self.encrypted, [])

    def test_private_identity_or_permissive_recipient_is_never_used(self):
        self.recipient.chmod(0o600); self.recipient.write_text('AGE-' + 'SECRET-' + 'KEY-NOT-A-RECIPIENT')
        with self.assertRaises(ValueError): self.prepare()
        self.assertEqual(self.encrypted, [])

    def test_direct_put_head_get_all_six_objects_and_complete_marker_last(self):
        result = self.upload(self.prepare())
        self.assertEqual(result['status'], 'COMMITTED_CIPHERTEXT')
        self.assertEqual(result['objects'], 6)
        self.assertEqual(len(self.transport.calls), 18)
        self.assertEqual([kind for kind, key in self.transport.calls], ['put', 'head', 'get'] * 6)
        self.assertTrue(self.transport.calls[-1][1].endswith('/complete.age'))
        self.assertEqual(len(self.records), 12)
        self.assertTrue(all(value['status'] == 'UPLOADED_VERIFIED' for key, value in self.records.items() if key.endswith('-result.json')))
        self.assertFalse(result['restoreVerified'])

    def test_corrupted_readback_stops_no_commit_no_retry_or_delete(self):
        index = self.prepare(); self.transport.tamper = True
        with self.assertRaises(generation.GenerationError): self.upload(index)
        self.assertEqual([kind for kind, key in self.transport.calls], ['put', 'head', 'get'])
        self.assertFalse(any(key.endswith('/complete.age') for key in self.transport.objects))
        result = self.records['backup-01-database-result.json']
        self.assertEqual(result['code'], 'ObjectReadbackSha256Mismatch')
        self.assertTrue(result['ambiguousPutMustBeReconciledBeforeAnotherAttempt'])

    def test_unknown_put_outcome_is_logged_without_secret_and_never_retried(self):
        index = self.prepare(); self.transport.fail = True
        with self.assertRaises(generation.GenerationError) as error: self.upload(index)
        self.assertEqual(len(self.transport.calls), 1)
        self.assertNotIn('private-value', str(error.exception) + json.dumps(self.records))
        self.assertEqual(self.records['backup-01-database-result.json']['code'], 'RuntimeError')

    def test_stale_inexact_or_over_cap_inventory_refuses_first_put(self):
        index = self.prepare()
        for override in ({'checked_at': datetime.now(timezone.utc) - timedelta(minutes=6)},
                         {'exact_inventory': False}, {'exact_request_count': False},
                         {'bucket_bytes': generation.MAX_BYTES, 'tenancy_standard_bytes': generation.MAX_BYTES,
                          'tenancy_all_tier_bytes': generation.MAX_BYTES}, {'monthly_requests_so_far': 50_000}):
            with self.assertRaises(BackupScopeError): self.upload(index, lambda: self.capacity() | override)
        self.assertEqual(self.transport.calls, [])

    def test_budget_callback_cannot_override_incoming_bytes_or_request_count(self):
        index = self.prepare()
        with self.assertRaises(generation.GenerationError):
            self.upload(index, lambda: self.capacity() | {'new_ciphertext_bytes': 0})
        self.assertEqual(self.transport.calls, [])

    def test_missing_capacity_is_redacted_and_precedes_imds_or_transport(self):
        index = self.prepare()
        def unavailable():
            raise RuntimeError('synthetic-private-capacity-credential')
        with patch.object(generation, '_new_client') as make:
            with self.assertRaises(generation.GenerationError) as caught:
                generation.upload_generation(index, 'namespace1', unavailable, self.record)
            self.assertEqual(str(caught.exception), 'FreshMeasuredCapacityUnavailable_NoPut')
            make.assert_not_called()
        self.assertEqual(self.records, {})
        self.assertEqual(self.transport.calls, [])

    def test_inexact_capacity_cannot_even_create_instance_principal_client(self):
        index = self.prepare()
        with patch.object(generation, '_new_client') as make:
            with self.assertRaises(BackupScopeError):
                generation.upload_generation(index, 'namespace1',
                    lambda: self.capacity() | {'exact_inventory': False}, self.record)
            make.assert_not_called()
        self.assertEqual(self.records, {})

    def test_commit_metadata_cannot_override_part_or_inject_unknown_fields(self):
        index = self.prepare()
        for field, value in (('part', 'database'), ('credential', 'synthetic-not-secret')):
            with self.subTest(field=field):
                altered = index | {'complete': index['complete'] | {field: value}}
                with self.assertRaises(generation.GenerationError): self.upload(altered)
        with self.assertRaises(generation.GenerationError):
            self.upload(index | {'sourceSHA': ['a' * 40]})
        self.assertEqual(self.records, {})
        self.assertEqual(self.transport.calls, [])

    def test_symlink_ciphertext_and_wrong_owner_fail_before_any_put(self):
        index = self.prepare()
        with self.assertRaises(generation.GenerationError):
            generation.upload_generation(index, 'namespace1', self.capacity, self.record,
                uid=os.geteuid() + 1, _transport=self.transport)
        path = self.root / index['generation'] / 'database.age'
        renamed = path.with_name('original.age'); path.rename(renamed); path.symlink_to(renamed)
        with self.assertRaises(generation.GenerationError): self.upload(index)
        self.assertEqual(self.transport.calls, [])

    def test_upload_reads_the_hashed_descriptor_not_a_replaced_path(self):
        index = self.prepare()
        path = self.root / index['generation'] / 'database.age'
        original = path.read_bytes()
        put = self.transport.put_object
        def replace_path_after_descriptor_open(**arguments):
            if arguments['object_name'].endswith('/database.age'):
                path.rename(path.with_name('original.age'))
                path.write_bytes(b'synthetic-private-file-never-upload'); path.chmod(0o400)
            return put(**arguments)
        self.transport.put_object = replace_path_after_descriptor_open
        result = self.upload(index)
        self.assertEqual(result['status'], 'COMMITTED_CIPHERTEXT')
        uploaded = next(body for key, body in self.transport.objects.items() if key.endswith('/database.age'))
        self.assertEqual(uploaded, original)
        self.assertNotIn(b'synthetic-private-file', uploaded)

    def test_missing_part_bad_index_or_changed_ciphertext_has_no_put(self):
        index = self.prepare()
        with self.assertRaises(generation.GenerationError): self.upload(index | {'parts': index['parts'][:-1]})
        path = self.root / index['generation'] / 'database.age'
        path.chmod(0o600); path.write_bytes(generation.HEADER + b'changed'); path.chmod(0o400)
        with self.assertRaises(generation.GenerationError): self.upload(index)
        self.assertEqual(self.transport.calls, [])

    def test_invalid_namespace_rejected_before_client_or_put(self):
        index = self.prepare()
        with patch.object(generation, '_new_client') as make:
            with self.assertRaises(BackupScopeError):
                generation.upload_generation(index, '*', self.capacity, self.record)
            make.assert_not_called()

    def test_nightly_units_are_not_enabled_and_do_not_grant_docker_to_ir35(self):
        units = generation.nightly_units()
        self.assertFalse(units['installed']); self.assertFalse(units['enabled'])
        self.assertFalse(units['nativeRestoreProven'])
        self.assertTrue(units['requiresProvenNativeRunnerAndFreshUsage'])
        self.assertIn('User=root', units['service'])
        self.assertIn('MemoryMax=512M', units['service'])
        self.assertIn('OnCalendar=*-*-* 02:15:00 UTC', units['timer'])
        self.assertNotIn('EnvironmentFile', units['service'])

    def test_transport_has_no_multipart_delete_keyfile_or_automatic_retry_path(self):
        tree = ast.parse(inspect.getsource(generation))
        names = {node.func.attr for node in ast.walk(tree) if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)}
        for forbidden in ('delete_object', 'create_multipart_upload', 'upload_part', 'commit_multipart_upload', 'abort_multipart_upload', 'upload_file'):
            self.assertNotIn(forbidden, names)
        self.assertIn('NoneRetryStrategy', inspect.getsource(generation._new_client))
        self.assertNotIn('key_file', inspect.getsource(generation._new_client))


if __name__ == '__main__': unittest.main()
