"""Concrete Docker adapter tests with fake process/file/SQL only; no VM/keys."""
import copy
import importlib.util
import json
import os
from pathlib import Path
import socket
import stat
import subprocess
import sys
import tempfile
import types
import unittest
from contextlib import ExitStack
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import p8_webqa_runtime_guest as guest
import p8_webqa_config as config
import p8_webqa_edge as edge
import p8_webqa_realtime as realtime
import p7_auth_profile as profile
import p8_webqa_bundle as bundle
import test_p8_webqa_config as fixture_source
from immutable_artifacts import digest
from offline_bundle_fixture import public_bootstrap

SOURCE = 'd' * 40
SLOT = 'writable-qa-20261125t150000z-0123abcd'
PRISTINE = fixture_source.PRISTINE
ORIGINAL = '0' * 64
SENTINEL = 'FIXTURE_NOT_A_REAL_CREDENTIAL'


class Store:
    def __init__(self): self.records = {}
    def put(self, stage, name, body):
        if name in self.records: raise AssertionError('Evidence overwrite')
        self.records[name] = json.loads(body)


def frame():
    proof = fixture_source.native_proof(); proof['sourceSHA'] = SOURCE
    for kind in ('web', 'worker'): proof[kind]['sourceSHA'] = SOURCE
    images = config.image_pair(proof, expected_source_sha=SOURCE)
    pins = fixture_source.pins()
    pins['realtime'] = {'platform': 'linux/arm64', 'image': realtime.PIN,
        'entrypoint': ['/usr/bin/tini', '-s', '-g', '--', '/app/run.sh'], 'command': ['/app/bin/server']}
    pins['caddy'] = {'platform': 'linux/arm64', 'image': 'caddy:2.10.2@sha256:' + 'e' * 64}
    plan = config.compose(images, pins, expected_source_sha=SOURCE)
    plan = edge.add_to_compose(realtime.add_to_compose(plan, pins['realtime']), pins['caddy'])
    args = fixture_source.inputs(); args[7] = images
    env = config.environments(*args, expected_source_sha=SOURCE)
    env['web'].update(IR35_WORKER_HEALTH_ENABLED='true', IR35_REALTIME_HEALTH_ENABLED='true')
    env['realtime'] = {'DB_NAME': config.database_name(PRISTINE), 'DB_HOST': 'db'}
    env['caddy'] = {'STAGING_BASIC_HASH': SENTINEL, 'STAGING_GATE_TOKEN': 'f' * 64}
    files = {}
    for name, values in env.items():
        path = realtime.ENV_PATH if name == 'realtime' else str(guest.ROOT / '.env.p8-webqa01-caddy') if name == 'caddy' else config.environment_path(name)
        files[path] = ''.join(key + "='" + value + "'\n" for key, value in sorted(values.items())).encode()
    subjects = {'GOTRUE_MAILER_SUBJECTS_CONFIRMATION': "  You're invited: $literal ${NAME} # exact = value  "}
    files[config.environment_path('subjects')] = profile.subject_env(subjects).encode()
    files[config.environment_path('templates-json')] = b'{"confirmation":"public fixture template"}'
    files[config.environment_path('kong-config')] = b'{"services":[]}'
    files[str(guest.ROOT / '.env.p8-webqa01-caddyfile')] = edge.caddyfile('172.30.0.1').encode()
    configuration = {'status': 'PASS', 'realtimeConfigured': True, 'publicPorts': 0, 'servicesStarted': 0,
        'composeSHA256': digest(guest._json(plan)), 'environmentFiles': [
            {'name': Path(path).name, 'sha256': digest(body), 'mode': '600', 'owner': 'ir35'} for path, body in files.items()]}
    files[str(guest.ROOT / 'p8-webqa01-compose.json')] = guest._json(plan)
    files[str(guest.ROOT / 'bin/env-exec')] = b'public fixture launcher, not executable'
    data = {'qaSourceSHA': SOURCE, 'webQaImages': proof, 'p4': {'pins': pins}}
    def query(sql, database=None):
        if database == 'postgres':
            return json.dumps({'queueCount': 1, 'ledgerRows': 0, 'pendingJobs': 0, 'ledgerOwner': 'ir35_queue', 'unsafeRoles': 0})
        return json.dumps([{'id': identifier, 'url': 'https://mock-ats.invalid/' + config.SCENARIOS[index]}
            for index, identifier in enumerate(config.JOBS)])
    fixture = types.SimpleNamespace(data=data, source_sha=SOURCE, images=images, database_intent=True,
        upgrade_verified=True, before={'baseline': 'fixture-only'}, store=Store(),
        recovery=types.SimpleNamespace(database=config.database_name(PRISTINE), query=query),
        pristine=PRISTINE, target=config.database_name(PRISTINE))
    authority = {'sourceSHA': SOURCE, 'slot': SLOT, 'nativeImageAnchors': {'web': 'a' * 64, 'worker': 'b' * 64, 'post': 'c' * 64}}
    return fixture, configuration, authority, plan, files, subjects


