"""RAM-only transport fixtures, never VM/cloud/network or private-state tests."""
import base64
import copy
import inspect
import json
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import p8_live_header_audit as audit


PASSWORD = 'public-fixture-password-not-real'
ANON = 'public-fixture-anon-key-not-real'
GATE = 'a' * 64
SHA = 'b' * 40
BASIC = 'Basic ' + base64.b64encode(('ir35:' + PASSWORD).encode()).decode()
BEARER = 'Bearer ' + ANON
REQUEST_ID = '01234567-89ab-4cde-8123-0123456789ab'


class MemoryStore:
    def __init__(self):
        self.artifacts = {}

    def put(self, stage, name, content):
        key = (stage, name)
        if key in self.artifacts:
            raise FileExistsError('ExclusiveFixtureSlotAlreadyExists')
        self.artifacts[key] = bytes(content)


class Fixture:
    def __init__(self):
        self.calls = []
        self.http_calls = []
        self.private_paths = []
        self.error_headers_missing = False
        self.redirect_headers_missing = False
        self.bad_sdk_status = False
        self.old_health = False
        self.echo_credentials_in_headers = False
        self.response_error = False

    def private_env(self, path):
        self.private_paths.append(path)
        return {'STAGING_GATE_TOKEN': GATE}

    def read_env(self):
        return {'STAGING_BASIC_PASSWORD': PASSWORD, 'ANON_KEY': ANON}

    def headers(self, route, *, challenge=False):
        value = {'cache-control': 'no-store', 'x-robots-tag': 'noindex, nofollow, noarchive',
                 'x-caddy-request-id': REQUEST_ID, 'x-ir35-matched-route': route,
                 'content-type': 'application/json'}
        if challenge:
            value['www-authenticate'] = 'Basic realm="restricted"'
            if self.error_headers_missing:
                del value['cache-control']
                del value['x-robots-tag']
        if self.echo_credentials_in_headers:
            value['content-type'] = PASSWORD
            value['x-upstream-route'] = BEARER + '/' + GATE
        return value

    def tls_request(self, host, method, path, headers):
        self.calls.append((host, method, path, copy.deepcopy(headers)))
        if self.response_error:
            raise ValueError(PASSWORD + '/' + BEARER + '/' + GATE)
        if host == audit.WEB and path == '/supabase/auth/v1/health':
            valid = headers.get('Cookie') == '__Host-ir35-staging=' + GATE
            status = 200 if valid else 401
            if valid and self.bad_sdk_status:
                status = 404
            return status, self.headers('sdk-proxy' if valid else 'sdk-guard'), b'{}'
        if host == audit.WEB and path == '/supabase/not-supported':
            return 404, self.headers('sdk-fallback'), b'{}'
        if host == audit.WEB and headers.get('Authorization') != BASIC:
            return 401, self.headers('basic-auth-rejection', challenge=True), b''
        if host == audit.API:
            if headers.get('X-Staging-Authorization') != BASIC:
                return 401, self.headers('api-basic-rejection', challenge=True), b''
            if path == '/not-supported':
                return 404, self.headers('api-fallback'), b'{}'
            return 200, self.headers('api-proxy'), b'{}'
        if path == '/jobs':
            reply = self.headers('page-proxy')
            reply['set-cookie'] = '__Host-ir35-staging=' + GATE + '; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=1800'
            return 200, reply, b'<html><h1>Find your next contract</h1></html>'
        if path == '/api/health':
            value = {'ok': True, 'buildSHA': SHA,
                     'checks': {name: 'ready' for name in audit.HEALTH_COMPONENTS}}
            if self.old_health:
                value['checks']['worker'] = 'not-configured'
            return 503 if self.old_health else 200, self.headers('page-proxy'), json.dumps(value).encode()
        raise AssertionError('UnexpectedSyntheticRoute')

    def http_request(self, host, method, path, headers):
        self.http_calls.append((host, method, path, copy.deepcopy(headers)))
        value = self.headers('https-redirect')
        value['location'] = 'https://' + host + path
        if self.redirect_headers_missing:
            for key in ('cache-control', 'x-robots-tag', 'x-caddy-request-id', 'x-ir35-matched-route'):
                del value[key]
        return 308, value, b''


