"""ONE new owner-approved conditional Caddy activation; injected operations only.

No private-state import, native transport, process command or config generator.
The enclosing guest implements the narrowly named operations below and creates
the fixed NEW journal with owner custody. Never invoke an old phase controller.
First HEADs are read-only/no credentials; present headers ALWAYS skip mutation.
"""
import hashlib
import json
import re

from p8_live_header_audit import audit_headers, WEB, API


JOURNAL = '/opt/ir35/.env.p8-live-header-owner-20261030-01'
CONTAINER = 'ir35-staging-caddy-1'
CONFIG = '/opt/ir35/config/p5-Caddyfile-sdk-owner1'
OLD_CONFIG_SHA = '2a4fad8dd6c35c3708c1d5a382f88dd105475cf54dc5d10425771da19758a49a'
IMAGE = 'sha256:8dbca3525dd8dce671e495665a0eb297a83ec87ee30f373947d0ea93115949db'
REVIEWED_SOURCE = 'ece46358ca2bdd5fc12f247a66cb826c1b6ce82c'
EXCEPTIONS = {'extension:pg_stat_statements', 'extension:pgcrypto', 'extension:uuid-ossp'}
EXPECTED_CASES = {'sdk-missing': 401, 'sdk-suffix': 401, 'sdk-valid': 200,
    'jobs': 200, 'basic-missing': 401, 'basic-invalid': 401, 'sdk-fallback': 404,
    'api-basic-missing': 401, 'api-basic-invalid': 401, 'api-health': 200,
    'api-fallback': 404, 'app-health-current': 200, 'http-web-redirect': 308,
    'http-api-redirect': 308}


class ControlStop(RuntimeError):
    def __init__(self, code):
        # Codes are fixed by this module, never a native exception/message.
        self.code = code
        super().__init__(code)


def _require(condition, code):
    if not condition:
        raise ControlStop(code)


def _hash(value):
    return type(value) is str and re.fullmatch(r'[0-9a-f]{64}', value) is not None


def _op(ops, name):
    value = ops.get(name)
    _require(callable(value), 'NarrowInjectedOperationRequired')
    return value


class _Recorder:
    def __init__(self, store):
        _require(str(store.root) == JOURNAL, 'ExactNewOwnerJournalRequired')
        self.store, self.previous, self.steps = store, None, []
        self.attempts, self.unsealed = 0, []

    def step(self, name, function, project):
        if self.previous:
            self.store.verify(self.previous['stage'], self.previous['manifestSHA256'])
        _require(not self.unsealed or name in ('restore-old-config', 'restart-rollback-once',
                 'inspect-rollback', 'containment-rollback', 'containment-after-failure', 'final-report'),
                 'UnsealedControllerStep_HardStop')
        self.attempts += 1
        stage_name = f'{self.attempts:02d}-' + name
        try:
            stage = self.store.stage(stage_name)  # O_EXCL; replay fails BEFORE a call.
            self.store.put(stage, 'controller-intent.json', json.dumps({
                'operation': name, 'scope': 'STAGING_CADDY_ONLY', 'ownerApproval': '20261030',
                'publicAdminAPIAllowed': False, 'unsealedPriorStages': list(self.unsealed)}, sort_keys=True).encode())
        except Exception:
            self.unsealed.append(stage_name)
            raise
        error = None
        value = None
        try:
            value = function(stage)
            result = project(value)
        except Exception as failure:
            code = failure.code if type(failure) is ControlStop else 'InjectedOperationFailed'
            name_class = type(failure).__name__
            if name_class not in ('ControlStop', 'HeaderAuditError', 'RuntimeError', 'ValueError',
                                  'TypeError', 'KeyError', 'OSError', 'TimeoutError', 'FileExistsError'):
                name_class = 'UnexpectedException'
            result = {'status': 'FAIL', 'code': code, 'errorClass': name_class}
            error = ControlStop(code)
        try:
            self.store.put(stage, 'controller-step-result.json', json.dumps(result, sort_keys=True).encode())
            anchor = self.store.seal(stage, previous=self.previous['manifestSHA256'] if self.previous else None)
        except Exception:
            # Never overwrite/reconstruct a broken slot or silently omit it.
            # Only bounded rollback/read-only containment may follow; FAIL is
            # retained even if restoration succeeds. The final seal names it.
            self.unsealed.append(stage_name)
            raise
        self.previous = {'stage': stage_name, 'manifestSHA256': anchor}
        self.steps.append(self.previous | {'operation': name, 'status': result['status']})
        if error:
            raise error from None
        return value


