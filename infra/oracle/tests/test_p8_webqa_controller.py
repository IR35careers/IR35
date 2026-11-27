"""Fake-I/O lifecycle tests: no .ir35, credentials, sockets, Docker or VM."""
import contextlib
import copy
import io
import json
from pathlib import Path
import sys
import types
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import p8_webqa_controller as qa

SHA = 'a' * 40
SLOT = 'writable-qa-20261123t120000z-0123abcd'
AUTHORITY = qa.Authority(SHA, SLOT, 'NEW_WRITABLE_QA_REHEARSAL_ONLY')


class Journal:
    def __init__(self): self.values = {}
    def put(self, name, value):
        if name in self.values: raise AssertionError('No overwrite')
        self.values[name] = copy.deepcopy(value)


def full():
    return {'status': 'PASS', 'tablesEach': 62, 'orderedMd5Each': True,
        'sequencesEach': 2, 'authHashParity': True, 'storageObjectsEach': 73,
        'storageSha256Match': True, 'appRolePrivilegesEach': 552, 'queueRolesEach': 2,
        'hbaActualLoginChecks': 112, 'approvedSchemaExceptionsEach': 3,
        'originalContainersUnchanged': True, 'sourceWrites': 0, 'pristineWrites': 0, 'fixtureWrites': 0}


def ledger():
    return {'status': 'PASS', 'realtimeCdcObserved': True, 'heartbeatFresh': True,
        'allQueueRowsAccounted': True, 'unexplainedRows': 0, 'realEmailMessages': 0,
        'employerPayloads': 0, 'acceptJobs': False, 'smtpSink': True, 'applyRunner': 'mock',
        'maxConcurrentBrowsers': 1, 'jobs': [
            {'jobId': qa.config.JOBS[index], 'scenario': scenario,
             'status': 'submitted' if index == 0 else 'failed', 'failure': qa.FAILURES[index],
             'mockReceipts': 1 if index == 0 else 0, 'browserAttempts': 1, 'visibleAfterReload': True}
            for index, scenario in enumerate(qa.SCENARIOS)]}


class Adapter:
    def __init__(self):
        self.calls, self.fail = [], None
        self.reports = {
            'preflight': {'status': 'PASS', 'sourceSHA': SHA, 'slot': SLOT,
                'freshOwnerAuthorityVerified': True, 'slotUnused': True, 'immutableImagesVerified': True,
                'networkInternal': True, 'certificateCustodyVerified': True, 'twoGiBHeadroom': True,
                'publicPorts': 0, 'originalRuntimeReadOnly': True, 'acceptJobs': False,
                'applyRunner': 'mock', 'smtpSink': True, 'liveProvidersConfigured': False},
            'full_containment': full(),
            'prepare_fixture': {'status': 'PASS', 'baselineExact': True, 'reviewed025': True,
                'storageObjects': 73, 'queueCloneDenials': 8, 'privateEdge': True, 'realtimeOwnedClone': True},
            'start_owned': {'status': 'PASS', 'ownedContainersAttested': True, 'queueSeededOnce': True,
                'jobsSeeded': 6, 'originalQueuesUnchanged': True, 'privateEdgeValidated': True,
                'publicPorts': 0, 'applyRunner': 'mock', 'acceptJobs': False, 'smtpSink': True},
            'sdk_gate': {'status': 'PASS', 'missingStatus': 401, 'suffixStatus': 401, 'validStatus': 200,
                'noStore': True, 'noindex': True, 'secureCookie': True},
            'open_tunnel': {'status': 'PASS', 'ownedDestinationAttested': True, 'loopbackOnly': True,
                'tlsVerified': True, 'originalEdgeRetargeted': False},
            'browser_journeys': {'status': 'PASS', 'headed': True, 'actualServerResponses': True,
                'namedAccountOnly': True, 'mockOnly': True, 'realEmailMessages': 0, 'employerRequests': 0,
                'transportErrors': 0, 'credentialsPersisted': False,
                'cases': [{'name': name, 'status': 'PASS'} for name in qa.JOURNEYS]},
            'lifecycle_proof': ledger(),
            'restart_proof': {'status': 'PASS', 'onlyOwnedWorkerRestarted': True,
                'directLocalhostShaEqual': True, 'queueLedgerUnchanged': True, 'realtimeReconnected': True,
                'orphanBrowsers': 0, 'employerPayloads': 0, 'realEmailMessages': 0},
            'close_browser': {'status': 'PASS', 'browserClosed': True},
            'close_tunnel': {'status': 'PASS', 'tunnelClosed': True},
            'stop_owned': {'status': 'PASS', 'ownedContainersAbsent': True, 'originalContainersUnchanged': True},
            'clean_queue': {'status': 'PASS', 'ownedRowsAbsent': True, 'preexistingRowsUnchanged': True},
            'destroy_clone': {'status': 'PASS', 'databaseAbsent': True},
            'clean_files': {'status': 'PASS', 'ownedFilesAbsent': True, 'ownedStorageAbsent': True, 'unrelatedPathsChanged': 0},
        }
    def __getattr__(self, name):
        if name not in self.reports: raise AttributeError(name)
        def call():
            self.calls.append(name)
            if self.fail == name: raise RuntimeError('password=NEVER_PRINT_NATIVE_VALUE')
            return copy.deepcopy(self.reports[name])
        return call


