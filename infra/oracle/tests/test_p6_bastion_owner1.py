import json
import inspect
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import p6_bastion_owner1 as recovery
from immutable_artifacts import Store
from key_ceremony import KeySafetyError


class OwnerRecoveryTests(unittest.TestCase):
    def test_token_window_requires_forty_five_minutes_without_auth_retry(self):
        self.assertEqual(recovery.require_token_window({'expiresAt': 2800}, now=100)['tokenSecondsRemaining'], 2700)
        for expires in (2799, 0):
            with self.assertRaisesRegex(KeySafetyError, 'TokenBelow45Minutes'):
                recovery.require_token_window({'expiresAt': expires}, now=100)
        self.assertEqual(recovery.require_token_window({'expiresAt': 1900}, now=100, minimum_seconds=1800)['minimumSecondsRequired'], 1800)
        with self.assertRaisesRegex(KeySafetyError, 'TokenBelow30Minutes'):
            recovery.require_token_window({'expiresAt': 1899}, now=100, minimum_seconds=1800)

    def test_four_hour_reopening_is_bound_to_zero_create_unloaded_agent_failure(self):
        failed = {'status': 'FAIL', 'sessionCreates': 0, 'sessionClosed': True, 'workerRestarts': 0,
                  'bastionUpdates': 0, 'iamChanges': 0, 'networkChanges': 0, 'productionChanges': False,
                  'code': 'ExistingSSHAgentKeyNotLoaded_NoAutomaticPrompt'}
        recovery.require_unloaded_agent_reopening(failed)
        for change in ({'sessionCreates': 1}, {'sessionClosed': False}, {'code': 'unrelated failure'}, {'networkChanges': 1}):
            with self.assertRaises(KeySafetyError):
                recovery.require_unloaded_agent_reopening(failed | change)

    def test_four_hour_owner_execution_checks_thirty_minutes_and_closes_before_containment(self):
        self._token_run(four_hour=True)

    def test_owner_reopening_accepts_only_the_preserved_zero_create_auth_gate(self):
        previous = {'status': 'FAIL', 'sessionCreates': 0, 'sessionClosed': True, 'workerRestarts': 0,
                    'bastionUpdates': 0, 'iamChanges': 0, 'networkChanges': 0, 'productionChanges': False,
                    'code': 'G2: security-token refresh failed; browser sign-in required. Raw output suppressed.'}
        recovery.require_auth_only_reopening(previous)
        for change in ({'sessionCreates': 1}, {'sessionClosed': False}, {'iamChanges': 1}, {'code': 'data mismatch'}):
            with self.assertRaises(KeySafetyError):
                recovery.require_auth_only_reopening(previous | change)

    def test_token_reopening_closes_one_session_before_full_post_close_containment(self):
        self._token_run()

    def test_token_refresh_failure_is_not_retried_in_cleanup_or_another_recovery(self):
        self._token_run(auth_failure=True)

    def _token_run(self, auth_failure=False, four_hour=False):
        import time
        import subprocess
        import cloud_schema
        import exact_storage_audit
        from datetime import datetime, timezone
        from contextlib import ExitStack
        ids = {kind: 'ocid1.' + kind + '.oc1.uk-london-1.controlledfixture01' for kind in ('bastion', 'instance', 'subnet', 'vnic', 'bastionsession')}
        journal = {'ownerCIDR': '8.8.8.8/32', 'created': {'instance': {'spec': {'availabilityDomain': 'fixture-ad'}}}}
        events = []
        creates = []
        deletes = []
        refresh_failures = []
        def auth(**kwargs):
            if auth_failure and 'reconcile' in events:
                refresh_failures.append(True)
                raise KeySafetyError('G2: security-token refresh failed; browser sign-in required. Raw output suppressed.')
            return {'expiresAt': time.time() + 3600}
        def invoke(args):
            if args[:3] == ['iam', 'compartment', 'get']:
                return {'name': 'ir35', 'lifecycle-state': 'ACTIVE'}
            if args[:3] == ['bastion', 'bastion', 'get']:
                return {'id': ids['bastion']}
            if args[:3] == ['compute', 'instance', 'get']:
                return {'id': ids['instance'], 'lifecycle-state': 'RUNNING', 'shape': 'VM.Standard.A1.Flex', 'shape-config': {'ocpus': 2, 'memory-in-gbs': 12}}
            if args[:3] == ['compute', 'vnic-attachment', 'list']:
                return [{'lifecycle-state': 'ATTACHED', 'instance-id': ids['instance'], 'vnic-id': ids['vnic']}]
            if args[:3] == ['network', 'vnic', 'get']:
                return {'public-ip': '132.145.28.134', 'private-ip': '10.35.1.8', 'subnet-id': ids['subnet']}
            if args[:3] == ['bastion', 'session', 'list']:
                return []
            if args[:3] == ['bastion', 'session', 'create-port-forwarding']:
                creates.append(args)
            elif args[:3] != ['bastion', 'session', 'get']:
                self.fail('Unexpected operation')
            return {'id': ids['bastionsession'], 'lifecycle-state': 'DELETED' if deletes else 'ACTIVE',
                    'ssh-metadata': {'command': recovery.bastion.GATEWAY}, 'time-created': datetime.now(timezone.utc).isoformat()}
        def cli(args, **kwargs):
            self.assertEqual(args[:4], ['oci', 'bastion', 'session', 'delete'])
            deletes.append(args)
            events.append('close')
            return subprocess.CompletedProcess(args, 0, '', '')
        def guest(*args, **kwargs):
            if events:
                self.assertIn('close', events)
                events.append('post-close-containment')
            else:
                events.append('reconcile')
            return {'status': 'PASS', 'containment': {'status': 'PASS'}}
        def private(path):
            if path == recovery.infra.JOURNAL:
                return json.dumps(journal)
            if path == recovery.control.JOURNAL:
                return json.dumps({'created': {'compartment': {'id': 'fixture-child'}}})
            return 'public-fixture-key'
        with tempfile.TemporaryDirectory() as temporary, ExitStack() as stack:
            root = Path(temporary) / 'owner'
            root.mkdir(mode=0o700)
            public = root / 'preflight.json'
            store = Store(root)
            def seal(name, receipt, destination):
                stage = store.stage(name)
                store.put(stage, 'result.json', json.dumps(receipt).encode())
                destination.write_text(json.dumps(receipt | {'stage': stage.name, 'manifestSHA256': store.seal(stage)}))
            seal('01-preflight', {'status': 'PASS'}, public)
            seal('02-session', {'status': 'FAIL', 'sessionCreates': 0, 'sessionClosed': True, 'workerRestarts': 0,
                 'bastionUpdates': 0, 'networkChanges': 0, 'code': 'Approximate Object Storage metadata is not exact byte evidence.'}, root / 'bastion-owner1-session.json')
            seal('04-session-after-exact', {'status': 'FAIL', 'sessionCreates': 0, 'sessionClosed': True, 'workerRestarts': 0,
                 'bastionUpdates': 0, 'iamChanges': 0, 'networkChanges': 0, 'productionChanges': False,
                 'code': 'G2: security-token refresh failed; browser sign-in required. Raw output suppressed.'}, root / 'bastion-owner1-session-after-exact.json')
            if four_hour:
                seal('05-owner-token-reopen', {'status': 'FAIL', 'sessionCreates': 0, 'sessionClosed': True, 'workerRestarts': 0,
                     'bastionUpdates': 0, 'iamChanges': 0, 'networkChanges': 0, 'productionChanges': False,
                     'code': 'ExistingSSHAgentKeyNotLoaded_NoAutomaticPrompt'}, root / 'bastion-owner1-session-token-reopen.json')
            for name, value in [('ROOT', root), ('PUBLIC', public), ('TRANSPORT', root / 'transport.json'), ('HOSTS', root / 'hosts')]:
                stack.enter_context(patch.object(recovery, name, value))
            stack.enter_context(patch.object(recovery, 'work_bundle', return_value='fixture'))
            stack.enter_context(patch.object(exact_storage_audit, 'latest_pass', return_value={'status': 'PASS', 'exactBytesProven': True,
                 'bucketListingStable': True, 'exactBytes': 0, 'standardOnly': True, 'stableCompletePasses': 2, 'manifestSHA256': 'fixture'}))
            stack.enter_context(patch.object(recovery, 'private_file', side_effect=private))
            stack.enter_context(patch.object(recovery.transport, 'current_cidr', return_value='8.8.8.8/32'))
            stack.enter_context(patch.object(recovery.transport, 'continuity_key', return_value='fixture-pin'))
            stack.enter_context(patch.object(recovery, 'allowed_source', return_value={'status': 'PASS'}))
            stack.enter_context(patch.object(recovery.p1_compute, 'verify_network', return_value={'status': 'PASS'}))
            stack.enter_context(patch.object(recovery.infra, 'identifier', side_effect=lambda _, kind: ids[kind]))
            stack.enter_context(patch.object(recovery.infra, 'cli_arguments', return_value=['bastion', 'bastion', 'get']))
            stack.enter_context(patch.object(recovery.infra, 'invoke', side_effect=invoke))
            stack.enter_context(patch.object(recovery.infra, 'fresh_eligibility', return_value={'shapeBilling': 'LIMITED_FREE'}))
            stack.enter_context(patch.object(recovery, 'ReadOnlyOci', return_value=object()))
            stack.enter_context(patch.object(recovery, 'ensure_session', side_effect=auth))
            stack.enter_context(patch.object(recovery, 'ensure_agent', return_value={'keyLoaded': True, 'keyFingerprint': 'public-fixture-fingerprint', 'keyLifetimeSecondsRemaining': 14400}))
            stack.enter_context(patch.object(recovery.bastion, 'verify_session', return_value=ids['bastionsession']))
            stack.enter_context(patch.object(recovery, 'wait_for_visible', side_effect=lambda action, **_: action()))
            stack.enter_context(patch.object(recovery, 'command', side_effect=lambda args: ['oci', *args]))
            stack.enter_context(patch.object(recovery.subprocess, 'run', side_effect=cli))
            stack.enter_context(patch.object(cloud_schema, 'run_guest', side_effect=guest))
            result = recovery.execute(after_exact=True, token_reopen=True, four_hour_reopen=four_hour)
            self.assertEqual(len(creates), 1)
            if auth_failure:
                self.assertEqual(result['status'], 'FAIL')
                self.assertEqual(len(refresh_failures), 1)
                self.assertEqual(deletes, [])
                self.assertFalse(result['sessionClosed'])
                self.assertEqual(result['cleanupCode'], 'AuthRefreshFailed_NoRetry_SessionTTL1800')
            else:
                self.assertEqual(result['status'], 'PASS')
                self.assertEqual(len(deletes), 1)
                self.assertEqual(events, ['reconcile', 'close', 'post-close-containment'])
                self.assertTrue(result['sessionClosed'])
                if four_hour:
                    self.assertEqual(result['tokenWindow']['minimumSecondsRequired'], 1800)
                    self.assertGreaterEqual(result['sshAgent']['keyLifetimeSecondsRemaining'], 3600)
                    self.assertEqual(result['stage'], '06-owner-four-hour-reopen')
            store.verify(result['stage'], result['manifestSHA256'])
            with self.assertRaises(FileExistsError):
                recovery.execute(after_exact=True, token_reopen=True, four_hour_reopen=four_hour)
            self.assertEqual(len(creates), 1)

    def test_only_proven_zero_creates_and_exact_complete_pass_can_reopen_unused_slot(self):
        failed = {'status': 'FAIL', 'sessionCreates': 0, 'sessionClosed': True, 'workerRestarts': 0, 'bastionUpdates': 0, 'networkChanges': 0,
                  'code': 'Approximate Object Storage metadata is not exact byte evidence.'}
        proof = {'status': 'PASS', 'exactBytesProven': True, 'bucketListingStable': True, 'exactBytes': 0, 'standardOnly': True, 'stableCompletePasses': 2}
        recovery.require_unused_after_exact(failed, proof)
        for change in ({'sessionCreates': 1}, {'code': 'different failure'}, {'bastionUpdates': 1}, {'sessionClosed': False}):
            with self.assertRaises(KeySafetyError):
                recovery.require_unused_after_exact(failed | change, proof)
        for change in ({'exactBytesProven': False}, {'exactBytes': True}, {'exactBytes': 8_000_000_001}, {'bucketListingStable': False}, {'status': 'FAIL'}):
            with self.assertRaises(KeySafetyError):
                recovery.require_unused_after_exact(failed, proof | change)

    def test_new_authority_never_changes_an_existing_bastion_allowlist(self):
        journal = {'ownerCIDR': '8.8.8.8/32'}
        parent = {'client-cidr-block-allow-list': ['8.8.8.8/32']}
        with patch.object(recovery.transport, 'validate_bastion'), patch.object(recovery.infra, 'invoke') as api:
            self.assertEqual(recovery.allowed_source(journal, parent, '8.8.8.8/32')['bastionUpdates'], 0)
            with self.assertRaisesRegex(KeySafetyError, 'NoBastionChangeAuthorized'):
                recovery.allowed_source(journal, parent, '1.1.1.1/32')
            api.assert_not_called()

    def test_failed_preflight_is_write_once_and_never_continues_or_retries(self):
        journal = {'ownerCIDR': '8.8.8.8/32', 'computeReadback': {'publicIP': '132.145.28.134'}}
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / 'owner1'
            public = Path(temporary) / 'public.json'
            with patch.object(recovery, 'ROOT', root), patch.object(recovery, 'PUBLIC', public), \
                    patch.object(recovery, 'private_file', return_value=json.dumps(journal)), \
                    patch.object(recovery.transport, 'current_cidr', return_value='1.1.1.1/32'), \
                    patch.object(recovery, 'ensure_session', return_value={}), \
                    patch.object(recovery, 'ensure_agent', return_value={'keyLoaded': True}), \
                    patch.object(recovery.infra, 'identifier', return_value='ocid1.bastion.oc1.uk-london-1.controlledfixture01'), \
                    patch.object(recovery.infra, 'invoke', return_value={'lifecycle-state': 'ACTIVE', 'client-cidr-block-allow-list': ['8.8.8.8/32']}) as api, \
                    patch.object(recovery.transport, 'validate_bastion'), \
                    patch.object(recovery.p1_compute, 'verify_network') as network:
                result = recovery.run_preflight()
                self.assertEqual(result['status'], 'FAIL')
                self.assertEqual(result['code'], 'CurrentOwnerIPNotInExistingBastionAllowlist_NoBastionChangeAuthorized')
                self.assertEqual(result['sessionCreates'], 0)
                self.assertEqual(result['cloudUpdates'], 0)
                network.assert_not_called()
                api.assert_called_once()
                self.assertEqual(api.call_args.args[0][:3], ['bastion', 'bastion', 'get'])
                Store(root).verify(result['stage'], result['manifestSHA256'])
                first = public.read_bytes()
                with self.assertRaises(FileExistsError):
                    recovery.run_preflight()
                self.assertEqual(public.read_bytes(), first)
                api.assert_called_once()

    def test_preflight_has_no_provisioning_or_mutating_controller(self):
        source = inspect.getsource(recovery.run_preflight)
        self.assertNotIn('transport.prepare(', source)
        self.assertNotIn('update_args(', source)
        self.assertNotIn('create_args(', source)
        self.assertNotIn('atomic_metadata(', source)
        self.assertIn("PUBLIC.open('x'", source)

    def test_guest_reconciliation_is_read_only_and_checks_containment_on_failure(self):
        import p6_bastion_owner1_guest as guest
        source = inspect.getsource(guest.run)
        compile(source, 'owner1-guest-test', 'exec')
        self.assertIn("original.verify('07-network-diagnose', anchor)", source)
        self.assertIn("'execution'] = 'NOT_RUN' if not probe_exists", source)
        self.assertIn("check_containment(data, runtime, store, stage, 'post')", source)
        for forbidden in ("['docker', 'start'", "['docker', 'restart'", "['docker', 'run'", "['docker', 'rm'", 'unlink(', 'rmtree('):
            self.assertNotIn(forbidden, source)

    def test_post_stop_check_is_only_pinned_read_only_containment_not_another_attempt(self):
        import os
        import cloud_schema
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / 'journal'
            root.mkdir(mode=0o700)
            public = Path(temporary) / 'preflight.json'
            store = Store(root)
            stage = store.stage('02-session')
            store.put(stage, 'result.json', b'{"status":"FAIL"}')
            anchor = store.seal(stage)
            report = {'status': 'FAIL', 'sessionCreates': 0, 'workerRestarts': 0, 'sessionClosed': True,
                      'stage': stage.name, 'manifestSHA256': anchor}
            (public.parent / 'bastion-owner1-session.json').write_text(json.dumps(report))
            with patch.object(recovery, 'ROOT', root), patch.object(recovery, 'PUBLIC', public), \
                    patch.object(recovery, 'work_bundle', return_value='read-only fixture'), \
                    patch.dict(os.environ, {'IR35_SSH_TRANSPORT': 'direct'}), \
                    patch.object(cloud_schema, 'run_guest', return_value={'status': 'PASS', 'containment': {'status': 'PASS'}}) as ssh, \
                    patch.object(recovery.infra, 'invoke') as api:
                result = recovery.containment_after_stop()
                self.assertEqual(result['status'], 'PASS')
                self.assertEqual(result['sessionCreates'], 0)
                api.assert_not_called()
                ssh.assert_called_once()
                store.verify(result['stage'], result['manifestSHA256'])
                with self.assertRaises(FileExistsError):
                    recovery.containment_after_stop()
                ssh.assert_called_once()

    def test_execute_always_closes_only_its_one_session_when_ssh_work_fails(self):
        from datetime import datetime, timezone
        from contextlib import ExitStack
        import subprocess
        import cloud_schema
        ids = {kind: 'ocid1.' + kind + '.oc1.uk-london-1.controlledfixture01' for kind in ('bastion', 'instance', 'subnet', 'vnic', 'bastionsession')}
        journal = {'ownerCIDR': '8.8.8.8/32', 'created': {'instance': {'spec': {'availabilityDomain': 'fixture-ad'}}}}
        creates = []
        deletes = []
        def invoke(args):
            if args[:3] == ['bastion', 'bastion', 'get']:
                return {'id': ids['bastion']}
            if args[:3] == ['compute', 'instance', 'get']:
                return {'id': ids['instance'], 'lifecycle-state': 'RUNNING', 'shape': 'VM.Standard.A1.Flex', 'shape-config': {'ocpus': 2, 'memory-in-gbs': 12}}
            if args[:3] == ['compute', 'vnic-attachment', 'list']:
                return [{'lifecycle-state': 'ATTACHED', 'instance-id': ids['instance'], 'vnic-id': ids['vnic']}]
            if args[:3] == ['network', 'vnic', 'get']:
                return {'public-ip': '132.145.28.134', 'private-ip': '10.35.1.8', 'subnet-id': ids['subnet']}
            if args[:3] == ['bastion', 'session', 'list']:
                return []
            if args[:3] == ['bastion', 'session', 'create-port-forwarding']:
                creates.append(args)
            elif args[:3] != ['bastion', 'session', 'get']:
                self.fail('Unapproved OCI operation: ' + repr(args))
            return {'id': ids['bastionsession'], 'lifecycle-state': 'DELETED' if deletes else 'ACTIVE',
                    'ssh-metadata': {'command': recovery.bastion.GATEWAY}, 'time-created': datetime.now(timezone.utc).isoformat()}
        def cli(args, **kwargs):
            self.assertEqual(args[:4], ['oci', 'bastion', 'session', 'delete'])
            self.assertIn(ids['bastionsession'], args)
            deletes.append(args)
            return subprocess.CompletedProcess(args, 0, '', '')
        def private(path):
            if path == recovery.infra.JOURNAL:
                return json.dumps(journal)
            if path == recovery.control.JOURNAL:
                return json.dumps({'created': {'compartment': {'id': 'fixture-child'}}})
            return 'public-fixture-key'
        with tempfile.TemporaryDirectory() as temporary, ExitStack() as stack:
            root = Path(temporary) / 'owner'
            root.mkdir(mode=0o700)
            store = Store(root)
            stage = store.stage('01-preflight')
            store.put(stage, 'result.json', b'{"status":"PASS"}')
            anchor = store.seal(stage)
            public = Path(temporary) / 'preflight.json'
            public.write_text(json.dumps({'stage': stage.name, 'manifestSHA256': anchor, 'status': 'PASS'}))
            for name, value in [('ROOT', root), ('PUBLIC', public), ('TRANSPORT', root / 'transport.json'), ('HOSTS', root / 'hosts')]:
                stack.enter_context(patch.object(recovery, name, value))
            stack.enter_context(patch.object(recovery, 'work_bundle', return_value='fixture'))
            stack.enter_context(patch.object(recovery, 'private_file', side_effect=private))
            stack.enter_context(patch.object(recovery.transport, 'current_cidr', return_value='8.8.8.8/32'))
            stack.enter_context(patch.object(recovery.transport, 'continuity_key', return_value='fixture-gateway-pin'))
            stack.enter_context(patch.object(recovery, 'allowed_source', return_value={'status': 'PASS'}))
            stack.enter_context(patch.object(recovery.p1_compute, 'verify_network', return_value={'status': 'PASS'}))
            stack.enter_context(patch.object(recovery.infra, 'identifier', side_effect=lambda _, kind: ids[kind]))
            stack.enter_context(patch.object(recovery.infra, 'cli_arguments', return_value=['bastion', 'bastion', 'get']))
            stack.enter_context(patch.object(recovery.infra, 'invoke', side_effect=invoke))
            stack.enter_context(patch.object(recovery.infra, 'fresh_eligibility', return_value={'shapeBilling': 'LIMITED_FREE'}))
            stack.enter_context(patch.object(recovery, 'ReadOnlyOci', return_value=object()))
            stack.enter_context(patch.object(recovery, 'ensure_session', return_value={}))
            stack.enter_context(patch.object(recovery.bastion, 'verify_session', return_value=ids['bastionsession']))
            stack.enter_context(patch.object(recovery, 'wait_for_visible', side_effect=lambda action, **_: action()))
            stack.enter_context(patch.object(recovery, 'command', side_effect=lambda args: ['oci', *args]))
            stack.enter_context(patch.object(recovery.subprocess, 'run', side_effect=cli))
            stack.enter_context(patch.object(cloud_schema, 'run_guest', side_effect=KeySafetyError('fixture SSH failure')))
            result = recovery.execute()
            self.assertEqual(result['status'], 'FAIL')
            self.assertEqual(result['code'], 'fixture SSH failure')
            self.assertTrue(result['sessionClosed'])
            self.assertEqual(len(creates), 1)
            self.assertEqual(len(deletes), 1)
            self.assertEqual(creates[0][creates[0].index('--target-port') + 1], '22')
            self.assertEqual(creates[0][creates[0].index('--session-ttl') + 1], '1800')
            store.verify(result['stage'], result['manifestSHA256'])
            with self.assertRaises(FileExistsError):
                recovery.execute()
            self.assertEqual(len(creates), 1)


if __name__ == '__main__':
    unittest.main()
