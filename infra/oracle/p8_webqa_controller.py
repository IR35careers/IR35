"""Bounded writable-QA lifecycle, SOURCE ONLY until native adapters are reviewed.

The orchestration is real (including the existing Fixture preparation calls),
but no native launcher is supplied: a CLI execution request fails BEFORE private
state, SSH, Docker, keys or an evidence slot is touched. Tests inject fake I/O.
Never replay a historical native slot or call a partial workflow a P8 PASS.
"""
from dataclasses import dataclass
import json
import re
import sys

import p8_webqa_config as config


class QaError(RuntimeError):
    """Fixed codes only. Native/Playwright exceptions can contain credentials."""
    def __init__(self, code):
        super().__init__(code if type(code) is str and re.fullmatch('[A-Za-z0-9_]{1,140}', code)
                         else 'QaErrorTextWithheld')


NATIVE_BINDINGS_REQUIRED = (
    'fresh-source-image-network-certificate-and-memory-attestation',
    'exclusive-owner-authorised-slot-and-private-guest-journal',
    'owned-service-start-and-private-mock-queue-seed',
    'attested-ssh-forward-to-owned-private-caddy',
    'smtp-sink-only-disposable-recovery-and-magic-link-bridge',
    'headed-browser-ram-only-ipc',
    'actual-realtime-cdc-and-six-job-ledger-observation',
    'owned-worker-restart-and-direct-localhost-source-equality',
    'ownership-checked-container-queue-file-storage-cleanup',
    'full-original-containment-before-and-after',
)
JOURNEYS = ('recovery', 'password-login', 'magic-link', 'job-search', 'job-page',
            'save-job', 'mock-apply', 'account', 'dashboard', 'sitemap', 'robots', 'llms')
SCENARIOS = tuple(config.SCENARIOS)
FAILURES = ('', 'mock_ats_http_500', 'mock_ats_timeout', 'mock_unknown_outcome',
            'mock_captcha_required', 'mock_input_required')
ACTION_METHODS = frozenset(('preflight', 'full_containment', 'start_owned', 'sdk_gate',
    'open_tunnel', 'browser_journeys', 'lifecycle_proof', 'restart_proof', 'close_browser',
    'close_tunnel', 'stop_owned', 'clean_queue', 'clean_files'))


@dataclass(frozen=True)
class Authority:
    """Additional bounded identity, NOT proof that the owner approved execution."""
    source_sha: str
    slot: str
    approval: str

    def validate(self):
        if (not re.fullmatch('[a-f0-9]{40}', self.source_sha or '')
                or not re.fullmatch('writable-qa-[0-9]{8}t[0-9]{6}z-[a-f0-9]{8}', self.slot or '')
                or self.approval != 'NEW_WRITABLE_QA_REHEARSAL_ONLY'):
            raise QaError('FreshBoundedQaIdentityRequired_NoHistoricalReplay')


def plan():
    return {'status': 'DRY_RUN', 'scope': 'OWNED_DISPOSABLE_STAGING_ONLY',
        'writes': 0, 'privateStateRead': False, 'networkCalls': 0,
        'steps': ['read-only-preflight', 'original-full-containment-before',
            'existing-Fixture-clone-reviewed025-storage-config', 'owned-services-and-mock-queue',
            'sdk-401-401-200', 'attested-private-tunnel', 'headed-browser-write-journeys',
            'realtime-cdc-and-six-job-ledger', 'owned-worker-restart-and-recheck',
            'close-browser', 'close-tunnel', 'stop-owned-services', 'remove-owned-queue-rows',
            'destroy-disconnected-owned-clone', 'remove-owned-storage-and-env-files',
            'original-full-containment-after'],
        'nativeBindingsRequired': list(NATIVE_BINDINGS_REQUIRED),
        'signupNewUserProven': False, 'googleLoginProven': False, 'realSmtpProven': False,
        'nativeExecutionProven': False, 'phaseComplete': False, 'cutover': False}


def _pass(value):
    if type(value) is not dict or value.get('status') != 'PASS':
        raise QaError('QaStepDidNotPass')
    return value