def _context(context):
    _require(context.get('profile') == 'ir35' and context.get('region') == 'uk-london-1'
             and context.get('vmPublicIp') == '132.145.28.134'
             and context.get('sourceClean') is True
             and type(context.get('sourceSHA')) is str
             and re.fullmatch(r'[0-9a-f]{40}', context['sourceSHA'])
             and context.get('runtimeVerified') is True
             and context.get('transportsPinnedToLoopback') is True
             and context.get('noRedirectFollowing') is True
             and context.get('mock') is True and context.get('smtpSink') is True
             and context.get('realAcceptance') is False, 'FreshOwnedMockStagingContextRequired')
    return {'status': 'PASS', 'sourceSHA': context['sourceSHA'], 'mock': True,
            'smtpSink': True, 'realAcceptance': False, 'profile': 'ir35', 'region': 'uk-london-1'}


def _head_projection(reply, host, path):
    _require(isinstance(reply, tuple) and len(reply) == 2 and type(reply[0]) is int
             and isinstance(reply[1], dict), 'BoundedHeadReplyRequired')
    status, raw = reply
    headers = {key.lower(): value for key, value in raw.items()}
    _require(status == 401 and headers.get('www-authenticate') == 'Basic realm="restricted"',
             'InitialUnauthenticatedSecurityMismatch_Stop')
    return {'status': 'PASS', 'host': host, 'method': 'HEAD', 'path': path,
            'actualStatus': status, 'challengeRetained': True,
            'noStore': headers.get('cache-control') == 'no-store',
            'noindex': 'noindex' in headers.get('x-robots-tag', ''),
            'credentialsSent': False, 'redirectsFollowed': 0}


def _current(row, expected_config, previous=None):
    _require(row.get('status') == 'PASS' and row.get('container') == CONTAINER
             and row.get('imageId') == IMAGE and row.get('version') == 'v2.10.2'
             and row.get('configSha256') == expected_config
             and row.get('containerConfigSha256') == expected_config and row.get('adminOff') is True
             and row.get('persistenceOff') is True and row.get('exactReadonlyConfigMount') is True
             and row.get('publicAdminAPIExposed') is False and row.get('running') is True
             and row.get('paused') is False and row.get('oomKilled') is False
             and _hash(row.get('containerId')) and type(row.get('startedAt')) is str
             and re.fullmatch(r'[0-9TZ:.-]{20,40}', row['startedAt'])
             and type(row.get('restartCount')) is int and 0 <= row['restartCount'] <= 100,
             'ExactCurrentCaddyCustodyRequired')
    if previous:
        _require(row['containerId'] == previous['containerId']
                 and row['startedAt'] != previous['startedAt'], 'CaddyOnlyRestartIdentityRequired')
    return {key: row[key] for key in ('status', 'container', 'containerId', 'imageId',
             'version', 'configSha256', 'containerConfigSha256', 'adminOff', 'persistenceOff', 'exactReadonlyConfigMount',
             'publicAdminAPIExposed', 'running', 'paused', 'oomKilled', 'startedAt', 'restartCount')}


