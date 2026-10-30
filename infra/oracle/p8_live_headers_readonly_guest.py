"""New read-only fourteen-GET native adapter; no edge activation path exists.

Existing private values remain in VM RAM. Only a NEW private evidence journal
is written. Source data, containers, configuration, queues and services are
never changed. The original full containment verifier remains unmodified.
"""
import hashlib
import http.client
import json
import os
from pathlib import Path
import re
import stat

from p8_live_header_audit import audit_headers, WEB, API

ROOT = Path('/opt/ir35')
JOURNAL = ROOT / '.env.p8-live-headers-readonly-owner-20261030-01'
CADDY = 'ir35-staging-caddy-1'
CONFIG = ROOT / 'config/p5-Caddyfile-sdk-owner1'
CADDY_IMAGE = 'sha256:8dbca3525dd8dce671e495665a0eb297a83ec87ee30f373947d0ea93115949db'
CONFIG_SHA = '2a4fad8dd6c35c3708c1d5a382f88dd105475cf54dc5d10425771da19758a49a'
NAMES = ('ir35-p5-web', 'ir35-p6-mock-worker-v7-fixedip',
         'ir35-p6-mock-worker-v7-fixedip-rollback', CADDY)
EXCEPTIONS = {'extension:pg_stat_statements', 'extension:pgcrypto', 'extension:uuid-ossp'}
CASES = {'sdk-missing': 401, 'sdk-suffix': 401, 'sdk-valid': 200, 'jobs': 200,
         'basic-missing': 401, 'basic-invalid': 401, 'sdk-fallback': 404,
         'api-basic-missing': 401, 'api-basic-invalid': 401, 'api-health': 200,
         'api-fallback': 404, 'app-health-current': 200,
         'http-web-redirect': 308, 'http-api-redirect': 308}


class ReadOnlyStop(RuntimeError):
    """Only fixed codes from this module may become public evidence."""


def require(value, code):
    if not value:
        raise ReadOnlyStop(code)


def digest(value):
    return hashlib.sha256(value).hexdigest()


def containment_projection(proof):
    summary = proof.get('containment', {})
    fresh = proof.get('freshReadOnlyHBAProof', {})
    require(proof.get('status') == 'PASS' and summary.get('status') == 'PASS'
        and summary.get('tablesEach') == 62 and summary.get('sequencesEach') == 2
        and summary.get('approvedSchemaExceptionsEach') == 3
        and summary.get('appRolePrivilegesEach') == 552 and summary.get('approvedP6RolesEach') == 2
        and summary.get('storageObjectsEach') == 73
        and all(summary.get(key) is True for key in ('orderedMD5Each', 'storageSHA256Match',
            'baseline552Unchanged', 'sourceRolesUnchanged', 'rawCatalogDifferencesRetained',
            'originalCaddyFilesUnchanged', 'privateFixtureRunningNoPorts'))
        and summary.get('manifests') == 'PASS'
        and all(summary.get(key) == 0 for key in ('sourceWrites', 'pristineWrites', 'fixtureWrites'))
        and fresh == {'status': 'PASS', 'checks': 112, 'queueSuccesses': 8,
            'applicationRejections': 104, 'functionCalls': 0,
            'noContainerCreated': True, 'noReloadRestartOrConfigWrite': True}
        and len(proof.get('freshLoginChecks', [])) == 112
        and all(row.get('passed') is True for row in proof['freshLoginChecks']),
        'OriginalFullContainmentAndFresh112Required')
    for name in ('pristine', 'P5Fixture'):
        row = proof.get(name, {})
        schema = row.get('schema', {})
        exceptions = schema.get('exceptions', [])
        require(row.get('status') == 'PASS' and len(row.get('tables', [])) == 62
            and row.get('sequenceChecks') == 2
            and schema.get('status') == 'PASS_WITH_APPROVED_P6_ADDITIONS'
            and schema.get('baseline552Unchanged') is True
            and schema.get('unexplainedDifferences') == [] and len(exceptions) == 3
            and {item.get('object') for item in exceptions} == EXCEPTIONS,
            'UnchangedPristineAndP5FidelityRequired')
    return {'status': 'PASS', 'tablesEach': 62, 'sequencesEach': 2,
        'storageObjectsEach': 73, 'appRolePrivilegesEach': 552,
        'approvedQueueRolesEach': 2, 'freshHbaChecks': 112,
        'schemaExceptions': sorted(EXCEPTIONS), 'sourceWrites': 0,
        'rawProofSHA256': digest(json.dumps(proof, sort_keys=True).encode())}


