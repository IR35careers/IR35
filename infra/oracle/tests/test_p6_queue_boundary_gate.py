import copy
import json
from pathlib import Path
import sys
import unittest
from tempfile import TemporaryDirectory
from unittest.mock import Mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from immutable_artifacts import digest
from p4_recovery_guest import RecoveryError
import p6_queue_boundary_gate as gate
from test_p6_queue_hba import DATABASES, parsed


def fixture():
    body = b'fixture current hba bytes'
    custody = {'uid': 105, 'gid': 105, 'mode': 384}
    raw = {'status': 'REVIEW_REQUIRED', 'databases': [
        {'database': 'postgres', 'outsideQueueDefiners': []},
        {'database': 'ir35_p5_app', 'outsideQueueDefiners': [{'function': 'fixture()', 'role': 'ir35_queue'}]}]}
    containment = {'status': 'PASS', 'tablesEach': 62, 'orderedMD5Each': True, 'sequencesEach': 2,
                   'approvedSchemaExceptionsEach': 3, 'appRolePrivilegesEach': 552,
                   'storageObjectsEach': 73, 'storageSHA256Match': True, 'baseline552Unchanged': True,
                   'sourceRolesUnchanged': True, 'approvedP6RolesEach': 2}
    proof = {'status': 'PASS', 'stage': '10-owner-queue-hba-boundary', 'queueOnlyConnectionBoundary': 'PASS',
             'baseline552Changed': False, 'functionCalls': 0, 'rawFunctionFindingRetained': True,
             'inaccessibleApplicationFunctions': True, 'postmasterStartUnchanged': True, 'reloaded': True,
             'queueDatabase': 'postgres', 'applicationDataMustNeverBeRestoredIntoQueueDatabase': True,
             'containment': containment, 'rawFunctionScopeBefore': raw, 'rawFunctionScopeAfter': raw,
             'backup': {'originalPath': '/etc/postgresql/pg_hba.conf', 'originalCustody': custody},
             'candidateSHA256': digest(body), 'databasesWithConnections': DATABASES,
             'disabledDatabaseRules': [], 'loginChecks': []}
    for name in ('roleWrites', 'grantWrites', 'customerWrites', 'passwordChanges', 'postgresRestarts',
                 'workerStarts', 'ociNetworkChanges'):
        proof[name] = 0
    for role in gate.ROLES:
        for database in DATABASES:
            for transport in gate.TRANSPORTS:
                queue = database == 'postgres'
                proof['loginChecks'].append({'role': role, 'database': database, 'transport': transport,
                    'passed': True, 'applicationFunctionCalled': False, 'exitCode': 0 if queue else 2,
                    'connectedAsExpected': queue, 'explicitHBAReject': not queue})
    failure = {'code': 'QueueRoleDefinerAccessOutsideQueueSchema_SecurityStop', 'queueFunctionScope': raw}
    info = {'hbaFile': '/etc/postgresql/pg_hba.conf', 'databases': [{'name': name, 'allowConnections': True} for name in DATABASES],
            'queueSessions': [{'role': 'ir35_queue', 'database': 'postgres'}]}
    return [proof, failure, raw, info, body, custody, parsed()]


class BoundaryGateTests(unittest.TestCase):
    def test_public_pass_cannot_replace_sealed_native_failure(self):
        with TemporaryDirectory() as temporary:
            root = Path(temporary)
            stage = root / '10-owner-queue-hba-boundary'
            stage.mkdir()
            (stage / 'result.json').write_text(json.dumps({'status': 'FAIL', 'code': 'actual denial mismatch'}))
            store = Mock(root=root)
            report = {'stage': stage.name, 'manifestSHA256': 'a' * 64, 'status': 'PASS'}
            with self.assertRaisesRegex(RecoveryError, 'PublicProofDiffersFromSealedNativeResult'):
                gate.anchored_result(store, report)
            store.verify.assert_called_once_with(stage.name, 'a' * 64)
            report.update(status='FAIL', code='actual denial mismatch')
            self.assertEqual(gate.anchored_result(store, report)['status'], 'FAIL')

    def test_connection_boundary_pass_preserves_raw_review_required_finding(self):
        data = fixture()
        original = copy.deepcopy(data[2])
        result = gate.require_proof(*data)
        self.assertEqual(result['status'], 'PASS')
        self.assertEqual(result['rawFunctionACLStatus'], 'REVIEW_REQUIRED')
        self.assertEqual(data[2], original)
        self.assertFalse(result['baseline552Changed'])

    def test_any_missing_duplicate_wrong_or_unproven_login_is_not_pass(self):
        variants = []
        value = fixture(); value[0]['loginChecks'].pop(); variants.append(value)
        value = fixture(); value[0]['loginChecks'].append(value[0]['loginChecks'][0]); variants.append(value)
        for field, observed in [('passed', False), ('explicitHBAReject', False), ('exitCode', 0), ('applicationFunctionCalled', True)]:
            value = fixture()
            next(row for row in value[0]['loginChecks'] if row['database'] == 'ir35_p5_app')[field] = observed
            variants.append(value)
        for value in variants:
            with self.assertRaises(RecoveryError): gate.require_proof(*value)

    def test_changed_hba_custody_inventory_sessions_acl_or_baseline_fail_closed(self):
        variants = []
        value = fixture(); value[4] = b'changed'; variants.append(value)
        value = fixture(); value[5] = value[5] | {'mode': 438}; variants.append(value)
        value = fixture(); value[3]['databases'].append({'name': 'new_app', 'allowConnections': True}); variants.append(value)
        value = fixture(); value[3]['queueSessions'][0]['database'] = 'ir35_p5_app'; variants.append(value)
        value = fixture(); value[2] = value[2] | {'status': 'PASS'}; variants.append(value)
        value = fixture(); value[0]['containment']['appRolePrivilegesEach'] = 551; variants.append(value)
        value = fixture(); value[0]['baseline552Changed'] = True; variants.append(value)
        value = fixture(); value[0]['grantWrites'] = 1; variants.append(value)
        value = fixture(); value[6][0]['auth_method'] = 'trust'; variants.append(value)
        for value in variants:
            with self.assertRaises((RecoveryError, ValueError)): gate.require_proof(*value)


if __name__ == '__main__':
    unittest.main()