def _containment(proof):
    required = ('orderedMD5', 'authHashParity', 'storageSHA256', 'manifests',
                'baseline552Unchanged', 'queueRolesPassed', 'hbaPassed', 'sourceUntouched')
    _require(proof.get('status') == 'PASS' and proof.get('tables') == 62
             and proof.get('sequences') == 2 and proof.get('storageObjects') == 73
             and proof.get('appRolePrivileges') == 552 and proof.get('approvedQueueRoles') == 2
             and proof.get('hbaLoginChecks') == 112 and proof.get('unapprovedRuntimeChanges') == 0
             and proof.get('schemaUnexplainedDifferences') == 0
             and type(proof.get('schemaExceptions')) is list and len(proof['schemaExceptions']) == 3
             and set(proof['schemaExceptions']) == EXCEPTIONS
             and all(proof.get(key) is True for key in required)
             and _hash(proof.get('manifestSHA256')), 'FullContainmentMismatch_HardStop')
    return {key: proof[key] for key in ('status', 'tables', 'sequences', 'storageObjects',
        'appRolePrivileges', 'approvedQueueRoles', 'hbaLoginChecks', 'unapprovedRuntimeChanges',
        'schemaUnexplainedDifferences', 'schemaExceptions', 'manifestSHA256', *required)}


def _candidate_ci(context, candidate):
    _require(type(candidate) is bytes and 0 < len(candidate) <= 256_000
             and b'\x00' not in candidate, 'BoundedReviewedCandidateBytesRequired')
    sha = hashlib.sha256(candidate).hexdigest()
    ci = context.get('candidateCI', {})
    _require(ci.get('configSourceSHA') == REVIEWED_SOURCE
             and ci.get('controllerSourceSHA') == context['sourceSHA']
             and ci.get('candidateTemplateSHA256') == sha and ci.get('imageId') == IMAGE
             and ci.get('manifestVerified') is True and _hash(ci.get('manifestSHA256'))
             and ci.get('allHostedChecksGreen') is True and ci.get('sameAssertionsAndTimeouts') is True,
             'ExactCandidateAndControllerCIRequired')
    rows = ci.get('realCaddyCases', [])
    _require(type(rows) is list and len(rows) == 14
             and {row.get('case') for row in rows} == set(EXPECTED_CASES)
             and all(row.get('passed') is True and row.get('expectedStatus') == EXPECTED_CASES[row['case']]
                     and row.get('actualStatus') == EXPECTED_CASES[row['case']] for row in rows),
             'RealCandidateCaddyAllPathProofRequired')
    return {'status': 'PASS', 'candidateSHA256': sha, 'configSourceSHA': REVIEWED_SOURCE,
            'controllerSourceSHA': context['sourceSHA'], 'manifestSHA256': ci['manifestSHA256'],
            'realCaddyCases': 14, 'allHostedChecksGreen': True}


def _backup(proof):
    _require(proof.get('status') == 'PASS' and proof.get('configSHA256') == OLD_CONFIG_SHA
             and proof.get('imageId') == IMAGE and proof.get('configCopyVerified') is True
             and proof.get('imageRetainedLocally') is True and proof.get('exclusivePrivateBackup') is True
             and proof.get('custodyVerified') is True and proof.get('envUnchanged') is True,
             'ExactPrivateConfigAndImageBackupRequired')
    return {key: proof[key] for key in ('status', 'configSHA256', 'imageId', 'configCopyVerified',
        'imageRetainedLocally', 'exclusivePrivateBackup', 'custodyVerified', 'envUnchanged')}


def _validated(proof, sha):
    required = ('validatePassed', 'adaptPassed', 'adminOff', 'persistenceOff', 'authUnchanged',
                'routesAndUpstreamsUnchanged', 'bindingsUnchanged', 'envUnchanged',
                'cookieFlagsUnchanged', 'privateKeyPathsUnchanged', 'trustedTlsUnchanged',
                'onlyApprovedHeaderChanges')
    _require(proof.get('status') == 'PASS' and proof.get('configSHA256') == sha
             and proof.get('imageId') == IMAGE and all(proof.get(key) is True for key in required)
             and _hash(proof.get('redactedAdaptedDiffSHA256')), 'ValidatedHeaderOnlyCandidateRequired')
    return {key: proof[key] for key in ('status', 'configSHA256', 'imageId', 'redactedAdaptedDiffSHA256', *required)}