def audit_projection(proof):
    rows = proof.get('cases', [])
    require(proof.get('status') == 'PASS' and len(rows) == 14
        and {row.get('case') for row in rows} == set(CASES)
        and all(row.get('method') == 'GET' and row.get('passed') is True
            and row.get('actualStatus') == CASES[row['case']]
            and row.get('expectedStatus') == CASES[row['case']] for row in rows)
        and proof.get('redirectsFollowed') == 0 and proof.get('credentialsSentOverHttp') is False
        and proof.get('serviceChanges') == 0 and proof.get('configChanges') == 0
        and proof.get('queuePublications') == 0, 'AllFourteenUnchangedLiveGetCasesRequired')
    return {'status': 'PASS', 'cases': 14, 'sdk': [401, 401, 200],
        'currentP6Health': 200, 'redirectsFollowed': 0, 'activationPerformed': False}


class Steps:
    def __init__(self, store):
        require(Path(store.root) == JOURNAL, 'ExactNewReadOnlyOwnerJournalRequired')
        self.store, self.previous, self.records, self.unsealed = store, None, [], []

    def step(self, name, action, projection=lambda value: value):
        if self.previous:
            self.store.verify(self.previous['stage'], self.previous['manifestSHA256'])
        require(not self.unsealed or name in ('post-containment', 'post-runtime', 'final-report'),
                'UnsealedEvidenceStop_NoFurtherHeaderRequests')
        number = len(self.records) + len(self.unsealed) + 1
        stage_name = f'{number:02d}-' + name
        try:
            stage = self.store.stage(stage_name)
            self.store.put(stage, 'intent.json', json.dumps({'operation': name,
                'readOnly': True, 'activationAllowed': False,
                'unsealedPriorStages': self.unsealed}, sort_keys=True).encode())
        except Exception:
            self.unsealed.append(stage_name)
            raise ReadOnlyStop('EvidenceIntentWriteFailed_NoReplay') from None
        failed = None
        value = None
        try:
            value = action(stage)
            result = projection(value)
        except Exception as error:
            failed = error
            code = str(error) if type(error) is ReadOnlyStop else 'ReadOnlyOperationFailed_RawWithheld'
            result = {'status': 'FAIL', 'code': code}
        try:
            # The unchanged audit owns result.json in its case stage. Never
            # collide with or overwrite that original fourteen-case report.
            self.store.put(stage, 'adapter-step-result.json', json.dumps(result, sort_keys=True).encode())
            anchor = self.store.seal(stage,
                previous=self.previous['manifestSHA256'] if self.previous else None)
        except Exception:
            self.unsealed.append(stage.name if hasattr(stage, 'name') else str(stage))
            raise ReadOnlyStop('EvidenceWriteOrSealFailed_NoReplay') from None
        self.previous = {'stage': stage.name if hasattr(stage, 'name') else str(stage), 'manifestSHA256': anchor}
        self.records.append(self.previous | {'operation': name, 'status': result['status']})
        if failed:
            raise ReadOnlyStop(result['code']) from None
        return value