class QaControllerTests(unittest.TestCase):
    def run_flow(self, adapter=None):
        adapter = adapter or Adapter()
        journal = Journal()
        controller = qa.BoundedQaController(adapter, journal, AUTHORITY)
        return controller.run(), adapter, journal, controller

    def test_full_workflow_runs_existing_required_phases_and_cleanup_but_never_claims_native_pass(self):
        result, adapter, journal, controller = self.run_flow()
        self.assertEqual(result['status'], 'WORKFLOW_PASS_NATIVE_UNPROVEN')
        self.assertFalse(result['nativeExecutionProven']); self.assertFalse(result['phaseComplete'])
        self.assertEqual(adapter.calls, ['preflight', 'full_containment', 'prepare_fixture', 'start_owned',
            'sdk_gate', 'open_tunnel', 'browser_journeys', 'lifecycle_proof', 'restart_proof',
            'lifecycle_proof', 'close_browser', 'close_tunnel', 'stop_owned', 'clean_queue',
            'destroy_clone', 'clean_files', 'full_containment'])
        self.assertEqual(len(journal.values), 34)
        with self.assertRaisesRegex(qa.QaError, 'AlreadyUsed'): controller.run()

    def test_preflight_rejects_wrong_source_public_port_live_provider_before_any_mutation(self):
        for key, value in [('sourceSHA', 'b' * 40), ('publicPorts', 1),
                           ('freshOwnerAuthorityVerified', False), ('slotUnused', False),
                           ('liveProvidersConfigured', True), ('twoGiBHeadroom', False)]:
            with self.subTest(key=key):
                adapter = Adapter(); adapter.reports['preflight'][key] = value
                result, adapter, _, _ = self.run_flow(adapter)
                self.assertEqual(result['status'], 'FAIL')
                self.assertEqual(adapter.calls, ['preflight', 'full_containment'])

    def test_partial_prepare_start_or_tunnel_failure_always_closes_then_cleans_and_verifies(self):
        for failure in ('prepare_fixture', 'start_owned', 'open_tunnel', 'browser_journeys', 'restart_proof'):
            with self.subTest(failure=failure):
                adapter = Adapter(); adapter.fail = failure
                result, adapter, journal, _ = self.run_flow(adapter)
                self.assertEqual(result['status'], 'FAIL')
                self.assertEqual(adapter.calls[-7:], ['close_browser', 'close_tunnel', 'stop_owned',
                    'clean_queue', 'destroy_clone', 'clean_files', 'full_containment'])
                self.assertEqual(adapter.calls.count(failure), 1)
                self.assertNotIn('NEVER_PRINT', json.dumps(result) + json.dumps(journal.values))

    def test_uncertain_service_stop_never_drops_clone_and_final_containment_still_attempts(self):
        adapter = Adapter(); adapter.fail = 'stop_owned'
        result, adapter, _, _ = self.run_flow(adapter)
        self.assertEqual(result['status'], 'FAIL')
        self.assertNotIn('destroy_clone', adapter.calls); self.assertNotIn('clean_files', adapter.calls)
        self.assertEqual(adapter.calls[-1], 'full_containment')
        self.assertIn('QaCloneRetained_UncertainDisconnect_NoDrop', result['issues'])

    def test_missing_cleanup_binding_does_not_skip_remaining_cleanup_or_final_check(self):
        adapter = Adapter(); del adapter.reports['close_browser']
        result, adapter, _, _ = self.run_flow(adapter)
        self.assertEqual(result['status'], 'FAIL')
        self.assertIn('close_tunnel', adapter.calls); self.assertIn('stop_owned', adapter.calls)
        self.assertEqual(adapter.calls[-1], 'full_containment')
        self.assertNotIn('destroy_clone', adapter.calls)

    def test_all_failures_are_evidenced_and_sdk_values_are_not_weakened(self):
        adapter = Adapter(); adapter.reports['sdk_gate']['suffixStatus'] = 200
        result, adapter, journal, _ = self.run_flow(adapter)
        self.assertEqual(result['status'], 'FAIL'); self.assertNotIn('open_tunnel', adapter.calls)
        self.assertEqual(journal.values['qa-05-sdk-gate-result.json']['status'], 'FAIL')

    def test_terminal_ledger_rejects_ready_missing_error_duplicate_receipt_or_external_activity(self):
        for row_key, value in [('status', 'ready'), ('failure', ''), ('browserAttempts', 2), ('mockReceipts', 1)]:
            bad = ledger(); bad['jobs'][1][row_key] = value
            with self.subTest(row_key=row_key), self.assertRaises(qa.QaError): qa.lifecycle_result(bad)
        for key, value in [('employerPayloads', 1), ('realEmailMessages', 1), ('unexplainedRows', 1)]:
            bad = ledger(); bad[key] = value
            with self.subTest(key=key), self.assertRaises(qa.QaError): qa.lifecycle_result(bad)

    def test_evidence_projection_discards_credentials_but_preserves_all_semantic_checks(self):
        adapter = Adapter()
        for value in adapter.reports.values(): value['password'] = 'PRIVATE_SENTINEL'
        result, _, journal, _ = self.run_flow(adapter)
        self.assertEqual(result['status'], 'WORKFLOW_PASS_NATIVE_UNPROVEN')
        self.assertNotIn('PRIVATE_SENTINEL', json.dumps(result) + json.dumps(journal.values))
        self.assertFalse(result['browser']['googleLoginProven'])
        self.assertEqual(str(qa.QaError('password=PRIVATE_SENTINEL')), 'QaErrorTextWithheld')

    def test_existing_fixture_adapter_calls_real_preparation_methods_in_order_and_no_ad_hoc_start(self):
        events = []
        class Fixture:
            def create_clone(self, stage):
                events.append(('clone', stage)); return {'status': 'PASS', 'baselineExact': True, 'cloneRoleDenials': {'deniedLogins': 8}}
            def apply_reviewed_upgrade(self, stage, migration):
                events.append(('upgrade', stage, migration)); return {'status': 'PASS'}
            def copy_storage(self, stage):
                events.append(('storage', stage)); return {'status': 'PASS', 'objects': 73, 'sha256AndHeadersExact': True}
            def write_configuration(self, stage, **options):
                events.append(('configuration', stage, options)); return {'status': 'PASS', 'realtimeConfigured': True}
            def destroy_disconnected_database(self, stage):
                events.append(('destroy', stage)); return {'status': 'PASS', 'databaseAbsent': True}
        adapter = qa.ExistingFixtureAdapter(Fixture, lambda name: name, {}, 'reviewed-migration-bytes', '172.18.0.1')
        self.assertEqual(adapter.prepare_fixture()['status'], 'PASS')
        self.assertEqual([event[0] for event in events], ['clone', 'upgrade', 'storage', 'configuration'])
        self.assertEqual(events[-1][2], {'private_gateway': '172.18.0.1'})
        self.assertEqual(adapter.destroy_clone(), {'status': 'PASS', 'databaseAbsent': True})
        with self.assertRaisesRegex(qa.QaError, 'BindingMissing'): adapter.start_owned()

    def test_cli_defaults_dry_run_and_execution_refuses_before_any_private_or_native_action(self):
        for arguments in ([], ['--dry-run']):
            output = io.StringIO()
            with contextlib.redirect_stdout(output): self.assertEqual(qa.main(arguments), 0)
            result = json.loads(output.getvalue())
            self.assertEqual(result['writes'], 0); self.assertEqual(result['networkCalls'], 0)
            self.assertFalse(result['privateStateRead']); self.assertTrue(result['nativeBindingsRequired'])
        with self.assertRaisesRegex(qa.QaError, 'ExecutionNotWired'):
            qa.main(['--execute', SLOT])

    def test_import_has_no_private_state_network_or_process_dependencies(self):
        body = Path(qa.__file__).read_text()
        for forbidden in ('import cloud_schema', 'import subprocess', 'import socket', 'context()', 'run_guest('):
            self.assertNotIn(forbidden, body)
        for slot in ('browser-readonly-01', 'webqa01-native-01', 'backup-lifecycle-owner-20261031-01'):
            self.assertNotIn(slot, body)


if __name__ == '__main__': unittest.main()