class LiveHeaderAuditTests(unittest.TestCase):
    def run_audit(self, fixture=None, store=None, **overrides):
        fixture = fixture or Fixture()
        store = store or MemoryStore()
        options = {'runtime': {'read_env': fixture.read_env}, 'private_env': fixture.private_env,
                   'tls_request': fixture.tls_request, 'http_request': fixture.http_request,
                   'store': store, 'stage': 'fresh-header-stage', 'expected_build_sha': SHA,
                   'current_runtime_verified': True}
        options.update(overrides)
        return audit.audit_headers(**options), fixture, store

    def test_all_fourteen_get_only_cases_use_the_existing_sdk_contract(self):
        result, fixture, store = self.run_audit()
        self.assertEqual(result['status'], 'PASS')
        self.assertEqual(len(result['cases']), 14)
        sdk = [row['actualStatus'] for row in result['cases'] if row['case'].startswith('sdk-') and row['case'] != 'sdk-fallback']
        self.assertEqual(sdk, [401, 401, 200])
        self.assertEqual(len(fixture.calls), 12)
        self.assertEqual(len(fixture.http_calls), 2)
        self.assertEqual({row[1] for row in fixture.calls + fixture.http_calls}, {'GET'})
        self.assertEqual({row[0] for row in fixture.calls + fixture.http_calls}, {audit.WEB, audit.API})
        self.assertEqual(fixture.private_paths, [Path('/opt/ir35/.env.p5-caddy')])
        self.assertFalse(result['phaseComplete'])
        self.assertFalse(result['containmentPerformed'])
        self.assertFalse(result['upstreamFailureInduced'])
        self.assertEqual(len(store.artifacts), 29)

    def test_every_intent_and_case_has_staging_transport_and_redacted_headers(self):
        result, _, store = self.run_audit()
        for (_, name), content in store.artifacts.items():
            value = json.loads(content)
            if name != 'result.json':
                self.assertIn(value['host'], (audit.WEB, audit.API))
                self.assertEqual(value['port'], 443 if value['scheme'] == 'https' else 80)
            self.assertNotIn(PASSWORD, content.decode())
            self.assertNotIn(ANON, content.decode())
            self.assertNotIn(GATE, content.decode())
            self.assertNotIn(BASIC, content.decode())
        serialized = json.dumps(result)
        self.assertNotIn(PASSWORD, serialized)
        self.assertNotIn(GATE, serialized)
        self.assertIn('__Host-ir35-staging=<redacted>', serialized)

    def test_missing_error_headers_fail_without_hiding_following_cases(self):
        fixture = Fixture()
        fixture.error_headers_missing = True
        result, fixture, _ = self.run_audit(fixture)
        self.assertEqual(result['status'], 'FAIL')
        self.assertEqual(len(fixture.calls) + len(fixture.http_calls), 14)
        cases = {row['case']: row for row in result['cases']}
        self.assertFalse(cases['basic-invalid']['checks']['noStore'])
        self.assertFalse(cases['basic-invalid']['checks']['noindex'])
        self.assertTrue(cases['basic-invalid']['checks']['challengeRetained'])
        self.assertTrue(cases['sdk-valid']['passed'])
        self.assertTrue(cases['http-api-redirect']['passed'])

    def test_builtin_redirect_missing_headers_and_diagnostics_is_a_real_failure(self):
        fixture = Fixture()
        fixture.redirect_headers_missing = True
        result, _, _ = self.run_audit(fixture)
        self.assertEqual(result['status'], 'FAIL')
        for row in result['cases'][-2:]:
            self.assertEqual(row['actualStatus'], 308)
            self.assertFalse(row['checks']['requestId'])
            self.assertFalse(row['checks']['matchedRoute'])
            self.assertFalse(row['checks']['noStore'])
            self.assertFalse(row['checks']['noindex'])
            self.assertTrue(row['checks']['exactHttpsLocation'])

    def test_http_never_receives_credentials_or_follows_a_redirect(self):
        result, fixture, _ = self.run_audit()
        for _, _, _, headers in fixture.http_calls:
            self.assertEqual(set(headers), {'X-IR35-Client-Request-ID'})
        self.assertEqual(result['redirectsFollowed'], 0)
        self.assertFalse(result['credentialsSentOverHttp'])

    def test_current_p6_health_must_not_be_waived_to_historical_503(self):
        fixture = Fixture()
        fixture.old_health = True
        result, _, _ = self.run_audit(fixture)
        health = next(row for row in result['cases'] if row['case'] == 'app-health-current')
        self.assertEqual(health['expectedStatus'], 200)
        self.assertEqual(health['actualStatus'], 503)
        self.assertFalse(health['checks']['allFiveDependenciesReady'])
        self.assertFalse(health['passed'])

    def test_wrong_sdk_status_is_retained_and_all_cases_are_still_recorded(self):
        fixture = Fixture()
        fixture.bad_sdk_status = True
        result, _, store = self.run_audit(fixture)
        self.assertEqual(result['status'], 'FAIL')
        sdk = json.loads(store.artifacts[('fresh-header-stage', 'case-sdk-valid.json')])
        self.assertEqual(sdk['expectedStatus'], 200)
        self.assertEqual(sdk['actualStatus'], 404)
        self.assertEqual(len(result['cases']), 14)

    def test_known_secrets_are_redacted_even_if_a_server_echoes_them_in_headers(self):
        fixture = Fixture()
        fixture.echo_credentials_in_headers = True
        result, _, store = self.run_audit(fixture)
        text = json.dumps(result) + ''.join(item.decode() for item in store.artifacts.values())
        for secret in (PASSWORD, ANON, GATE, BASIC, BEARER):
            self.assertNotIn(secret, text)
        self.assertIn('<redacted>', text)

    def test_transport_exception_messages_and_response_bodies_are_never_recorded(self):
        fixture = Fixture()
        fixture.response_error = True
        result, _, store = self.run_audit(fixture)
        text = json.dumps(result) + ''.join(item.decode() for item in store.artifacts.values())
        self.assertEqual(result['status'], 'FAIL')
        self.assertIn('ValueError', text)
        for secret in (PASSWORD, ANON, GATE, BASIC, BEARER):
            self.assertNotIn(secret, text)

    def test_existing_evidence_slot_refuses_replay_before_any_second_request(self):
        fixture = Fixture()
        store = MemoryStore()
        self.run_audit(fixture, store)
        original = dict(store.artifacts)
        with self.assertRaises(FileExistsError):
            self.run_audit(fixture, store)
        self.assertEqual(store.artifacts, original)
        self.assertEqual(len(fixture.calls) + len(fixture.http_calls), 14)

    def test_missing_current_runtime_attestation_or_bad_sha_makes_zero_requests(self):
        for change in ({'current_runtime_verified': False}, {'expected_build_sha': 'not-a-build'},
                       {'expected_build_sha': 'b' * 41}):
            with self.subTest(change=change):
                fixture = Fixture()
                with self.assertRaisesRegex(audit.HeaderAuditError, '^VerifiedCurrentP6RuntimeRequired$'):
                    self.run_audit(fixture, **change)
                self.assertEqual(fixture.calls + fixture.http_calls + fixture.private_paths, [])

    def test_malformed_credential_rejected_before_transport_without_echo(self):
        fixture = Fixture()
        with self.assertRaisesRegex(audit.HeaderAuditError, '^ExistingRamOnlyStagingCredentialsRequired$') as raised:
            self.run_audit(fixture, runtime={'read_env': lambda: {'STAGING_BASIC_PASSWORD': PASSWORD + '\n', 'ANON_KEY': ANON}})
        self.assertNotIn(PASSWORD, str(raised.exception))
        self.assertEqual(fixture.calls + fixture.http_calls, [])

    def test_source_defines_no_native_transport_or_mutation_primitive(self):
        source = inspect.getsource(audit)
        for forbidden in ('import socket', 'import ssl', 'import subprocess', 'import requests',
                          'urlopen(', 'docker ', 'systemctl ', 'write_text(', 'open(',
                          'sdk_owner1.run(', 'sdk_owner1.activate(', 'web_edge.activate('):
            self.assertNotIn(forbidden, source)
        self.assertNotIn("'POST'", inspect.getsource(audit.audit_headers))


if __name__ == '__main__':
    unittest.main()