class FakeDocker:
    def __init__(self, plan, subjects):
        self.plan, self.subjects = plan, subjects
        self.calls, self.mutations = [], []
        self.rows = {ORIGINAL: {'Id': ORIGINAL, 'Name': '/original-db', 'Image': 'sha256:' + '0' * 64,
            'RestartCount': 0, 'Config': {'Labels': {}, 'Env': ['FIXTURE=not-a-real-value']}, 'HostConfig': {},
            'State': {'Status': 'running', 'Running': True, 'Paused': False, 'ExitCode': 0, 'StartedAt': 'original'},
            'NetworkSettings': {'Networks': {config.NETWORK: {'Aliases': ['db', 'auth', 'rest', 'storage', 'web', 'kong', 'smtp']}}}}}
        self.original = copy.deepcopy(self.rows[ORIGINAL])
        refs = sorted({row['image'] for row in plan['services'].values()})
        self.images = {value: {'Id': 'sha256:' + f'{index + 100:064x}', 'Os': 'linux', 'Architecture': 'arm64',
            'Config': {'Env': ['PATH=/fixture/bin'], 'Labels': {}, 'WorkingDir': '/app', 'Volumes': {}}} for index, value in enumerate(refs)}
        self.network = {'Name': config.NETWORK, 'Id': 'f' * 64, 'Driver': 'bridge', 'Internal': True, 'EnableIPv6': False,
                        'IPAM': {'Config': [{'Subnet': '172.30.0.0/24', 'Gateway': '172.30.0.1'}]}}
        self.create_fault = None

    def __call__(self, arguments, **kwargs):
        if tuple(arguments[:len(guest.DOCKER)]) != guest.DOCKER: raise AssertionError('Wrong engine')
        args = arguments[len(guest.DOCKER):]; self.calls.append(args)
        self.assert_safe(kwargs)
        if args[:2] == ['container', 'ls']: body = '\n'.join(self.rows).encode()
        elif args[0] == 'inspect': body = guest._json([self.rows[value] for value in args[1:]])
        elif args[:2] == ['image', 'inspect']: body = guest._json([self.images[args[2]]])
        elif args[:2] == ['network', 'inspect']: body = guest._json([self.network])
        elif args[0] == 'create':
            self.mutations.append(args)
            name = args[args.index('--name') + 1]
            service = next(key for key, row in self.plan['services'].items() if row['container_name'] == name)
            identifier = f'{len(self.rows) + 1:064x}'
            image_index = args.index('--entrypoint') + 2
            labels = dict(args[index + 1].split('=', 1) for index, value in enumerate(args) if value == '--label')
            aliases = [args[index + 1] for index, value in enumerate(args) if value == '--network-alias']
            mounts = []
            for index, value in enumerate(args):
                if value == '--mount':
                    parts = dict(item.split('=', 1) for item in args[index + 1].split(',') if '=' in item)
                    mounts.append({'Type': parts['type'], 'Source': parts['src'], 'Destination': parts['dst'],
                                   'RW': 'readonly' not in args[index + 1].split(',')})
            env = {'PATH': '/fixture/bin'} | (self.subjects if service == 'auth' else {})
            self.rows[identifier] = {'Id': identifier, 'Name': '/' + name, 'Image': self.images[args[image_index]]['Id'],
                'RestartCount': 0, 'Mounts': mounts,
                'Config': {'User': args[args.index('--user') + 1], 'Labels': labels, 'Env': [key + '=' + value for key, value in env.items()],
                    'Entrypoint': [args[args.index('--entrypoint') + 1]], 'Cmd': args[image_index + 1:],
                    'WorkingDir': '/app', 'OpenStdin': False, 'Tty': False},
                'HostConfig': {'ReadonlyRootfs': '--read-only' in args, 'Privileged': False, 'PortBindings': {},
                    'PublishAllPorts': False, 'CapAdd': [], 'CapDrop': ['ALL'], 'SecurityOpt': ['no-new-privileges:true'],
                    'RestartPolicy': {'Name': 'no'}, 'LogConfig': {'Type': 'none'},
                    'Memory': int(args[args.index('--memory') + 1][:-1]) * guest.MIB,
                    'PidsLimit': int(args[args.index('--pids-limit') + 1]), 'NetworkMode': config.NETWORK,
                    'IpcMode': 'private', 'Tmpfs': dict(args[index + 1].split(':', 1) for index, value in enumerate(args) if value == '--tmpfs')},
                'State': {'Status': 'created', 'Running': False, 'Paused': False, 'ExitCode': 0, 'StartedAt': '', 'Pid': 0, 'OOMKilled': False},
                'NetworkSettings': {'Ports': {}, 'Networks': {config.NETWORK: {'Aliases': aliases,
                    'NetworkID': self.network['Id'], 'IPAddress': '172.30.0.' + str(len(self.rows) + 5)}}}}
            if self.create_fault: self.create_fault(self.rows[identifier], service)
            body = identifier.encode()
        elif args[0] == 'start':
            self.mutations.append(args)
            self.rows[args[1]]['State'].update(Status='running', Running=True, StartedAt='owned-start', Pid=100)
            body = args[1].encode()
        elif args[0] == 'stop':
            self.mutations.append(args)
            for identifier in args[3:]: self.rows[identifier]['State'].update(Status='exited', Running=False, Pid=0)
            body = b''
        elif args[0] == 'rm':
            self.mutations.append(args)
            for identifier in args[1:]: del self.rows[identifier]
            body = b''
        else: raise AssertionError('Unknown command')
        return subprocess.CompletedProcess(arguments, 0, body, b'')

    @staticmethod
    def assert_safe(kwargs):
        if kwargs.get('env') != guest.ENVIRONMENT or kwargs.get('timeout') != 180 or not kwargs.get('capture_output'):
            raise AssertionError('Unsafe subprocess policy')


