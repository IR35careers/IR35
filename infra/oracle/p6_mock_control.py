"""Localhost-only mock control; HMAC stays in RAM, never URLs/logs/argv."""
import base64
import hashlib
import hmac
import json
import re
import time
import urllib.error
import urllib.request
from p4_recovery_guest import RecoveryError


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, response, code, message, headers, new_url):
        return None  # Never forward the private signature to a redirect target.


class Control:
    def __init__(self, secret):
        if not isinstance(secret, str) or not re.fullmatch(r'[a-f0-9]{64}', secret):
            raise RecoveryError('ExistingPrivateMockHMACRequired')
        self._secret = secret
        self._opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())

    def __repr__(self):
        return '<private localhost mock control>'

    def request(self, method, path, value=None):
        get = method == 'GET' and (path == '/health' or re.fullmatch(r'/mock/applications/[a-f0-9-]{36}', path))
        post = method == 'POST' and (path in ('/mock/maintenance', '/mock/applications', '/mock/schedule')
                                    or re.fullmatch(r'/mock/applications/[a-f0-9-]{36}/cancel', path))
        if not (get or post):
            raise RecoveryError('FixedLocalMockMethodAndPathRequired')
        body = '' if value is None else json.dumps(value, separators=(',', ':'))
        if len(body.encode()) > 4096:
            raise RecoveryError('BoundedMockControlBodyRequired')
        stamp = str(int(time.time() * 1000))
        signed = f'ir35-staging-mock-v1.{stamp}.{method}.{path}.{body}'.encode()
        signature = base64.urlsafe_b64encode(hmac.new(self._secret.encode(), signed, hashlib.sha256).digest()).decode().rstrip('=')
        request = urllib.request.Request('http://127.0.0.1:8787' + path,
            data=body.encode() if method == 'POST' else None, method=method,
            headers={'Content-Type': 'application/json', 'X-Ir35-Mock-Timestamp': stamp, 'X-Ir35-Mock-Signature': signature})
        try:
            with self._opener.open(request, timeout=45) as reply:
                raw = reply.read(16385)
                if len(raw) > 16384:
                    raise RecoveryError('MockControlResponseLimit')
                return reply.status, json.loads(raw)
        except urllib.error.HTTPError as error:
            # No response body, headers/signature or URL goes into an error.
            raise RecoveryError('MockControlHTTP_' + str(error.code)) from None
        except (urllib.error.URLError, TimeoutError, ConnectionError, ValueError):
            raise RecoveryError('MockLocalControlUnavailable_RawSuppressed') from None