def exact(value, fields):
    """Only fixed allowlisted facts escape to the public journal."""
    value = _pass(value)
    for key, expected in fields.items():
        if type(value.get(key)) is not type(expected) or value.get(key) != expected:
            raise QaError('QaRequiredProofMismatch')
    return {'status': 'PASS', **fields}


def containment(value):
    # New adapter contract, not a replacement or edit to the original verifier.
    return exact(value, {'tablesEach': 62, 'orderedMd5Each': True, 'sequencesEach': 2,
        'authHashParity': True, 'storageObjectsEach': 73, 'storageSha256Match': True,
        'appRolePrivilegesEach': 552, 'queueRolesEach': 2, 'hbaActualLoginChecks': 112,
        'approvedSchemaExceptionsEach': 3, 'originalContainersUnchanged': True,
        'sourceWrites': 0, 'pristineWrites': 0, 'fixtureWrites': 0})


def browser_result(value):
    value = _pass(value)
    cases = value.get('cases')
    if (type(cases) is not list or len(cases) != len(JOURNEYS)
            or [row.get('name') for row in cases if type(row) is dict] != list(JOURNEYS)
            or any(row.get('status') != 'PASS' for row in cases)):
        raise QaError('EveryActualBrowserJourneyRequired')
    proof = exact(value, {'headed': True, 'actualServerResponses': True, 'namedAccountOnly': True,
        'mockOnly': True, 'realEmailMessages': 0, 'employerRequests': 0,
        'transportErrors': 0, 'credentialsPersisted': False})
    proof['cases'] = [{'name': name, 'status': 'PASS'} for name in JOURNEYS]
    # Registration and real providers are separate gates, never inferred here.
    proof.update(signupNewUserProven=False, googleLoginProven=False, realSmtpProven=False)
    return proof


def lifecycle_result(value):
    value = _pass(value)
    rows = value.get('jobs')
    if type(rows) is not list or len(rows) != 6:
        raise QaError('AllSixMockJobOutcomesRequired')
    safe = []
    for index, row in enumerate(rows):
        expected = {'jobId': config.JOBS[index], 'scenario': SCENARIOS[index],
            'status': 'submitted' if index == 0 else 'failed', 'failure': FAILURES[index],
            'mockReceipts': 1 if index == 0 else 0, 'browserAttempts': 1,
            'visibleAfterReload': True}
        if type(row) is not dict or any(type(row.get(k)) is not type(v) or row.get(k) != v for k, v in expected.items()):
            raise QaError('ExactPersistedMockOutcomeRequired_NoReadyFallback')
        safe.append(expected)
    result = exact(value, {'realtimeCdcObserved': True, 'heartbeatFresh': True,
        'allQueueRowsAccounted': True, 'unexplainedRows': 0, 'realEmailMessages': 0,
        'employerPayloads': 0, 'acceptJobs': False, 'smtpSink': True,
        'applyRunner': 'mock', 'maxConcurrentBrowsers': 1})
    return result | {'jobs': safe}


