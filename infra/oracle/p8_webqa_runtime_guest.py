"""Concrete owned Docker runtime, SOURCE ONLY: no CLI/native launcher.

The caller must provide a NEW attested Fixture, sealed source-image anchors and
an exclusive private journal. Missing queue setup or fresh images refuses BEFORE
any Docker mutation. No network/role/queue setup, secret generation, image pull,
original-stack activation or phase PASS is implemented here.
"""
import copy
import hashlib
import ipaddress
import json
import os
from pathlib import Path
import re
import stat
import subprocess
from urllib.parse import urlsplit

from immutable_artifacts import Store, digest
import p7_auth_profile
import p8_webqa_config as config
import p8_webqa_edge as edge
import p8_webqa_realtime as realtime

ROOT = Path('/opt/ir35')
DOCKER = ('/usr/bin/docker', '--host', 'unix:///var/run/docker.sock')
ENVIRONMENT = {'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'LANG': 'C.UTF-8', 'LC_ALL': 'C.UTF-8',
               'DOCKER_CONFIG': '/nonexistent/ir35-no-registry-config'}
ORDER = ('templates', 'smtp', 'rest', 'auth', 'storage', 'realtime', 'kong', 'web', 'caddy', 'worker')
MIB, HEADROOM = 1024 ** 2, 2 * 1024 ** 3
LIVE_PROVIDER = re.compile(r'^(STRIPE_|RESEND_|POSTMARK_|EMAIL_PROVIDER_|TSENTA_|APPLICATION_SUBMISSION_PROVIDER_|SMTP_|OPENAI_|OPENROUTER_|AWS_|GOOGLE_|GITHUB_CLIENT_SECRET$|GH_TOKEN$|GITHUB_TOKEN$)')
SUPPORTED = {'image', 'platform', 'container_name', 'labels', 'restart', 'user', 'read_only', 'mem_limit',
             'pids_limit', 'cap_drop', 'security_opt', 'logging', 'networks', 'volumes', 'tmpfs',
             'entrypoint', 'command', 'init', 'ulimits', 'env_file', 'profiles'}


class RuntimeErrorSafe(RuntimeError):
    """Only fixed codes; never include native/env/config/HTTP values."""


def _json(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':')).encode()


def _read_fixed(path, uid, mode, expected=None, maximum=4 * 1024 * 1024):
    path = Path(path)
    if path.absolute() != path.resolve() or not path.is_relative_to(ROOT):
        raise RuntimeErrorSafe('OwnedQaFilePathRequired')
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        before = os.fstat(descriptor)
        if (not stat.S_ISREG(before.st_mode) or before.st_uid != uid or stat.S_IMODE(before.st_mode) != mode
                or before.st_nlink != 1 or not 0 < before.st_size <= maximum):
            raise RuntimeErrorSafe('OwnedQaFileCustodyRequired')
        body = bytearray()
        while len(body) <= maximum:
            part = os.read(descriptor, min(65536, maximum - len(body) + 1))
            if not part: break
            body.extend(part)
        after, named = os.fstat(descriptor), path.lstat()
        if (len(body) != before.st_size or len(body) > maximum
                or (before.st_dev, before.st_ino, before.st_mtime_ns, before.st_ctime_ns)
                   != (after.st_dev, after.st_ino, after.st_mtime_ns, after.st_ctime_ns)
                or not stat.S_ISREG(named.st_mode) or (named.st_dev, named.st_ino) != (after.st_dev, after.st_ino)
                or named.st_nlink != 1 or expected is not None and digest(body) != expected):
            raise RuntimeErrorSafe('OwnedQaFileChangedOrHashMismatch')
        return bytes(body)
    finally:
        os.close(descriptor)


def public_subjects(body):
    """Actual writer is p7_auth_profile.subject_env. Docker kvfile uses raw
    values: no shell interpolation/unquoting; whitespace/$/#/quotes survive.
    https://github.com/docker/cli/blob/v27.5.1/pkg/kvfile/kvfile.go
    No name-only entries (host-environment fallback) or credential keys allowed.
    """
    allowed = {'GOTRUE_MAILER_SUBJECTS_' + item.upper() for item in p7_auth_profile.exporter.TEMPLATES}
    try:
        text = body.decode('utf8')
        if not text.endswith('\n') or any(item in text for item in ('\r', '\0', '\ufeff')):
            raise ValueError()
        result = {}
        for line in text[:-1].split('\n'):
            key, separator, value = line.partition('=')
            if not separator or key not in allowed or key in result or len(line.encode()) >= 65536:
                raise ValueError()
            result[key] = value
        if p7_auth_profile.subject_env(result).encode() != body:
            raise ValueError()
        return result
    except Exception:
        raise RuntimeErrorSafe('ExactRawPublicSubjectsRequired_NoHostEnvFallback') from None


def _memory(limit_reservation=0):
    body = Path('/proc/meminfo').read_text()
    values = {name: int(re.search(r'^' + name + r':\s+([0-9]+)', body, re.M)[1]) * 1024
              for name in ('MemTotal', 'MemAvailable')}
    if (os.uname().machine != 'aarch64' or os.cpu_count() != 2
            or not 11 * 1024 ** 3 <= values['MemTotal'] <= 12 * 1024 ** 3
            or values['MemAvailable'] > values['MemTotal']
            or values['MemAvailable'] < HEADROOM + limit_reservation):
        raise RuntimeErrorSafe('OwnedQaMemoryHeadroomRequired_NoLimitIncrease')
    return {'availableBytes': values['MemAvailable'], 'reservedBytes': limit_reservation, 'minimumHeadroomBytes': HEADROOM}


