import inspect
import io
import json
from pathlib import Path
import sys
import types
import unittest
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import p8_images as controller
import p8_image_policy as policy
from offline_bundle_fixture import public_bootstrap


class ImageTests(unittest.TestCase):
    def checks(self):
        return {'check_runs': [{'name': name, 'id': i + 1, 'head_sha': 'a' * 40,
            'status': 'completed', 'conclusion': 'success'} for i, name in enumerate(sorted(policy.REQUIRED_CHECKS))]}

    def test_all_eleven_exact_head_hosted_checks_required(self):
        self.assertEqual(len(policy.hosted_checks(self.checks(), 'a' * 40)['checks']), 11)
        for key, value in (('head_sha', 'b' * 40), ('status', 'in_progress'), ('conclusion', 'failure'), ('id', True)):
            checked = self.checks(); checked['check_runs'][0][key] = value
            with self.assertRaisesRegex(RuntimeError, 'ExactSource_NoNativeBuild'): policy.hosted_checks(checked, 'a' * 40)

    def test_missing_duplicate_and_malformed_names_are_not_green(self):
        for mutation in ('missing', 'duplicate', 'malformed', 'unknown-extra'):
            checked = self.checks()
            if mutation == 'missing': checked['check_runs'].pop()
            if mutation == 'duplicate': checked['check_runs'].append(checked['check_runs'][0])
            if mutation == 'malformed': checked['check_runs'][0]['name'] = []
            if mutation == 'unknown-extra': checked['check_runs'].append(dict(checked['check_runs'][0], name='unapproved-extra'))
            with self.assertRaisesRegex(RuntimeError, 'CompleteUniqueHostedChecks'): policy.hosted_checks(checked, 'a' * 40)

    def test_public_windows_get_metadata_uses_bounded_stdin_not_windows_binary_or_token(self):
        body = json.dumps(self.checks()).encode()
        checked, digest = controller.public_hosted_input(io.BytesIO(body), 'a' * 40)
        self.assertEqual(checked['status'], 'PASS'); self.assertEqual(len(digest), 64)
        source = inspect.getsource(controller.main)
        self.assertIn('public_hosted_input(sys.stdin.buffer, sha)', source)
        self.assertNotIn('gh.exe', source)
        self.assertNotIn("'api'", source)
        self.assertNotIn('GITHUB_TOKEN', source)

    def test_bad_or_secret_like_stdin_never_escapes_or_creates_a_native_intent(self):
        for body in (b'', b'x' * 1_000_001, b'\xff', b'fixture-private-value-not-json'):
            with self.assertRaises(RuntimeError) as result:
                controller.public_hosted_input(io.BytesIO(body), 'a' * 40)
            self.assertNotIn('private-value', str(result.exception))

    def test_only_current_two_cpu_twelve_gib_arm_and_measured_headroom(self):
        self.assertEqual(policy.resources('aarch64', 2, 12 * 1024**2, 5 * 1024**2, 20 * 1024**3)['newOCIResources'], 0)
        for values in [('x86_64', 2, 12, 5, 20), ('aarch64', 4, 12, 5, 20),
            ('aarch64', 2, 24, 5, 20), ('aarch64', 2, 6, 5, 20), ('aarch64', 2, 12, 13, 20),
            ('aarch64', 2, 12, 3, 20), ('aarch64', 2, 12, 5, 14)]:
            machine, cpus, total, available, disk = values
            with self.assertRaises(RuntimeError): policy.resources(machine, cpus, total * 1024**2, available * 1024**2, disk * 1024**3)

    def test_complete_bundle_compiles_without_operator_files_or_network(self):
        with public_bootstrap(): source = controller.program({'public': 'fixture'})
        compile(source, '<public-p8-images>', 'exec')
        self.assertIn('p8_native_images_result=', source)
        self.assertNotIn("sys.modules['web_build_guest'].run(", source)

    def test_invalid_cli_never_reads_private_context_or_calls_vm(self):
        with patch.object(sys, 'argv', ['p8_images.py', '--production']), patch.object(
                controller.staging, 'context', side_effect=AssertionError('private state touched')), patch.object(
                controller.schema, 'run_guest', side_effect=AssertionError('VM touched')):
            with self.assertRaises(SystemExit): controller.main()

    def guest_module(self):
        modules = {name: types.ModuleType(name) for name in ('p6_mock_guest', 'web_services_guest', 'web_edge_guest', 'p6_restart_diagnosis_guest')}
        for name, key in [('p6_mock_guest', 'prepared'), ('web_services_guest', 'require_prepared'),
                ('web_edge_guest', 'private_env'), ('p6_restart_diagnosis_guest', 'containment')]:
            setattr(modules[name], key, None)
        result = types.ModuleType('p8_images_guest_fixture')
        path = controller.schema.REPO / 'infra/oracle/p8_images_guest.py'
        with patch.dict(sys.modules, modules): exec(compile(path.read_text(), str(path), 'exec'), result.__dict__)
        return result

    def test_failure_is_sealed_before_stop_and_original_stage_verified(self):
        guest, calls = self.guest_module(), []
        class Store:
            def __init__(self):
                self.names = []; self.root = types.SimpleNamespace(iterdir=lambda: [types.SimpleNamespace(name=name) for name in self.names])
            def stage(self, name): self.names.append(name); calls.append(('stage', name)); return Path(name)
            def put(self, stage, name, body): calls.append(('put', stage.name, name, json.loads(body)))
            def seal(self, stage, previous=None): calls.append(('seal', stage.name, previous)); return stage.name
            def verify(self, name, anchor): calls.append(('verify', name, anchor))
        steps = guest.Steps(Store())
        steps.step(1, 'preflight', lambda stage: {'status': 'PASS'})
        def failed(stage): raise RuntimeError('ControlledFixtureBuildFailure')
        with self.assertRaisesRegex(RuntimeError, 'NativeImageStepFailed_web-build'): steps.step(2, 'web-build', failed)
        self.assertEqual(steps.results['web-build']['result']['code'], 'ControlledFixtureBuildFailure')
        self.assertIn(('seal', '02-web-build', '01-preflight'), calls)
        self.assertLess(calls.index(('verify', '01-preflight', '01-preflight')), calls.index(('stage', '02-web-build')))

    def test_private_error_text_does_not_escape(self):
        guest = self.guest_module()
        class Store:
            root = types.SimpleNamespace(iterdir=lambda: [])
            def stage(self, name): return Path(name)
            def put(self, *unused): pass
            def seal(self, *unused, **options): return 'a' * 64
            def verify(self, *unused): pass
        steps = guest.Steps(Store())
        def failed(stage): raise ValueError('fixture-private-value-never-output')
        with self.assertRaises(RuntimeError): steps.step(1, 'preflight', failed)
        self.assertNotIn('private-value', json.dumps(steps.results))

    def test_unanchored_stage_fails_before_any_action_or_new_stage(self):
        guest = self.guest_module()
        store = types.SimpleNamespace(root=types.SimpleNamespace(iterdir=lambda: [Path('01-unknown')]))
        with self.assertRaisesRegex(RuntimeError, 'UnanchoredNativeImageStage_Abort'):
            guest.Steps(store).step(1, 'preflight', lambda stage: self.fail('unexpected execution'))

    def test_no_service_queue_schema_or_old_build_slot_activation(self):
        guest = self.guest_module()
        source = inspect.getsource(guest.run)
        for forbidden in ('docker\', \'start', 'docker\', \'restart', 'CREATE DATABASE', 'ALTER ROLE',
                          '.env.p5-builds', '.env.p6-build', 'setupWebMockQueue', 'runWebMockWorker('):
            self.assertNotIn(forbidden, source)
        self.assertIn("root = ROOT / '.env.p8-webmock-images01'", source)
        self.assertIn('P8ImageJournalAlreadyExists_NoReplay', source)
        self.assertIn("result['post'] = steps.step(4, 'post-containment', final)", source)
        self.assertIn('OriginalContainerIdentityOrRestartChanged_Abort', source)
        self.assertIn('public_build_env', source)
        self.assertIn('ExistingDockerDataRootRequired_NoReconfiguration', source)
        probe = inspect.getsource(guest.image_probe)
        self.assertIn("'--network', 'none'", probe)
        self.assertIn("'--entrypoint', 'node'", probe)

    def test_process_wait_observes_live_owned_child_and_preserves_deadline(self):
        guest = self.guest_module()
        source = inspect.getsource(guest.build_command)
        self.assertIn('while child.poll() is None:', source)
        self.assertIn('> 1200', source)
        self.assertIn('2 * 1024 * 1024', source)
        self.assertIn("'builder-pid.json'", source)
        self.assertIn('start_new_session=True', source)
        self.assertIn('os.killpg(child.pid', source)