class ExistingFixtureAdapter:
    """Actual preparation wiring; the missing native operations are explicit.

    Construct ONLY after the controller's read-only/original-containment gates.
    `actions` must come from reviewed, fixed native adapters, never user-loaded
    modules, commands or arbitrary URLs. This class does not acquire credentials.
    """
    def __init__(self, fixture_factory, stage_factory, actions, migration, private_gateway):
        self.factory, self.stage, self.actions = fixture_factory, stage_factory, actions
        self.migration, self.gateway = migration, private_gateway
        self.fixture = None

    def prepare_fixture(self):
        self.fixture = self.factory()  # Existing p8_webqa_guest.Fixture(data,runtime,store).
        clone = self.fixture.create_clone(self.stage('clone'))
        upgrade = self.fixture.apply_reviewed_upgrade(self.stage('upgrade025'), self.migration)
        storage = self.fixture.copy_storage(self.stage('storage'))
        configuration = self.fixture.write_configuration(self.stage('configuration'), private_gateway=self.gateway)
        if (clone.get('status') != 'PASS' or clone.get('baselineExact') is not True
                or clone.get('cloneRoleDenials', {}).get('deniedLogins') != 8
                or upgrade.get('status') != 'PASS' or storage.get('objects') != 73
                or storage.get('sha256AndHeadersExact') is not True
                or configuration.get('status') != 'PASS' or configuration.get('realtimeConfigured') is not True):
            raise QaError('ExistingFixturePreparationDidNotPass')
        return {'status': 'PASS', 'baselineExact': True, 'reviewed025': True,
                'storageObjects': 73, 'queueCloneDenials': 8, 'privateEdge': True, 'realtimeOwnedClone': True}

    def destroy_clone(self):
        if self.fixture is None:
            return {'status': 'PASS', 'databaseAbsent': True}
        result = self.fixture.destroy_disconnected_database(self.stage('destroy-clone'))
        return exact(result, {'databaseAbsent': True})

    def __getattr__(self, name):
        # Fail before executing anything if an operational dependency is absent.
        operation = self.actions.get(name) if name in ACTION_METHODS else None
        if not callable(operation):
            raise QaError('ReviewedNativeQaBindingMissing')
        return operation


