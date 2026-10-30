"""Pure controller/transport fixtures; no native, private-state or network I/O."""
import copy
import hashlib
import inspect
import json
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import p8_live_header_control as control
from test_p8_live_header_audit import Fixture as HeaderFixture, PASSWORD, ANON, GATE, BASIC, BEARER, SHA


CANDIDATE = b'Public synthetic template ONLY; never a validated live Caddyfile.\n'
CANDIDATE_SHA = hashlib.sha256(CANDIDATE).hexdigest()


class Journal:
    def __init__(self, root=control.JOURNAL):
        self.root, self.stages, self.files, self.sealed = root, set(), {}, {}
        self.verifications = 0

    def stage(self, name):
        if name in self.stages:
            raise FileExistsError('ExclusiveFixtureStageExists')
        self.stages.add(name)
        return name

    def put(self, stage, name, content):
        if stage in self.sealed:
            raise RuntimeError('FixtureStageSealed')
        key = (stage, name)
        if key in self.files:
            raise FileExistsError('ExclusiveFixtureArtifactExists')
        self.files[key] = bytes(content)

    def seal(self, stage, previous=None):
        rows = {name: hashlib.sha256(body).hexdigest() for (owner, name), body in self.files.items() if owner == stage}
        body = json.dumps({'previous': previous, 'artifacts': rows}, sort_keys=True).encode()
        self.put(stage, 'manifest.json', body)
        sha = hashlib.sha256(body).hexdigest()
        self.sealed[stage] = sha
        return sha

    def verify(self, stage, expected):
        self.verifications += 1
        manifest = self.files[(stage, 'manifest.json')]
        if self.sealed[stage] != expected or hashlib.sha256(manifest).hexdigest() != expected:
            raise RuntimeError('FixtureManifestMismatch')
        for name, sha in json.loads(manifest)['artifacts'].items():
            if hashlib.sha256(self.files[(stage, name)]).hexdigest() != sha:
                raise RuntimeError('FixtureArtifactMismatch')


def context():
    return {'profile': 'ir35', 'region': 'uk-london-1', 'vmPublicIp': '132.145.28.134',
        'sourceClean': True, 'sourceSHA': control.REVIEWED_SOURCE, 'runtimeVerified': True,
        'transportsPinnedToLoopback': True, 'noRedirectFollowing': True,
        'mock': True, 'smtpSink': True, 'realAcceptance': False,
        'candidateCI': {'configSourceSHA': control.REVIEWED_SOURCE,
            'controllerSourceSHA': control.REVIEWED_SOURCE, 'candidateTemplateSHA256': CANDIDATE_SHA,
            'imageId': control.IMAGE, 'manifestVerified': True, 'manifestSHA256': '1' * 64,
            'allHostedChecksGreen': True, 'sameAssertionsAndTimeouts': True,
            'realCaddyCases': [{'case': name, 'expectedStatus': expected,
                'actualStatus': expected, 'passed': True} for name, expected in control.EXPECTED_CASES.items()]}}


def full_proof():
    return {'status': 'PASS', 'tables': 62, 'sequences': 2, 'storageObjects': 73,
        'appRolePrivileges': 552, 'approvedQueueRoles': 2, 'hbaLoginChecks': 112,
        'unapprovedRuntimeChanges': 0, 'schemaUnexplainedDifferences': 0,
        'schemaExceptions': sorted(control.EXCEPTIONS), 'manifestSHA256': '2' * 64,
        **{key: True for key in ('orderedMD5', 'authHashParity', 'storageSHA256', 'manifests',
            'baseline552Unchanged', 'queueRolesPassed', 'hbaPassed', 'sourceUntouched')}}