def observe(data, runtime, store, operations):
    """Operations are injectable for OFFLINE tests only; native_run fixes them."""
    require(re.fullmatch('[a-f0-9]{40}', data.get('headerAuditSourceSHA', '')) is not None
        and data.get('headDecision') == 'HEADERS_ALREADY_PRESENT_NO_ACTIVATION',
        'CleanSourceAndExistingNoActivationDecisionRequired')
    steps = Steps(store)
    result = {'status': 'FAIL', 'phaseComplete': False, 'readOnly': True,
        'sourceSHA': data['headerAuditSourceSHA'], 'activationPerformed': False,
        'serviceRestarts': 0, 'configChanges': 0, 'queuePublications': 0,
        'sourceWrites': 0, 'evidenceWritesOnly': True, 'cutover': False}
    before = None
    # Refuse a consumed slot before any operation or recovery append. Only the
    # native constructor may create the fixed journal; there is no resume mode.
    steps.step('owner-intent', lambda stage: {'status': 'PASS',
        'sourceSHA': data['headerAuditSourceSHA'], 'activationAllowed': False})
    try:
        before = steps.step('runtime-before', lambda stage: operations['inspect']())
        steps.step('pre-containment', lambda stage: operations['containment'](stage), containment_projection)
        result['headers'] = steps.step('all-path-get-headers', lambda stage: audit_headers(
            runtime=runtime, private_env=operations['private_env'],
            tls_request=operations['tls_request'], http_request=operations['http_request'],
            store=store, stage=stage, expected_build_sha=data['build']['sourceSHA'],
            current_runtime_verified=True), audit_projection)
        result['status'] = 'PASS'
    except Exception as error:
        result['code'] = str(error) if type(error) is ReadOnlyStop else 'ReadOnlyAuditFailed_RawWithheld'
    finally:
        try:
            result['postContainment'] = steps.step('post-containment',
                lambda stage: operations['containment'](stage), containment_projection)
            # Raw containment output is VM-private; only its strict projection
            # and SHA are returned, without weakening the original verifier.
            result['postContainment'] = containment_projection(result['postContainment'])
        except Exception:
            result.update(status='FAIL', postContainmentCode='PostContainmentFailed_HardStop')
        try:
            after = steps.step('post-runtime', lambda stage: operations['inspect']())
            require(before is not None and before == after, 'OriginalRuntimeIdentityOrRestartChanged_HardStop')
            result['originalRuntimeUnchanged'] = True
        except Exception:
            result.update(status='FAIL', runtimeCode='OriginalRuntimeReadbackMismatch_HardStop')
    if steps.unsealed:
        result.update(status='FAIL', journalIntegrity='FAIL', unsealedStages=list(steps.unsealed))
    else:
        result['journalIntegrity'] = 'PASS'
    steps.step('final-report', lambda stage: dict(result))
    return result | {'journal': str(JOURNAL), 'steps': steps.records,
        'manifestSHA256': steps.previous['manifestSHA256']}


def http_request(host, method, path, headers):
    """Cleartext requests are credential-free and cannot follow redirects."""
    require((host, method, path) in ((WEB, 'GET', '/jobs'), (API, 'GET', '/auth/v1/health'))
        and set(headers) == {'X-IR35-Client-Request-ID'}
        and re.fullmatch('[a-f0-9-]{36}', headers['X-IR35-Client-Request-ID']) is not None,
        'FixedCredentialFreeLoopbackHttpGetRequired')
    connection = http.client.HTTPConnection('127.0.0.1', 80, timeout=8)
    try:
        connection.request(method, path, headers={'Host': host, 'Connection': 'close',
            'Accept-Encoding': 'identity', **headers})
        reply = connection.getresponse()
        body = reply.read(4_000_001)
        require(len(body) <= 4_000_000, 'BoundedReadOnlyHttpResponseRequired')
        return reply.status, {key.lower(): value for key, value in reply.getheaders()}, body
    finally:
        connection.close()