def _action(proof, config_sha=None):
    _require(proof.get('status') == 'PASS' and proof.get('container') == CONTAINER
             and proof.get('imageId') == IMAGE and proof.get('onlyCaddy') is True
             and proof.get('envUnchanged') is True, 'CaddyOnlyActionReceiptRequired')
    if config_sha:
        _require(proof.get('configSHA256') == config_sha, 'ExactActionConfigReadbackRequired')
    return {'status': 'PASS', 'container': CONTAINER, 'imageId': IMAGE, 'onlyCaddy': True,
            'envUnchanged': True, **({'configSHA256': config_sha} if config_sha else {})}


def run(*, context, ops, store, header_inputs, candidate=None):
    """Inject only HEAD/inspect/containment/backup/validate/install/restart/restore.

    Never call native operations in offline tests. The guest adapter must pin
    both transports to loopback, read the existing secrets only in RAM, retain
    private backup bytes, and use `docker restart` for CONTAINER only. It may
    never enable admin, change an image/port/env, pull or recreate a stack.
    Candidate CI must cover the EXACT public template, not just the private QA
    error-chain mechanism. No boolean here substitutes for those real proofs.
    """
    _context(context)  # No operation without current root-attested custody.
    recorder = _Recorder(store)
    state = {'status': 'FAIL', 'activationAttempts': 0, 'activationRestarts': 0,
             'rollbackRestarts': 0, 'activationSkipped': False, 'rollback': 'NOT_NEEDED',
             'phaseComplete': False, 'requestedScope': 'STAGING_CADDY_ONLY'}
    changed = False
    before = None
    containment_started = False
    after_done = False

    # Deliberately outside recovery: replay cannot append a new "failure" stage
    # to this used owner slot or call any native operation, even read-only.
    recorder.step('owner-intent', lambda stage: _context(context), lambda value: value)

    def full(phase, sha):
        return recorder.step('containment-' + phase,
            lambda stage: _op(ops, 'containment')(phase, sha), _containment)

    def get_audit():
        return recorder.step('all-path-headers', lambda stage: audit_headers(
            runtime=header_inputs['runtime'], private_env=header_inputs['private_env'],
            tls_request=header_inputs['tls_request'], http_request=header_inputs['http_request'],
            store=store, stage=stage, expected_build_sha=header_inputs['expected_build_sha'],
            current_runtime_verified=True), lambda proof: _audit_projection(proof))

    try:
        heads = []
        # These are the FIRST live operations. No credentials, redirects or
        # candidate/backup/restart call occurs before both observations.
        for name, host, path in (('head-web', WEB, '/jobs'), ('head-api', API, '/auth/v1/health')):
            reply = recorder.step(name, lambda stage, host=host, path=path:
                _op(ops, 'head_request')(host, path),
                lambda value, host=host, path=path: _head_projection(value, host, path))
            heads.append(_head_projection(reply, host, path))
        before = recorder.step('inspect-current', lambda stage: _op(ops, 'inspect_current')(),
                               lambda value: _current(value, OLD_CONFIG_SHA))
        full('before', OLD_CONFIG_SHA)
        containment_started = True
        if all(row['noStore'] and row['noindex'] for row in heads):
            state['activationSkipped'] = True
            state['decision'] = 'HEADERS_ALREADY_PRESENT_NO_MUTATION'
            get_audit()  # A later failure stops; it NEVER reopens activation.
            full('after', OLD_CONFIG_SHA)
            after_done = True
        else:
            ci = recorder.step('candidate-ci', lambda stage: _candidate_ci(context, candidate), lambda value: value)
            sha = ci['candidateSHA256']
            recorder.step('backup-current', lambda stage: _op(ops, 'backup_current')(stage, CONFIG, IMAGE), _backup)
            recorder.step('validate-candidate', lambda stage: _op(ops, 'validate_candidate')(stage, candidate),
                          lambda value: _validated(value, sha))

            def install(stage):
                nonlocal changed
                # Intent is already durable. Ambiguous writes consume the ONE
                # activation and require rollback, never another install.
                state['activationAttempts'] = 1
                changed = True
                return _op(ops, 'install_candidate')(CONFIG, candidate, OLD_CONFIG_SHA)
            recorder.step('install-candidate', install, lambda value: _action(value, sha))

            def restart(stage):
                state['activationRestarts'] += 1
                return _op(ops, 'restart_caddy')(CONTAINER)
            recorder.step('restart-caddy-once', restart, _action)
            recorder.step('inspect-candidate', lambda stage: _op(ops, 'inspect_current')(),
                          lambda value: _current(value, sha, before))
            get_audit()
            full('after', sha)
            after_done = True
            state['decision'] = 'ONE_HEADER_ONLY_ACTIVATION_PASSED'
        state['status'] = 'PASS'
    except Exception as error:
        state['code'] = error.code if type(error) is ControlStop else 'ControllerOrJournalFailed'
        if changed:
            state['rollback'] = 'FAILED'
            try:
                recorder.step('restore-old-config', lambda stage: _op(ops, 'restore_backup')(CONFIG, OLD_CONFIG_SHA, IMAGE),
                              lambda value: _action(value, OLD_CONFIG_SHA))
                def rollback_restart(stage):
                    state['rollbackRestarts'] += 1
                    return _op(ops, 'restart_caddy')(CONTAINER)
                recorder.step('restart-rollback-once', rollback_restart, _action)
                recorder.step('inspect-rollback', lambda stage: _op(ops, 'inspect_current')(),
                              lambda value: _current(value, OLD_CONFIG_SHA, before))
                full('rollback', OLD_CONFIG_SHA)
                after_done = True
                state['rollback'] = 'PASS'
            except Exception:
                state['rollbackCode'] = 'RollbackFailed_NoRetry'
        elif containment_started and not after_done:
            try:
                full('after-failure', OLD_CONFIG_SHA)
                after_done = True
            except Exception:
                state['containmentAfterFailure'] = 'FAIL'
        state['reviewRequired'] = True
    state['containmentCompleted'] = after_done
    state['journalIntegrity'] = 'FAIL' if recorder.unsealed else 'PASS'
    state['unsealedStages'] = list(recorder.unsealed)
    # Final summary is separate from the helper's result.json, never overwrite.
    recorder.step('final-report', lambda stage: dict(state), lambda value: value)
    return state | {'steps': recorder.steps, 'manifestSHA256': recorder.previous['manifestSHA256'],
                    'journal': JOURNAL, 'productionChangesRequested': 0, 'dnsChangesRequested': 0}


def _audit_projection(proof):
    rows = proof.get('cases', [])
    _require(proof.get('status') == 'PASS' and len(rows) == 14
             and {row.get('case') for row in rows} == set(EXPECTED_CASES)
             and all(row.get('passed') is True and row.get('expectedStatus') == EXPECTED_CASES[row['case']]
                     and row.get('actualStatus') == EXPECTED_CASES[row['case']] for row in rows),
             'FullLiveHeaderSuiteFailed_Stop')
    return {'status': 'PASS', 'cases': 14, 'sdk': [401, 401, 200], 'getOnly': True,
            'upstreamFailureInduced': False, 'phaseComplete': False}


if __name__ == '__main__':
    raise SystemExit('Injected new owner-journal controller only; no standalone native entrypoint')
