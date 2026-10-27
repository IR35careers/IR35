import copy
from pathlib import Path
import sys
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import upgrade_review as review


class UpgradeReviewTests(unittest.TestCase):
    pristine = 'ir35_p4_20261021t170139z_8be0fc2e'

    def tables(self):
        names = sorted(review.CHANGED_TABLES) + ['auth.fixture_' + str(i) for i in range(59)]
        return [{'name': name, 'algorithm': 'pg17-copy-binary-framed-text-v1', 'md5': 'a' * 32,
            'rows': '2', 'serializedBytes': '100'} for name in names]

    def privileges(self):
        rows = []
        for index in range(184):
            name = 'public.application_packets' if index == 0 else 'public.fixture_' + str(index)
            for role in ('anon', 'authenticated', 'service_role'):
                rows.append({'kind': 'table', 'name': name, 'role': role,
                    'privileges': {'SELECT': False, 'INSERT': True, 'UPDATE': True}})
        source = {'version': 1, 'roles': ['anon', 'authenticated', 'service_role'], 'entries': rows}
        target = copy.deepcopy(source)
        for name in sorted(review.DELIVERY_FUNCTIONS):
            for role in source['roles']:
                execute = role == 'service_role' or name in review.PURE_FUNCTIONS or (
                    role == 'authenticated' and name == 'save_application_draft')
                target['entries'].append({'kind': 'function', 'name': 'public.' + name + '()', 'role': role,
                    'privileges': {'EXECUTE': execute, 'EXECUTE WITH GRANT OPTION': False}})
        return source, target

    def test_drop_is_limited_to_exact_owned_disconnected_clone(self):
        target = review.clone_name(self.pristine)
        review.assert_owned_clone(self.pristine, target, 'owner', 'owner', '0')
        for candidate, comment, connections in ((self.pristine, 'owner', '0'), ('ir35_p5_app', 'owner', '0'),
                (target, 'other', '0'), (target, 'owner', '1')):
            with self.assertRaises(ValueError):
                review.assert_owned_clone(self.pristine, candidate, comment, 'owner', connections)
        for source in ('postgres', 'production', self.pristine + ';DROP DATABASE postgres', ''):
            with self.assertRaises(ValueError):
                review.clone_name(source)

    def test_allowed_upgrade_keeps_raw_changed_fingerprints_not_fake_parity(self):
        before = self.tables(); after = copy.deepcopy(before)
        for row in after[:3]:
            row['md5'] = 'b' * 32
        result = review.data_delta(before, after)
        self.assertEqual(len(result['rawChangedTables']), 3)
        self.assertFalse(result['fullMigrationFidelityClaimed'])
        self.assertEqual(result['rawChangedTables'][0]['before']['md5'], 'a' * 32)
        self.assertEqual(result['rawChangedTables'][0]['after']['md5'], 'b' * 32)
        self.assertEqual(before[0]['md5'], 'a' * 32)

    def test_unrelated_auth_data_count_or_inventory_mismatch_stops(self):
        before = self.tables()
        for mutate in (lambda rows: rows[3].update(md5='b' * 32), lambda rows: rows.pop(),
                       lambda rows: rows[0].update(rows='0'), lambda rows: rows[1].update(rows='3')):
            after = copy.deepcopy(before); mutate(after)
            with self.assertRaises(ValueError):
                review.data_delta(before, after)

    def test_only_exact_new_functions_and_narrow_old_table_restriction(self):
        before, after = self.privileges()
        row = next(row for row in after['entries'] if row['name'] == 'public.application_packets'
            and row['role'] == 'authenticated')
        row['privileges']['INSERT'] = False
        result = review.privilege_delta(before, after)
        self.assertEqual(len(result['restrictions']), 1)
        self.assertEqual(len(result['newFunctionPrivileges']), 30)
        self.assertFalse(result['baseline552Edited'])

    def test_existing_access_escalation_extra_function_or_grant_option_stops(self):
        for mutate in (lambda rows: rows[0]['privileges'].update(SELECT=True),
                lambda rows: rows[-1]['privileges'].update({'EXECUTE WITH GRANT OPTION': True}),
                lambda rows: rows[-1].update(name='public.other()'),
                lambda rows: rows.pop(), lambda rows: rows.append(copy.deepcopy(rows[0]))):
            before, after = self.privileges(); mutate(after['entries'])
            with self.assertRaises(ValueError):
                review.privilege_delta(before, after)
        before, after = self.privileges()
        row = next(row for row in after['entries'] if row['name'] == 'public.save_application_draft()' and row['role'] == 'anon')
        row['privileges']['EXECUTE'] = True
        with self.assertRaises(ValueError):
            review.privilege_delta(before, after)


if __name__ == '__main__':
    unittest.main()
