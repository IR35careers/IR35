import json
from contextlib import redirect_stdout
from io import StringIO
from pathlib import Path
import subprocess
import sys
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from p6_audit_log import AuditFailure, CommandTrace, Journal, command_kind, sha
from p6_status_audit import CASES
import p6_status_audit as controller


class AuditLogTests(unittest.TestCase):
    def test_remote_command_failure_keeps_operation_even_when_old_wrapper_discards_details(self):
        bootstrap = '''runtime={}
guest=types.ModuleType('p6_status_audit_guest')
def fail(name,data,runtime):
    result=subprocess.run(['docker','top','ir35-p6-mock-worker-v3','-eo','stat,comm'],capture_output=True)
    if result.returncode:raise RuntimeError('legacy wrapper discards details')
guest.run_case=fail
sys.modules['p6_status_audit_guest']=guest
'''
        def execute(source, **_):
            output = StringIO()
            with redirect_stdout(output):
                exec(source, {})
            return json.loads(output.getvalue())
        for name in CASES:
            with self.subTest(name=name), patch.object(controller, 'MODULES', ()), \
                    patch.object(controller.p6_worker_build, 'bundle', return_value=bootstrap), \
                    patch.object(controller.schema, 'run_guest', side_effect=execute), \
                    patch.object(subprocess, 'run', return_value=subprocess.CompletedProcess([], 1, b'', b'private error')):
                result = controller.remote_case(name, {})
            self.assertEqual(result['status'], 'FAIL')
            self.assertEqual(result['operation'], name)
            self.assertEqual(result['commands'], [{'operation': 'docker-top', 'status': 'FAIL', 'exitCode': 1,
                                                  'stderrSHA256': sha(b'private error'),
                                                  'stderrCategory': 'unclassified-output-withheld'}])
            self.assertNotIn('private error', json.dumps(result))

    def test_remote_bootstrap_failure_also_preserves_command_diagnostic(self):
        bootstrap = "subprocess.run(['docker','inspect','fixed-name'],capture_output=True)\nraise RuntimeError('legacy failure')\n"
        def execute(source, **_):
            output = StringIO()
            with redirect_stdout(output):
                exec(source, {})
            return json.loads(output.getvalue())
        with patch.object(controller, 'MODULES', ()), patch.object(controller.p6_worker_build, 'bundle', return_value=bootstrap), \
                patch.object(controller.schema, 'run_guest', side_effect=execute), \
                patch.object(subprocess, 'run', return_value=subprocess.CompletedProcess([], 1, b'', b'No such object: fixed-name')):
            result = controller.remote_case('sealed-history', {})
        self.assertEqual(result['status'], 'FAIL')
        self.assertEqual(result['commands'][0]['operation'], 'docker-inspect')
        self.assertEqual(result['commands'][0]['stderrCategory'], 'object-not-found')

    def test_every_case_logs_intent_and_result_before_success_or_failure(self):
        for case in CASES:
            for status in ('PASS', 'FAIL'):
                with self.subTest(case=case, status=status), TemporaryDirectory() as directory:
                    journal = Journal(Path(directory) / 'run')
                    observed = {'status': status, 'operation': case, 'commands': []}
                    if status == 'FAIL':
                        with self.assertRaisesRegex(AuditFailure, 'ReadOnlyAuditFailed_' + case):
                            journal.step(1, case, lambda: observed)
                    else:
                        self.assertEqual(journal.step(1, case, lambda: observed), observed)
                    intent = json.loads((journal.root / ('01-' + case + '-intent.json')).read_bytes())
                    result = json.loads((journal.root / ('01-' + case + '-result.json')).read_bytes())
                    self.assertEqual(intent, {'operation': case, 'readOnly': True})
                    self.assertEqual(result, observed)
                    journal.verify()

    def test_exception_is_recorded_before_raising_without_raw_error(self):
        with TemporaryDirectory() as directory:
            journal = Journal(Path(directory) / 'run')
            action = Mock(side_effect=RuntimeError('password=do-not-include-this-private-fixture'))
            with self.assertRaisesRegex(AuditFailure, 'ReadOnlyAuditFailed_worker-idle'):
                journal.step(1, 'worker-idle', action)
            proof = (journal.root / '01-worker-idle-result.json').read_text()
            self.assertIn('RuntimeError', proof)
            self.assertNotIn('do-not-include', proof)
            self.assertNotIn('password', proof)

    def test_failed_docker_command_identified_even_if_legacy_wrapper_suppresses_it(self):
        raw = b'Error response from daemon: Container deadbeef is not running; password=private-fixture'
        native = Mock(return_value=subprocess.CompletedProcess([], 1, b'private stdout', raw))
        trace = CommandTrace(native)
        result = trace(['docker', 'top', 'ir35-p6-mock-worker-v3', '-eo', 'stat,comm'])
        self.assertEqual(result.returncode, 1)
        self.assertEqual(trace.observations, [{'operation': 'docker-top', 'status': 'FAIL', 'exitCode': 1,
                                              'stderrSHA256': sha(raw), 'stderrCategory': 'container-not-running'}])
        self.assertNotIn('private', json.dumps(trace.observations))
        self.assertNotIn('password', json.dumps(trace.observations))

    def test_timeout_logged_before_failure_and_without_output(self):
        native = Mock(side_effect=subprocess.TimeoutExpired('private args', 1, output=b'private value'))
        trace = CommandTrace(native)
        with self.assertRaises(subprocess.TimeoutExpired):
            trace(['docker', 'ps', '-q'], timeout=1)
        self.assertEqual(trace.observations, [{'operation': 'docker-ps', 'status': 'FAIL', 'exceptionType': 'TimeoutExpired'}])

    def test_modifying_commands_and_write_transactions_refused_before_execution(self):
        for args, body in ((['docker', 'restart', 'worker'], None), (['docker', 'run', 'image'], None),
                           (['docker', 'compose', 'up', '-d'], None), (['sh', '-c', 'anything'], None),
                           (['docker', 'compose', 'exec', 'db', 'psql'], 'BEGIN READ WRITE; SELECT 1; COMMIT;'),
                           (['docker', 'compose', 'exec', 'db', 'psql'], 'SELECT 1;')):
            with self.subTest(args=args):
                native = Mock()
                trace = CommandTrace(native)
                with self.assertRaises(AuditFailure):
                    trace(args, input=body)
                native.assert_not_called()
                self.assertEqual(trace.observations[0]['operation'], 'rejected-before-execution')

    def test_only_transaction_wrapped_read_only_psql_accepted(self):
        args = ['docker', 'compose', '--env-file', '/opt/ir35/.env', '-f', '/opt/ir35/compose.yml',
                'exec', '-T', 'db', '/run/ir35/env-exec', '/opt/ir35/.env.db', 'psql', '-f', '-']
        self.assertEqual(command_kind(args, b'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; SELECT 1; ROLLBACK;'),
                         'docker-compose-read-only-psql')

    def test_write_once_intent_prevents_replay_before_action(self):
        with TemporaryDirectory() as directory:
            root = Path(directory) / 'run'
            journal = Journal(root)
            journal.step(1, 'sealed-history', lambda: {'status': 'PASS'})
            action = Mock()
            with self.assertRaises(FileExistsError):
                journal.step(1, 'sealed-history', action)
            action.assert_not_called()
            with self.assertRaises(FileExistsError):
                Journal(root)

    def test_tampering_or_extra_artifact_stops_before_next_action(self):
        with TemporaryDirectory() as directory:
            journal = Journal(Path(directory) / 'run')
            journal.step(1, 'sealed-history', lambda: {'status': 'PASS'})
            path = journal.root / '01-sealed-history-result.json'
            path.write_text('tampered')
            action = Mock()
            with self.assertRaisesRegex(AuditFailure, 'AuditArtifactChanged'):
                journal.step(2, 'queue-before', action)
            action.assert_not_called()

    def test_manifest_seals_failed_results_without_overwrite(self):
        with TemporaryDirectory() as directory:
            journal = Journal(Path(directory) / 'run')
            with self.assertRaises(AuditFailure):
                journal.step(1, 'smtp-empty', lambda: {'status': 'FAIL', 'sinkTotal': 1})
            digest = journal.seal({'status': 'FAIL', 'retryCount': 0})
            manifest = (journal.root / 'manifest.json').read_bytes()
            self.assertEqual(sha(manifest), digest)
            for row in json.loads(manifest)['artifacts']:
                self.assertEqual(sha((journal.root / row['name']).read_bytes()), row['sha256'])
            with self.assertRaises(AuditFailure):
                journal.put('anything.json', {})