def _container_memory(row, limit):
    pid = row['State'].get('Pid')
    if type(pid) is not int or pid <= 0:
        raise RuntimeErrorSafe('OwnedRunningContainerPidRequired')
    lines = (Path('/proc') / str(pid) / 'cgroup').read_text().splitlines()
    selected = [line[3:] for line in lines if line.startswith('0::')]
    if (len(selected) != 1 or not selected[0].startswith('/') or '..' in selected[0].split('/')
            or row['Id'] not in selected[0]):
        raise RuntimeErrorSafe('ExactOwnedCgroupV2Required')
    root = Path('/sys/fs/cgroup') / selected[0].lstrip('/')
    current, peak, maximum = (int((root / item).read_text()) for item in ('memory.current', 'memory.peak', 'memory.max'))
    events = dict(line.split() for line in (root / 'memory.events').read_text().splitlines())
    if (maximum != limit or current > limit or peak > limit or current < 0 or peak < 0
            or events.get('oom') != '0' or events.get('oom_kill') != '0' or row['State'].get('OOMKilled') is not False):
        raise RuntimeErrorSafe('OwnedQaCgroupBudgetOrOomMismatch')
    return {'limitBytes': limit, 'chargedBytes': current, 'kernelPeakBytes': peak, 'oom': 0, 'oomKill': 0}


def _mounts(service):
    result = {}
    for item in service['volumes']:
        pieces = item.split(':')
        if len(pieces) not in (2, 3) or len(pieces) == 3 and pieces[2] != 'ro':
            raise RuntimeErrorSafe('ExactReviewedQaBindMountRequired')
        source, target = pieces[:2]
        if not source.startswith('/opt/ir35/') or not target.startswith('/') or ',' in item or target in result:
            raise RuntimeErrorSafe('ExactReviewedQaBindMountRequired')
        result[target] = (source, len(pieces) == 2)
    return result


def create_arguments(name, service, source_sha, slot):
    """Fixed Docker create derived from the complete exact reviewed plan.
    Compose's implicit generic service aliases are deliberately NOT installed
    on the original shared bridge. Only unique names/Realtime alias are used.
    Unsupported keys never disappear silently; inline env is never permitted.
    """
    limits = config.LIMITS | {'realtime': 256, 'caddy': 128}
    if (name not in ORDER or set(service) - SUPPORTED or service.get('platform') != 'linux/arm64'
            or service.get('restart') != 'no' or service.get('user') != '1002:1002'
            or service.get('read_only') is not True or service.get('cap_drop') != ['ALL']
            or service.get('security_opt') != ['no-new-privileges:true'] or service.get('logging') != {'driver': 'none'}
            or service.get('profiles', []) != (['mock-worker'] if name == 'worker' else [])
            or service.get('mem_limit') != str(limits.get(name)) + 'm'
            or service.get('pids_limit') != (32 if name == 'templates' else 256 if name == 'worker' else 128)):
        raise RuntimeErrorSafe('UnsupportedOrUnsafeQaServiceRefused')
    expected_name = config.TEMPLATE_HOST if name == 'templates' else config.PROJECT + '-' + name
    if service.get('container_name') != expected_name:
        raise RuntimeErrorSafe('FixedOwnedQaContainerNameRequired')
    labels = service['labels'] | {'ir35.qa-run': slot, 'ir35.image-source': source_sha}
    if labels.get('ir35.qa') != config.PROJECT:
        raise RuntimeErrorSafe('ExactOwnedQaLabelsRequired')
    aliases = [expected_name]
    if name == 'realtime':
        if service['networks'] != {'backend': {'aliases': [realtime.ALIAS]}}:
            raise RuntimeErrorSafe('ExactUniqueRealtimeAliasRequired')
        aliases.append(realtime.ALIAS)
    elif service['networks'] != ['backend']:
        raise RuntimeErrorSafe('OnlyReviewedPrivateQaNetworkAllowed')
    args = ['create', '--pull', 'never', '--platform', 'linux/arm64', '--name', expected_name,
            '--network', config.NETWORK, '--restart', 'no', '--user', '1002:1002', '--read-only',
            '--memory', service['mem_limit'], '--pids-limit', str(service['pids_limit']), '--cap-drop', 'ALL',
            '--security-opt', 'no-new-privileges:true', '--log-driver', 'none']
    for alias in aliases: args += ['--network-alias', alias]
    for key, value in sorted(labels.items()): args += ['--label', key + '=' + value]
    for target, (origin, writable) in _mounts(service).items():
        args += ['--mount', 'type=bind,src=' + origin + ',dst=' + target + ('' if writable else ',readonly')]
    for item in service.get('tmpfs', []): args += ['--tmpfs', item]
    if service.get('init') is True: args += ['--init']
    elif 'init' in service: raise RuntimeErrorSafe('UnsupportedQaInitSetting')
    if 'ulimits' in service:
        if service['ulimits'] != {'nofile': {'soft': 4096, 'hard': 4096}}:
            raise RuntimeErrorSafe('UnsupportedQaUlimitSetting')
        args += ['--ulimit', 'nofile=4096:4096']
    if 'env_file' in service:
        path = config.environment_path('subjects')
        if name != 'auth' or service['env_file'] != [{'path': path, 'required': True, 'format': 'raw'}]:
            raise RuntimeErrorSafe('OnlyRawPublicSubjectsMayEnterDockerEnv')
        args += ['--env-file', path]
    entry, command = service.get('entrypoint'), service.get('command')
    if (type(entry) is not list or not entry or type(command) is not list
            or any(type(item) is not str or '\0' in item for item in entry + command)):
        raise RuntimeErrorSafe('ExactReviewedQaEntrypointRequired')
    return args + ['--entrypoint', entry[0], service['image'], *entry[1:], *command]


