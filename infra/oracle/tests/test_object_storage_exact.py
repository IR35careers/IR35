import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import object_storage_exact as exact
import exact_storage_audit as journal
from immutable_artifacts import Store
from key_ceremony import KeySafetyError
from storage_budget import reconcile
from test_storage_budget import fixture, NOW


def obj(name='private-path-canary', size=10, etag='etag-fixture'):
    return {'name': name, 'size': size, 'etag': etag, 'storage_tier': 'Standard'}


def version(**changes):
    return obj() | {'version_id': 'v1', 'is_delete_marker': False} | changes


class API:
    def __init__(self, current=None, versions=None, uploads=None, parts=None):
        self.calls = []
        self.current = [obj()] if current is None else current
        self.versions = [version()] if versions is None else versions
        self.uploads = [] if uploads is None else uploads
        self.parts = [] if parts is None else parts
        self.config = {'name': 'ir35-backups', 'compartment_id': 'fixture-child', 'storage_tier': 'Standard',
                       'versioning': 'Disabled', 'auto_tiering': 'Disabled', 'public_access_type': 'NoPublicAccess'}

    def read(self, op, namespace, **kw):
        self.calls.append((op, kw))
        if op == 'get_bucket':
            return self.config, {}
        if op == 'list_buckets':
            return [{'name': 'ir35-backups', 'compartment_id': 'fixture-child'}], {}
        if op == 'list_objects':
            return {'objects': self.current, 'prefixes': []}, {}
        if op == 'list_object_versions':
            return {'items': self.versions, 'prefixes': []}, {}
        if op == 'list_multipart_uploads':
            return self.uploads, {}
        if op == 'list_multipart_upload_parts':
            return self.parts, {}
        raise AssertionError('unapproved operation')


