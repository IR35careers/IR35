import copy
import inspect
import json
from pathlib import Path
import subprocess
import sys
import unittest
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import p6_hba as controller
import p6_hba_guest as guest
import p6_queue_hba as policy

DATABASES = ['postgres', 'ir35_p5_app', 'ir35_p4_fixture', 'template0', 'template1']


def parsed():
    result = []
    for index, line in enumerate(policy.rules(DATABASES), 1):
        parts = line.split()
        result.append({'rule_number': index, 'type': parts[0], 'database': [parts[1].strip('"')],
                       'user_name': list(policy.ROLES), 'address': 'all' if parts[0] == 'host' else None,
                       'auth_method': parts[-1], 'error': None, 'options': None})
    result.append({'rule_number': len(result) + 1, 'type': 'host', 'database': ['all'], 'user_name': ['all'],
                   'address': 'all', 'auth_method': 'md5', 'error': None})
    return result


class QueueHBATests(unittest.TestCase):
    def test_explicit_app_rejects_then_queue_scram_then_future_rejects_before_original(self):
        original = b'# Original untouched\nhost all all all trust\nlocal all all peer\n'
        body = policy.candidate(original, DATABASES)
        self.assertTrue(body.endswith(original))
        self.assertLess(body.index(b'host "ir35_p5_app"'), body.index(b'host "postgres"'))
        self.assertLess(body.index(b'host "postgres"'), body.index(b'host all ir35_queue,'))
        self.assertLess(body.index(policy.END.encode()), body.index(b'host all all all trust'))
        self.assertEqual(body.count(b' scram-sha-256\n'), 2)
        self.assertIn(b'local all ir35_queue,ir35_queue_producer reject', body)
        self.assertIn(b'host replication ir35_queue,ir35_queue_producer all reject', body)
        proof = policy.verify_parsed(parsed(), DATABASES)
        self.assertTrue(proof['ipv4Covered'] and proof['ipv6Covered'] and proof['localCovered'])

    def test_injection_duplicate_missing_inventory_or_replay_refused(self):
        for names in (['postgres'], DATABASES + ['bad\nall'], DATABASES + ['all"'], DATABASES + ['postgres']):
            with self.assertRaises(ValueError):
                policy.candidate(b'host all all all scram-sha-256\n', names)
        with self.assertRaisesRegex(ValueError, 'AlreadyPresent_NoReplay'):
            policy.candidate((policy.BEGIN + '\n').encode(), DATABASES)

    def test_wrong_order_general_rule_wrong_role_method_parser_error_all_fail(self):
        rows = parsed()
        variants = []
        changed = copy.deepcopy(rows)
        changed[0]['auth_method'] = 'trust'
        variants.append(changed)
        changed = copy.deepcopy(rows)
        changed[0]['user_name'] = ['all']
        variants.append(changed)
        changed = copy.deepcopy(rows)
        changed[-1]['rule_number'] = 0
        variants.append(changed)
        changed = copy.deepcopy(rows)
        changed[-1]['error'] = 'bad configuration'
        variants.append(changed)
        variants.append(rows[:1])
        for observed in variants:
            with self.assertRaises(ValueError):
                policy.verify_parsed(observed, DATABASES)

    def test_real_login_probe_uses_existing_password_only_in_stdin_no_logs(self):
        secret = 'd' * 64
        credential = {'PGUSER': 'ir35_queue', 'PGDATABASE': 'postgres', 'PGPASSWORD': secret}
        response = subprocess.CompletedProcess([], 2, b'', b'FATAL: pg_hba.conf rejects connection for host "private"')
        with patch.object(guest.subprocess, 'run', return_value=response) as native:
            proof = guest.docker_login('sha256:' + 'a' * 64, 'ir35_queue', 'ir35_p5_app', credential)
        self.assertTrue(proof['passed'] and proof['explicitHBAReject'])
        self.assertEqual(native.call_args.kwargs['input'], (secret + '\n').encode())
        self.assertNotIn(secret, str(native.call_args.args))
        self.assertNotIn(secret, json.dumps(proof))
        self.assertNotIn('--env', native.call_args.args[0])
        self.assertNotIn('--volume', native.call_args.args[0])
        self.assertIn('--log-driver', native.call_args.args[0])
        self.assertFalse(proof['applicationFunctionCalled'])

    def test_connection_refused_bad_password_and_wrong_identity_never_count_as_denials(self):
        for error in (b'connection refused', b'FATAL: password authentication failed', b'no pg_hba.conf entry'):
            proof = guest.reduce_login(subprocess.CompletedProcess([], 2, b'', error), 'ir35_queue', 'ir35_p5_app', 'local')
            self.assertFalse(proof['passed'])
        self.assertFalse(guest.reduce_login(subprocess.CompletedProcess([], 0, b'wrong|postgres', b''),
                                           'ir35_queue', 'postgres', 'local')['passed'])
        self.assertTrue(guest.reduce_login(subprocess.CompletedProcess([], 0, b'ir35_queue|postgres\n', b''),
                                          'ir35_queue', 'postgres', 'local')['passed'])

    def test_every_transport_password_never_in_command_or_result(self):
        credential = {'PGUSER': 'ir35_queue', 'PGDATABASE': 'postgres', 'PGPASSWORD': 'b' * 64}
        for transport, host in [('local', '/var/run/postgresql'), ('ipv4-loopback', '127.0.0.1'), ('ipv6-loopback', '::1')]:
            with patch.object(guest.subprocess, 'run', return_value=subprocess.CompletedProcess([], 0, b'ir35_queue|postgres', b'')) as native:
                self.assertTrue(guest.actual_login('ir35_queue', 'postgres', transport, credential)['passed'])
            self.assertIn(host, native.call_args.args[0])
            self.assertNotIn('b' * 64, str(native.call_args.args))

    def test_explicit_entrypoint_and_write_once_gate(self):
        with patch.object(controller.sys, 'argv', ['p6_hba.py']), patch.object(controller.p6_context, 'context') as context:
            with self.assertRaisesRegex(RuntimeError, 'ExplicitOwnerQueueBoundaryRequired'):
                controller.main()
        context.assert_not_called()
        source = inspect.getsource(controller.main)
        self.assertIn("destination.open('x'", source)
        self.assertIn('AlreadyRecorded_NoReplay', source)

    def test_no_restart_or_privilege_mutation_and_backup_precedes_change(self):
        source = inspect.getsource(guest.run)
        self.assertLess(source.index("store.put(stage, 'pg_hba.original.conf'"), source.index('replace_hba(path, body, custody)'))
        self.assertLess(source.index('verify_parsed(rows, names)'), source.index('reload_and_wait(recovery)'))
        self.assertIn('replace_hba(path, original, custody)', source)
        self.assertIn("check_containment(data, runtime, store, stage, 'post')", source)
        self.assertIn("result['rawFunctionScopeAfter'] != result['rawFunctionScopeBefore']", source)
        self.assertIn('postmasterStartUnchanged=True', source)
        for forbidden in ('ALTER ROLE', 'GRANT ', 'REVOKE ', 'UPDATE pg_', 'docker restart', 'pg_ctl restart', 'add_to_waitlist('):
            self.assertNotIn(forbidden, inspect.getsource(guest))

    def test_failed_denial_restores_exact_backup_reloads_and_preserves_failure(self):
        info = {'port': '5432', 'socketDirectories': '/var/run/postgresql', 'queueSessions': [], 'hbaFile': '/etc/postgresql/pg_hba.conf',
                'databases': [{'name': name, 'allowConnections': True} for name in DATABASES]}
        raw_scope = {'status': 'REVIEW_REQUIRED'}
        data = {'p4': {}, 'scopeFailure': {'stage': '09-mock-runtime-update-two', 'manifestSHA256': 'a' * 64,
                'code': 'QueueRoleDefinerAccessOutsideQueueSchema_SecurityStop', 'newWorkerStarts': 0,
                'containment': {'status': 'PASS'}, 'queueFunctionScope': raw_scope}}
        store = Mock()
        store.stage.return_value = Path('/opt/ir35/.env.p6/10-owner-queue-hba-boundary')
        store.seal.return_value = 'c' * 64
        recovery = Mock()
        recovery.query.side_effect = [json.dumps(info), '[]', json.dumps(parsed())]
        runtime = {'run': Mock(return_value=json.dumps([{'Image': 'sha256:' + 'a' * 64,
                           'HostConfig': {'LogConfig': {'Type': 'none'}, 'PortBindings': None}}]))}
        original = b'# untouched\nlocal all all trust\n'
        custody = {'uid': 105, 'gid': 105, 'mode': 384}
        with patch.object(guest, 'prepared', return_value=store), patch.object(guest, 'Recovery', return_value=recovery), \
                patch.object(guest, 'check_containment', return_value={'status': 'PASS'}), \
                patch.object(guest, 'function_scope', return_value=raw_scope), patch.object(guest, 'read_hba', return_value=(original, custody)), \
                patch.object(guest, 'replace_hba') as replace, patch.object(guest, 'reload_and_wait') as reload, \
                patch.object(guest, 'private_env', return_value={}), patch.object(guest, 'docker_login', return_value={'passed': False}):
            result = guest.run(data, runtime)
        self.assertEqual(result['status'], 'FAIL')
        self.assertEqual(result['code'], 'QueueActualLoginBoundaryMismatch_RestoreAndStop')
        self.assertEqual(result['rollback']['status'], 'PASS')
        self.assertEqual(replace.call_args_list[-1].args, (info['hbaFile'], original, custody))
        self.assertEqual(reload.call_count, 2)
        self.assertEqual(result['workerStarts'], 0)
        self.assertEqual(result['functionCalls'], 0)
        self.assertEqual(result['failureContainment']['status'], 'PASS')


if __name__ == '__main__':
    unittest.main()
