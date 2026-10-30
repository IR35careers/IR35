import json
from pathlib import Path
import sys
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import p8_webqa_edge as edge
from p8_webqa_config import ConfigError


class PrivateQaEdgeTests(unittest.TestCase):
    def test_auth_errors_have_explicit_error_chain_same_status_headers_and_no_error_detail(self):
        body = edge.caddyfile('172.18.0.1')
        error = body[body.index('    handle_errors {'):body.index('    route {\n        @not_tunnel')]
        self.assertIn('header >Cache-Control "no-store"', error)
        self.assertIn('header >X-Robots-Tag "noindex, nofollow, noarchive"', error)
        self.assertIn('header >X-Caddy-Request-ID {http.request.uuid}', error)
        self.assertIn('header -Server', error)
        self.assertIn('respond "" {err.status_code}', error)
        for forbidden in ('{err.message}', '{err.trace}', 'request_header -WWW-Authenticate', 'respond "" 200'):
            self.assertNotIn(forbidden, error)

    def test_only_actual_private_gateway_can_be_selected_never_public_metadata_or_cidr(self):
        self.assertEqual(edge.gateway_source('172.18.0.1'), '172.18.0.1/32')
        for value in ('0.0.0.0/0', '0.0.0.0', '132.145.28.134', '169.254.169.254', '127.0.0.1', '::1', '*'):
            with self.assertRaises(ConfigError): edge.gateway_source(value)

    def test_sdk_guard_order_is_literal_not_sorted_and_keeps_cookie_security(self):
        body = edge.caddyfile('172.18.0.1')
        start = body.index('handle @sdk {')
        self.assertLess(body.index('respond @missing_gate', start), body.index('uri strip_prefix', start))
        self.assertLess(body.index('uri strip_prefix', start), body.index('reverse_proxy @api', start))
        self.assertLess(body.index('reverse_proxy @api', start), body.index('respond "Not found" 404', start))
        self.assertIn('handle @sdk {\n            route {', body)
        self.assertIn('(^|;[ ]*)__Host-ir35-staging={$STAGING_GATE_TOKEN}(;|$)', body)
        self.assertIn('Secure; HttpOnly; SameSite=Strict', body)
        self.assertIn('header >Cache-Control "no-store"', body)
        self.assertIn('header >X-Robots-Tag "noindex, nofollow, noarchive"', body)

    def test_basic_is_checked_before_restoring_app_bearer_header_not_replacing_user_auth(self):
        body = edge.caddyfile('172.18.0.1')
        start = body.index('vars original_auth')
        sequence = ('vars @bearer original_auth', 'request_header @staging_header Authorization',
                    'basic_auth {', 'request_header -Authorization', 'request_header @restore_bearer Authorization',
                    'request_header -X-Staging-Authorization', 'reverse_proxy ir35-p8-webqa01-web:3000')
        positions = [body.index(value, start) for value in sequence]
        self.assertEqual(positions, sorted(positions))
        self.assertNotIn('ir35-p5-', body)
        self.assertIn('reverse_proxy @api ir35-p8-webqa01-kong:8000', body)

    def test_only_existing_readonly_certificate_paths_no_acme_or_public_edge_edit(self):
        body = edge.caddyfile('172.18.0.1')
        self.assertIn('auto_https off', body); self.assertIn('admin off', body); self.assertIn('persist_config off', body)
        self.assertIn('tls ' + edge.CERTIFICATE + '.crt ' + edge.CERTIFICATE + '.key', body)
        for forbidden in ('issuer acme', 'tls internal', 'api.ir35careers.com {', 'www.ir35careers.com {', 'admin.ir35careers.com {'):
            self.assertNotIn(forbidden, body)

    def test_caddy_has_no_port_binding_and_cannot_write_or_copy_existing_keys(self):
        value = edge.compose_service({'platform': 'linux/arm64', 'image': 'caddy:2.10.2@sha256:' + 'a' * 64})
        self.assertEqual(value['mem_limit'], '128m'); self.assertEqual(value['user'], '1002:1002')
        self.assertTrue(value['read_only']); self.assertEqual(value['logging'], {'driver': 'none'})
        self.assertIn('/opt/ir35/data/caddy:/data:ro', value['volumes'])
        for forbidden in ('ports', 'privileged', 'network_mode', 'build'): self.assertNotIn(forbidden, value)
        self.assertNotIn('/var/run/docker.sock', json.dumps(value))
        for bad in ({'platform': 'linux/amd64', 'image': 'caddy:2@sha256:' + 'a' * 64}, {'platform': 'linux/arm64', 'image': 'caddy:latest'}):
            with self.assertRaises(ConfigError): edge.compose_service(bad)

    def test_no_replacement_of_an_existing_edge_and_no_mutation_of_input_plan(self):
        plan = {'name': 'ir35-p8-webqa01', 'networks': {'backend': {'external': True, 'name': 'ir35-staging_backend'}}, 'services': {}}
        pin = {'platform': 'linux/arm64', 'image': 'caddy:2.10.2@sha256:' + 'a' * 64}
        result = edge.add_to_compose(plan, pin)
        self.assertEqual(plan['services'], {}); self.assertIn('caddy', result['services'])
        with self.assertRaises(ConfigError): edge.add_to_compose(result, pin)
