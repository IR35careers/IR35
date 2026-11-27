import copy
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import p8_lifecycle_owner31 as owner
import p8_lifecycle_protocol as wire
import p8_backup_policy as scope

ROOT = 'ocid1.tenancy.oc1..publicfixture0001'
BASE = {'id': 'ocid1.policy.oc1..originalfixture01', 'name': 'original',
        'statements': ['Original unmodified owner policy'], 'compartment-id': ROOT,
        'lifecycle-state': 'ACTIVE'}
CAPTURE = Path(__file__).resolve().parents[3] / 'docs/evidence/p8/lifecycle-cli-shape-diagnosis-20261030-01/serialization-mismatch.json'


class Journal:
    def __init__(self):
        self.values = {}
    def put(self, name, value):
        if name in self.values:
            raise AssertionError('Evidence overwrite')
        self.values[name] = copy.deepcopy(value)
    def verify(self):
        pass


def immediate(read, **options):
    value = read()
    if value is None:
        raise AssertionError('Fixture unexpectedly pending')
    return value


class FakeApi:
    def __init__(self):
        self.ids, self.calls = set(), []
        self.rows = {'groups': [], 'root-policies': [copy.deepcopy(BASE)], 'child-policies': []}
        self.lifecycle, self.lifecycle_etag = None, None
        self.failure = None
        self.changed_etag = False

    def identifier(self, value, kind):
        if not value.startswith('ocid1.' + kind + '.'):
            raise AssertionError('Bad fixture identifier')
        return value

    def lifecycle_or_absent(self):
        self.calls.append(('lifecycle-or-absent', {}))
        return None if self.lifecycle is None else self.call('get-lifecycle')

    def call(self, operation, **selectors):
        self.calls.append((operation, selectors))
        if operation == self.failure:
            raise owner.OwnerRunError('SimulatedBoundedFailure')
        if operation in self.rows:
            return {'data': copy.deepcopy(self.rows[operation])}
        if operation.startswith('create-') and operation != 'create-lifecycle':
            spec = next(spec for spec in owner.specifications(ROOT) if spec['create'] == operation)
            row = {'id': 'ocid1.' + spec['kind'] + '.oc1..' + spec['name'].replace('-', '') + '01',
                   'name': spec['name'], 'compartment-id': spec['compartment'],
                   'lifecycle-state': 'ACTIVE', 'freeform-tags': copy.deepcopy(owner.TAGS)}
            row['matching-rule' if spec['kind'] == 'dynamicgroup' else 'statements'] = spec['definition']
            self.rows[spec['list']].append(row)
            return {'data': copy.deepcopy(row), 'etag': '"created-' + spec['name'] + '"'}
        if operation in ('get-group', 'get-policy'):
            row = next(row for values in self.rows.values() for row in values if row['id'] == selectors['identifier'])
            tag = '"created-' + row['name'] + '"'
            if self.changed_etag:
                tag = '"foreign-updated"'
            return {'data': copy.deepcopy(row), 'etag': tag}
        if operation == 'create-lifecycle':
            if self.lifecycle is not None:
                raise owner.OwnerRunError('CreateOnlyPreconditionFailed')
            self.lifecycle = json.loads(CAPTURE.read_bytes())['installedCliSerializedItems']
            self.lifecycle_etag = '"created-lifecycle"'
            return {'data': {'items': copy.deepcopy(self.lifecycle)}, 'etag': self.lifecycle_etag}
        if operation == 'get-lifecycle':
            return {'data': {'items': copy.deepcopy(self.lifecycle)}, 'etag': self.lifecycle_etag}
        if operation == 'delete-created-lifecycle':
            if selectors['expected_etag'] != self.lifecycle_etag:
                raise AssertionError('Unsafe deletion ETag')
            self.lifecycle = None
            return {'data': None}
        if operation in ('delete-created-policy', 'delete-created-group'):
            for rows in self.rows.values():
                rows[:] = [row for row in rows if row['id'] != selectors['identifier']]
            return {'data': None}
        raise AssertionError('Unexpected fake operation')