class RuntimeTests(unittest.TestCase):
    def setUp(self):
        self.fixture, self.configuration, self.authority, self.plan, self.files, self.subjects = frame()
        self.runtime = guest.OwnedRuntime(self.fixture, self.configuration, self.authority)
        self.docker = FakeDocker(self.plan, self.subjects)

    def fake_reads(self, path, uid, mode, expected=None, **unused):
        body = self.files[str(path)]
        if expected is not None and digest(body) != expected: raise guest.RuntimeErrorSafe('OwnedQaFileChangedOrHashMismatch')
        return body

    def io(self):
        stack = ExitStack()
        stack.enter_context(patch.object(self.runtime, '_verify_images'))
        stack.enter_context(patch.object(self.runtime, '_certificates'))
        stack.enter_context(patch.object(guest, '_read_fixed', side_effect=self.fake_reads))
        stack.enter_context(patch.object(Path, 'lstat', return_value=types.SimpleNamespace(st_mode=stat.S_IFDIR | 0o700, st_uid=1002)))
        stack.enter_context(patch.object(guest.subprocess, 'run', side_effect=self.docker))
        stack.enter_context(patch.object(guest, '_memory', return_value={'availableBytes': 10 * 1024 ** 3}))
        stack.enter_context(patch.object(guest, '_container_memory', return_value={'oom': 0}))
        return stack

    def test_complete_direct_create_start_and_owned_cleanup_do_not_touch_originals(self):
        with self.io():
            result = self.runtime.start(Path('owned-stage'))
            self.assertEqual(result, {'status': 'PROCESSES_STARTED_NOT_QA_SIGNOFF', 'services': 10, 'phaseComplete': False})
            self.assertEqual(len(self.runtime.owned), 10)
            self.assertEqual(self.docker.rows[ORIGINAL], self.docker.original)
            stopped = self.runtime.stop(Path('owned-stage'))
            count = len(self.docker.mutations)
            self.assertEqual(self.runtime.stop(Path('owned-stage')), stopped)
            self.assertEqual(len(self.docker.mutations), count)
        self.assertEqual(stopped['removedContainers'], 10)
        self.assertFalse(stopped['databaseOrQueueCleanupClaimed'])
        self.assertEqual(self.docker.rows, {ORIGINAL: self.docker.original})
        self.assertNotIn(SENTINEL, json.dumps(self.fixture.store.records))
        self.assertEqual(sum(row[0] == 'create' for row in self.docker.mutations), 10)
        self.assertEqual(sum(row[0] == 'start' for row in self.docker.mutations), 10)
        self.assertTrue(all('compose' not in row and '--force' not in row and '--volumes' not in row and '-f' not in row for row in self.docker.mutations))

    def test_exact_plan_to_argv_has_unique_aliases_no_generic_alias_or_inline_secrets(self):
        for name, service in self.plan['services'].items():
            args = guest.create_arguments(name, service, SOURCE, SLOT)
            aliases = [args[index + 1] for index, value in enumerate(args) if value == '--network-alias']
            self.assertEqual(aliases, [service['container_name']] + ([realtime.ALIAS] if name == 'realtime' else []))
            self.assertNotIn(name, aliases); self.assertEqual(args[:3], ['create', '--pull', 'never'])
            index = args.index('--entrypoint')
            docker_options = args[:index + 2]  # Child Node -e is NOT Docker's -e/--env.
            self.assertNotIn('--publish', docker_options); self.assertNotIn('--env', docker_options); self.assertNotIn('-e', docker_options)
            self.assertNotIn(SENTINEL, str(args))
            self.assertEqual(args[index + 1:], [service['entrypoint'][0], service['image'], *service['entrypoint'][1:], *service['command']])
        self.assertIn('--env-file', guest.create_arguments('auth', self.plan['services']['auth'], SOURCE, SLOT))

    def test_unsupported_keys_inline_env_published_ports_and_limit_increases_are_refused(self):
        service = self.plan['services']['web']
        for change in ({'environment': {'SECRET': SENTINEL}}, {'ports': ['80:3000']}, {'privileged': True},
                       {'mem_limit': '9999m'}, {'pids_limit': 10000}, {'restart': 'always'}):
            with self.subTest(change=change), self.assertRaises(guest.RuntimeErrorSafe):
                guest.create_arguments('web', service | change, SOURCE, SLOT)

    def test_raw_public_subjects_match_actual_writer_and_docker_kvfile_semantics(self):
        values = {'GOTRUE_MAILER_SUBJECTS_CONFIRMATION': " You're invited: 'quotes' \"double\" $NAME ${NAME} # = ",
                  'GOTRUE_MAILER_SUBJECTS_RECOVERY': ''}
        body = profile.subject_env(values).encode()
        self.assertEqual(guest.public_subjects(body), values)
        # Official Docker kvfile parse preserves literal values after the first '='.
        self.assertEqual(dict(line.split('=', 1) for line in body.decode().splitlines()), values)
        for bad in (b'JWT_SECRET=fixture\n', b'GOTRUE_MAILER_SUBJECTS_RECOVERY\n', b'GOTRUE_MAILER_SUBJECTS_RECOVERY=one\nGOTRUE_MAILER_SUBJECTS_RECOVERY=two\n', b'\xff\n'):
            with self.assertRaises(guest.RuntimeErrorSafe): guest.public_subjects(bad)

    def test_missing_fresh_image_anchors_refuses_before_any_process_or_journal_mutation(self):
        self.authority.pop('nativeImageAnchors')
        with patch.object(guest.subprocess, 'run', side_effect=AssertionError('Process touched')), \
                patch.object(guest, '_read_fixed', side_effect=AssertionError('Private file touched')):
            with self.assertRaisesRegex(guest.RuntimeErrorSafe, 'FreshSealedNativeImagesMissing'): self.runtime.start(Path('unused'))
        self.assertEqual(self.fixture.store.records, {})

    def test_historical_source_is_refused_before_read_or_process(self):
        self.authority['sourceSHA'] = config.BUILD_SHA
        with patch.object(guest.subprocess, 'run', side_effect=AssertionError('Process touched')):
            with self.assertRaisesRegex(guest.RuntimeErrorSafe, 'NewOwnedPreparedSourceFixture'): self.runtime.preflight()

    def test_private_network_or_alias_collision_fails_before_create(self):
        self.docker.network['Internal'] = False
        with self.io(), self.assertRaises(guest.RuntimeErrorSafe): self.runtime.preflight()
        self.assertFalse(self.docker.mutations)
        self.docker.network['Internal'] = True
        self.docker.rows[ORIGINAL]['NetworkSettings']['Networks'][config.NETWORK]['Aliases'].append(realtime.ALIAS)
        with self.io(), self.assertRaisesRegex(guest.RuntimeErrorSafe, 'DnsNameAlreadyUsed'): self.runtime.preflight()
        self.assertFalse(self.docker.mutations)

    def test_actual_queue_setup_and_canonical_jobs_are_required_not_status_booleans(self):
        self.fixture.recovery.query = lambda *unused: json.dumps({'queueCount': 0})
        with self.io(), self.assertRaisesRegex(guest.RuntimeErrorSafe, 'ActualOwnedEmptyQueueSetupRequired'): self.runtime.preflight()
        self.assertFalse(self.docker.mutations)

    def test_tampered_prepared_file_after_preflight_blocks_first_create_and_never_logs_bytes(self):
        original = self.runtime.preflight
        def changed():
            result = original()
            self.files[config.environment_path('worker')] += b'PRIVATE_SENTINEL\n'
            return result
        with self.io(), patch.object(self.runtime, 'preflight', side_effect=changed), \
                self.assertRaisesRegex(guest.RuntimeErrorSafe, 'HardStop'):
            self.runtime.start(Path('owned-stage'))
        self.assertFalse(any(row[0] == 'create' for row in self.docker.mutations))
        self.assertNotIn('PRIVATE_SENTINEL', json.dumps(self.fixture.store.records))

    def test_ambiguous_create_is_reconciled_and_removed_once_never_recreated(self):
        def unknown(row, unused): raise subprocess.TimeoutExpired('docker', 180, stderr=b'PRIVATE_SENTINEL')
        self.docker.create_fault = unknown
        with self.io(), self.assertRaisesRegex(guest.RuntimeErrorSafe, 'HardStop'):
            self.runtime.start(Path('owned-stage'))
        self.assertEqual(sum(row[0] == 'create' for row in self.docker.mutations), 1)
        self.assertEqual(self.docker.rows, {ORIGINAL: self.docker.original})
        self.assertNotIn('PRIVATE_SENTINEL', json.dumps(self.fixture.store.records))

    def test_unexpected_generic_or_missing_required_alias_rolls_back_before_any_start(self):
        def broken(row, unused): row['NetworkSettings']['Networks'][config.NETWORK]['Aliases'] = ['auth']
        self.docker.create_fault = broken
        with self.io(), self.assertRaisesRegex(guest.RuntimeErrorSafe, 'HardStop'):
            self.runtime.start(Path('owned-stage'))
        self.assertFalse(any(row[0] == 'start' for row in self.docker.mutations))
        self.assertEqual(self.docker.rows, {ORIGINAL: self.docker.original})

    def test_post_create_extra_env_or_public_port_fails_before_start(self):
        def broken(row, unused):
            row['Config']['Env'].append('SOME_CREDENTIAL=PRIVATE_SENTINEL')
            row['HostConfig']['PortBindings'] = {'8080/tcp': [{'HostIp': '0.0.0.0', 'HostPort': '8080'}]}
        self.docker.create_fault = broken
        with self.io(), self.assertRaisesRegex(guest.RuntimeErrorSafe, 'HardStop'):
            self.runtime.start(Path('owned-stage'))
        self.assertFalse(any(row[0] == 'start' for row in self.docker.mutations))
        self.assertNotIn('PRIVATE_SENTINEL', json.dumps(self.fixture.store.records))

    def test_foreign_replacement_is_never_stopped_or_removed(self):
        with self.io(): self.runtime.start(Path('owned-stage'))
        identifier = next(iter(self.runtime.owned)); row = self.docker.rows.pop(identifier)
        row['Id'] = '9' * 64; row['Config']['Labels']['ir35.qa-run'] = 'foreign'; self.docker.rows[row['Id']] = row
        before = len(self.docker.mutations)
        with self.io(), self.assertRaisesRegex(guest.RuntimeErrorSafe, 'NoForeignCleanup'):
            self.runtime.stop(Path('owned-stage'))
        self.assertEqual(len(self.docker.mutations), before)

    def test_readonly_env_and_cert_mounts_and_only_owned_cache_writable(self):
        with self.io(): self.runtime.preflight(); self.runtime._recheck_prepared()
        bad = copy.deepcopy(self.runtime.plan)
        bad['services']['web']['volumes'].append('/opt/ir35/data/caddy:/unsafe')
        self.runtime.plan = bad
        with self.io(), self.assertRaisesRegex(guest.RuntimeErrorSafe, 'OnlyOwnedQaCache'): self.runtime._mount_custody()

    def test_kernel_and_os_guards_are_not_limit_raising_placeholders(self):
        with patch.object(guest.Path, 'read_text', return_value='MemTotal: 12582912 kB\nMemAvailable: 1024 kB\n'), \
                patch.object(guest.os, 'uname', return_value=types.SimpleNamespace(machine='aarch64')), patch.object(guest.os, 'cpu_count', return_value=2):
            with self.assertRaisesRegex(guest.RuntimeErrorSafe, 'Headroom'): guest._memory()

    def test_private_file_reader_refuses_symlinks_and_modified_hashes(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary); file = root / 'fixture'; file.write_bytes(b'fixture'); file.chmod(0o600)
            with patch.object(guest, 'ROOT', root):
                self.assertEqual(guest._read_fixed(file, os.getuid(), 0o600, digest(b'fixture')), b'fixture')
                with self.assertRaises(guest.RuntimeErrorSafe): guest._read_fixed(file, os.getuid(), 0o600, '0' * 64)

    def test_bundle_includes_real_runtime_after_its_dependencies_without_executing_it(self):
        with public_bootstrap(): source = bundle.bundle()
        compile(source, '<source-only-qa-runtime-bundle>', 'exec')
        self.assertIn("sys.modules['p8_webqa_runtime_guest']", source)
        self.assertLess(source.index("sys.modules['p8_webqa_guest']"), source.index("sys.modules['p8_webqa_runtime_guest']"))


if __name__ == '__main__': unittest.main()
