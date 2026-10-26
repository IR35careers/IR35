import ast
import copy
import json
import os
from pathlib import Path
import sys
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import p6_pause_reconcile_guest as guest


class PauseReconciliationTests(unittest.TestCase):
    def test_job_activity_before_cutoff_passes_with_snake_and_compact_keys(self):
        jobs = [{'created_on': '2026-10-25T22:20:00Z', 'started_on': '2026-10-25T22:21:00Z',
                 'completed_on': '2026-10-25T22:22:00Z', 'retry_count': 0},
                {'createdon': '2026-10-25T22:23:00+00:00', 'startedon': None, 'completedon': None, 'retrycount': 0}]
        result = guest.activity_times(jobs)
        self.assertTrue(result['noJobActivityAfterCutoff'])
        self.assertTrue(result['jobRetryCountsZero'])
        self.assertEqual(result['latestRecordedJobActivityUTC'], '2026-10-25T22:23:00+00:00')

    def test_any_post_pause_execution_or_retry_fails_without_editing_the_data(self):
        original = [{'created_on': '2026-10-25T22:20:00Z', 'completed_on': '2026-10-26T01:00:00Z', 'retry_count': 1}]
        before = copy.deepcopy(original)
        result = guest.activity_times(original)
        self.assertFalse(result['noJobActivityAfterCutoff'])
        self.assertFalse(result['jobRetryCountsZero'])
        self.assertEqual(original, before)

    def test_missing_activity_timestamp_is_not_treated_as_no_activity(self):
        with self.assertRaisesRegex(RuntimeError, 'CreationTimestampMissing'):
            guest.activity_times([{'completed_on': None, 'retry_count': 0}])

    def test_running_container_and_processing_pause_are_distinct_and_tested(self):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            stage = root / '16-native-mock-lifecycle-repair-one'
            stage.mkdir()
            marker = stage / 'manifest.json'
            marker.write_text('public fixture')
            os.utime(marker, (guest.instant('2026-10-25T22:30:00Z').timestamp(),) * 2)
            started = '2026-10-25T15:09:10Z'
            worker = {'State': {'StartedAt': started, 'Running': True, 'Paused': False}, 'RestartCount': 0, 'Image': 'sha256:fixture'}
            health = {'paused': True, 'active': 0, 'mode': 'staging-mock-only', 'realAcceptance': False, 'buildSHA': 'b'*40}
            values = {'APPLY_RUNNER': 'mock', 'IR35_STAGING': 'true', 'APPLICATION_WORKER_ACCEPT_JOBS': 'false',
                      'APPLICATION_WORKER_CONCURRENCY': '1', 'IR35_READ_ONLY': 'false', 'IR35_SCHEDULER_ENABLED': 'false',
                      'IR35CAREERS_APP_URL': 'https://staging.ir35careers.com', 'QUEUE_DB_ALLOWED_HOSTS': 'db', 'PORT': '8787',
                      'APPLICATION_WORKER_SECRET': 'a'*64, 'IR35_BUILD_SHA': 'b'*40}
            data = {'currentFailure': {'stage': stage.name}, 'priorDiagnosis': {'inspect': {'StartedAt': started}},
                    'runtimeProof': {'image': worker['Image'], 'sourceSHA': 'b'*40}}
            runtime = {'run': Mock(return_value=json.dumps([worker]))}
            with patch.object(guest, 'history', return_value=(Mock(root=root), {})), \
                    patch.object(guest, 'private_env', side_effect=lambda p: values if p.name.endswith('worker') else {'APPLICATION_WORKER_SECRET': 'a'*64}), \
                    patch.object(guest, 'Control') as control:
                control.return_value.request.return_value = (200, health)
                result = guest.run_case('processing-flag', data, runtime)
                self.assertEqual(result['status'], 'PASS')
                self.assertTrue(result['processingPaused'])
                self.assertFalse(result['DockerPaused'])
                self.assertTrue(result['expectedInternalHeartbeatTraffic'])
                control.return_value.request.assert_called_once_with('GET', '/health')
                health['paused'] = False
                self.assertEqual(guest.run_case('processing-flag', data, runtime)['status'], 'FAIL')

    def test_reconciliation_contains_no_top_fix_mutating_control_or_service_command(self):
        tree = ast.parse(Path(guest.__file__).read_text())
        for node in ast.walk(tree):
            if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) and node.func.attr == 'request':
                self.assertEqual(ast.literal_eval(node.args[0]), 'GET')
        source = Path(guest.__file__).read_text()
        self.assertNotIn("'top'", source)
        for forbidden in ("'restart'", "'unpause'", "'POST'", "'build'", 'readonly=False'):
            self.assertNotIn(forbidden, source)

    def test_unknown_case_refused_before_any_native_read(self):
        runtime = {'run': Mock()}
        with self.assertRaisesRegex(RuntimeError, 'FixedPauseReconciliationCaseRequired'):
            guest.run_case('resume-worker', {}, runtime)
        runtime['run'].assert_not_called()
