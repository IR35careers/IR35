"""Pure synthetic adapter checks; never read real private state or call a VM."""
import inspect
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import p8_live_headers_readonly as entry
import p8_live_headers_readonly_guest as guest
from test_p8_live_header_audit import Fixture as Headers, PASSWORD, ANON, GATE, BASIC, BEARER, SHA
from test_p8_live_header_control import Journal


def full_proof():
    return {'status': 'PASS', 'containment': {
        'status': 'PASS', 'tablesEach': 62, 'sequencesEach': 2,
        'approvedSchemaExceptionsEach': 3, 'appRolePrivilegesEach': 552,
        'approvedP6RolesEach': 2, 'storageObjectsEach': 73, 'manifests': 'PASS',
        **{key: True for key in ('orderedMD5Each', 'storageSHA256Match', 'baseline552Unchanged',
            'sourceRolesUnchanged', 'rawCatalogDifferencesRetained', 'originalCaddyFilesUnchanged', 'privateFixtureRunningNoPorts')},
        'sourceWrites': 0, 'pristineWrites': 0, 'fixtureWrites': 0},
        'freshReadOnlyHBAProof': {'status': 'PASS', 'checks': 112, 'queueSuccesses': 8,
            'applicationRejections': 104, 'functionCalls': 0,
            'noContainerCreated': True, 'noReloadRestartOrConfigWrite': True},
        'freshLoginChecks': [{'passed': True} for _ in range(112)],
        **{name: {'status': 'PASS', 'tables': ['PUBLIC_FIXTURE_ONLY'] * 62, 'sequenceChecks': 2,
            'schema': {'status': 'PASS_WITH_APPROVED_P6_ADDITIONS', 'baseline552Unchanged': True,
                'unexplainedDifferences': [], 'exceptions': [{'object': name} for name in sorted(guest.EXCEPTIONS)]}}
            for name in ('pristine', 'P5Fixture')}}


class Fixture:
    def __init__(self):
        self.headers, self.events = Headers(), []
        self.runtime_changed = False
        self.bad_containment = False
        self.inspect_count = 0

    def inspect(self):
        self.events.append('inspect')
        self.inspect_count += 1
        return {'status': 'PASS', 'identity': 'CHANGED' if self.runtime_changed and self.inspect_count > 1 else 'PUBLIC_FIXTURE_ONLY'}

    def containment(self, stage):
        self.events.append('containment')
        proof = full_proof()
        if self.bad_containment:
            proof['containment']['tablesEach'] = 61
        return proof

    def ops(self):
        return {'inspect': self.inspect, 'containment': self.containment,
            'private_env': self.headers.private_env, 'tls_request': self.headers.tls_request,
            'http_request': self.headers.http_request}