def inspect_runtime(data, runtime):
    from p6_mock_guest import prepared, validate_config
    from web_services_guest import require_prepared
    from web_edge_guest import private_env
    prepared(data)
    require_prepared(data)
    values = runtime['read_env']()
    web = private_env(ROOT / '.env.p5-web')
    worker = private_env(ROOT / '.env.p6-mock-worker')
    auth = private_env(ROOT / '.env.p5-auth')
    validate_config(worker)
    require(values.get('APPLY_RUNNER') == 'mock' and values.get('APPLICATION_WORKER_ACCEPT_JOBS') == 'false'
        and web.get('APPLY_RUNNER') == 'mock' and web.get('APPLICATION_WORKER_ACCEPT_JOBS') == 'false'
        and web.get('IR35_READ_ONLY') == 'true' and web.get('IR35_BUILD_SHA') == data['build']['sourceSHA']
        and auth.get('GOTRUE_SMTP_HOST') == 'smtp' and auth.get('GOTRUE_SMTP_PORT') == '1025'
        and not auth.get('GOTRUE_SMTP_USER') and not auth.get('GOTRUE_SMTP_PASS'),
        'OriginalReadOnlyMockSinkAndBuildRequired')
    rows = json.loads(runtime['run'](['docker', 'inspect', *NAMES]))
    require(len(rows) == 4 and {row['Name'].lstrip('/') for row in rows} == set(NAMES),
        'ExactOriginalRuntimeInventoryRequired')
    expected = dict(zip(NAMES, (data['build']['image'], data['finalBuild']['image'],
        data['rollbackBuild']['image'], CADDY_IMAGE)))
    output = {}
    for row in rows:
        name, state = row['Name'].lstrip('/'), row['State']
        require(row['Image'] == expected[name] and re.fullmatch('[a-f0-9]{64}', row['Id']) is not None
            and state.get('OOMKilled') is False and state.get('Paused') is False,
            'OriginalImageOrRuntimeStateMismatch_HardStop')
        if name in ('ir35-p5-web', CADDY):
            require(state.get('Running') is True, 'CurrentWebAndEdgeMustAlreadyBeRunning')
        if name == 'ir35-p5-web':
            entry = row['Config'].get('Entrypoint', [])
            require(entry == ['/run/ir35/env-exec', '/opt/ir35/.env.p5-web', '/usr/bin/env',
                'IR35_WORKER_HEALTH_ENABLED=true', 'IR35_REALTIME_HEALTH_ENABLED=true', 'node', 'web-server.mjs'],
                'ExistingP6FullHealthEntrypointRequired_NoOverride')
        if name == CADDY:
            info = CONFIG.lstat()
            require(not CONFIG.is_symlink() and stat.S_ISREG(info.st_mode)
                and digest(CONFIG.read_bytes()) == CONFIG_SHA
                and any(item.get('Source') == str(CONFIG) and item.get('Destination') == '/etc/caddy/Caddyfile'
                    and item.get('RW') is False for item in row['Mounts'])
                and set(row['HostConfig'].get('PortBindings', {})) == {'80/tcp', '443/tcp'},
                'ExactExistingReadonlyCaddyCustodyRequired')
            text = CONFIG.read_text()
            require(re.search(r'^\s*admin\s+off\s*$', text, re.M) is not None
                and re.search(r'^\s*persist_config\s+off\s*$', text, re.M) is not None,
                'ExistingAdminAndPersistenceOffRequired')
        output[name] = {'Id': row['Id'], 'image': row['Image'], 'restartCount': row['RestartCount'],
            'startedAt': state['StartedAt'], 'running': state['Running'], 'status': state['Status']}
    return {'status': 'PASS', 'containers': output, 'mock': True, 'smtpSink': True,
        'realAcceptance': False, 'readOnlyWeb': True, 'expectedBuildSHA': data['build']['sourceSHA'],
        'fullHealthFlagsAlreadyConfigured': True, 'caddyConfigSHA256': CONFIG_SHA}


def native_run(data, runtime):
    from immutable_artifacts import Store
    from p6_restart_diagnosis_guest import containment
    from sdk_owner1_guest import tls_request
    from web_edge_guest import private_env
    require(not JOURNAL.exists() and not JOURNAL.is_symlink(), 'ReadOnlyOwnerSlotUsed_NoReplay')
    # Custody is checked BEFORE the one new native evidence directory exists.
    inspect_runtime(data, runtime)
    JOURNAL.mkdir(mode=0o700)
    os.chown(JOURNAL, 1002, 1002)
    store = Store(JOURNAL, uid=1002)

    def full(stage):
        proof = containment(data, runtime, probe_container='ir35-p6-mock-worker-v7-fixedip')
        store.put(stage, 'full-original-containment.json', json.dumps(proof, sort_keys=True).encode())
        return proof

    return observe(data, runtime, store, {'inspect': lambda: inspect_runtime(data, runtime),
        'containment': full, 'private_env': private_env,
        'tls_request': tls_request, 'http_request': http_request})


if __name__ == '__main__':
    raise SystemExit('Native read-only bundle adapter only; no standalone guest dispatch')