class BoundedQaController:
    """One invocation, no retry; cleanup is attempted even after partial starts."""
    def __init__(self, adapter, journal, authority):
        authority.validate()
        self.adapter, self.journal, self.authority = adapter, journal, authority
        self.number = 0
        self.used = False

    def step(self, name, operation, validate):
        self.number += 1
        prefix = f'qa-{self.number:02d}-{name}'
        self.journal.put(prefix + '-intent.json', {'operation': name,
            'scope': 'OWNED_DISPOSABLE_STAGING_ONLY', 'retryAllowed': False})
        try:
            result = validate(operation())
        except BaseException as error:
            self.journal.put(prefix + '-result.json', {'status': 'FAIL',
                'code': str(error) if type(error) is QaError else 'NativeErrorWithheld',
                'exceptionType': type(error).__name__, 'rawOutputWithheld': True})
            raise
        self.journal.put(prefix + '-result.json', result)
        return result

    def run(self):
        if self.used:
            raise QaError('BoundedQaRunAlreadyUsed_NoRetry')
        self.used = True
        result = plan() | {'status': 'FAIL', 'steps': [], 'cleanup': {}, 'issues': []}
        owned_intent = False
        try:
            self.step('preflight', self.adapter.preflight, lambda value: exact(value, {
                'sourceSHA': self.authority.source_sha, 'slot': self.authority.slot,
                'freshOwnerAuthorityVerified': True, 'slotUnused': True,
                'immutableImagesVerified': True, 'networkInternal': True,
                'certificateCustodyVerified': True, 'twoGiBHeadroom': True,
                'publicPorts': 0, 'originalRuntimeReadOnly': True, 'acceptJobs': False,
                'applyRunner': 'mock', 'smtpSink': True, 'liveProvidersConfigured': False}))
            self.step('containment-before', self.adapter.full_containment, containment)
            # Persisted intent BEFORE possible clone/config/service creation.
            owned_intent = True
            self.step('prepare-fixture', self.adapter.prepare_fixture, lambda value: exact(value, {
                'baselineExact': True, 'reviewed025': True, 'storageObjects': 73,
                'queueCloneDenials': 8, 'privateEdge': True, 'realtimeOwnedClone': True}))
            self.step('start-owned', self.adapter.start_owned, lambda value: exact(value, {
                'ownedContainersAttested': True, 'queueSeededOnce': True, 'jobsSeeded': 6,
                'originalQueuesUnchanged': True, 'privateEdgeValidated': True, 'publicPorts': 0,
                'applyRunner': 'mock', 'acceptJobs': False, 'smtpSink': True}))
            self.step('sdk-gate', self.adapter.sdk_gate, lambda value: exact(value, {
                'missingStatus': 401, 'suffixStatus': 401, 'validStatus': 200,
                'noStore': True, 'noindex': True, 'secureCookie': True}))
            self.step('private-tunnel', self.adapter.open_tunnel, lambda value: exact(value, {
                'ownedDestinationAttested': True, 'loopbackOnly': True, 'tlsVerified': True,
                'originalEdgeRetargeted': False}))
            result['browser'] = self.step('browser-writes', self.adapter.browser_journeys, browser_result)
            result['lifecycle'] = self.step('realtime-ledger', self.adapter.lifecycle_proof, lifecycle_result)
            self.step('owned-worker-restart', self.adapter.restart_proof, lambda value: exact(value, {
                'onlyOwnedWorkerRestarted': True, 'directLocalhostShaEqual': True,
                'queueLedgerUnchanged': True, 'realtimeReconnected': True,
                'orphanBrowsers': 0, 'employerPayloads': 0, 'realEmailMessages': 0}))
            # Observe actual terminal rows again AFTER the restart, not old proof.
            self.step('post-restart-ledger', self.adapter.lifecycle_proof, lifecycle_result)
            result['status'] = 'WORKFLOW_PASS_NATIVE_UNPROVEN'
        except BaseException as error:
            result['issues'].append(str(error) if type(error) is QaError else 'QaWorkflowFailed_RawWithheld')
        finally:
            # Close even if open/start threw after an ambiguous side effect.
            stops_ok = not owned_intent
            if owned_intent:
                for name, method, fields in (
                    ('close-browser', 'close_browser', {'browserClosed': True}),
                    ('close-tunnel', 'close_tunnel', {'tunnelClosed': True}),
                    ('stop-owned', 'stop_owned', {'ownedContainersAbsent': True, 'originalContainersUnchanged': True}),
                    ('clean-owned-queue', 'clean_queue', {'ownedRowsAbsent': True, 'preexistingRowsUnchanged': True}),
                ):
                    try:
                        result['cleanup'][name] = self.step(name, lambda m=method: getattr(self.adapter, m)(),
                            lambda value, f=fields: exact(value, f))
                    except BaseException:
                        result['issues'].append('QaCleanupFailed_' + name)
                stops_ok = all(name in result['cleanup'] for name in ('close-browser', 'close-tunnel', 'stop-owned', 'clean-owned-queue'))
                # Never force-disconnect or drop an uncertain live database.
                if stops_ok:
                    try:
                        result['cleanup']['destroy-clone'] = self.step('destroy-clone', self.adapter.destroy_clone,
                            lambda value: exact(value, {'databaseAbsent': True}))
                        result['cleanup']['clean-owned-files'] = self.step('clean-owned-files', self.adapter.clean_files,
                            lambda value: exact(value, {'ownedFilesAbsent': True, 'ownedStorageAbsent': True,
                                                       'unrelatedPathsChanged': 0}))
                    except BaseException:
                        result['issues'].append('QaOwnedCloneOrFileCleanupFailed')
                else:
                    result['issues'].append('QaCloneRetained_UncertainDisconnect_NoDrop')
            # Always attempt full original containment, even when cleanup failed.
            try:
                result['finalContainment'] = self.step('containment-after', self.adapter.full_containment, containment)
            except BaseException:
                result['issues'].append('QaFinalContainmentFailed_HardStop')
            if result['issues']:
                result['status'] = 'FAIL'
            result.update(nativeExecutionProven=False, phaseComplete=False, cutover=False)
        return result


def main(argv=None):
    arguments = sys.argv[1:] if argv is None else argv
    if arguments in ([], ['--dry-run']):
        print(json.dumps(plan(), sort_keys=True))
        return 0
    # No credential import, private bootstrap, filesystem read or native slot first.
    raise QaError('NativeQaExecutionNotWired_FreshAuthorityAndReviewedBindingsRequired')


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except QaError as error:
        print(json.dumps({'status': 'STOP', 'code': str(error), 'privateStateRead': False,
                          'nativeExecutionProven': False, 'phaseComplete': False}))
        raise SystemExit(1)