class LiveReadOnlyAdapterTests(unittest.TestCase):
    def observe(self, fixture=None, store=None, data=None):
        fixture = fixture or Fixture()
        store = store or Journal(str(guest.JOURNAL))
        data = data or {'headerAuditSourceSHA': 'c' * 40,
            'headDecision': 'HEADERS_ALREADY_PRESENT_NO_ACTIVATION', 'build': {'sourceSHA': SHA}}
        return guest.observe(data, {'read_env': fixture.headers.read_env}, store, fixture.ops()), fixture, store

    def test_live_adapter_runs_fourteen_real_transport_calls_and_original_containment_twice(self):
        result, fixture, store = self.observe()
        self.assertEqual(result['status'], 'PASS')
        self.assertEqual(fixture.events, ['inspect', 'containment', 'containment', 'inspect'])
        self.assertEqual(len(fixture.headers.calls) + len(fixture.headers.http_calls), 14)
        self.assertEqual(result['postContainment']['freshHbaChecks'], 112)
        self.assertTrue(result['originalRuntimeUnchanged'])
        self.assertFalse(result['activationPerformed'])
        self.assertFalse(result['phaseComplete'])
        self.assertEqual(len(result['steps']), 7)
        self.assertTrue(any(name == 'case-app-health-current.json' for _, name in store.files))

    def test_health_503_cannot_be_accepted_or_trigger_an_activation(self):
        fixture = Fixture()
        fixture.headers.old_health = True
        result, fixture, store = self.observe(fixture)
        self.assertEqual(result['status'], 'FAIL')
        self.assertEqual(result['code'], 'AllFourteenUnchangedLiveGetCasesRequired')
        self.assertEqual(fixture.events.count('containment'), 2)
        health = next(json.loads(body) for (_, name), body in store.files.items() if name == 'case-app-health-current.json')
        self.assertEqual(health['actualStatus'], 503)
        self.assertEqual(health['expectedStatus'], 200)
        self.assertFalse(result['activationPerformed'])

    def test_missing_redirect_headers_remains_failure_with_all_cases_retained_and_post_checks(self):
        fixture = Fixture()
        fixture.headers.redirect_headers_missing = True
        result, fixture, _ = self.observe(fixture)
        self.assertEqual(result['status'], 'FAIL')
        self.assertEqual(len(fixture.headers.calls) + len(fixture.headers.http_calls), 14)
        self.assertEqual(fixture.events.count('containment'), 2)
        self.assertFalse(result['activationPerformed'])

    def test_pre_containment_failure_prevents_every_header_request_and_attempts_post_containment(self):
        fixture = Fixture()
        fixture.bad_containment = True
        result, fixture, _ = self.observe(fixture)
        self.assertEqual(result['status'], 'FAIL')
        self.assertEqual(fixture.headers.calls + fixture.headers.http_calls, [])
        self.assertEqual(fixture.events.count('containment'), 2)
        self.assertIn('postContainmentCode', result)

    def test_runtime_identity_or_restart_change_is_not_hidden_by_passing_headers(self):
        fixture = Fixture()
        fixture.runtime_changed = True
        result, _, _ = self.observe(fixture)
        self.assertEqual(result['status'], 'FAIL')
        self.assertEqual(result['runtimeCode'], 'OriginalRuntimeReadbackMismatch_HardStop')

    def test_full_containment_projection_keeps_exact_counts_all_logins_and_exception_set(self):
        changes = [lambda p: p['containment'].update(appRolePrivilegesEach=551),
            lambda p: p['freshLoginChecks'].pop(),
            lambda p: p['freshLoginChecks'][0].update(passed=False),
            lambda p: p['P5Fixture']['schema']['exceptions'].pop(),
            lambda p: p['pristine']['schema'].update(unexplainedDifferences=[{'object': 'PUBLIC_FIXTURE'}])]
        for change in changes:
            with self.subTest(change=change):
                proof = full_proof()
                change(proof)
                with self.assertRaises(guest.ReadOnlyStop):
                    guest.containment_projection(proof)

    def test_exception_messages_and_staging_credentials_cannot_escape_in_results(self):
        fixture = Fixture()
        fixture.headers.response_error = True
        result, _, store = self.observe(fixture)
        text = json.dumps(result) + ''.join(body.decode() for body in store.files.values())
        self.assertEqual(result['status'], 'FAIL')
        for secret in (PASSWORD, ANON, GATE, BASIC, BEARER):
            self.assertNotIn(secret, text)

    def test_evidence_failure_retains_unsealed_stage_and_runs_only_final_readonly_checks(self):
        class BrokenJournal(Journal):
            def put(self, stage, name, content):
                if stage.endswith('-all-path-get-headers') and name == 'case-sdk-missing.json':
                    raise OSError('PUBLIC_FIXTURE_WRITE_FAILURE')
                return super().put(stage, name, content)
        result, fixture, _ = self.observe(store=BrokenJournal(str(guest.JOURNAL)))
        self.assertEqual(result['status'], 'FAIL')
        self.assertEqual(fixture.events.count('containment'), 2)
        self.assertEqual(len(fixture.headers.calls), 1)

    def test_old_or_used_native_slot_and_wrong_decision_stop_before_requests(self):
        with self.assertRaises(guest.ReadOnlyStop):
            self.observe(store=Journal('/opt/ir35/.env.OLD_USED_SLOT'))
        fixture, store = Fixture(), Journal(str(guest.JOURNAL))
        self.observe(fixture, store)
        calls = len(fixture.headers.calls)
        # A repeated run fails on the first exclusive intent; no GET is replayed.
        with self.assertRaises(guest.ReadOnlyStop):
            self.observe(fixture, store)
        self.assertEqual(len(fixture.headers.calls), calls)
        with self.assertRaises(guest.ReadOnlyStop):
            self.observe(data={'headerAuditSourceSHA': 'c' * 40, 'headDecision': 'ACTIVATE'})

    def test_cleartext_adapter_is_only_fixed_loopback_get_and_never_receives_credentials(self):
        class Reply:
            status = 308
            def read(self, count): self.count = count; return b''
            def getheaders(self): return [('Location', 'https://staging.ir35careers.com/jobs')]
        reply = Reply()
        with patch.object(guest.http.client, 'HTTPConnection') as connect:
            connection = connect.return_value
            connection.getresponse.return_value = reply
            result = guest.http_request(guest.WEB, 'GET', '/jobs', {'X-IR35-Client-Request-ID': 'a' * 36})
            connect.assert_called_once_with('127.0.0.1', 80, timeout=8)
            self.assertEqual(result[0], 308)
            request_headers = connection.request.call_args.kwargs['headers']
            self.assertEqual(set(request_headers), {'Host', 'Connection', 'Accept-Encoding', 'X-IR35-Client-Request-ID'})
            connection.close.assert_called_once()
            with self.assertRaises(guest.ReadOnlyStop):
                guest.http_request(guest.WEB, 'GET', '/jobs', {'Authorization': BASIC})
            self.assertEqual(connect.call_count, 1)

    def test_bundle_is_compile_only_offline_and_dispatches_only_new_readonly_adapter(self):
        base = 'import json,types,sys\nruntime={}\n'
        source = entry.program({'public': 'fixture'}, base_bundle=base)
        compile(source, '<PUBLIC_COMPILER_FIXTURE_ONLY>', 'exec')
        self.assertIn("sys.modules['p8_live_headers_readonly_guest'].native_run", source)
        body = inspect.getsource(guest.native_run) + inspect.getsource(guest.inspect_runtime)
        for forbidden in ('activate(', 'restart(', "'docker', 'run'", "'docker', 'start'", 'systemctl',
                          'CREATE DATABASE', 'INSERT INTO', 'ensure_session(', 'write_text('):
            self.assertNotIn(forbidden, body)
        with patch.dict(sys.modules, {'cloud_schema': None}):
            with self.assertRaisesRegex(RuntimeError, '^FixedReadOnlyHeaderInvocationRequired$'):
                entry.main(['--activate'])

    def test_prior_head_proof_is_hash_bound_and_does_not_become_activation_permission(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            value = {'status': 'PASS', 'activationRequired': False, 'activationPerformed': False,
                'initialRequiredHeadersPresent': True, 'cases': [
                    {'host': host, 'status': 'PASS', 'actualStatus': 401, 'method': 'HEAD',
                     'credentialsSent': False, 'noStore': True, 'noindex': True}
                    for host in ('staging.ir35careers.com', 'api-staging.ir35careers.com')]}
            (root / '01-first-heads-result.json').write_text(json.dumps(value))
            self.assertEqual(entry.head_decision(root, lambda path: entry.HEAD_SHA)['headDecision'],
                'HEADERS_ALREADY_PRESENT_NO_ACTIVATION')
            with self.assertRaises(RuntimeError): entry.head_decision(root, lambda path: 'a' * 64)
            value['activationRequired'] = True
            (root / '01-first-heads-result.json').write_text(json.dumps(value))
            with self.assertRaises(RuntimeError): entry.head_decision(root, lambda path: entry.HEAD_SHA)


if __name__ == '__main__':
    unittest.main()
