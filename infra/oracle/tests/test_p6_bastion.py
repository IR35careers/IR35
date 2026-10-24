from contextlib import contextmanager
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import host_ssh
import p6_bastion as recovery
from key_ceremony import KeySafetyError
from test_host_identity_bastion import KEY


class RecoveryTests(unittest.TestCase):
    def test_update_uses_installed_cli_option_and_single_source(self):
        args = recovery.update_args('fixture', '8.8.8.8/32')
        self.assertEqual(args[:3], ['bastion', 'bastion', 'update'])
        self.assertEqual(json.loads(args[args.index('--client-cidr-list') + 1]), ['8.8.8.8/32'])
        self.assertNotIn('--client-cidr-block-allow-list', args)
        for value in ('0.0.0.0/0', '8.8.8.0/24'):
            with self.assertRaises(KeySafetyError):
                recovery.update_args('fixture', value)

    def test_repair_requires_exact_pre_http_parser_evidence(self):
        with patch.object(recovery.subprocess, 'run', return_value=subprocess.CompletedProcess([], 2, "Error: No such option '--client-cidr-block-allow-list'. Did you mean '--client-cidr-list'?", '')):
            self.assertTrue(recovery.prove_parser_rejection()['oldOptionRejectedBeforeHTTP'])
        with patch.object(recovery.subprocess, 'run', return_value=subprocess.CompletedProcess([], 1, '', 'HTTP500')):
            with self.assertRaises(KeySafetyError):
                recovery.prove_parser_rejection()

    def test_parser_probe_uses_public_fixtures_no_profile_signer_or_auth(self):
        # CI needs only its existing crypto dependencies, not owner CLI files.
        # The matching real vendor probe runs explicitly with --check-parser.
        output = "Usage: oci bastion bastion update [OPTIONS]\nError: No such option '--client-cidr-block-allow-list'. Did you mean '--client-cidr-list'?\n"
        with patch.object(recovery.subprocess, 'run', return_value=subprocess.CompletedProcess([], 2, output, '')) as run:
            self.assertTrue(recovery.prove_parser_rejection()['oldOptionRejectedBeforeHTTP'])
            args = run.call_args.args[0]
            self.assertIn('fixture', args)
            self.assertNotIn('--profile', args)
            self.assertNotIn('--auth', args)

    def test_recorded_hold_blocks_before_identity_or_cloud_access(self):
        with patch.object(recovery.HOLD.__class__, 'exists', return_value=True), patch.object(recovery, 'ensure_session') as auth, \
                patch.object(recovery.infra, 'invoke') as api:
            with self.assertRaisesRegex(KeySafetyError, 'held for owner review'):
                recovery.prepare(repair_cli=True)
            auth.assert_not_called()
            api.assert_not_called()

    def test_allowlist_cannot_add_second_source_or_widen_private_endpoint(self):
        journal = {'ownerCIDR': '8.8.8.8/32', 'bastionCIDR': '10.35.1.9/32', 'created': {'bastion': {}}}
        row = {'lifecycle-state': 'ACTIVE', 'client-cidr-block-allow-list': ['1.1.1.1/32'], 'private-endpoint-ip-address': '10.35.1.9'}
        with patch.object(recovery.infra, 'verify'):
            recovery.validate_bastion(journal, row, ['8.8.8.8/32', '1.1.1.1/32'])
            for sources in (['0.0.0.0/0'], ['8.8.8.8/32', '1.1.1.1/32'], ['1.1.1.0/24']):
                with self.subTest(sources=sources), self.assertRaises(KeySafetyError):
                    recovery.validate_bastion(journal, row | {'client-cidr-block-allow-list': sources}, ['1.1.1.1/32'])
            with self.assertRaises(KeySafetyError):
                recovery.validate_bastion(journal, row | {'private-endpoint-ip-address': '10.35.1.10'}, ['1.1.1.1/32'])

    def test_historical_gateway_pin_cannot_be_silently_reenrolled(self):
        entry = {'id': 'fixture', 'deleted': True, 'gatewayTrustMethod': 'first-use-gateway-public-scan-only'}
        def read(path):
            return json.dumps({'bastionVerification': entry}) if path == recovery.repair.STATE else 'ir35-bastion-fixture ' + KEY + '\n'
        with patch.object(recovery, 'private_file', side_effect=read):
            self.assertEqual(recovery.continuity_key({}), recovery.ALIAS + ' ' + KEY + '\n')
            with self.assertRaises(KeySafetyError):
                recovery.continuity_key({'bastion-public-host-key-info': 'ssh-ed25519 AAAA'})
            entry['deleted'] = False
            with self.assertRaises(KeySafetyError):
                recovery.continuity_key({})

    def test_bastion_inner_connection_keeps_original_guest_pin_and_no_agent_forwarding(self):
        state = {'verified': True, 'knownHostsLine': 'fixture', 'publicIP': '8.8.8.8', 'instanceId': 'fixture-instance'}
        def private(path):
            return json.dumps(state) if path == host_ssh.HOST_JOURNAL else 'fixture'
        @contextmanager
        def tunnel(agent, guest):
            self.assertEqual(guest, state)
            yield 12345
        result = subprocess.CompletedProcess([], 0, '{"ok":true}', '')
        with patch.dict(os.environ, {'IR35_SSH_TRANSPORT': 'bastion'}), patch.object(host_ssh, 'private_file', side_effect=private), \
                patch.object(host_ssh, 'ensure_agent', return_value={'keyLoaded': True, 'socket': '/fixture/agent'}), \
                patch.object(recovery, 'tunnel', side_effect=tunnel), patch.object(host_ssh.subprocess, 'run', return_value=result) as run:
            self.assertEqual(host_ssh.run_remote('safe', []), {'ok': True})
            args = run.call_args.args[0]
            for value in ('HostKeyAlias=8.8.8.8', 'StrictHostKeyChecking=yes', 'ForwardAgent=no', 'ubuntu@127.0.0.1', '12345'):
                self.assertIn(value, args)
            self.assertFalse(any('accept-new' in value for value in args))

    def test_expired_or_changed_receipt_stops_before_network(self):
        base = {'ready': True, 'expiresAt': 0, 'gatewayPinSHA256': hashlib.sha256(b'fixture').hexdigest(),
                'spec': {'targetResourceDetails': {'targetResourceId': 'fixture-instance'}}}
        def read(path):
            return json.dumps(base) if path == recovery.STATE else 'fixture'
        with patch.object(recovery, 'private_file', side_effect=read), patch.object(recovery.infra, 'invoke') as invoke:
            with self.assertRaises(KeySafetyError), recovery.tunnel({}, {'instanceId': 'fixture-instance'}):
                self.fail('must not connect')
            invoke.assert_not_called()

    def test_unknown_transport_never_falls_back_to_direct(self):
        state = {'verified': True, 'knownHostsLine': 'fixture', 'publicIP': '8.8.8.8'}
        with patch.dict(os.environ, {'IR35_SSH_TRANSPORT': 'proxy-command'}), \
                patch.object(host_ssh, 'private_file', side_effect=lambda p: json.dumps(state) if p == host_ssh.HOST_JOURNAL else 'fixture'), \
                patch.object(host_ssh, 'ensure_agent', return_value={'keyLoaded': True, 'socket': '/fixture/agent'}), \
                patch.object(host_ssh.subprocess, 'run') as run:
            with self.assertRaises(KeySafetyError):
                host_ssh.run_remote('safe', [])
            run.assert_not_called()


if __name__ == '__main__':
    unittest.main()
