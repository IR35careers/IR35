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