class OwnedRuntime:
    def __init__(self, fixture, configuration, authority):
        # No I/O or native action at construction/import.
        self.fixture, self.configuration, self.authority = fixture, configuration, authority
        self.stage = None; self.number = 0; self.plan = None; self.baseline = None
        self.owned = {}; self.image_ids = {}; self.image_defaults = {}
        self.prepared_files = {}
        self.used = False; self.stop_result = None
        self._foreign_cleanup_result = None

    def _record(self, name, value):
        self.fixture.store.put(self.stage, name, _json(value))

    def _docker(self, args, mutation=None):
        if mutation:
            self.number += 1
            prefix = f'runtime-{self.number:03d}-{mutation}'
            self._record(prefix + '-intent.json', {'operation': mutation, 'sourceSHA': self.source_sha,
                'slot': self.slot, 'retryAllowed': False, 'newNetworks': 0, 'publishedPorts': 0})
        try:
            reply = subprocess.run([*DOCKER, *args], capture_output=True, timeout=180, check=False, env=ENVIRONMENT)
        except BaseException:
            if mutation: self._record(prefix + '-result.json', {'status': 'FAIL', 'code': 'DockerOutcomeUnknown_RawWithheld'})
            raise RuntimeErrorSafe('DockerOutcomeUnknown_ReconcileOwnedOnly_NoRetry') from None
        if mutation:
            self._record(prefix + '-result.json', {'status': 'PASS' if reply.returncode == 0 else 'FAIL',
                'exitCode': reply.returncode, 'stdoutBytes': len(reply.stdout), 'stderrBytes': len(reply.stderr),
                'stderrSHA256Prefix': digest(reply.stderr)[:16], 'rawOutputWithheld': True})
        if reply.returncode or len(reply.stdout) > 8_000_000 or len(reply.stderr) > 1_000_000:
            raise RuntimeErrorSafe('DockerCommandFailed_RawWithheld_NoRetry')
        return reply.stdout

    def _json_docker(self, args):
        try: return json.loads(self._docker(args))
        except RuntimeErrorSafe: raise
        except Exception: raise RuntimeErrorSafe('DockerJsonReadbackInvalid_RawWithheld') from None

    def _containers(self):
        ids = self._docker(['container', 'ls', '--all', '--quiet', '--no-trunc']).decode().splitlines()
        if len(set(ids)) != len(ids) or any(not re.fullmatch('[a-f0-9]{64}', item) for item in ids):
            raise RuntimeErrorSafe('ExactContainerInventoryRequired')
        rows = self._json_docker(['inspect', *ids]) if ids else []
        if type(rows) is not list or {row.get('Id') for row in rows} != set(ids):
            raise RuntimeErrorSafe('FullContainerReadbackRequired')
        return {row['Id']: row for row in rows}

    @staticmethod
    def _original(rows):
        return {identifier: {'image': row['Image'], 'name': row['Name'], 'restartCount': row['RestartCount'],
            'state': {key: row['State'][key] for key in ('Status', 'Running', 'Paused', 'ExitCode', 'StartedAt')},
            'configSHA256': digest(_json(row['Config'])), 'hostConfigSHA256': digest(_json(row['HostConfig'])),
            'networkSHA256': digest(_json(row['NetworkSettings']))} for identifier, row in rows.items()}

    def _original_unchanged(self, rows):
        others = {key: value for key, value in rows.items() if key not in self.owned}
        if self._original(others) != self.baseline:
            raise RuntimeErrorSafe('OriginalContainerOrNetworkChanged_HardStop')

    def _network(self):
        rows = self._json_docker(['network', 'inspect', config.NETWORK])
        if (type(rows) is not list or len(rows) != 1 or rows[0].get('Name') != config.NETWORK
                or rows[0].get('Driver') != 'bridge' or rows[0].get('Internal') is not True
                or rows[0].get('EnableIPv6') is not False):
            raise RuntimeErrorSafe('ExistingInternalIpv4BridgeRequired_NoNetworkChange')
        row = rows[0]; entries = row.get('IPAM', {}).get('Config', [])
        if len(entries) != 1: raise RuntimeErrorSafe('ExactPrivateBridgeIpamRequired')
        network = ipaddress.IPv4Network(entries[0]['Subnet']); gateway = ipaddress.IPv4Address(entries[0]['Gateway'])
        if not any(network.subnet_of(ipaddress.IPv4Network(value)) for value in ('10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16')) or gateway not in network:
            raise RuntimeErrorSafe('ExactPrivateBridgeIpamRequired')
        return row, network, gateway

    def _verify_images(self):
        data = self.fixture.data; anchors = self.authority.get('nativeImageAnchors')
        if (type(anchors) is not dict or set(anchors) != {'web', 'worker', 'post'}
                or any(not re.fullmatch('[a-f0-9]{64}', value or '') for value in anchors.values())):
            raise RuntimeErrorSafe('FreshSealedNativeImagesMissing_NoCreate')
        images = config.image_pair(data['webQaImages'], expected_source_sha=self.source_sha)
        root = ROOT / ('.env.p8-webmock-images-' + self.source_sha[:12])
        store = Store(root, uid=1002)
        for part, name in (('web', '02-web-build'), ('worker', '03-worker-build'), ('post', '04-post-containment')):
            store.verify(name, anchors[part])
            observed = json.loads(_read_fixed(root / name / 'result.json', 1002, 0o400))
            if observed != data['webQaImages'][part]:
                raise RuntimeErrorSafe('ExactSealedNativeImageResultRequired')
        if images != self.fixture.images:
            raise RuntimeErrorSafe('FixtureImagesMustMatchFreshSourceProof')

    def _env_policy(self, files):
        values = {}
        for name in ('auth', 'rest', 'storage', 'web', 'worker', 'realtime'):
            body = files[config.environment_path(name) if name != 'realtime' else realtime.ENV_PATH]
            result = {}
            for line in body.decode().splitlines():
                match = re.fullmatch(r"([A-Z][A-Z0-9_]*)='([^'\r\n]*)'", line)
                if not match or match[1] in result: raise RuntimeErrorSafe('ExactPrivateEnvEncodingRequired')
                result[match[1]] = match[2]
            values[name] = result
        for name in ('web', 'worker'):
            row = values[name]
            required = {'APPLY_RUNNER': 'mock', 'IR35_STAGING': 'true', 'APPLICATION_WORKER_ACCEPT_JOBS': 'false',
                'APPLICATION_WORKER_CONCURRENCY': '1', 'IR35_READ_ONLY': 'false', 'IR35_SCHEDULER_ENABLED': 'false',
                'IR35_MOCK_WEB_ENABLED': 'true', 'IR35_MOCK_WEB_JOB_IDS': ','.join(config.JOBS), 'IR35_BUILD_SHA': self.source_sha}
            if any(row.get(key) != value for key, value in required.items()) or any(value and LIVE_PROVIDER.search(key) for key, value in row.items()):
                raise RuntimeErrorSafe('ProviderFreeMockAcceptanceFalseRequired')
        web = values['web']; auth = values['auth']; storage = values['storage']
        if (web.get('IR35_STAGING_HEALTH_FIXTURE') != 'webqa01' or web.get('IR35_STAGING_KONG_HOST') != config.container_name('kong')
                or web.get('NEXT_PUBLIC_SUPABASE_URL') != 'https://staging.ir35careers.com/supabase'
                or auth.get('GOTRUE_SMTP_HOST') != config.container_name('smtp') or auth.get('GOTRUE_SMTP_PORT') != '1025'
                or auth.get('GOTRUE_SMTP_USER') or auth.get('GOTRUE_SMTP_PASS')
                or any(value and key.startswith('GOTRUE_EXTERNAL_') and key.endswith('_SECRET') for key, value in auth.items())
                or any(value == 'true' and key.startswith('GOTRUE_EXTERNAL_') and key.endswith('_ENABLED')
                       and key != 'GOTRUE_EXTERNAL_EMAIL_ENABLED' for key, value in auth.items())
                or storage.get('DB_ALLOW_MIGRATION_REFRESH') != 'false' or storage.get('DB_INSTALL_ROLES') != 'false'):
            raise RuntimeErrorSafe('OwnedHealthAuthSinkAndFrozenStorageRequired')
        for name, key, role in (('auth', 'GOTRUE_DB_DATABASE_URL', 'supabase_auth_admin'),
                                ('rest', 'PGRST_DB_URI', 'authenticator'), ('storage', 'DATABASE_URL', 'supabase_storage_admin')):
            value = urlsplit(values[name][key])
            if value.hostname != 'db' or value.port != 5432 or value.username != role or value.path != '/' + self.fixture.target:
                raise RuntimeErrorSafe('AllAppServicesMustUseOwnedClone')
        for name, role in (('web', 'ir35_queue_producer'), ('worker', 'ir35_queue')):
            config.queue_uri(values[name]['PG_BOSS_DATABASE_URL'], role)
        if values['realtime'].get('DB_NAME') != self.fixture.target or values['realtime'].get('DB_HOST') != 'db':
            raise RuntimeErrorSafe('RealtimeMustUseOwnedClone')
        self.subjects = public_subjects(files[config.environment_path('subjects')])

    def _certificates(self):
        base = ROOT / 'data/caddy'
        for suffix in ('.crt', '.key'):
            path = base / (edge.CERTIFICATE.removeprefix('/data/') + suffix)
            if path.absolute() != path.resolve(): raise RuntimeErrorSafe('ExistingReadonlyCertificateCustodyRequired')
            for parent in (path, *path.parents):
                info = parent.lstat()
                if info.st_uid != 1002 or stat.S_IMODE(info.st_mode) != (0o600 if parent == path else 0o700):
                    raise RuntimeErrorSafe('ExistingReadonlyCertificateCustodyRequired')
                if parent == base: break
        # Metadata only: no private-key bytes/hash/copy/log.

    def _mount_custody(self):
        for suffix in ('', '/storage', '/next-cache'):
            path = ROOT / ('data/p8-webqa01' + suffix)
            if path.absolute() != path.resolve(): raise RuntimeErrorSafe('OwnedQaDataDirectoryCustodyRequired')
            info = path.lstat()
            if not stat.S_ISDIR(info.st_mode) or info.st_uid != 1002 or stat.S_IMODE(info.st_mode) != 0o700:
                raise RuntimeErrorSafe('OwnedQaDataDirectoryCustodyRequired')
        for name, service in self.plan['services'].items():
            for target, (origin, writable) in _mounts(service).items():
                if writable:
                    if (name != 'web' or origin != str(ROOT / 'data/p8-webqa01/next-cache') or target != '/app/.next/cache'):
                        raise RuntimeErrorSafe('OnlyOwnedQaCacheMayBeWritable')
                elif origin not in self.prepared_files and origin not in (str(ROOT / 'data/caddy'), str(ROOT / 'data/p8-webqa01/storage')):
                    raise RuntimeErrorSafe('EveryReadonlyBindSourceMustBeAttested')
        self._certificates()

    def _recheck_prepared(self):
        # Docker resolves bind/env-file paths later: repeat through owned file
        # descriptors immediately BEFORE each create/start, never print bytes.
        for path, (uid, mode, expected) in self.prepared_files.items():
            _read_fixed(Path(path), uid, mode, expected)
        self._mount_custody()

    def _queue_and_jobs(self):
        query = """SELECT jsonb_build_object(
 'queueCount',(SELECT count(*) FROM pgboss.queue WHERE name='ir35-staging-web-mock-apply'),
 'ledgerRows',(SELECT count(*) FROM pgboss.ir35_mock_web_delivery),
 'pendingJobs',(SELECT count(*) FROM pgboss.job WHERE name='ir35-staging-web-mock-apply'),
 'ledgerOwner',(SELECT tableowner FROM pg_tables WHERE schemaname='pgboss' AND tablename='ir35_mock_web_delivery'),
 'unsafeRoles',(SELECT count(*) FROM pg_roles WHERE rolname IN('ir35_queue','ir35_queue_producer')
   AND (rolsuper OR rolcreaterole OR rolcreatedb OR rolreplication OR rolbypassrls)));"""
        observed = json.loads(self.fixture.recovery.query(query, 'postgres'))
        if observed != {'queueCount': 1, 'ledgerRows': 0, 'pendingJobs': 0, 'ledgerOwner': 'ir35_queue', 'unsafeRoles': 0}:
            raise RuntimeErrorSafe('ActualOwnedEmptyQueueSetupRequired_NoCreate')
        rows = json.loads(self.fixture.recovery.query('SELECT coalesce(jsonb_agg(jsonb_build_object(\'id\',id::text,\'url\',apply_url) ORDER BY id),\'[]\') '
            + 'FROM public.jobs WHERE id IN (' + ','.join("'" + value + "'::uuid" for value in config.JOBS) + ');'))
        if rows != [{'id': identifier, 'url': 'https://mock-ats.invalid/' + config.SCENARIOS[index]} for index, identifier in enumerate(config.JOBS)]:
            raise RuntimeErrorSafe('SixExactCanonicalMockJobsRequired_NoCreate')

    def preflight(self):
        try: return self._preflight()
        except RuntimeErrorSafe: raise
        except Exception: raise RuntimeErrorSafe('QaRuntimePreflightFailed_RawWithheld_NoCreate') from None

    def _preflight(self):
        self.source_sha = config.source_sha(self.authority.get('sourceSHA'))
        self.slot = self.authority.get('slot', '')
        if (not re.fullmatch('writable-qa-[0-9]{8}t[0-9]{6}z-[a-f0-9]{8}', self.slot)
                or self.source_sha == config.BUILD_SHA or self.fixture.source_sha != self.source_sha
                or self.fixture.data.get('qaSourceSHA') != self.source_sha or not self.fixture.database_intent
                or not self.fixture.upgrade_verified or not self.fixture.before
                or self.fixture.recovery.database != self.fixture.target
                or self.configuration.get('status') != 'PASS' or self.configuration.get('realtimeConfigured') is not True
                or self.configuration.get('publicPorts') != 0 or self.configuration.get('servicesStarted') != 0):
            raise RuntimeErrorSafe('NewOwnedPreparedSourceFixtureRequired_NoCreate')
        self._verify_images()  # Known missing today; ZERO Docker mutations before this passes.
        network, self.subnet, gateway = self._network(); self.network_id = network['Id']
        plan = config.compose(self.fixture.images, self.fixture.data['p4']['pins'], expected_source_sha=self.source_sha)
        plan = realtime.add_to_compose(plan, self.fixture.data['p4']['pins']['realtime'])
        plan = edge.add_to_compose(plan, self.fixture.data['p4']['pins']['caddy'])
        if set(plan['services']) != set(ORDER): raise RuntimeErrorSafe('AllTenOwnedQaServicesRequired')
        body = _read_fixed(ROOT / 'p8-webqa01-compose.json', 0, 0o644, self.configuration['composeSHA256'])
        if json.loads(body) != plan: raise RuntimeErrorSafe('ExactCompiledFixturePlanRequired_NoCreate')
        self.plan = plan; self.image_ids = {}
        self.prepared_files = {str(ROOT / 'p8-webqa01-compose.json'): (0, 0o644, digest(body))}
        expected_files = {origin for row in plan['services'].values() for origin, unused in _mounts(row).values()
                          if origin.startswith('/opt/ir35/.env.p8-webqa01-')}
        expected_files.add(config.environment_path('subjects'))
        proof = self.configuration['environmentFiles']
        if len(proof) != len(expected_files) or {str(ROOT / item['name']) for item in proof} != expected_files:
            raise RuntimeErrorSafe('ExactPreparedEnvironmentInventoryRequired')
        files = {str(ROOT / item['name']): _read_fixed(ROOT / item['name'], 1002, 0o600, item['sha256']) for item in proof}
        self.prepared_files.update({str(ROOT / item['name']): (1002, 0o600, item['sha256']) for item in proof})
        self._env_policy(files)
        if files[str(ROOT / '.env.p8-webqa01-caddyfile')] != edge.caddyfile(str(gateway)).encode():
            raise RuntimeErrorSafe('ExactPrivateEdgeConfigRequired')
        launcher = _read_fixed(ROOT / 'bin/env-exec', 0, 0o755, maximum=1024 * 1024)
        self.prepared_files[str(ROOT / 'bin/env-exec')] = (0, 0o755, digest(launcher))
        self._mount_custody()
        for name in ORDER:
            row = plan['services'][name]
            create_arguments(name, row, self.source_sha, self.slot)
            images = self._json_docker(['image', 'inspect', row['image']])
            if (len(images) != 1 or images[0].get('Architecture') != 'arm64' or images[0].get('Os') != 'linux'
                    or not re.fullmatch('sha256:[a-f0-9]{64}', images[0].get('Id', ''))
                    or set(images[0].get('Config', {}).get('Volumes') or {}) - set(_mounts(row))):
                raise RuntimeErrorSafe('LocalPinnedArmImageAndNoImplicitVolumeRequired')
            self.image_ids[name] = images[0]['Id']
            self.image_defaults[name] = images[0].get('Config', {})
        self._queue_and_jobs()
        current = self._containers()
        names = {row['Name'].lstrip('/') for row in current.values()}
        if any(row['container_name'] in names for row in plan['services'].values()):
            raise RuntimeErrorSafe('QaNameAlreadyExists_ReconcileNeverAdopt')
        new_aliases = {row['container_name'] for row in plan['services'].values()} | {realtime.ALIAS}
        if any(new_aliases & set(row['NetworkSettings'].get('Networks', {}).get(config.NETWORK, {}).get('Aliases') or [])
               for row in current.values()):
            raise RuntimeErrorSafe('UniqueQaDnsNameAlreadyUsed_NoCreate')
        self.baseline = self._original(current)
        self._memory_before = _memory(sum(int(row['mem_limit'][:-1]) * MIB for row in plan['services'].values()))
        return {'status': 'PREFLIGHT_PASS_NOT_ACTIVATED', 'sourceSHA': self.source_sha, 'services': 10,
                'newNetworks': 0, 'publishedPorts': 0, 'phaseComplete': False}

    def _identity(self, identifier, row, name):
        service = self.plan['services'][name]; labels = row.get('Config', {}).get('Labels', {})
        if (identifier in self.baseline or row.get('Id') != identifier or row.get('Name') != '/' + service['container_name']
                or row.get('Image') != self.image_ids[name] or labels.get('ir35.qa') != config.PROJECT
                or labels.get('ir35.qa-run') != self.slot or labels.get('ir35.image-source') != self.source_sha):
            raise RuntimeErrorSafe('ExactRunOwnedContainerRequired_NoForeignCleanup')

    def _isolation(self, row, name, running):
        service = self.plan['services'][name]; host = row['HostConfig']; container = row['Config']
        defaults = self.image_defaults[name]
        labels = (defaults.get('Labels') or {}) | service['labels'] | {'ir35.qa-run': self.slot, 'ir35.image-source': self.source_sha}
        env_rows = container.get('Env') or []
        expected_env = dict(item.split('=', 1) for item in defaults.get('Env') or [])
        if name == 'auth': expected_env.update(self.subjects)
        if (len({item.split('=', 1)[0] for item in env_rows}) != len(env_rows)
                or dict(item.split('=', 1) for item in env_rows) != expected_env or container.get('Labels') != labels
                or container.get('WorkingDir', '') != defaults.get('WorkingDir', '')
                or container.get('Healthcheck') != defaults.get('Healthcheck')
                or container.get('StopSignal', '') != defaults.get('StopSignal', '')
                or container.get('OpenStdin') is not False or container.get('Tty') is not False):
            raise RuntimeErrorSafe('ExactImageEnvAndOwnedConfigRequired_NoInlineSecrets')
        if (container.get('User') != '1002:1002' or host.get('ReadonlyRootfs') is not True or host.get('Privileged') is not False
                or host.get('PortBindings') or host.get('PublishAllPorts') or host.get('CapAdd')
                or host.get('CapDrop') != ['ALL'] or host.get('SecurityOpt') != ['no-new-privileges:true']
                or host.get('RestartPolicy', {}).get('Name') != 'no' or host.get('LogConfig', {}).get('Type') != 'none'
                or host.get('Memory') != int(service['mem_limit'][:-1]) * MIB or host.get('PidsLimit') != service['pids_limit']
                or host.get('NetworkMode') != config.NETWORK or host.get('Devices') or host.get('DeviceRequests')
                or host.get('PidMode') or host.get('UTSMode') or host.get('IpcMode') not in ('private', '')
                or container.get('Entrypoint') != service['entrypoint'][:1]
                or container.get('Cmd') != service['entrypoint'][1:] + service['command']):
            raise RuntimeErrorSafe('OwnedQaRuntimeIsolationMismatch_HardStop')
        expected_tmpfs = dict(item.split(':', 1) for item in service.get('tmpfs', []))
        if (host.get('Tmpfs') or {}) != expected_tmpfs:
            raise RuntimeErrorSafe('OwnedQaTmpfsMismatch')
        actual = {item['Destination']: (item['Source'], item['RW']) for item in row.get('Mounts', []) if item.get('Type') == 'bind'}
        if actual != _mounts(service) or any(item.get('Type') not in ('bind', 'tmpfs')
            or item.get('Type') == 'tmpfs' and item.get('Destination') not in expected_tmpfs for item in row.get('Mounts', [])):
            raise RuntimeErrorSafe('OwnedQaMountMismatch_HardStop')
        networks = row['NetworkSettings'].get('Networks', {})
        if set(networks) != {config.NETWORK} or any(row['NetworkSettings'].get('Ports', {}).values()):
            raise RuntimeErrorSafe('OwnedQaNetworkOrPublishedPortMismatch')
        network = networks[config.NETWORK]
        allowed_aliases = {service['container_name'], row['Id'], row['Id'][:12]}
        required_aliases = {service['container_name']}
        if name == 'realtime':
            allowed_aliases.add(realtime.ALIAS); required_aliases.add(realtime.ALIAS)
        actual_aliases = set(network.get('Aliases') or [])
        if actual_aliases - allowed_aliases or not required_aliases <= actual_aliases:
            raise RuntimeErrorSafe('GenericOrForeignQaDnsAliasRefused')
        if running:
            if (row['State'].get('Running') is not True or row['State'].get('Paused') is not False
                    or network.get('NetworkID') != self.network_id or ipaddress.IPv4Address(network['IPAddress']) not in self.subnet):
                raise RuntimeErrorSafe('OwnedQaRunningPrivateEndpointRequired')
            _container_memory(row, host['Memory'])
        if name == 'auth':
            observed = dict(value.split('=', 1) for value in container.get('Env', []) if value.startswith('GOTRUE_MAILER_SUBJECTS_'))
            if observed != self.subjects: raise RuntimeErrorSafe('LiteralPublicSubjectsChanged_HardStop')

    def _reconcile(self):
        rows = self._containers()
        names = {row['container_name']: name for name, row in self.plan['services'].items()}
        for identifier, row in rows.items():
            name = names.get(row['Name'].lstrip('/'))
            if name is not None:
                self._identity(identifier, row, name)
                self.owned[identifier] = name
        return rows

    def _cleanup_known_after_foreign(self, stage):
        """Private start-failure path, never a successful reconciliation.

        A foreign name/ID cannot prevent cleanup of OTHER independently proven
        run-owned IDs. No foreign object is adopted, stopped or removed, and an
        observed collision always remains a terminal hard stop. Public stop()
        retains its existing stricter all-targets-proven contract.
        """
        if self._foreign_cleanup_result is not None:
            return copy.deepcopy(self._foreign_cleanup_result)
        self.stage = stage
        self._record('runtime-foreign-cleanup-intent.json', {'operation': 'cleanup-proven-owned-only',
            'retryAllowed': False, 'foreignCleanupAllowed': False, 'phaseComplete': False})
        rows = self._containers()
        names = {row['container_name']: name for name, row in self.plan['services'].items()}
        proven = {}
        # Independently inspect every candidate instead of aborting at the first
        # collision. The original exact ID/name/image/run/source proof is reused.
        for identifier, row in rows.items():
            name = names.get(row['Name'].lstrip('/'))
            if name is None: continue
            try: self._identity(identifier, row, name)
            except RuntimeErrorSafe:
                continue  # Foreign is retained and appears in the final report.
            proven[identifier] = name
        self.owned.update(proven)
        issues, removed = [], []
        for identifier, name in proven.items():
            current = self._containers()
            row = current.get(identifier)
            if row is None:
                issues.append('KnownOwnedTargetDisappeared'); continue
            try: self._identity(identifier, row, name)
            except RuntimeErrorSafe:
                issues.append('KnownOwnedTargetChanged'); continue
            if row['State'].get('Running'):
                try: self._docker(['stop', '--time', '30', identifier], mutation='stop-proven-owned')
                except BaseException:
                    issues.append('KnownOwnedStopUnconfirmed'); continue  # No retry of this target.
            current = self._containers()
            row = current.get(identifier)
            if row is None:
                issues.append('KnownOwnedTargetDisappeared'); continue
            try: self._identity(identifier, row, name)
            except RuntimeErrorSafe:
                issues.append('KnownOwnedTargetChanged'); continue
            if row['State'].get('Running') is not False:
                issues.append('KnownOwnedTargetStillRunning'); continue
            try: self._docker(['rm', identifier], mutation='remove-proven-owned')
            except BaseException:
                issues.append('KnownOwnedRemovalUnconfirmed'); continue
            removed.append(identifier)
        final = self._containers()
        foreign = sorted(set(final) - set(self.baseline) - set(self.owned))
        remaining = sorted(set(final) & set(self.owned))
        baseline_rows = {key: row for key, row in final.items() if key in self.baseline}
        baseline_unchanged = self._original(baseline_rows) == self.baseline
        result = {'status': 'HARD_STOP', 'code': 'CLEANUP_FOREIGN_REMAINS' if foreign else 'CLEANUP_FOREIGN_OBSERVED',
            'provenOwnedRemoved': len(removed), 'knownOwnedIdsRemaining': len(remaining),
            'foreignIdsRemaining': len(foreign), 'foreignIdSHA256': [digest(value.encode()) for value in foreign],
            'knownBaselineContainersUnchanged': baseline_unchanged, 'fullInventoryUnchanged': False,
            'foreignObjectsChanged': 0, 'issues': issues, 'phaseComplete': False}
        self._record('runtime-foreign-cleanup-result.json', result)
        self._foreign_cleanup_result = result
        return copy.deepcopy(result)

    def start(self, stage):
        if self.used: raise RuntimeErrorSafe('OwnedQaRuntimeAttemptUsed_NoReplay')
        self.preflight()
        self.used = True; self.stage = stage
        try:
            for name in ORDER:
                row = self.plan['services'][name]
                self._recheck_prepared()
                self._docker(create_arguments(name, row, self.source_sha, self.slot), mutation='create-' + name)
                current = self._reconcile()
                matches = [item for identifier, item in current.items() if self.owned.get(identifier) == name]
                if len(matches) != 1: raise RuntimeErrorSafe('CreatedContainerReadbackRequired_NoReplay')
                self._isolation(matches[0], name, False)
                self._original_unchanged(current)
            for name in ORDER:
                _memory()
                self._recheck_prepared()
                identifier = next(key for key, value in self.owned.items() if value == name)
                self._docker(['start', identifier], mutation='start-' + name)
                current = self._reconcile(); self._identity(identifier, current[identifier], name)
                self._isolation(current[identifier], name, True); self._original_unchanged(current)
            _memory()
            self._record('runtime-started.json', {'status': 'PROCESSES_STARTED_NOT_QA_SIGNOFF', 'services': 10,
                'sourceSHA': self.source_sha, 'originalContainersUnchanged': True, 'applyRunner': 'mock',
                'acceptJobs': False, 'smtpSink': True, 'sdkGateProven': False, 'realtimeCdcProven': False,
                'browserJourneysProven': False, 'phaseComplete': False})
            return {'status': 'PROCESSES_STARTED_NOT_QA_SIGNOFF', 'services': 10, 'phaseComplete': False}
        except BaseException:
            try:
                self._reconcile()  # An ambiguous create is reconciled ONCE, never re-created.
                self.stop(stage)
            except RuntimeErrorSafe as error:
                if str(error) == 'ExactRunOwnedContainerRequired_NoForeignCleanup':
                    try: self._cleanup_known_after_foreign(stage)
                    except BaseException:
                        raise RuntimeErrorSafe('OwnedQaStartFailed_ForeignCleanupUnconfirmed_HardStop') from None
                    raise RuntimeErrorSafe('OwnedQaStartFailed_CLEANUP_FOREIGN_REMAINS_HardStop') from None
                raise RuntimeErrorSafe('OwnedQaStartFailed_CleanupUnconfirmed_HardStop') from None
            except BaseException:
                raise RuntimeErrorSafe('OwnedQaStartFailed_CleanupUnconfirmed_HardStop') from None
            raise RuntimeErrorSafe('OwnedQaStartFailed_OwnedRuntimeRemoved_HardStop') from None

    def stop(self, stage):
        if self.stop_result is not None: return copy.deepcopy(self.stop_result)
        if not self.used: return {'status': 'NOT_STARTED', 'ownedContainersAbsent': True, 'phaseComplete': False}
        self.stage = stage
        rows = self._reconcile()
        # No stop/rm until EVERY target's immutable ID/name/run/source/image is
        # proven. Never compose down/prune/rm -f/-v or remove networks/volumes.
        for identifier, name in self.owned.items():
            if identifier not in rows: raise RuntimeErrorSafe('OwnedContainerMissing_ReconcileRequired')
            self._identity(identifier, rows[identifier], name)
        running = [identifier for identifier in self.owned if rows[identifier]['State'].get('Running')]
        if running: self._docker(['stop', '--time', '30', *running], mutation='stop-owned')
        rows = self._containers()
        for identifier, name in self.owned.items():
            self._identity(identifier, rows[identifier], name)
            if rows[identifier]['State'].get('Running') is not False:
                raise RuntimeErrorSafe('StoppedOwnedContainerRequired_NoForcedRemoval')
        if self.owned: self._docker(['rm', *self.owned], mutation='remove-owned')
        current = self._containers()
        if set(current) & set(self.owned): raise RuntimeErrorSafe('OwnedRemovalReadbackFailed')
        self._original_unchanged(current)
        self.stop_result = {'status': 'OWNED_CONTAINERS_REMOVED_NOT_PHASE_SIGNOFF', 'ownedContainersAbsent': True,
            'originalContainersUnchanged': True, 'removedContainers': len(self.owned), 'networksRemoved': 0,
            'volumesRemoved': 0, 'databaseOrQueueCleanupClaimed': False, 'phaseComplete': False}
        self._record('runtime-stopped.json', self.stop_result)
        return copy.deepcopy(self.stop_result)


if __name__ == '__main__':
    raise SystemExit('Library only: new attested fixture/image/queue/journal controller required; no native launcher.')
