import inspect
import json
from pathlib import Path
import re
import sys
import unittest
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from p6_processes import PS_FIELDS, process_rows
import p6_status_audit_guest as audit
import p6_lifecycle_guest as lifecycle


class ProcessColumnsTests(unittest.TestCase):
    def test_pid_column_is_mandatory_and_old_header_is_rejected(self):
        self.assertEqual(PS_FIELDS, 'pid,stat,comm')
        self.assertEqual(process_rows('PID STAT COMMAND\n123 S node\n'), ['123 S node'])
        for output in ('', 'STAT COMMAND\nS node\n', 'PID STAT COMMAND\nunknown S node\n'):
            with self.subTest(output=output), self.assertRaises(RuntimeError):
                process_rows(output)

    def test_both_native_checks_use_pid_columns_and_keep_orphan_failures(self):
        for function in (audit.run_case, lifecycle.run):
            source = inspect.getsource(function)
            self.assertIn('process_rows(', source)
            self.assertIn("'-eo', PS_FIELDS", source)
            self.assertNotIn("'-eo', 'stat,comm'", source)
            self.assertIn('chrome|chromium|chrome_crashpad', source)
        self.assertIn("checked('no-browser-orphans'", inspect.getsource(lifecycle.run))

    def test_actual_audit_case_passes_node_only_but_still_fails_any_browser_process(self):
        values = {'APPLICATION_WORKER_SECRET': 'a'*64}
        health = {'paused': True, 'active': 0, 'realAcceptance': False}
        container = {'Image': 'sha256:fixture', 'State': {'Running': True}}
        for process in ('123 S node', '123 Z chrome_crashpad', '123 S chromium'):
            runtime = {'run': Mock(side_effect=[json.dumps([container]), 'PID STAT COMMAND\n' + process + '\n'])}
            with self.subTest(process=process), patch.object(audit, 'private_env', return_value=values), patch.object(audit, 'Control') as control:
                control.return_value.request.return_value = (200, health)
                observed = audit.run_case('worker-idle', {'runtimeProof': {'image': 'sha256:fixture'}}, runtime)
            self.assertEqual(observed['status'], 'PASS' if process.endswith('node') else 'FAIL')
            self.assertEqual(runtime['run'].call_args.args[0][-2:], ['-eo', 'pid,stat,comm'])

