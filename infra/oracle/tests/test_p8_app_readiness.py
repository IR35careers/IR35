import copy
from pathlib import Path
import re
import sys
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import p8_app_readiness as audit
from offline_bundle_fixture import public_bootstrap


class AppReadinessTests(unittest.TestCase):
    def metadata(self):
        return {'columns': [{'table': table, 'column': column, 'type': kind}
            for table, fields in audit.COLUMNS.items() for column, kind in fields.items()],
            'functions': list(audit.FUNCTIONS)}

    def test_complete_capabilities_do_not_claim_functional_qa_or_apply_migration(self):
        result = audit.readiness(self.metadata())
        self.assertEqual(result['schemaCapabilities'], 'PRESENT_ONLY')
        self.assertEqual((result['requiredColumns'], result['requiredFunctions']), (10, 10))
        self.assertFalse(result['functionalQAProven'])
        self.assertFalse(result['migrationApplied'])

    def test_empty_cloud_baseline_reports_every_missing_requirement(self):
        result = audit.readiness({'columns': [], 'functions': []})
        self.assertEqual(result['schemaCapabilities'], 'BLOCKED')
        self.assertEqual((len(result['missingColumns']), len(result['missingFunctions'])), (10, 10))
        self.assertIn('application_packets.delivery_status', result['missingColumns'])
        self.assertIn('save_application_draft', result['missingFunctions'])

    def test_wrong_type_is_not_silently_accepted_or_normalised(self):
        metadata = self.metadata()
        metadata['columns'][0]['type'] = 'character varying(12)'
        result = audit.readiness(metadata)
        self.assertEqual(result['schemaCapabilities'], 'BLOCKED')
        self.assertEqual(result['wrongColumnTypes'], [{'name': 'application_packets.delivery_status',
            'expected': 'text', 'actual': 'character varying(12)'}])

    def test_metadata_is_exact_and_unique(self):
        rows = []
        extra = self.metadata(); extra['password'] = 'not-a-real-credential'; rows.append(extra)
        duplicate = self.metadata(); duplicate['columns'].append(copy.deepcopy(duplicate['columns'][0])); rows.append(duplicate)
        duplicate = self.metadata(); duplicate['functions'].append(duplicate['functions'][0]); rows.append(duplicate)
        foreign = self.metadata(); foreign['functions'][0] = 'other_function'; rows.append(foreign)
        invalid = self.metadata(); invalid['columns'][0]['table'] = []; rows.append(invalid)
        for metadata in rows:
            with self.subTest(metadata_shape=list(metadata)):
                with self.assertRaises(RuntimeError):
                    audit.readiness(metadata)

    def test_query_reads_catalogues_only_and_program_keeps_full_containment(self):
        for forbidden in ('ALTER ', 'CREATE ', 'DROP ', 'INSERT ', 'UPDATE ', 'DELETE ',
                          'GRANT ', 'REVOKE ', 'SET ', 'encrypted_password', 'rolpassword'):
            self.assertNotIn(forbidden, audit.SQL)
        self.assertNotRegex(audit.SQL, r'(?i)FROM\s+(?:public|auth|storage)\.')
        self.assertNotIn('readonly=False', audit.BODY)
        self.assertIn('finally:', audit.BODY)
        self.assertIn('containment(data,runtime', audit.BODY)
        for forbidden in ('write_text(', 'write_bytes(', 'run_guest(', 'ensure_session(',
                          "'docker','restart'", 'owned_clone(', 'set_password('):
            self.assertNotIn(forbidden, audit.BODY)
        with public_bootstrap():
            compile(audit.program({'public': 'fixture'}), '<public-app-readiness>', 'exec')

    def test_column_query_scopes_exact_pairs_not_cross_product_of_names(self):
        # Existing worker columns such as error_detail are not requirements of
        # this migration. A broad table-IN + column-IN cross-product is wrong.
        self.assertIn('(c.relname,a.attname) IN (', audit.SQL)
        pairs = re.findall(r"\('(application_[a-z_]+)','([a-z_]+)'\)", audit.SQL)
        expected = [(table, column) for table, fields in audit.COLUMNS.items() for column in fields]
        self.assertCountEqual(pairs, expected)

    def test_requirements_are_all_delivery_migration_additions(self):
        migration = (Path(__file__).resolve().parents[3] /
            'supabase/migrations/025_application_delivery_lifecycle.sql').read_text()
        actual = re.findall(r'CREATE FUNCTION public\.([a-z_]+)\(', migration)
        self.assertEqual(set(actual), set(audit.FUNCTIONS))
        for fields in audit.COLUMNS.values():
            for name in fields:
                self.assertRegex(migration, r'ADD COLUMN ' + name + r'\b')


if __name__ == '__main__':
    unittest.main()
