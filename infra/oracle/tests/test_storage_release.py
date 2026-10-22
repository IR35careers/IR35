from pathlib import Path
import hashlib
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import storage_release as release


def row(number=0, name='initial', content='fixture'):
    return {'id': number, 'name': name, 'hash': hashlib.sha1(content.encode()).hexdigest()}


class StorageReleaseTests(unittest.TestCase):
    def test_every_name_id_hash_and_pending_migration_must_match(self):
        applied = [row(), row(1, 'second')]
        self.assertEqual(release.compare(applied, list(reversed(applied)))['status'], 'PASS')
        for field, value in (('hash', 'f'*40), ('name', 'renamed')):
            altered = [dict(entry) for entry in applied]
            altered[1][field] = value
            self.assertEqual(release.compare(applied, altered)['status'], 'FAIL')
        self.assertEqual(len(release.compare(applied, applied+[row(2, 'pending')])['pending']), 1)
        self.assertEqual(len(release.compare(applied, applied[:1])['missing']), 1)

    def test_duplicate_gapped_or_untrusted_metadata_fails_closed(self):
        for entries in ([], [row(), row()], [row(1)], [row()|{'hash':'bad'}], [row()|{'name':'private/path'}]):
            with self.assertRaises(ValueError):
                release.validate_rows(entries)

    def test_exact_filename_and_bytes_are_hashed_without_newline_normalization(self):
        filename = '0002-storage-schema.sql'
        result = release.file_row(filename, b'SELECT 1;\n')
        self.assertEqual(result['hash'], hashlib.sha1(b'0002-storage-schema.sqlSELECT 1;\n').hexdigest())
        self.assertNotEqual(result['hash'], release.file_row(filename, b'SELECT 1;\r\n')['hash'])
        self.assertEqual(result['id'], 2)
        self.assertEqual(result['name'], 'storage-schema')

    def test_metadata_export_is_snapshot_bound_readonly_and_cannot_start_services(self):
        compile(release.EXPORT, 'metadata-export', 'exec')
        self.assertIn('sourceBundleSHA256', release.EXPORT)
        self.assertIn('fingerprint(args', release.EXPORT)
        self.assertIn('BEGIN READ ONLY', release.EXPORT)
        self.assertIn('READ ONLY', release.EXPORT)
        for forbidden in ('docker run', 'pg_restore', 'UPDATE storage', 'DELETE FROM', 'DROP ', 'ALTER ', 'refresh'):
            self.assertNotIn(forbidden, release.EXPORT)

    def test_summary_preserves_each_failed_gate_and_commit(self):
        difference = release.compare([row()], [row(), row(1, 'pending')])
        summary = release.summarize_releases([{'tag':'v1.0.0', 'commit':'a'*40,
                                             'migrationCount':2, **difference}])[0]
        self.assertEqual(summary['status'], 'FAIL')
        self.assertEqual(summary['pendingIds'], [1])
        self.assertEqual(summary['alteredIds'], [])
        self.assertEqual(summary['commit'], 'a'*40)


if __name__ == '__main__':
    unittest.main()
