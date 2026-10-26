import json
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import p6_queue_function_scope as scope
from p4_recovery_guest import RecoveryError


class FunctionScopeTests(unittest.TestCase):
    def test_metadata_only_audit_checks_all_three_databases_without_calling_functions(self):
        calls = []
        class Database:
            database = 'fixture_pristine'
            def query(self, sql):
                calls.append(self.database)
                self_sql = sql.strip()
                if not self_sql.startswith('SELECT ') or 'pg_proc' not in sql:
                    raise AssertionError('Metadata SELECT required')
                return json.dumps({'checks': 6, 'outsideQueueDefiners': []})
        proof = scope.audit(Database())
        self.assertEqual(proof['status'], 'PASS')
        self.assertEqual(calls, ['postgres', 'fixture_pristine', 'ir35_p5_app'])
        self.assertEqual(proof['functionCalls'], 0)
        self.assertFalse(proof['baseline552Changed'])

    def test_public_inheritance_cannot_be_silently_waived_or_marked_queue_only(self):
        class Database:
            database = 'fixture_pristine'
            def query(self, sql):
                return json.dumps({'checks': 6, 'outsideQueueDefiners': [{'role': 'ir35_queue', 'function': 'public_fixture()', 'alsoAccessibleToAnon': True}]})
        self.assertEqual(scope.audit(Database())['status'], 'REVIEW_REQUIRED')

    def test_missing_checks_are_not_a_pass(self):
        class Database:
            database = 'fixture_pristine'
            def query(self, sql):
                return '{}'
        with self.assertRaises(RecoveryError):
            scope.audit(Database())


if __name__ == '__main__':
    unittest.main()
