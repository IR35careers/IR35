"""One explicitly reopened access02 slot; fake TTY/agent/process only."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import ssh_agent_session as agent
from key_ceremony import KeySafetyError, write_new
import test_ssh_agent_session as fixtures

FINGERPRINT = fixtures.FINGERPRINT
OLD = 'load-owner-migration-20261026.json'
FIRST = 'load-owner-migration-retry-20261125.json'
FIRST_RESULT = 'load-owner-migration-retry-20261125-result.json'
SECOND = 'load-owner-migration-retry-20261125-02.json'
SECOND_RESULT = 'load-owner-migration-retry-20261125-02-result.json'
OPERATION = 'load-owner-migration-retry-20261125-02-and-hold'


class Owner25Retry02Tests(unittest.TestCase):
    setUp = fixtures.AgentTests.setUp
    result = fixtures.AgentTests.result

    def prepare(self, *, intent_changes=None, result_changes=None):
        original = b'{"promptAttempted":true,"plainMigrationOwnerApproval":true}\n'
        write_new(self.directory / OLD, original)
        parent_sha = hashlib.sha256(original).hexdigest()
        intent = {'promptAttempted': True, 'ownerMigrationRetry20261125': True,
                  'expectedFingerprint': FINGERPRINT, 'agentPID': 1, 'previousAttemptSHA256': parent_sha}
        receipt = {'status': 'FAIL', 'code': 'NativeSshUnlockFailed_RawWithheld',
                   'previousAttemptSHA256': parent_sha, 'retryAllowed': False}
        intent.update(intent_changes or {}); receipt.update(result_changes or {})
        values = {OLD: original, FIRST: json.dumps(intent).encode(), FIRST_RESULT: json.dumps(receipt).encode()}
        for name in (FIRST, FIRST_RESULT): write_new(self.directory / name, values[name])
        self.prior = values
        self.first_sha = hashlib.sha256(values[FIRST]).hexdigest()
        self.result_sha = hashlib.sha256(values[FIRST_RESULT]).hexdigest()
        for name, value in (('OWNER25_RETRY01_ATTEMPT_SHA256', self.first_sha), ('OWNER25_RETRY01_RESULT_SHA256', self.result_sha)):
            scope = patch.object(agent, name, value); scope.start(); self.addCleanup(scope.stop)

    def loaded(self):
        return self.result(0, '256 ' + FINGERPRINT + ' fixture (ED25519)')

    def call(self):
        return agent.ensure_agent(load=True, owner_migration_retry_20261125_02=True)

    def old_unchanged(self):
        for name, value in self.prior.items(): self.assertEqual((self.directory / name).read_bytes(), value)

    def test_native_hash_pins_are_the_exact_owner_observed_failed_metadata(self):
        self.assertEqual(agent.OWNER25_RETRY01_ATTEMPT_SHA256, 'db772024c63bccd2c5951828c8701f9ec3e41cd037558cf247e26a078fdbc458')
        self.assertEqual(agent.OWNER25_RETRY01_RESULT_SHA256, '518fbe5ec585744e9801954215ec7b344b7fc39d1a4dd5362317f14329e70b0c')

    def test_exact_failure_chain_opens_only_one_plain_prompt_and_receipt_is_recognised(self):
        self.prepare()
        with patch.object(agent.sys.stdin, 'isatty', return_value=True), \
                patch.object(agent.sys.stdout, 'isatty', return_value=True), \
                patch.object(agent.subprocess, 'run', side_effect=[self.result(1), self.result(0), self.loaded()]) as native:
            answer = self.call()
        self.assertEqual(answer['keyLeaseMode'], 'until-agent-restart')
        self.assertEqual(answer['keyFingerprint'], FINGERPRINT)
        self.assertNotIn('keyLifetimeSecondsRemaining', answer)
        prompt = native.call_args_list[1]
        self.assertEqual(prompt.args[0], ['ssh-add', str(agent.KEY_DIRECTORY / 'ssh_ed25519')])
        for name in ('input', 'stdin', 'stdout', 'stderr', 'capture_output', 'text'):
            self.assertNotIn(name, prompt.kwargs)
        self.assertNotIn('SSH_ASKPASS', prompt.kwargs['env'])
        intent = json.loads((self.directory / SECOND).read_bytes())
        receipt = json.loads((self.directory / SECOND_RESULT).read_bytes())
        for value in (intent, receipt):
            self.assertEqual(value['previousAttemptSHA256'], self.first_sha)
            self.assertEqual(value['previousResultSHA256'], self.result_sha)
        self.assertTrue(intent['ownerMigrationRetry20261125_02'])
        self.assertEqual(intent['expectedFingerprint'], FINGERPRINT)
        self.assertEqual(intent['agentPID'], 1)
        self.assertEqual(receipt['status'], 'PASS')
        self.assertEqual(receipt['agentPID'], 1)
        self.assertFalse(receipt['retryAllowed'])
        self.old_unchanged()
        with patch.object(agent.subprocess, 'run', return_value=self.loaded()) as native:
            self.assertEqual(agent.ensure_agent()['keyLeaseMode'], 'until-agent-restart')
            self.assertTrue(self.call()['keyLoaded'])
        self.assertEqual(native.call_count, 2)

    def test_missing_predecessor_stops_before_prompt(self):
        with patch.object(agent.subprocess, 'run', return_value=self.result(1)) as native:
            with self.assertRaisesRegex(KeySafetyError, 'ExactRetainedFailure'): self.call()
        self.assertEqual(native.call_count, 1)
        self.assertFalse((self.directory / SECOND).exists())

    def test_wrong_hash_does_not_become_a_new_retry_authority(self):
        self.prepare()
        with patch.object(agent, 'OWNER25_RETRY01_ATTEMPT_SHA256', '0' * 64), \
                patch.object(agent.subprocess, 'run', return_value=self.result(1)) as native:
            with self.assertRaisesRegex(KeySafetyError, 'ExactRetainedFailure'): self.call()
        self.assertEqual(native.call_count, 1); self.old_unchanged()

    def test_pinned_success_result_is_still_rejected(self):
        self.prepare(result_changes={'status': 'PASS'})
        with patch.object(agent.subprocess, 'run', return_value=self.result(1)) as native:
            with self.assertRaisesRegex(KeySafetyError, 'ExactRetainedFailure'): self.call()
        self.assertEqual(native.call_count, 1)

    def test_same_failed_status_with_wrong_error_code_is_rejected(self):
        self.prepare(result_changes={'code': 'SomethingElse'})
        with patch.object(agent.subprocess, 'run', return_value=self.result(1)):
            with self.assertRaisesRegex(KeySafetyError, 'ExactRetainedFailure'): self.call()

    def test_wrong_agent_pid_or_fingerprint_cannot_step_over_the_failed_guard(self):
        self.prepare(intent_changes={'agentPID': 999})
        with patch.object(agent.subprocess, 'run', return_value=self.result(1)) as native:
            with self.assertRaisesRegex(KeySafetyError, 'ExactRetainedFailure'): self.call()
        self.assertEqual(native.call_count, 1)

    def test_wrong_fingerprint_is_rejected_even_with_matching_pins(self):
        self.prepare(intent_changes={'expectedFingerprint': 'SHA256:' + 'B' * 43})
        with patch.object(agent.subprocess, 'run', return_value=self.result(1)):
            with self.assertRaisesRegex(KeySafetyError, 'ExactRetainedFailure'): self.call()

    def test_old_successful_migration_receipt_cannot_be_bypassed(self):
        self.prepare()
        write_new(self.directory / 'load-owner-migration-20261026-result.json', b'{"keyLoaded":true}')
        with patch.object(agent.subprocess, 'run', return_value=self.result(1)):
            with self.assertRaisesRegex(KeySafetyError, 'ExactRetainedFailure'): self.call()

    def test_every_mixed_flag_and_non_load_is_refused_before_agent_access(self):
        invalid = [{'owner_migration_retry_20261125_02': True}, {'load': True, 'owner_migration_retry_20261125_02': 'true'}]
        for flag in ('owner_retry', 'owner_four_hour', 'owner_four_hour_reopen', 'owner_ready_four_hour', 'owner_migration', 'owner_migration_retry_20261125'):
            invalid.append({'load': True, 'owner_migration_retry_20261125_02': True, flag: True})
        with patch.object(agent.subprocess, 'run') as native:
            for options in invalid:
                with self.subTest(options=options), self.assertRaises(KeySafetyError): agent.ensure_agent(**options)
            native.assert_not_called()

    def test_noninteractive_tty_never_opens_a_prompt_or_consumes02(self):
        self.prepare()
        with patch.object(agent.sys.stdin, 'isatty', return_value=False), \
                patch.object(agent.sys.stdout, 'isatty', return_value=True), \
                patch.object(agent.subprocess, 'run', return_value=self.result(1)) as native:
            with self.assertRaisesRegex(KeySafetyError, 'native terminal'): self.call()
        self.assertEqual(native.call_count, 1); self.assertFalse((self.directory / SECOND).exists())

    def test_crashed02_attempt_with_no_result_blocks_all_load_paths(self):
        self.prepare(); write_new(self.directory / SECOND, b'{"promptAttempted":true}')
        with patch.object(agent.subprocess, 'run', return_value=self.result(1)) as native:
            for options in ({'load': True}, {'load': True, 'owner_migration': True},
                            {'load': True, 'owner_migration_retry_20261125': True},
                            {'load': True, 'owner_migration_retry_20261125_02': True}):
                with self.subTest(options=options), self.assertRaisesRegex(KeySafetyError, '02AlreadyAttempted'):
                    agent.ensure_agent(**options)
        self.assertEqual(native.call_count, 4); self.assertFalse((self.directory / SECOND_RESULT).exists())
        self.old_unchanged()

    def terminal_failure(self, error):
        self.prepare()
        with patch.object(agent.sys.stdin, 'isatty', return_value=True), \
                patch.object(agent.sys.stdout, 'isatty', return_value=True), \
                patch.object(agent.subprocess, 'run', side_effect=[self.result(1), error]):
            with self.assertRaises(KeySafetyError): self.call()
        receipt = json.loads((self.directory / SECOND_RESULT).read_bytes())
        self.assertEqual(receipt['status'], 'FAIL'); self.assertFalse(receipt['retryAllowed'])
        self.assertEqual(receipt['previousAttemptSHA256'], self.first_sha)
        self.assertEqual(receipt['previousResultSHA256'], self.result_sha)
        self.assertNotIn('PRIVATE_SENTINEL', json.dumps(receipt)); self.old_unchanged()
        with patch.object(agent.subprocess, 'run', return_value=self.result(1)) as native:
            with self.assertRaisesRegex(KeySafetyError, '02AlreadyAttempted'): self.call()
            with self.assertRaisesRegex(KeySafetyError, '02AlreadyAttempted'): agent.ensure_agent(load=True)
        self.assertEqual(native.call_count, 2)
        return receipt

    def test_native_nonzero_is_terminal_and_never_reprompted(self):
        self.assertEqual(self.terminal_failure(self.result(1))['code'], 'NativeSshUnlockExitFailure')

    def test_native_timeout_is_redacted_and_terminal(self):
        self.terminal_failure(subprocess.TimeoutExpired('ssh-add', 300, stderr=b'PRIVATE_SENTINEL'))

    def test_keyboard_interrupt_is_terminal_and_leaves_no_automatic_retry(self):
        self.terminal_failure(KeyboardInterrupt())

    def test_already_loaded_without_existing_receipts_never_prompts_or_consumes02(self):
        with patch.object(agent.subprocess, 'run', return_value=self.loaded()) as native:
            self.assertTrue(self.call()['keyLoaded'])
        self.assertEqual(native.call_count, 1); self.assertFalse((self.directory / SECOND).exists())

    def test_failed01_receipt_with_loaded_key_does_not_prompt_or_fabricate_a_verified_lease(self):
        self.prepare()
        with patch.object(agent.subprocess, 'run', return_value=self.loaded()) as native:
            with self.assertRaisesRegex(KeySafetyError, 'ReceiptMismatch'): self.call()
        self.assertEqual(native.call_count, 1); self.assertFalse((self.directory / SECOND).exists())

    def test_cli_and_powershell_use_only_the_new_fixed_explicit_operation(self):
        with patch.object(agent, 'ensure_agent', return_value={'keyLoaded': True, 'socket': 'PRIVATE_SENTINEL'}) as ensure, \
                patch.object(agent.signal, 'pause') as pause, patch('builtins.print') as output:
            agent.cli([OPERATION])
        ensure.assert_called_once_with(load=True, owner_migration_retry_20261125_02=True)
        pause.assert_called_once_with(); self.assertNotIn('PRIVATE_SENTINEL', str(output.call_args_list))
        source = (Path(__file__).resolve().parents[1] / 'open-ssh-agent.ps1').read_text()
        self.assertIn('[switch]$OwnerMigrationRetry2026112502', source)
        self.assertIn('[int]$OwnerMigrationRetry2026112502.IsPresent', source)
        self.assertIn(OPERATION, source)


if __name__ == '__main__': unittest.main()