class NativeFixture:
    def __init__(self):
        self.events = []
        self.headers = HeaderFixture()
        self.head_missing = False
        self.head_status = 401
        self.config_sha = control.OLD_CONFIG_SHA
        self.restart_calls = 0
        self.install_calls = 0
        self.restore_calls = 0
        self.validate_fail = False
        self.restart_fail = False
        self.install_fail = False
        self.containment_fail_after = False
        self.custody_fail = False
        self.seen_config_fail = False

    def head_request(self, host, path):
        self.events.append(('HEAD', host, path))
        # The post-install GET failure fixture must not accidentally fail the
        # earlier HEAD itself (or delete an already-absent header). Independent
        # transports model their distinct observations without relaxing checks.
        headers = {'cache-control': 'no-store', 'x-robots-tag': 'noindex',
                   'www-authenticate': 'Basic realm="restricted"'}
        if self.head_missing:
            del headers['cache-control']
        return self.head_status, headers

    def inspect_current(self):
        self.events.append(('inspect', self.config_sha))
        return {'status': 'PASS', 'container': control.CONTAINER, 'imageId': control.IMAGE,
            'version': 'v2.10.2', 'configSha256': self.config_sha,
            'containerConfigSha256': '9' * 64 if self.seen_config_fail else self.config_sha,
            'adminOff': not self.custody_fail, 'persistenceOff': True,
            'exactReadonlyConfigMount': True, 'publicAdminAPIExposed': False,
            'running': True, 'paused': False, 'oomKilled': False, 'containerId': 'c' * 64,
            'startedAt': f'2026-10-30T12:00:0{self.restart_calls}.000000000Z', 'restartCount': 0}

    def containment(self, phase, sha):
        self.events.append(('containment', phase, sha))
        value = full_proof()
        if phase == 'after' and self.containment_fail_after:
            value['orderedMD5'] = False
        return value

    def backup_current(self, stage, path, image):
        self.events.append(('backup', path, image))
        return {'status': 'PASS', 'configSHA256': control.OLD_CONFIG_SHA, 'imageId': image,
            'configCopyVerified': True, 'imageRetainedLocally': True,
            'exclusivePrivateBackup': True, 'custodyVerified': True, 'envUnchanged': True}

    def validate_candidate(self, stage, candidate):
        self.events.append(('validate', hashlib.sha256(candidate).hexdigest()))
        return {'status': 'PASS', 'configSHA256': CANDIDATE_SHA, 'imageId': control.IMAGE,
            'redactedAdaptedDiffSHA256': '3' * 64,
            **{key: True for key in ('validatePassed', 'adaptPassed', 'adminOff', 'persistenceOff',
                'routesAndUpstreamsUnchanged', 'bindingsUnchanged', 'envUnchanged',
                'cookieFlagsUnchanged', 'privateKeyPathsUnchanged', 'trustedTlsUnchanged',
                'onlyApprovedHeaderChanges')}, 'authUnchanged': not self.validate_fail}

    def action(self):
        return {'status': 'PASS', 'container': control.CONTAINER, 'imageId': control.IMAGE,
                'onlyCaddy': True, 'envUnchanged': True, 'configSHA256': self.config_sha}

    def install_candidate(self, path, candidate, old_sha):
        self.events.append(('install', path, old_sha))
        self.install_calls += 1
        self.config_sha = hashlib.sha256(candidate).hexdigest()
        if self.install_fail:
            raise ValueError(PASSWORD + '/' + BEARER + '/' + GATE)
        return self.action()

    def restart_caddy(self, container):
        self.events.append(('restart', container))
        self.restart_calls += 1
        if self.restart_fail and self.restart_calls == 1:
            raise RuntimeError(PASSWORD)
        return self.action()

    def restore_backup(self, path, old_sha, image):
        self.events.append(('restore', path, old_sha, image))
        self.restore_calls += 1
        self.config_sha = old_sha
        return self.action()

    def ops(self):
        return {name: getattr(self, name) for name in ('head_request', 'inspect_current', 'containment',
            'backup_current', 'validate_candidate', 'install_candidate', 'restart_caddy', 'restore_backup')}

    def inputs(self):
        return {'runtime': {'read_env': self.headers.read_env}, 'private_env': self.headers.private_env,
            'tls_request': self.headers.tls_request, 'http_request': self.headers.http_request,
            'expected_build_sha': SHA}