class ExactStorageTests(unittest.TestCase):
    def test_versions_include_current_once_and_unfinished_parts_are_added(self):
        api = API(versions=[version(), version(version_id='old', size=7, etag='old-etag')],
                  uploads=[{'object': 'unfinished-secret-name', 'upload_id': 'private-upload-canary', 'storage_tier': 'Standard'}],
                  parts=[{'part_number': 1, 'size': 3, 'etag': 'p1'}, {'part_number': 2, 'size': 4, 'etag': 'p2'}])
        records = []
        proof = exact.Counter(api, record=lambda name, value: records.append((name, value))).full_audit('fixture', ['fixture-child'])
        row = proof['bucketReports'][0]
        self.assertEqual(proof['exactBytes'], 24)  # 10 + 7 + 3 + 4, NOT +10 twice.
        self.assertEqual(row['objectCount'], 1)
        self.assertEqual(row['versionCount'], 2)
        self.assertEqual(row['unfinishedPartBytes'], 7)
        self.assertTrue(proof['bucketListingStable'])
        evidence = json.dumps([proof, records])
        for private in ('private-path-canary', 'unfinished-secret-name', 'private-upload-canary'):
            self.assertNotIn(private, evidence)
        self.assertTrue(all(op in exact.READS for op, _ in api.calls))

    def test_paginate_objects_versions_uploads_and_parts_even_empty_page(self):
        api = API()
        original = api.read
        def read(op, namespace, **kw):
            if op in ('list_objects', 'list_object_versions', 'list_multipart_uploads', 'list_multipart_upload_parts'):
                api.calls.append((op, kw))
            if op == 'list_objects':
                self.assertNotIn('page', kw)
                return ({'objects': [obj()], 'next_start_with': None}, {}) if kw.get('start') == 'next-object' else ({'objects': [], 'next_start_with': 'next-object'}, {})
            if op == 'list_object_versions':
                return ({'items': [version()]}, {}) if kw.get('page') == 'next-version' else ({'items': []}, {'opc-next-page': 'next-version'})
            if op == 'list_multipart_uploads':
                return ([{'object': 'upload-fixture', 'upload_id': 'upload-id', 'storage_tier': 'Standard'}], {}) if kw.get('page') == 'next-upload' else ([], {'opc-next-page': 'next-upload'})
            if op == 'list_multipart_upload_parts':
                return ([{'size': 5, 'part_number': 1, 'etag': 'p1'}], {}) if kw.get('page') == 'next-part' else ([], {'opc-next-page': 'next-part'})
            return original(op, namespace, **kw)
        api.read = read
        proof = exact.Counter(api).full_audit('fixture', ['fixture-child'])
        self.assertEqual(proof['exactBytes'], 15)
        for op in ('list_objects', 'list_object_versions', 'list_multipart_uploads', 'list_multipart_upload_parts'):
            self.assertEqual(sum(call == op for call, _ in api.calls), 4)

    def test_missing_fractional_negative_or_boolean_sizes_never_become_zero(self):
        for value in (None, True, -1, 1.5, '10', float('nan')):
            with self.subTest(value=value), self.assertRaisesRegex(KeySafetyError, 'UnclearStorageSize'):
                exact.Counter(API(versions=[version(size=value)])).audit('fixture', [('ir35-backups', 'fixture-child')])

    def test_repeated_cursor_and_duplicate_rows_refuse_partial_total(self):
        api = API()
        api.read = lambda *_, **kw: ({'objects': [], 'next_start_with': 'same'}, {})
        with self.assertRaisesRegex(KeySafetyError, 'RepeatedStoragePageCursor'):
            exact.Counter(api).pages('list_objects', 'fixture', 'ir35-backups')
        for api in (API(current=[obj(), obj()]), API(versions=[version(), version()]),
                    API(uploads=[{'object': 'x', 'upload_id': 'y', 'storage_tier': 'Standard'}],
                        parts=[{'part_number': 1, 'size': 1, 'etag': 'e'}, {'part_number': 1, 'size': 2, 'etag': 'f'}])):
            with self.assertRaises(KeySafetyError):
                exact.Counter(api).audit('fixture', [('ir35-backups', 'fixture-child')])

    def test_changed_second_pass_or_bucket_set_is_a_hard_stop(self):
        api = API()
        counter = exact.Counter(api)
        with patch.object(counter, 'snapshot', side_effect=[{'totalBytes': 1}, {'totalBytes': 2}]), self.assertRaisesRegex(KeySafetyError, 'StorageChangedBetween'):
            counter.audit('fixture', [('ir35-backups', 'fixture-child')])
        with self.assertRaisesRegex(KeySafetyError, 'BucketSetChangedSince'):
            exact.Counter(api).full_audit('fixture', ['fixture-child'], [])
        with self.assertRaisesRegex(KeySafetyError, 'ExplicitUniqueCompartment'):
            exact.Counter(api).full_audit('fixture', [])

    def test_delete_markers_require_observed_zero_size_and_do_not_double_count(self):
        api = API(versions=[version(), version(name='deleted-object', version_id='delete-id', is_delete_marker=True, size=0, etag=None)])
        proof = exact.Counter(api).audit('fixture', [('ir35-backups', 'fixture-child')])
        self.assertEqual(proof['exactBytes'], 10)
        self.assertEqual(proof['bucketReports'][0]['deleteMarkerCount'], 1)
        api.versions[1]['size'] = None
        with self.assertRaisesRegex(KeySafetyError, 'UnclearStorageSize'):
            exact.Counter(api).audit('fixture', [('ir35-backups', 'fixture-child')])

    def test_unknown_tier_unmatched_current_or_incomplete_page_stops(self):
        for api in (API(versions=[]), API(versions=[version(storage_tier='Archive')]),
                    API(uploads=[{'object': 'x', 'upload_id': 'y'}])):
            with self.assertRaises(KeySafetyError):
                exact.Counter(api).audit('fixture', [('ir35-backups', 'fixture-child')])
        api = API()
        api.config['auto_tiering'] = None
        with self.assertRaisesRegex(KeySafetyError, 'OnlyExplicitStandardTier'):
            exact.Counter(api).audit('fixture', [('ir35-backups', 'fixture-child')])

    def test_20gb_eighty_percent_gate_and_existing_8gb_cap_are_independent(self):
        for count, message in ((16_000_000_001, 'Over80PercentOf20GB'), (16_000_000_000, 'OverExisting8GB'), (8_000_000_001, 'OverExisting8GB')):
            api = API(current=[obj(size=count)], versions=[version(size=count)])
            with self.subTest(count=count), self.assertRaisesRegex(KeySafetyError, message):
                exact.Counter(api).audit('fixture', [('ir35-backups', 'fixture-child')])
        api = API(current=[], versions=[])
        proof = exact.Counter(api).audit('fixture', [('ir35-backups', 'fixture-child')])
        self.assertEqual(proof['exactBytes'], 0)
        self.assertEqual(proof['freeAllowanceBytes'], 20_000_000_000)

    def test_storage_guard_uses_exact_not_estimate_and_never_relabels_an_estimate(self):
        report = fixture()
        report['objectStorage'] = {'buckets': 1, 'exactBytesProven': True, 'exactBytes': 7, 'approximateBytes': 9_000_000_000}
        self.assertEqual(reconcile(report, now=NOW)['proposedObjectBytes'], '7')
        del report['objectStorage']['exactBytes']
        with self.assertRaisesRegex(KeySafetyError, 'Non-empty buckets require exact'):
            reconcile(report, now=NOW)

    def test_read_adapter_rejects_mutations_before_authentication_or_sdk(self):
        api = exact.SecurityTokenReads({'tenancy': 'fixture', 'user': 'fixture'})
        for method in ('delete_bucket', 'abort_multipart_upload', 'put_object', 'get_object', 'raw_request'):
            with self.assertRaisesRegex(KeySafetyError, 'OutsideFixedScope'):
                api.read(method, 'fixture')

    def test_write_once_journal_and_approved_repair_budget(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / 'journal'
            public = Path(temporary) / 'public'
            public.mkdir()
            with patch.object(journal, 'ROOT', root), patch.object(journal, 'PUBLIC', public):
                proof = journal.audit(namespace='fixture', compartments=['fixture-child'], api=API())
                self.assertEqual(proof['status'], 'PASS')
                Store(root).verify(proof['stage'], proof['manifestSHA256'])
                original = (public / 'exact-storage-01-audit.json').read_bytes()
                with self.assertRaises(FileExistsError):
                    journal.audit(namespace='fixture', compartments=['fixture-child'], api=API())
                self.assertEqual((public / 'exact-storage-01-audit.json').read_bytes(), original)
                with self.assertRaisesRegex(KeySafetyError, 'OnlyFailedTooling'):
                    journal.audit(slot='02-repair-one', namespace='fixture', compartments=['fixture-child'], api=API())
                with self.assertRaisesRegex(KeySafetyError, 'FixedExactStorageAuditSlot'):
                    journal.audit(slot='05-retry', namespace='fixture', compartments=['fixture-child'], api=API())

    def test_full_resource_inventory_opt_in_proof_avoids_all_estimate_fields(self):
        import resource_audit
        from test_resource_audit import FixtureClient, ACCOUNT, COMPARTMENT
        client = FixtureClient({'buckets': lambda selectors: [{'name': 'ir35-backups'}] if selectors['compartment'] == COMPARTMENT else []})
        proof = {'status': 'PASS', 'buckets': 1, 'exactBytesProven': True, 'exactBytes': 17}
        calls = []
        def counter(namespace, buckets, *, compartments):
            calls.append((namespace, buckets, compartments))
            return proof
        report = resource_audit.inventory(client, ACCOUNT, exact_storage=counter)
        self.assertEqual(report['objectStorage']['exactBytes'], 17)
        self.assertNotIn('approximateBytes', report['objectStorage'])
        self.assertNotIn('bucket', [name for name, _ in client.calls])
        self.assertEqual(calls[0][1], [('ir35-backups', COMPARTMENT)])
        with self.assertRaisesRegex(KeySafetyError, 'ExactObjectStorageProofRequired'):
            resource_audit.inventory(FixtureClient(), ACCOUNT, exact_storage=lambda *_, **kw: {'status': 'FAIL'})

    def test_browser_gate_is_preserved_and_only_zero_request_gate_can_resume(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / 'journal'
            public = Path(temporary) / 'public'
            public.mkdir()
            with patch.object(journal, 'ROOT', root), patch.object(journal, 'PUBLIC', public):
                with patch.object(journal, 'ensure_session', side_effect=KeySafetyError('G2: owner browser required')):
                    with self.assertRaisesRegex(KeySafetyError, 'G2:'):
                        journal.audit(namespace='fixture', compartments=['fixture-child'])
                first = (public / 'exact-storage-01-audit.json').read_bytes()
                result = journal.audit(slot='01-after-browser', namespace='fixture', compartments=['fixture-child'], api=API())
                self.assertEqual(result['status'], 'PASS')
                self.assertEqual((public / 'exact-storage-01-audit.json').read_bytes(), first)
                with self.assertRaises(FileExistsError):
                    journal.audit(slot='01-after-browser', namespace='fixture', compartments=['fixture-child'], api=API())

    def test_unclear_usage_cannot_be_retried_as_a_tooling_repair_or_hide_new_failure(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / 'journal'
            public = Path(temporary) / 'public'
            public.mkdir()
            with patch.object(journal, 'ROOT', root), patch.object(journal, 'PUBLIC', public):
                with self.assertRaisesRegex(KeySafetyError, 'UnclearStorageSize'):
                    journal.audit(namespace='fixture', compartments=['fixture-child'], api=API(versions=[version(size=None)]))
                with self.assertRaisesRegex(KeySafetyError, 'NotAToolingRetry'):
                    journal.audit(slot='02-repair-one', namespace='fixture', compartments=['fixture-child'], api=API())
                with self.assertRaisesRegex(KeySafetyError, 'LatestExactStorageAuditMustPass'):
                    journal.latest_pass()


if __name__ == '__main__':
    unittest.main()
