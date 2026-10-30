"""NEW read-only edge audit primitive; no transport, activation or CLI entrypoint.

The caller owns a fresh exclusive journal and attests the current P6 app image.
Pass existing tls_request/private_env/read_env callables, never old controllers.
HTTP transport must connect to the same attested VM's loopback:80, not follow a
redirect. Credentials stay in RAM and are never sent over the HTTP transport.
"""
import base64
import json
from pathlib import Path
import re

from sdk_gate_observation import Observer, sdk_cases


WEB = 'staging.ir35careers.com'
API = 'api-staging.ir35careers.com'
ENV_PATH = Path('/opt/ir35/.env.p5-caddy')
HEALTH_COMPONENTS = {'database', 'auth', 'storage', 'realtime', 'worker'}


class HeaderAuditError(RuntimeError):
    """Fixed error codes only: no source exception, credentials or body."""


def _redact(value, secrets):
    if isinstance(value, dict):
        return {_redact(key, secrets): _redact(item, secrets) for key, item in value.items()}
    if isinstance(value, list):
        return [_redact(item, secrets) for item in value]
    if isinstance(value, str):
        for secret in secrets:
            value = value.replace(secret, '<redacted>')
    return value


class _Journal:
    """Decorate the existing Observer evidence without changing its checks."""
    def __init__(self, store, secrets):
        self.store = store
        self.secrets = tuple(sorted(set(secrets), key=len, reverse=True))
        self.host = WEB
        self.scheme = 'https'

    def scope(self, host, scheme):
        if host not in (WEB, API) or scheme not in ('https', 'http'):
            raise HeaderAuditError('FixedStagingTransportScopeRequired')
        self.host, self.scheme = host, scheme

    def put(self, stage, name, content):
        if not re.fullmatch(r'(?:intent-|case-)[a-z][a-z0-9-]{0,60}\.json|result\.json', name):
            raise HeaderAuditError('FixedHeaderAuditArtifactRequired')
        data = json.loads(content)
        if name != 'result.json':
            data.update(host=self.host, scheme=self.scheme, port=443 if self.scheme == 'https' else 80)
        # Existing Store.put remains O_EXCL/fsync/read-only. Do not replace or
        # catch its failure: lost/duplicate evidence must abort the caller.
        return self.store.put(stage, name, json.dumps(_redact(data, self.secrets), sort_keys=True).encode())


def _credential(mapping, name):
    value = mapping.get(name) if isinstance(mapping, dict) else None
    if (type(value) is not str or not value or len(value) > 8192
            or any(character in value for character in ('\r', '\n', '\x00'))):
        raise HeaderAuditError('ExistingRamOnlyStagingCredentialsRequired')
    return value