class ConditionalHeaderControllerTests(unittest.TestCase):
    def run_control(self, fixture=None, journal=None, ctx=None, **overrides):
        fixture, journal = fixture or NativeFixture(), journal or Journal()
        kwargs = {'context': ctx or context(), 'ops': fixture.ops(), 'store': journal,
                  'header_inputs': fixture.inputs(), 'candidate': CANDIDATE}
        kwargs.update(overrides)
        return control.run(**kwargs), fixture, journal

    def test_present_initial_headers_skip_every_mutation_and_candidate_requirement(self):
        ctx = context()
        del ctx['candidateCI']
        native = NativeFixture()
        ops = {name: method for name, method in native.ops().items()
               if name in ('head_request', 'inspect_current', 'containment')}
        result, native, journal = self.run_control(native, ctx=ctx, ops=ops, candidate=None)
        self.assertEqual(result['status'], 'PASS')
        self.assertTrue(result['activationSkipped'])
        self.assertEqual(result['activationAttempts'], 0)
        self.assertEqual(native.install_calls + native.restart_calls + native.restore_calls, 0)
        self.assertEqual([row[0] for row in native.events[:2]], ['HEAD', 'HEAD'])
        self.assertEqual(len(native.headers.calls) + len(native.headers.http_calls), 14)
        self.assertEqual(journal.verifications, len(result['steps']) - 1)

    def test_later_http_header_failure_cannot_turn_a_skip_into_an_activation(self):
        native = NativeFixture()
        native.headers.redirect_headers_missing = True
        result, native, _ = self.run_control(native)
        self.assertEqual(result['status'], 'FAIL')
        self.assertTrue(result['activationSkipped'])
        self.assertEqual(result['code'], 'FullLiveHeaderSuiteFailed_Stop')
        self.assertEqual(native.install_calls + native.restart_calls, 0)
        self.assertTrue(result['containmentCompleted'])

    def test_one_missing_initial_header_allows_one_proven_same_image_restart(self):
        native = NativeFixture()
        native.head_missing = True
        result, native, _ = self.run_control(native)
        self.assertEqual(result['status'], 'PASS')
        self.assertEqual(result['activationAttempts'], 1)
        self.assertEqual(result['activationRestarts'], 1)
        self.assertEqual(native.install_calls, 1)
        self.assertEqual(native.restart_calls, 1)
        self.assertEqual(native.restore_calls, 0)
        self.assertEqual(native.config_sha, CANDIDATE_SHA)
        order = [row[0] for row in native.events]
        self.assertLess(order.index('backup'), order.index('install'))
        self.assertLess(order.index('validate'), order.index('install'))
        self.assertEqual(next(row for row in native.events if row[0] == 'restart'), ('restart', control.CONTAINER))

    def test_private_error_chain_ci_alone_is_not_exact_public_candidate_proof(self):
        for change in ('missing-case', 'wrong-template', 'wrong-controller', 'not-verified'):
            with self.subTest(change=change):
                native = NativeFixture()
                native.head_missing = True
                ctx = context()
                if change == 'missing-case': ctx['candidateCI']['realCaddyCases'].pop()
                if change == 'wrong-template': ctx['candidateCI']['candidateTemplateSHA256'] = '4' * 64
                if change == 'wrong-controller': ctx['candidateCI']['controllerSourceSHA'] = 'd' * 40
                if change == 'not-verified': ctx['candidateCI']['manifestVerified'] = False
                result, native, _ = self.run_control(native, ctx=ctx)
                self.assertEqual(result['status'], 'FAIL')
                self.assertEqual(native.install_calls + native.restart_calls + native.restore_calls, 0)

    def test_auth_or_current_custody_failure_never_becomes_header_repair_authority(self):
        for mode in ('status', 'admin', 'mounted-bytes'):
            with self.subTest(mode=mode):
                native = NativeFixture()
                native.head_missing = True
                if mode == 'status': native.head_status = 200
                if mode == 'admin': native.custody_fail = True
                if mode == 'mounted-bytes': native.seen_config_fail = True
                result, native, _ = self.run_control(native)
                self.assertEqual(result['status'], 'FAIL')
                self.assertEqual(native.install_calls + native.restart_calls + native.restore_calls, 0)

    def test_failed_header_only_validation_stops_before_install(self):
        native = NativeFixture()
        native.head_missing = True
        native.validate_fail = True
        result, native, _ = self.run_control(native)
        self.assertEqual(result['status'], 'FAIL')
        self.assertEqual(result['code'], 'ValidatedHeaderOnlyCandidateRequired')
        self.assertEqual(result['activationAttempts'], 0)
        self.assertEqual(native.install_calls + native.restart_calls + native.restore_calls, 0)

    def test_any_post_install_failure_restores_original_and_never_retries_activation(self):
        for failure in ('install', 'restart', 'headers', 'containment'):
            with self.subTest(failure=failure):
                native = NativeFixture()
                native.head_missing = True
                if failure == 'install': native.install_fail = True
                if failure == 'restart': native.restart_fail = True
                if failure == 'headers': native.headers.error_headers_missing = True
                if failure == 'containment': native.containment_fail_after = True
                result, native, _ = self.run_control(native)
                self.assertEqual(result['status'], 'FAIL')
                self.assertEqual(result['rollback'], 'PASS')
                self.assertEqual(result['activationAttempts'], 1)
                self.assertEqual(native.install_calls, 1)
                self.assertEqual(native.restore_calls, 1)
                self.assertEqual(result['rollbackRestarts'], 1)
                self.assertLessEqual(result['activationRestarts'], 1)
                self.assertEqual(native.config_sha, control.OLD_CONFIG_SHA)
                self.assertTrue(result['containmentCompleted'])

    def test_data_mismatch_remains_failure_even_after_a_clean_rollback(self):
        native = NativeFixture()
        native.head_missing = True
        native.containment_fail_after = True
        result, native, journal = self.run_control(native)
        self.assertEqual(result['status'], 'FAIL')
        self.assertEqual(result['code'], 'FullContainmentMismatch_HardStop')
        self.assertEqual(result['rollback'], 'PASS')
        self.assertTrue(any(b'FullContainmentMismatch_HardStop' in body for body in journal.files.values()))

    def test_post_install_journal_failure_is_preserved_with_rollback_not_reconstructed(self):
        class FailingJournal(Journal):
            def put(self, stage, name, content):
                if stage.endswith('-install-candidate') and name == 'controller-step-result.json':
                    raise OSError('SyntheticJournalWriteFailure')
                return super().put(stage, name, content)
        native = NativeFixture()
        native.head_missing = True
        result, native, journal = self.run_control(native, FailingJournal())
        self.assertEqual(result['status'], 'FAIL')
        self.assertEqual(result['rollback'], 'PASS')
        self.assertEqual(result['journalIntegrity'], 'FAIL')
        self.assertEqual(len(result['unsealedStages']), 1)
        failed = result['unsealedStages'][0]
        self.assertIn((failed, 'controller-intent.json'), journal.files)
        self.assertNotIn((failed, 'controller-step-result.json'), journal.files)
        self.assertEqual(native.install_calls, 1)
        self.assertEqual(native.restore_calls, 1)
        self.assertEqual(native.config_sha, control.OLD_CONFIG_SHA)

    def test_failed_rollback_is_reported_without_a_second_restore_or_restart_retry(self):
        native = NativeFixture()
        native.head_missing = True
        native.install_fail = True
        def denied_restore(*args):
            native.restore_calls += 1
            raise RuntimeError('SyntheticRestoreFailure')
        ops = native.ops() | {'restore_backup': denied_restore}
        result, native, _ = self.run_control(native, ops=ops)
        self.assertEqual(result['status'], 'FAIL')
        self.assertEqual(result['rollback'], 'FAILED')
        self.assertEqual(result['rollbackCode'], 'RollbackFailed_NoRetry')
        self.assertEqual(native.install_calls, 1)
        self.assertEqual(native.restore_calls, 1)
        self.assertEqual(native.restart_calls, 0)
        self.assertFalse(result['containmentCompleted'])

    def test_replay_of_used_owner_journal_fails_before_any_second_native_call_or_append(self):
        native, journal = NativeFixture(), Journal()
        self.run_control(native, journal)
        original_events, original_files = list(native.events), dict(journal.files)
        with self.assertRaises(FileExistsError):
            self.run_control(native, journal)
        self.assertEqual(native.events, original_events)
        self.assertEqual(journal.files, original_files)

    def test_all_public_controller_evidence_omits_raw_callback_exception_secrets(self):
        native = NativeFixture()
        native.head_missing = True
        native.install_fail = True
        result, native, journal = self.run_control(native)
        text = json.dumps(result) + ''.join(body.decode() for body in journal.files.values())
        for secret in (PASSWORD, ANON, GATE, BASIC, BEARER):
            self.assertNotIn(secret, text)
        self.assertIn('InjectedOperationFailed', text)

    def test_fresh_context_and_fixed_new_journal_are_required_without_native_calls(self):
        for change in ({'runtimeVerified': False}, {'sourceClean': False}, {'realAcceptance': True},
                       {'smtpSink': False}, {'region': 'different'}, {'noRedirectFollowing': False}):
            with self.subTest(change=change):
                native = NativeFixture()
                ctx = context() | change
                with self.assertRaises(control.ControlStop):
                    self.run_control(native, ctx=ctx)
                self.assertEqual(native.events, [])
        native = NativeFixture()
        with self.assertRaisesRegex(control.ControlStop, 'ExactNewOwnerJournalRequired'):
            self.run_control(native, Journal('/old/used-slot'))
        self.assertEqual(native.events, [])

    def test_no_native_command_import_or_old_controller_is_in_the_new_source(self):
        source = inspect.getsource(control)
        for forbidden in ('import subprocess', 'import socket', 'import ssl', 'import cloud_schema',
            'import sdk_owner1', 'import p6_', 'import web_edge', 'urlopen(', 'systemctl ',
            'write_text(', 'open(', 'force-recreate', 'docker compose', 'caddy reload'):
            self.assertNotIn(forbidden, source)


if __name__ == '__main__':
    unittest.main()
