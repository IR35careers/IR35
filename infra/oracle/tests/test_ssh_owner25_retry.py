"""Owner25Nov retry boundary; fake agent/TTY/process only, no real key/auth.

Use the existing temporary owner-only Unix-socket fixture by composition, not
subclassing/importing its TestCase into this module's discovery namespace.
"""
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
OLD_ATTEMPT = 'load-owner-migration-20261026.json'
OLD_RESULT = 'load-owner-migration-20261026-result.json'
ATTEMPT = 'load-owner-migration-retry-20261125.json'
RESULT = 'load-owner-migration-retry-20261125-result.json'
OPERATION = 'load-owner-migration-retry-20261125-and-hold'


class Owner25RetryTests(unittest.TestCase):
    setUp = fixtures.AgentTests.setUp
    result = fixtures.AgentTests.result

    def prior(self):
        body = b'{"promptAttempted":true,"plainMigrationOwnerApproval":true}\n'
        write_new(self.directory / OLD_ATTEMPT, body)
        return body

    def loaded(self):
        return self.result(0, '256 ' + FINGERPRINT + ' fixture (ED25519)')

    def call(self):
        return agent.ensure_agent(load=True, owner_migration_retry_20261125=True)

    def test_one_plain_hidden_prompt_preserves_prior_and_records_success_for_the_same_agent(self):
        old = self.prior()
        with patch.object(agent.sys.stdin, 'isatty', return_value=True), \
                patch.object(agent.sys.stdout, 'isatty', return_value=True), \
                patch.object(agent.subprocess, 'run', side_effect=[self.result(1), self.result(0), self.loaded()]) as native:
            proof = self.call()
        self.assertTrue(proof['keyLoaded'])
        self.assertEqual(proof['keyLeaseMode'], 'until-agent-restart')
        self.assertEqual(proof['keyFingerprint'], FINGERPRINT)
        self.assertNotIn('keyLifetimeSecondsRemaining', proof)
        self.assertEqual((self.directory / OLD_ATTEMPT).read_bytes(), old)
        prompt = native.call_args_list[1]
        self.assertEqual(prompt.args[0], ['ssh-add', str(agent.KEY_DIRECTORY / 'ssh_ed25519')])
        for forbidden in ('input', 'stdin', 'stdout', 'stderr', 'capture_output', 'text'):
            self.assertNotIn(forbidden, prompt.kwargs)
        self.assertNotIn('SSH_ASKPASS', prompt.kwargs['env'])
        self.assertNotIn('SSH_ASKPASS_REQUIRE', prompt.kwargs['env'])
        self.assertEqual(prompt.kwargs['timeout'], 300)
        receipt = json.loads((self.directory / RESULT).read_bytes())
        self.assertEqual(receipt['status'], 'PASS')
        self.assertEqual(receipt['fingerprint'], FINGERPRINT)
        self.assertEqual(receipt['agentPID'], 1)
        self.assertEqual(receipt['previousAttemptSHA256'], hashlib.sha256(old).hexdigest())
        self.assertFalse(receipt['retryAllowed'])
        attempt = json.loads((self.directory / ATTEMPT).read_bytes())
        self.assertTrue(attempt['ownerMigrationRetry20261125'])
        self.assertEqual(attempt['expectedFingerprint'], FINGERPRINT)
        self.assertEqual(attempt['agentPID'], 1)
        self.assertEqual(attempt['previousAttemptSHA256'], hashlib.sha256(old).hexdigest())
        with patch.object(agent.subprocess, 'run', return_value=self.loaded()) as native:
            self.assertEqual(agent.ensure_agent()['keyLeaseMode'], 'until-agent-restart')
            self.assertTrue(self.call()['keyLoaded'])
        self.assertEqual(native.call_count, 2)  # Two read-only ssh-add -l checks, no second prompt.

    def test_no_predecessor_is_fail_closed_before_prompt(self):
        with patch.object(agent.sys.stdin, 'isatty', return_value=True), \
                patch.object(agent.sys.stdout, 'isatty', return_value=True), \
                patch.object(agent.subprocess, 'run', return_value=self.result(1)) as native:
            with self.assertRaises((KeySafetyError, FileNotFoundError)): self.call()
        self.assertEqual(native.call_count, 1)
        self.assertFalse((self.directory / ATTEMPT).exists())

    def test_old_success_receipt_never_authorises_a_same_agent_reprompt(self):
        self.prior()
        write_new(self.directory / OLD_RESULT, json.dumps({'keyLoaded': True, 'fingerprint': FINGERPRINT,
            'agentPID': 1, 'mode': 'until-agent-restart'}).encode())
        with patch.object(agent.subprocess, 'run', return_value=self.result(1)) as native:
            with self.assertRaisesRegex(KeySafetyError, 'NoAutomaticReprompt'): self.call()
        self.assertEqual(native.call_count, 1)

    def test_already_loaded_identity_needs_no_prompt_or_new_slot(self):
        self.prior()
        with patch.object(agent.subprocess, 'run', return_value=self.loaded()) as native:
            self.assertTrue(self.call()['keyLoaded'])
        self.assertEqual(native.call_count, 1)
        self.assertFalse((self.directory / ATTEMPT).exists())
        self.assertFalse((self.directory / RESULT).exists())

    def test_each_mixed_or_non_load_flag_rejects_before_any_agent_operation(self):
        bad = [{'owner_migration_retry_20261125': True}, {'load': True, 'owner_migration_retry_20261125': 'true'}]
        for old_flag in ('owner_retry', 'owner_four_hour', 'owner_four_hour_reopen', 'owner_ready_four_hour', 'owner_migration'):
            bad.append({'load': True, 'owner_migration_retry_20261125': True, old_flag: True})
        with patch.object(agent.subprocess, 'run') as native:
            for options in bad:
                with self.subTest(options=options), self.assertRaises(KeySafetyError): agent.ensure_agent(**options)
            native.assert_not_called()

    def test_hidden_native_tty_required_and_no_attempt_consumed_by_noninteractive_call(self):
        self.prior()
        for stdin, stdout in ((False, True), (True, False), (False, False)):
            with self.subTest(stdin=stdin, stdout=stdout), \
                    patch.object(agent.sys.stdin, 'isatty', return_value=stdin), \
                    patch.object(agent.sys.stdout, 'isatty', return_value=stdout), \
                    patch.object(agent.subprocess, 'run', return_value=self.result(1)) as native:
                with self.assertRaisesRegex(KeySafetyError, 'native terminal'): self.call()
                self.assertEqual(native.call_count, 1)
        self.assertFalse((self.directory / ATTEMPT).exists())

    def failed_prompt(self, last):
        old = self.prior()
        with patch.object(agent.sys.stdin, 'isatty', return_value=True), \
                patch.object(agent.sys.stdout, 'isatty', return_value=True), \
                patch.object(agent.subprocess, 'run', side_effect=[self.result(1), last]):
            with self.assertRaises(KeySafetyError): self.call()
        receipt = json.loads((self.directory / RESULT).read_bytes())
        self.assertEqual(receipt['status'], 'FAIL')
        self.assertFalse(receipt['retryAllowed'])
        self.assertEqual(receipt['previousAttemptSHA256'], hashlib.sha256(old).hexdigest())
        self.assertEqual((self.directory / OLD_ATTEMPT).read_bytes(), old)
        with patch.object(agent.subprocess, 'run', return_value=self.result(1)) as native:
            with self.assertRaises(KeySafetyError): self.call()
            with self.assertRaises(KeySafetyError): agent.ensure_agent(load=True)
        self.assertEqual(native.call_count, 2)
        return receipt

    def test_native_exit_failure_is_terminal_and_has_no_repeat_prompt(self):
        self.assertEqual(self.failed_prompt(self.result(1))['code'], 'NativeSshUnlockExitFailure')

    def test_native_timeout_is_redacted_and_terminal(self):
        result = self.failed_prompt(subprocess.TimeoutExpired('ssh-add', 300, stderr=b'PRIVATE_SENTINEL'))
        self.assertNotIn('PRIVATE_SENTINEL', json.dumps(result))

    def test_post_load_fingerprint_mismatch_records_failure(self):
        self.prior()
        with patch.object(agent.sys.stdin, 'isatty', return_value=True), \
                patch.object(agent.sys.stdout, 'isatty', return_value=True), \
                patch.object(agent.subprocess, 'run', side_effect=[self.result(1), self.result(0),
                    self.result(0, '256 SHA256:' + 'B' * 43 + ' fixture (ED25519)')]):
            with self.assertRaises(KeySafetyError): self.call()
        self.assertEqual(json.loads((self.directory / RESULT).read_bytes())['code'], 'SshFingerprintVerificationFailed')

    def test_post_load_list_timeout_records_safe_terminal_failure(self):
        self.prior()
        with patch.object(agent.sys.stdin, 'isatty', return_value=True), \
                patch.object(agent.sys.stdout, 'isatty', return_value=True), \
                patch.object(agent.subprocess, 'run', side_effect=[self.result(1), self.result(0),
                    subprocess.TimeoutExpired('ssh-add', 5, stderr=b'PRIVATE_SENTINEL')]):
            with self.assertRaises(KeySafetyError): self.call()
        receipt = json.loads((self.directory / RESULT).read_bytes())
        self.assertEqual(receipt['status'], 'FAIL')
        self.assertNotIn('PRIVATE_SENTINEL', json.dumps(receipt))

    def test_used_attempt_without_result_after_crash_cannot_be_bypassed_by_generic_load(self):
        self.prior()
        write_new(self.directory / ATTEMPT, b'{"ownerMigrationRetry20261125":true}')
        with patch.object(agent.subprocess, 'run', return_value=self.result(1)) as native:
            for options in ({'load': True}, {'load': True, 'owner_migration': True},
                            {'load': True, 'owner_migration_retry_20261125': True}):
                with self.subTest(options=options), self.assertRaises(KeySafetyError): agent.ensure_agent(**options)
        self.assertEqual(native.call_count, 3)
        self.assertFalse((self.directory / RESULT).exists())
        self.assertFalse((self.directory / 'load-attempt.json').exists())

    def make_receipt(self, **changes):
        self.prior()
        receipt = {'status': 'PASS', 'keyLoaded': True, 'fingerprint': FINGERPRINT, 'mode': 'until-agent-restart',
                   'agentPID': 1, 'retryAllowed': False}
        write_new(self.directory / RESULT, json.dumps(receipt | changes).encode())

    def test_check_refuses_wrong_agent_pid_even_if_fingerprint_loaded(self):
        self.make_receipt(agentPID=999)
        with patch.object(agent.subprocess, 'run', return_value=self.loaded()):
            with self.assertRaisesRegex(KeySafetyError, 'ReceiptMismatch'): agent.ensure_agent()

    def test_check_refuses_wrong_receipt_fingerprint(self):
        self.make_receipt(fingerprint='SHA256:' + 'B' * 43)
        with patch.object(agent.subprocess, 'run', return_value=self.loaded()):
            with self.assertRaisesRegex(KeySafetyError, 'ReceiptMismatch'): agent.ensure_agent()

    def test_check_never_turns_failed_receipt_into_a_verified_no_ttl_lease(self):
        self.make_receipt(status='FAIL')
        with patch.object(agent.subprocess, 'run', return_value=self.loaded()):
            with self.assertRaisesRegex(KeySafetyError, 'ReceiptMismatch'): agent.ensure_agent()

    def test_cli_dispatches_only_owner25_flag_and_holds_without_socket_output_or_polling(self):
        proof = {'agentReady': True, 'keyLoaded': True, 'socket': 'PRIVATE_SENTINEL', 'keyFingerprint': FINGERPRINT,
                 'keyLeaseMode': 'until-agent-restart'}
        with patch.object(agent, 'ensure_agent', return_value=proof) as ensure, \
                patch.object(agent.signal, 'pause') as pause, patch('builtins.print') as output:
            agent.cli([OPERATION])
        ensure.assert_called_once_with(load=True, owner_migration_retry_20261125=True)
        pause.assert_called_once_with()
        self.assertNotIn('PRIVATE_SENTINEL', str(output.call_args_list))

    def test_powershell_switch_is_explicit_mutually_exclusive_and_routes_to_the_new_cli(self):
        source = (Path(__file__).resolve().parents[1] / 'open-ssh-agent.ps1').read_text()
        self.assertIn('[switch]$OwnerMigrationRetry20261125', source)
        self.assertIn('[int]$OwnerMigrationRetry20261125.IsPresent', source)
        self.assertIn(OPERATION, source)
        self.assertIn('OWNER APPROVED 25 NOV RETRY - NO LIFETIME - NOT OCI API', source)


if __name__ == '__main__': unittest.main()
