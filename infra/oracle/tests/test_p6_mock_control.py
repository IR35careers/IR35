import base64
import hashlib
import hmac
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import Mock, patch
import urllib.error

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from p6_mock_control import Control, NoRedirect
from p4_recovery_guest import RecoveryError


class MockControlTests(unittest.TestCase):
    def test_only_fixed_loopback_routes_and_no_redirect_or_proxy(self):
        with patch('p6_mock_control.urllib.request.build_opener') as opener:
            control = Control('a' * 64)
            for method, path in (('GET', 'https://outside.invalid'), ('POST', '/api/apply'), ('GET', '/health?next=outside'), ('DELETE', '/mock/applications')):
                with self.assertRaises(RecoveryError):
                    control.request(method, path)
            opener.return_value.open.assert_not_called()
        self.assertIsNone(NoRedirect().redirect_request(None, None, 302, '', {}, 'https://outside.invalid'))
        self.assertNotIn('a' * 64, repr(control))

    def test_signature_matches_node_protocol_without_putting_secret_in_url(self):
        reply = Mock()
        reply.status = 200
        reply.read.return_value = b'{"paused":true,"realAcceptance":false}'
        reply.__enter__ = Mock(return_value=reply)
        reply.__exit__ = Mock(return_value=False)
        with patch('p6_mock_control.time.time', return_value=1792910000), patch('p6_mock_control.urllib.request.build_opener') as opener:
            opener.return_value.open.return_value = reply
            control = Control('a' * 64)
            status, body = control.request('POST', '/mock/maintenance', {'action': 'pause'})
            request = opener.return_value.open.call_args.args[0]
        self.assertEqual(status, 200)
        self.assertTrue(body['paused'])
        self.assertEqual(request.full_url, 'http://127.0.0.1:8787/mock/maintenance')
        self.assertEqual(json.loads(request.data), {'action': 'pause'})
        expected = base64.urlsafe_b64encode(hmac.new(('a' * 64).encode(), b'ir35-staging-mock-v1.1792910000000.POST./mock/maintenance.{"action":"pause"}', hashlib.sha256).digest()).decode().rstrip('=')
        self.assertEqual(request.get_header('X-ir35-mock-signature'), expected)

    def test_provider_errors_cannot_echo_headers_or_credentials(self):
        with patch('p6_mock_control.urllib.request.build_opener') as opener:
            opener.return_value.open.side_effect = urllib.error.HTTPError('http://127.0.0.1', 401, 'a' * 64, {}, None)
            with self.assertRaisesRegex(RecoveryError, '^MockControlHTTP_401$') as error:
                Control('a' * 64).request('GET', '/health')
        self.assertNotIn('a' * 64, str(error.exception))


if __name__ == '__main__':
    unittest.main()
