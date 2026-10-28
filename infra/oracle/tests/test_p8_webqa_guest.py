import hashlib
import inspect
import json
from pathlib import Path
import stat
import sys
import tempfile
import types
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import p8_webqa_guest as guest
import p8_webqa_bundle as bundle
import p8_webqa_config as config
from offline_bundle_fixture import public_bootstrap

PRISTINE = 'ir35_p4_20261021t170139z_8be0fc2e'


class Store:
    def __init__(self): self.records = []
    def put(self, stage, name, body): self.records.append((name, json.loads(body)))


class QaPreparationTests(unittest.TestCase):
    def test_full_dependency_graph_compiles_with_no_private_state_or_network(self):
        with public_bootstrap(): source = bundle.bundle()
        compile(source, '<qa-public-fixture-compile>', 'exec')
        for name in ('p4_auth_probe', 'p4_mail_probe', 'p7_auth_profile', 'p8_upgrade_guest', 'p8_webqa_config', 'p8_webqa_guest'):
            self.assertIn("sys.modules['" + name + "']", source)
        self.assertLess(source.index("sys.modules['p4_auth_probe']"), source.index("sys.modules['p4_mail_probe']"))
        self.assertLess(source.index("sys.modules['p8_webqa_config']"), source.index("sys.modules['p8_webqa_guest']"))
        for name in ('run_guest(', 'Fixture(', 'create_clone(', 'write_configuration('):
            self.assertNotIn(name, inspect.getsource(bundle.bundle))

    def make_fixture(self):
        fixture = guest.Fixture.__new__(guest.Fixture)
        fixture.pristine = PRISTINE; fixture.target = config.database_name(PRISTINE)
        fixture.annotation = 'ir35-p8-webqa01:' + config.BUILD_SHA + ':' + guest.MIGRATION_SHA256
        fixture.store = Store(); fixture.files = []; fixture.storage_records = []; fixture.database_intent = False
        return fixture

    def test_private_files_are_exclusive_600_and_never_overwrite_even_same_bytes(self):
        fixture = self.make_fixture()
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            with patch.object(guest, 'ROOT', root), patch.object(config, 'environment_path', side_effect=lambda name: str(root / ('.env.qa-' + name))), \
                    patch.object(guest.os, 'fchown') as ownership:
                destination = fixture.private_file('web', b'PRIVATE_FIXTURE_ONLY')
                self.assertEqual(stat.S_IMODE(destination.stat().st_mode), 0o600)
                ownership.assert_called_once()
                self.assertEqual(ownership.call_args.args[1:], (1002, 1002))
                with self.assertRaises(FileExistsError): fixture.private_file('web', b'REPLACEMENT')
                self.assertEqual(destination.read_bytes(), b'PRIVATE_FIXTURE_ONLY')
                self.assertEqual(fixture.files[0]['sha256'], hashlib.sha256(b'PRIVATE_FIXTURE_ONLY').hexdigest())
                self.assertNotIn('PRIVATE_FIXTURE_ONLY', json.dumps(fixture.files))

    def test_private_files_reject_escape_and_oversize_before_create(self):
        fixture = self.make_fixture()
        with patch.object(config, 'environment_path', return_value='/other/.env.qa-web'):
            with self.assertRaises(guest.RecoveryError): fixture.private_file('web', b'fixture')
        with self.assertRaises(guest.RecoveryError): fixture.private_file('web', b'x' * (4 * 1024 * 1024 + 1))

    def test_ambiguous_clone_create_is_journalled_and_not_retried(self):
        fixture = self.make_fixture(); calls = []
        def command(args, **kwargs):
            calls.append(args)
            self.assertTrue(fixture.database_intent)
            self.assertEqual(fixture.store.records[0][0], 'clone-intent.json')
            raise guest.RecoveryError('AmbiguousFixtureCreate')
        fixture.recovery = types.SimpleNamespace(database=PRISTINE, verifiers={'literal': lambda value: "'" + value + "'"},
            query=lambda *unused: '0', check_database=lambda: {'status': 'PASS'}, base=['fixture-psql'], command=command)
        with self.assertRaisesRegex(guest.RecoveryError, 'AmbiguousFixtureCreate'): fixture.create_clone(Path('01-clone'))
        self.assertEqual(len(calls), 1)
        self.assertEqual(fixture.recovery.database, PRISTINE)

    def test_missing_baseline_or_wrong_migration_cannot_run_sql(self):
        fixture = self.make_fixture(); fixture.before = {}
        fixture.recovery = types.SimpleNamespace(database=fixture.target)
        with patch.object(guest.subprocess, 'run', side_effect=AssertionError('Native SQL touched')):
            with self.assertRaisesRegex(guest.RecoveryError, 'ExactReviewed025'): fixture.apply_reviewed_upgrade(Path('01-upgrade'), 'SELECT 1;')
            source = Path(guest.__file__).resolve().parents[2] / 'supabase/migrations/025_application_delivery_lifecycle.sql'
            migration = source.read_text()
            with self.assertRaisesRegex(guest.RecoveryError, 'VerifiedOwnedQaClone'): fixture.apply_reviewed_upgrade(Path('01-upgrade'), migration)

    def test_no_runtime_configuration_before_owned_upgrade_and_all_storage_copies(self):
        fixture = self.make_fixture(); fixture.before = {}; fixture.upgrade_verified = False
        fixture.recovery = types.SimpleNamespace(database=PRISTINE)
        with patch.object(Path, 'lstat', side_effect=AssertionError('Private state touched prematurely')):
            with self.assertRaisesRegex(guest.RecoveryError, 'OwnedVerifiedUpgradedAndCopied'):
                fixture.write_configuration(Path('04-configuration'))

    def test_drop_refuses_connected_unowned_or_original_database_before_any_command(self):
        for bad in ('connected', 'annotation', 'original-target'):
            fixture = self.make_fixture(); commands = []
            if bad == 'original-target': fixture.target = PRISTINE
            def query(sql, *unused):
                if 'pg_stat_activity' in sql: return '1' if bad == 'connected' else '0'
                if 'shobj_description' in sql: return 'unowned' if bad == 'annotation' else fixture.annotation
                return '1'
            fixture.recovery = types.SimpleNamespace(database=fixture.target, verifiers={'literal': lambda value: "'" + value + "'"},
                query=query, base=['fixture-psql'], command=lambda *a, **k: commands.append((a, k)))
            with self.assertRaises(config.ConfigError): fixture.destroy_disconnected_database(Path('99-cleanup'))
            self.assertEqual(commands, [])

    def test_drop_is_exact_owned_target_and_read_back_absent_no_termination(self):
        fixture = self.make_fixture(); commands = []; counts = iter(('1', '0'))
        def query(sql, *unused):
            if 'pg_stat_activity' in sql: return '0'
            if 'shobj_description' in sql: return fixture.annotation
            return next(counts)
        fixture.recovery = types.SimpleNamespace(database=fixture.target, verifiers={'literal': lambda value: "'" + value + "'"},
            query=query, base=['fixture-psql'], command=lambda *a, **k: commands.append((a, k)))
        result = fixture.destroy_disconnected_database(Path('99-cleanup'))
        self.assertTrue(result['databaseAbsent']); self.assertTrue(result['dropExecuted'])
        self.assertEqual(len(commands), 1)
        self.assertEqual(commands[0][1]['input'], ('DROP DATABASE ' + fixture.target + ';').encode())
        self.assertNotIn('pg_terminate_backend', inspect.getsource(guest.Fixture.destroy_disconnected_database))

    def test_no_startup_queue_setup_roles_provider_or_secret_generation_in_preparation(self):
        source = inspect.getsource(guest)
        for forbidden in ('CREATE ROLE', 'ALTER ROLE', 'openssl', 'token_urlsafe', 'run_guest(',
                          "'docker', 'start'", "'docker', 'restart'", 'setupWebMockQueue(', 'print('):
            self.assertNotIn(forbidden, source)
        self.assertIn("os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW", source)
        self.assertIn('clone_denials(recovery, self.target)', source)
        self.assertIn("security['policies'] != self.before['security']['policies']", source)
        self.assertIn('upgrade_review.privilege_delta', source)

    def test_all_synthetic_storage_files_copy_exact_headers_and_refuse_replay(self):
        fixture = self.make_fixture(); run = 'fixture-snapshot'; objects = []
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary); (root / 'data/p4-runs' / run).mkdir(parents=True)
            for index in range(73):
                name = 'fixture-' + str(index); body = ('fixture-bytes-' + str(index)).encode()
                path = root / 'data/p4-runs' / run / name; path.write_bytes(body)
                guest.os.setxattr(path, 'user.supabase.content-type', b'application/octet-stream')
                objects.append({'bucket': 'fixture-bucket', 'name': name, 'version': 'fixture-version',
                    'bytes': str(len(body)), 'sha256': hashlib.sha256(body).hexdigest()})
            fixture.source = {'storage': {'privateObjects': objects}}
            fixture.recovery = types.SimpleNamespace(run_id=run, check_storage_files=lambda value: None)
            fixture.runtime = {'verifiers': {'backend_path': lambda bucket, name, version: Path(name)}}
            with patch.object(guest, 'ROOT', root), patch.object(guest.os, 'chown'), patch.object(guest.os, 'fchown'):
                result = fixture.copy_storage(Path('03-storage'))
                self.assertEqual(result['objects'], 73); self.assertTrue(result['sha256AndHeadersExact'])
                with self.assertRaisesRegex(guest.RecoveryError, 'NoOverwrite'): fixture.copy_storage(Path('03-storage'))
            destination = root / 'data/p8-webqa01/storage'
            self.assertEqual(len(list(destination.iterdir())), 73)
            for obj in objects:
                path = destination / obj['name']
                self.assertEqual(hashlib.sha256(path.read_bytes()).hexdigest(), obj['sha256'])
                self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o400)
                self.assertEqual(guest.os.getxattr(path, 'user.supabase.content-type'), b'application/octet-stream')
            serialized = json.dumps(fixture.store.records)
            self.assertNotIn('fixture-0', serialized)