def audit_headers(*, runtime, private_env, tls_request, http_request, store, stage,
                  expected_build_sha, current_runtime_verified=False):
    """Observe GET-only paths; no retries, writes, cleanup or automatic repair.

    `current_runtime_verified` is supplied only after the enclosing read-only
    audit verifies current image/config custody, mock/sink/acceptance-false and
    the existing P6 full-health source SHA. Neither transport is called without
    that prerequisite. They must return (status, headers, bounded_body_bytes).
    This helper does NOT perform or replace the enclosing full containment.
    """
    if (current_runtime_verified is not True or type(expected_build_sha) is not str
            or not re.fullmatch(r'[0-9a-f]{40}', expected_build_sha)):
        raise HeaderAuditError('VerifiedCurrentP6RuntimeRequired')
    if not all(callable(item) for item in (private_env, tls_request, http_request)):
        raise HeaderAuditError('InjectedReadOnlyTransportsRequired')

    # Only existing staging inputs. No cloud/client/token discovery or defaults.
    values = runtime['read_env']()
    edge = private_env(ENV_PATH)
    password = _credential(values, 'STAGING_BASIC_PASSWORD')
    anon = _credential(values, 'ANON_KEY')
    gate = _credential(edge, 'STAGING_GATE_TOKEN')
    basic = 'Basic ' + base64.b64encode(('ir35:' + password).encode()).decode()
    bearer = 'Bearer ' + anon
    journal = _Journal(store, (password, anon, gate, basic, bearer))
    observer = Observer(journal, stage)
    scopes = {}

    def request(host, scheme, path, headers, request_id):
        # Exact routes are bound by the cases below, never caller-provided URLs.
        if host not in (WEB, API) or not path.startswith('/') or any(c in path for c in '\r\n?#'):
            raise HeaderAuditError('FixedStagingReadOnlyPathRequired')
        common = {'X-IR35-Client-Request-ID': request_id}
        if scheme == 'http':
            if headers:
                raise HeaderAuditError('HttpCredentialsForbidden')
            reply = http_request(host, 'GET', path, common)
        elif scheme == 'https':
            reply = tls_request(host, 'GET', path, common | headers)
        else:
            raise HeaderAuditError('FixedStagingTransportScopeRequired')
        if (not isinstance(reply, tuple) or len(reply) != 3 or type(reply[0]) is not int
                or not isinstance(reply[1], dict) or type(reply[2]) is not bytes or len(reply[2]) > 4_000_000):
            raise HeaderAuditError('BoundedReadOnlyResponseRequired')
        return reply

    def case(name, host, path, expected, headers, *, checks=None, scheme='https'):
        journal.scope(host, scheme)
        scopes[name] = (host, scheme)
        return observer.case(name, 'GET', path, expected,
            lambda rid: request(host, scheme, path, headers, rid), checks=checks)

    # Reuse original SDK checks unchanged: always record all three outcomes.
    journal.scope(WEB, 'https')
    def sdk_request(method, path, headers):
        if method != 'GET':
            raise HeaderAuditError('GetOnlyHeaderAuditRequired')
        return request(WEB, 'https', path, headers, headers['X-IR35-Client-Request-ID'])
    sdk_cases(observer, sdk_request, gate,
              headers={'apikey': anon, 'Authorization': bearer}, check_path=False)
    for name in ('sdk-missing', 'sdk-suffix', 'sdk-valid'):
        scopes[name] = (WEB, 'https')

    def route(name):
        return lambda headers, body: {'exactRoute': headers.get('x-ir35-matched-route') == name}

    def challenge(name):
        return lambda headers, body: {
            'exactRoute': headers.get('x-ir35-matched-route') == name,
            'challengeRetained': headers.get('www-authenticate') == 'Basic realm="restricted"'}

    case('jobs', WEB, '/jobs', 200, {'Authorization': basic}, checks=lambda headers, body: {
        'exactRoute': headers.get('x-ir35-matched-route') == 'page-proxy',
        'h1': bool(re.search(br'<h1[^>]*>Find your next contract</h1>', body)),
        'secureGate': headers.get('set-cookie', '').startswith('__Host-ir35-staging=' + gate + ';')
            and all(flag in headers.get('set-cookie', '') for flag in
                    ('Path=/', 'Secure', 'HttpOnly', 'SameSite=Strict', 'Max-Age=1800'))})
    case('basic-missing', WEB, '/jobs', 401, {}, checks=challenge('basic-auth-rejection'))
    case('basic-invalid', WEB, '/jobs', 401, {'Authorization': 'Basic invalid'},
         checks=challenge('basic-auth-rejection'))
    case('sdk-fallback', WEB, '/supabase/not-supported', 404,
         {'Cookie': '__Host-ir35-staging=' + gate}, checks=route('sdk-fallback'))

    auth = {'apikey': anon, 'Authorization': bearer}
    case('api-basic-missing', API, '/auth/v1/health', 401, {}, checks=challenge('api-basic-rejection'))
    case('api-basic-invalid', API, '/auth/v1/health', 401, auth | {'X-Staging-Authorization': 'Basic invalid'},
         checks=challenge('api-basic-rejection'))
    case('api-health', API, '/auth/v1/health', 200, auth | {'X-Staging-Authorization': basic},
         checks=route('api-proxy'))
    case('api-fallback', API, '/not-supported', 404, auth | {'X-Staging-Authorization': basic},
         checks=route('api-fallback'))

    def health(headers, body):
        value = json.loads(body)
        checks = value.get('checks', {})
        return {'exactRoute': headers.get('x-ir35-matched-route') == 'page-proxy',
                'currentBuildSHA': value.get('buildSHA') == expected_build_sha,
                'allFiveDependenciesReady': value.get('ok') is True and set(checks) == HEALTH_COMPONENTS
                    and all(item == 'ready' for item in checks.values())}
    case('app-health-current', WEB, '/api/health', 200, {'Authorization': basic}, checks=health)

    # Do not follow redirects or put Basic/Bearer/apikey/cookie on cleartext HTTP.
    # An automatic Caddy redirect may currently lack these headers/diagnostics:
    # record FAIL rather than inventing a route/UUID or waiving the requirement.
    for name, host, path in (('http-web-redirect', WEB, '/jobs'),
                             ('http-api-redirect', API, '/auth/v1/health')):
        case(name, host, path, 308, {}, scheme='http', checks=lambda headers, body, host=host, path=path: {
            'exactHttpsLocation': headers.get('location') == 'https://' + host + path})

    records = []
    for original in observer.records:
        host, scheme = scopes[original['case']]
        records.append(_redact(original | {'host': host, 'scheme': scheme,
                                         'port': 443 if scheme == 'https' else 80}, journal.secrets))
    result = {'status': 'PASS' if len(records) == 14 and all(row['passed'] for row in records) else 'FAIL',
              'scope': 'LIVE_STAGING_READ_ONLY_HEADER_AUDIT', 'cases': records,
              'requestsPlanned': 14, 'methods': ['GET'], 'redirectsFollowed': 0,
              'credentialsSentOverHttp': False, 'upstreamFailureInduced': False,
              'serviceChanges': 0, 'configChanges': 0, 'queuePublications': 0,
              'phaseComplete': False, 'containmentPerformed': False}
    journal.put(stage, 'result.json', json.dumps(result, sort_keys=True).encode())
    return result


if __name__ == '__main__':
    raise SystemExit('Injected journalled read-only primitive only; never run an old controller')