class Owner31Tests(unittest.TestCase):
    def setUp(self):
        self.api, self.journal = FakeApi(), Journal()
        self.checks = []
        self.run = owner.OwnerRun(self.api, self.journal, ROOT,
            lambda name, **options: self.checks.append((name, options)), immediate)
        self.root_sha = patch.object(owner, 'ROOT_POLICY_SHA', owner.sha(BASE['statements']))
        self.root_sha.start()
        self.addCleanup(self.root_sha.stop)

    def test_success_is_exact_three_creates_and_one_create_only_lifecycle(self):
        result = self.run.execute()
        self.assertEqual(result['status'], 'PASS')
        creates = [name for name, _ in self.api.calls if name.startswith('create-')]
        self.assertEqual(creates, ['create-group', 'create-vm-policy', 'create-service-policy', 'create-lifecycle'])
        self.assertEqual(len(self.checks), 4)
        self.assertTrue(self.checks[-1][1]['exact_storage'])
        self.assertLess(next(index for index, row in enumerate(self.api.calls) if row[0] == 'lifecycle-or-absent'),
                        next(index for index, row in enumerate(self.api.calls) if row[0] == 'create-group'))
        self.assertEqual(owner.service_statements()[0].count('request.permission='), 1)
        self.assertEqual(owner.service_statements()[1].count('request.permission='), 3)
        self.assertNotIn('OBJECT_DELETE', scope.policy_statement())

    def test_existing_empty_policy_is_not_absent_and_causes_zero_creates(self):
        self.api.lifecycle = []
        with self.assertRaises(wire.ProtocolError):
            self.run.execute()
        self.assertFalse(any(name.startswith('create-') for name, _ in self.api.calls))
        self.assertFalse(self.run.created)

    def test_existing_exact_resources_and_policy_reused_not_deleted(self):
        self.run.execute()
        second = owner.OwnerRun(self.api, Journal(), ROOT, lambda *_args, **_kw: self.fail('No creates'), immediate)
        self.api.calls.clear()
        result = second.execute()
        self.assertFalse(any(item['created'] for item in result['resources']))
        self.assertFalse(second.created)
        self.assertFalse(result['lifecycleCreated'])
        second.rollback()
        self.assertFalse(any(name.startswith(('create-', 'delete-')) for name, _ in self.api.calls))

    def test_failure_after_creation_deletes_only_run_ids_reverse_order_and_proves_root(self):
        self.api.failure = 'create-lifecycle'
        with self.assertRaisesRegex(owner.OwnerRunError, 'SimulatedBoundedFailure'):
            self.run.execute()
        result = self.run.rollback()
        self.assertEqual(result['status'], 'PASS')
        self.assertEqual(result['createdResourcesRemoved'], 3)
        self.assertEqual(self.api.rows, {'groups': [], 'root-policies': [BASE], 'child-policies': []})
        deletes = [selectors['identifier'] for name, selectors in self.api.calls if name.startswith('delete-')]
        self.assertEqual(deletes, [item['id'] for item in self.run.created[::-1]])
        self.assertNotIn(BASE['id'], deletes)
        self.assertEqual(sum(name == 'create-lifecycle' for name, _ in self.api.calls), 1)

    def test_lifecycle_rollback_binds_creation_etag_not_new_get_etag(self):
        self.run.execute()
        self.api.lifecycle_etag = '"changed-by-another-principal"'
        with self.assertRaisesRegex(owner.OwnerRunError, 'OwnershipEtagMismatch'):
            self.run.rollback()
        self.assertFalse(any(name == 'delete-created-lifecycle' for name, _ in self.api.calls))
        self.assertEqual(self.api.rows, {'groups': [], 'root-policies': [BASE], 'child-policies': []})
        self.assertTrue(any('rollback-original-root' in name for name in self.journal.values))

    def test_iam_rollback_rejects_changed_etag_without_delete(self):
        self.api.failure = 'create-vm-policy'
        with self.assertRaises(owner.OwnerRunError):
            self.run.execute()
        self.api.changed_etag = True
        with self.assertRaisesRegex(owner.OwnerRunError, 'OwnershipEtagMismatch'):
            self.run.rollback()
        self.assertFalse(any(name.startswith('delete-') for name, _ in self.api.calls))

    def test_successful_lifecycle_created_receipt_precedes_any_readback(self):
        self.run.execute()
        rollback = self.run.rollback()
        self.assertEqual(rollback['status'], 'PASS')
        self.assertTrue(rollback['createdLifecycleRemoved'])
        self.assertIsNone(self.api.lifecycle)
        for name, selectors in self.api.calls:
            if name == 'delete-created-lifecycle':
                self.assertEqual(selectors['expected_etag'], '"created-lifecycle"')

    def test_missing_create_etag_stops_but_retains_created_id_receipt(self):
        original = self.api.call
        def call(operation, **selectors):
            result = original(operation, **selectors)
            if operation == 'create-group':
                result.pop('etag')
            return result
        self.api.call = call
        with self.assertRaisesRegex(wire.ProtocolError, 'ExactReadbackEtagRequired'):
            self.run.execute()
        self.assertEqual(len(self.run.created), 1)
        self.assertTrue(any('created-receipt' in name for name in self.journal.values))
        self.assertEqual(sum(name == 'create-group' for name, _ in self.api.calls), 1)

    def test_ambiguous_first_create_without_receipt_never_deletes_but_rechecks_root(self):
        original = self.api.call
        def call(operation, **selectors):
            result = original(operation, **selectors)
            if operation == 'create-group':
                raise owner.OwnerRunError('AmbiguousCreateResponseLost')
            return result
        self.api.call = call
        with self.assertRaisesRegex(owner.OwnerRunError, 'AmbiguousCreateResponseLost'):
            self.run.execute()
        self.assertFalse(self.run.created)
        with self.assertRaisesRegex(owner.OwnerRunError, 'UnexpectedAdditionalIamResource'):
            self.run.rollback()
        self.assertFalse(any(name.startswith('delete-') for name, _ in self.api.calls))
        self.assertEqual(sum(name == 'create-group' for name, _ in self.api.calls), 1)
        self.assertTrue(any('rollback-original-root' in name for name in self.journal.values))

    def test_native_builders_are_fixed_scopes_and_noninteractive(self):
        api = owner.NativeApi({'tenancy': ROOT}, Journal())
        api.namespace = 'publicnamespace'
        for name in ('groups', 'root-policies', 'child-policies', 'create-group',
                     'create-vm-policy', 'create-service-policy', 'create-lifecycle'):
            args = api.arguments(name)
            self.assertNotIn('in tenancy', ' '.join(args))
            self.assertNotIn('OBJECT_OVERWRITE', ' '.join(args))
        self.assertEqual(api.arguments('create-lifecycle')[-3:], ['--if-none-match', '*', '--force'])
        with self.assertRaises(owner.OwnerRunError):
            api.arguments('delete-created-policy', identifier=BASE['id'], expected_etag='"etag"')
        with self.assertRaises(owner.OwnerRunError):
            api.arguments('unapproved-operation')

    def test_foreign_same_name_is_not_reused_or_overwritten(self):
        self.run.execute()
        self.api.rows['groups'][0]['freeform-tags'] = {'owner-scope': 'someone-else'}
        second = owner.OwnerRun(self.api, Journal(), ROOT, lambda *_args, **_kw: None, immediate)
        self.api.calls.clear()
        with self.assertRaisesRegex(owner.OwnerRunError, 'OwnerTagsRequired'):
            second.execute()
        self.assertFalse(any(name.startswith(('create-', 'delete-')) for name, _ in self.api.calls))

    def test_installed_cli_render_preserves_etag_for_create_and_get(self):
        try:
            from oci_cli import cli_util
        except ImportError:
            self.skipTest('Installed OCI CLI checked in Linux runtime, not Windows Python')
        from contextlib import redirect_stdout
        from io import StringIO
        from types import SimpleNamespace
        context = SimpleNamespace(obj={'debug': False, 'query': None, 'output': 'json', 'raw_output': False})
        for payload in ({'id': 'publicfixture'}, {'items': []}):
            output = StringIO()
            with redirect_stdout(output):
                cli_util.render(payload, {'etag': '"created-etag"'}, context)
            result = wire.response(json.loads(output.getvalue()))
            self.assertEqual(result['data'], payload)
            self.assertEqual(result['etag'], '"created-etag"')
        for headers in ({}, {'opc-total-items': '0'}):
            output = StringIO()
            with redirect_stdout(output):
                cli_util.render([], headers, context)
            raw = json.loads(output.getvalue()) if output.getvalue().strip() else {}
            self.assertEqual(wire.list_response(raw), {'data': []})
        for headers in ({'opc-total-items': '1'}, {'opc-next-cursor': 'remaining'}):
            output = StringIO()
            with redirect_stdout(output):
                cli_util.render([], headers, context)
            with self.assertRaises(wire.ProtocolError):
                wire.list_response(json.loads(output.getvalue()))

    def test_native_executor_closes_stdin_keeps_etag_and_never_retries_create(self):
        try:
            import security_session
        except ImportError:
            self.skipTest('Native Linux wrapper is checked in the OCI Python runtime')
        from types import SimpleNamespace
        profile = {'tenancy': ROOT, 'user': 'publicfixtureuser', 'region': scope.REGION}
        api = owner.NativeApi(profile, Journal(), create_guard=SimpleNamespace(assert_fresh=lambda name: None))
        api.namespace = 'publicnamespace'
        serialized = json.dumps({'data': {'items': json.loads(CAPTURE.read_bytes())['installedCliSerializedItems']},
                                 'etag': '"created-etag"'})
        with patch.object(security_session, 'ensure_session', return_value=profile), \
                patch.object(security_session, 'command', side_effect=lambda args: ['fixed-cli', *args]), \
                patch.object(security_session, 'clean_environment', return_value={}), \
                patch.object(owner.subprocess, 'run', return_value=SimpleNamespace(
                    returncode=0, stdout=serialized, stderr='')) as execute:
            result = api.call('create-lifecycle')
            self.assertEqual(result['etag'], '"created-etag"')
            self.assertEqual(execute.call_count, 1)
            self.assertEqual(execute.call_args.kwargs['stdin'], owner.subprocess.DEVNULL)
            self.assertEqual(execute.call_args.args[0][-3:], ['--if-none-match', '*', '--force'])
            with self.assertRaisesRegex(owner.OwnerRunError, 'AlreadyAttempted'):
                api.call('create-lifecycle')
            self.assertEqual(execute.call_count, 1)

    def test_failed_create_is_sealed_and_does_not_get_a_second_native_call(self):
        try:
            import security_session
            from visibility import OciError
        except ImportError:
            self.skipTest('Native Linux wrapper is checked in the OCI Python runtime')
        from types import SimpleNamespace
        profile = {'tenancy': ROOT, 'user': 'publicfixtureuser', 'region': scope.REGION}
        journal = Journal()
        api = owner.NativeApi(profile, journal, create_guard=SimpleNamespace(assert_fresh=lambda name: None))
        api.namespace = 'publicnamespace'
        with patch.object(security_session, 'ensure_session', return_value=profile), \
                patch.object(security_session, 'command', side_effect=lambda args: ['fixed-cli', *args]), \
                patch.object(security_session, 'clean_environment', return_value={}), \
                patch.object(owner.subprocess, 'run', return_value=SimpleNamespace(returncode=1,
                    stdout='', stderr='{"status":412,"code":"NoEtagMatch","message":"password=not-real"}')) as execute:
            with self.assertRaises(OciError):
                api.call('create-lifecycle')
            with self.assertRaises(owner.OwnerRunError):
                api.call('create-lifecycle')
            self.assertEqual(execute.call_count, 1)
            self.assertNotIn('not-real', json.dumps(journal.values))
            self.assertTrue(journal.values['approved31-001-result.json']['ambiguousCreatePossible'])


if __name__ == '__main__':
    unittest.main()
