"""Pure wiring for the NEW disposable writable QA stack; never a deployment CLI.

Private values are returned only to a VM-side custodian. No I/O, subprocess,
logging, credential creation, database or Docker action occurs on import/call.
The controller must attest the image/clone/network and seal configuration first.
"""
import copy
import re
from urllib.parse import unquote, urlsplit, urlunsplit

PROJECT = 'ir35-p8-webqa01'
NETWORK = 'ir35-staging_backend'
BUILD_SHA = '679dc8c234c525e9ebb246d2efbea857b6a5b660'
STORAGE_IMAGE = 'supabase/storage-api:v1.80.2@sha256:5e290c10a57893024dea5b41764e2fd81d02b379e5853bdd1da11e74bd58783e'
JOBS = tuple('00000000-0000-4000-8000-00000000a00' + str(i) for i in range(1, 7))
SCENARIOS = ('success', 'server_error', 'timeout', 'lost_ack', 'captcha', 'unknown_answer')
SERVICES = ('auth', 'rest', 'storage', 'kong', 'smtp', 'web', 'worker', 'templates')
TEMPLATE_HOST = 'ir35-p4-p8-webqa01-templates'  # Retain the existing template-host validator.
LIMITS = {'auth': 256, 'rest': 256, 'storage': 512, 'kong': 384,
          'smtp': 64, 'web': 1536, 'worker': 2560, 'templates': 96}
TEMPLATE_SERVER = """import fs from 'node:fs';import http from 'node:http';
const templates=JSON.parse(fs.readFileSync('/run/ir35/.env.p8-webqa01-templates','utf8'));
http.createServer((req,res)=>{const key=req.url.slice(1);res.setHeader('Cache-Control','no-store');res.setHeader('X-Robots-Tag','noindex');
if(req.method!=='GET'||!Object.hasOwn(templates,key)){res.writeHead(404);res.end();return;}
res.setHeader('Content-Type','text/html; charset=utf-8');res.end(templates[key]);}).listen(8080,'0.0.0.0');"""


class ConfigError(RuntimeError):
    """Fixed codes only; never embed a URL, password or configuration value."""


def require_compose(version):
    # raw env_file (2.30+) preserves exported subject quotes/$/# verbatim.
    match = re.fullmatch(r'v?([0-9]+)\.([0-9]+)\.([0-9]+)(?:[-+][A-Za-z0-9_.-]+)?', version.strip()) if type(version) is str else None
    if not match or tuple(int(item) for item in match.groups()[:2]) < (2, 30):
        raise ConfigError('ComposeRawEnvironmentSupportRequired_NoUpgrade')
    return '.'.join(match.groups())


def database_name(pristine):
    if type(pristine) is not str or not re.fullmatch(r'ir35_p4_[0-9]{8}t[0-9]{6}z_[a-f0-9]{8}', pristine):
        raise ConfigError('VerifiedPristineDatabaseIdentityRequired')
    target = pristine + '_p8_webqa01'
    if len(target.encode()) > 63:
        raise ConfigError('DisposableDatabaseIdentifierTooLong')
    return target


def assert_owned_database(pristine, target, comment, expected_comment, connections):
    if (target != database_name(pristine) or comment != expected_comment
            or type(expected_comment) is not str
            or not re.fullmatch('ir35-p8-webqa01:' + BUILD_SHA + ':[a-f0-9]{64}', expected_comment)
            or connections != '0'):
        raise ConfigError('ExactOwnedDisconnectedQaDatabaseRequired_NoDrop')


def container_name(service):
    if service not in SERVICES:
        raise ConfigError('ExplicitQaServiceRequired')
    return TEMPLATE_HOST if service == 'templates' else PROJECT + '-' + service


def environment_path(service):
    if service not in (*SERVICES, 'subjects', 'kong-config', 'templates-json'):
        raise ConfigError('ExplicitQaEnvironmentRequired')
    return '/opt/ir35/.env.p8-webqa01-' + service


def image_pair(proof):
    """Additional shape checks; NOT a substitute for verifying the sealed proof."""
    if (type(proof) is not dict or proof.get('status') != 'PASS' or proof.get('sourceSHA') != BUILD_SHA
            or proof.get('runtimeDeployed') is not False or type(proof.get('newOCIResources')) is not int
            or proof.get('newOCIResources') != 0 or type(proof.get('newSecrets')) is not int
            or proof.get('newSecrets') != 0 or proof.get('cutover') is not False
            or proof.get('post', {}).get('status') != 'PASS'
            or proof.get('post', {}).get('originalContainersUnchanged') is not True
            or proof.get('post', {}).get('fullContainment', {}).get('status') != 'PASS'):
        raise ConfigError('ExactNativeImageAndContainmentProofRequired')
    result = {'sourceSHA': BUILD_SHA}
    expected = {
        'web': {'next': '16.4.3', 'react': '19.2.9', 'react-dom': '19.2.9', 'sharp': '0.35.5'},
        'worker': {'exports': ['runWebMockWorker', 'setupWebMockQueue', 'webMockOwnerOptions'],
                   'versions': {'playwright-core': '1.61.0', 'pg-boss': '12.38.0'}, 'importOnly': True}}
    for kind in ('web', 'worker'):
        row = proof.get(kind, {})
        if (row.get('status') != 'PASS' or row.get('architecture') != 'linux/arm64'
                or row.get('sourceSHA') != BUILD_SHA or row.get('nonroot') is not True
                or row.get('runtimeDeployed') is not False or row.get('networkNoneProbe') is not True
                or row.get('probe') != expected[kind]
                or not re.fullmatch(r'sha256:[a-f0-9]{64}', row.get('image', ''))):
            raise ConfigError('NativeQaImageIdentityOrImportProofMismatch')
        result[kind] = row['image']
    return result


def private_database_uri(value, target, role):
    try:
        url = urlsplit(value)
        valid = (type(value) is str and len(value) <= 4096 and not any(c in value for c in '\r\n\0')
                 and url.scheme in ('postgres', 'postgresql') and url.hostname == 'db' and url.port == 5432
                 and unquote(url.username or '') == role and bool(url.password)
                 and url.path == '/postgres' and not url.query and not url.fragment)
    except (TypeError, ValueError):
        valid = False
    if not valid or type(target) is not str or not re.fullmatch(r'ir35_p4_[0-9]{8}t[0-9]{6}z_[a-f0-9]{8}_p8_webqa01', target):
        raise ConfigError('PrivateExactRoleAndDisposableDatabaseRequired')
    return urlunsplit((url.scheme, url.netloc, '/' + target, '', ''))


def queue_uri(value, role):
    # Never repoint a queue role to the QA database: pg_hba must deny that path.
    if role not in ('ir35_queue', 'ir35_queue_producer'):
        raise ConfigError('OnlyApprovedQueueIdentitiesPermitted')
    private_database_uri(value, database_name('ir35_p4_20261021t170139z_8be0fc2e'), role)
    return value


def environments(base, auth_profile, values, old_web, owner, producer, pristine, images, storage_migrations):
    """Use only existing Oracle-staging credentials; no random/secrets generation.

    auth_profile is the output of the unchanged, source-bound P7 mapper. The
    caller supplies the source migration list only after snapshot verification.
    """
    target = database_name(pristine)
    if set(images) != {'sourceSHA', 'web', 'worker'} or images['sourceSHA'] != BUILD_SHA:
        raise ConfigError('AttestedQaImagesRequired')
    if (not storage_migrations or type(storage_migrations[-1].get('name')) is not str
            or not storage_migrations[-1]['name'] or not re.fullmatch(r'[A-Za-z0-9_.-]+', storage_migrations[-1]['name'])):
        raise ConfigError('VerifiedStorageMigrationListRequired')
    if (old_web.get('IR35_READ_ONLY') != 'true' or old_web.get('APPLY_RUNNER') != 'mock'
            or old_web.get('APPLICATION_WORKER_ACCEPT_JOBS') != 'false'
            or not re.fullmatch('[a-f0-9]{64}', old_web.get('APPLICATION_WORKER_SECRET', ''))):
        raise ConfigError('OriginalReadonlyMockWebAndExistingControlRequired')
    result = {name: copy.deepcopy(base[name]) for name in ('rest', 'storage', 'kong')}
    result['auth'] = copy.deepcopy(auth_profile)
    for name, key, role in (('auth', 'GOTRUE_DB_DATABASE_URL', 'supabase_auth_admin'),
                            ('rest', 'PGRST_DB_URI', 'authenticator'),
                            ('storage', 'DATABASE_URL', 'supabase_storage_admin')):
        result[name][key] = private_database_uri(result[name][key], target, role)
    auth = result['auth']
    if (any(type(value) is not str for value in auth.values())
            or auth.get('GOTRUE_SMTP_HOST') != 'smtp' or auth.get('GOTRUE_SMTP_PORT') != '1025'
            or auth.get('GOTRUE_SMTP_USER') or auth.get('GOTRUE_SMTP_PASS')
            or auth.get('GOTRUE_SITE_URL') != 'https://staging.ir35careers.com'
            or auth.get('API_EXTERNAL_URL') != 'https://api-staging.ir35careers.com'
            or any(value == 'true' and key.startswith('GOTRUE_EXTERNAL_') and key.endswith('_ENABLED')
                   and key != 'GOTRUE_EXTERNAL_EMAIL_ENABLED' for key, value in auth.items())
            or any(value and key.endswith('_SECRET') and key.startswith('GOTRUE_EXTERNAL_') for key, value in auth.items())):
        raise ConfigError('SourceMappedAuthAndPrivateSinkOnlyRequired')
    auth.update(GOTRUE_SMTP_HOST=container_name('smtp'), GOTRUE_DB_MAX_POOL_SIZE='3', GOTRUE_LOG_LEVEL='error')
    result['rest']['PGRST_DB_POOL'] = '3'
    result['storage'].update(POSTGREST_URL='http://' + container_name('rest') + ':3000',
        NODE_OPTIONS='--max-old-space-size=384', DATABASE_MAX_CONNECTIONS='3',
        STORAGE_PUBLIC_URL='https://staging.ir35careers.com/supabase',
        DB_MIGRATIONS_FREEZE_AT=storage_migrations[-1]['name'], DB_ALLOW_MIGRATION_REFRESH='false',
        DB_INSTALL_ROLES='false', TUS_USE_FILE_VERSION_SEPARATOR='false', STORAGE_FILE_ETAG_ALGORITHM='md5',
        PG_QUEUE_ENABLE='false', PG_QUEUE_WORKERS_ENABLE='false', STORAGE_LIFECYCLE_ENABLED='false', TRACING_ENABLED='false')
    result['smtp'] = {'MP_DATABASE': '/tmp/mailpit.db', 'MP_MAX_MESSAGES': '20',
                      'MP_SMTP_BIND_ADDR': '0.0.0.0:1025', 'MP_UI_BIND_ADDR': '0.0.0.0:8025'}
    common = {'APPLY_RUNNER': 'mock', 'IR35_STAGING': 'true', 'APPLICATION_WORKER_ACCEPT_JOBS': 'false',
        'APPLICATION_WORKER_CONCURRENCY': '1', 'IR35_READ_ONLY': 'false', 'IR35_SCHEDULER_ENABLED': 'false',
        'IR35CAREERS_APP_URL': 'https://staging.ir35careers.com', 'IR35_BUILD_SHA': BUILD_SHA,
        'APPLICATION_WORKER_SECRET': old_web['APPLICATION_WORKER_SECRET'],
        'IR35_MOCK_WEB_ENABLED': 'true', 'IR35_MOCK_WEB_JOB_IDS': ','.join(JOBS), 'QUEUE_DB_ALLOWED_HOSTS': 'db'}
    result['web'] = common | {'NEXT_PUBLIC_SUPABASE_URL': 'https://staging.ir35careers.com/supabase',
        'NEXT_PUBLIC_SUPABASE_ANON_KEY': values['ANON_KEY'], 'SUPABASE_SECRET_KEY': values['SERVICE_ROLE_KEY'],
        'SUPABASE_INTERNAL_URL': 'http://' + container_name('kong') + ':8000', 'IR35_STAGING_KONG_HOST': container_name('kong'),
        'IR35_STAGING_HEALTH_FIXTURE': 'webqa01',
        'IR35_WEB_HOST': 'staging.ir35careers.com', 'IR35_PUBLIC_HTML_CACHE': 'true', 'IR35_SESSION_MIGRATED': 'true',
        'IR35_WORKER_HEALTH_ENABLED': 'false', 'IR35_REALTIME_HEALTH_ENABLED': 'false',
        'APPLICATION_WORKER_ENABLED': 'false', 'APPLICATION_SUBMISSION_ENABLED': 'false',
        'PG_BOSS_DATABASE_URL': queue_uri(producer['PG_BOSS_DATABASE_URL'], 'ir35_queue_producer')}
    result['worker'] = common | {'PG_BOSS_DATABASE_URL': queue_uri(owner['PG_BOSS_DATABASE_URL'], 'ir35_queue'),
        'PORT': '8787', 'IR35_MOCK_WEB_INTERNAL_URL': 'http://' + container_name('web') + ':3000',
        'IR35_MOCK_WEB_INTERNAL_HOST': container_name('web'), 'IR35_MOCK_WEB_INTERNAL_VHOST': 'staging.ir35careers.com'}
    return result


def gateway(original):
    """Preserve the existing auth/ACL plugins; rewrite ONLY exact upstreams.

    Realtime is deliberately not routed to the old stack. Its separately owned
    tenant/replication test must add an attested fixture route later; a 404 is
    not a successful Realtime test. No Studio, meta or management service leaks.
    """
    result = copy.deepcopy(original)
    upstreams = {'auth-v1': ('auth', 9999, '/'), 'rest-v1': ('rest', 3000, '/'),
                 'storage-v1': ('storage', 5000, '/')}
    for part in ('verify', 'callback', 'authorize', '.well-known/jwks.json'):
        upstreams['auth-open-' + part.replace('/', '-')] = ('auth', 9999, '/' + part)
    historical = {'realtime-v1-ws', 'rt-admin-tenants', 'rt-admin-openapi'}
    services = result.get('services', [])
    if (type(services) is not list or any(type(item) is not dict or type(item.get('name')) is not str for item in services)
            or len({item['name'] for item in services}) != len(services)
            or {item['name'] for item in services} != set(upstreams) | historical):
        raise ConfigError('ExactReviewedGatewayServiceInventoryRequired')
    selected = []
    for service in services:
        if service['name'] not in upstreams:
            continue
        name, port, path = upstreams[service['name']]
        if service.get('url') != 'http://' + name + ':' + str(port) + path:
            raise ConfigError('GatewayOriginalUpstreamMismatch_NoFallback')
        service['url'] = 'http://' + container_name(name) + ':' + str(port) + path
        selected.append(service)
    result['services'] = selected
    return result


def compose(images, pins):
    """Private fixture only. Worker has an explicit profile; never auto-start it.

    No Caddy/public-edge changes, ports, host networking or inherited aliases.
    The caller must still verify existing Docker network Internal=true, image
    identity and available memory; configured limits are not fit/load evidence.
    """
    if (images.get('sourceSHA') != BUILD_SHA or set(images) != {'sourceSHA', 'web', 'worker'}
            or any(not re.fullmatch(r'sha256:[a-f0-9]{64}', images.get(k, '')) for k in ('web', 'worker'))
            or pins.get('storage', {}).get('image') != STORAGE_IMAGE):
        raise ConfigError('VerifiedImmutableQaImagesAndStorageRequired')
    result = {'name': PROJECT, 'services': {}, 'networks': {'backend': {'external': True, 'name': NETWORK}}}
    for name in ('auth', 'rest', 'storage', 'kong', 'smtp', 'web', 'worker'):
        image = images[name] if name in ('web', 'worker') else pins[name]['image']
        if name not in ('web', 'worker') and (pins[name]['platform'] != 'linux/arm64'
                or not re.fullmatch(r'[a-z0-9/._-]+:[A-Za-z0-9_.-]+@sha256:[a-f0-9]{64}', image)):
            raise ConfigError('PinnedArmBackendImageRequired')
        path = environment_path(name)
        service = {'image': image, 'platform': 'linux/arm64', 'container_name': container_name(name),
            'labels': {'ir35.qa': PROJECT, 'ir35.image-source': BUILD_SHA},
            'restart': 'no', 'user': '1002:1002', 'read_only': True, 'mem_limit': str(LIMITS[name]) + 'm',
            'pids_limit': 256 if name == 'worker' else 128, 'cap_drop': ['ALL'],
            'security_opt': ['no-new-privileges:true'], 'logging': {'driver': 'none'}, 'networks': ['backend'],
            'volumes': ['/opt/ir35/bin/env-exec:/run/ir35/env-exec:ro', path + ':' + path + ':ro'],
            'tmpfs': ['/tmp:rw,size=' + ('512m' if name == 'worker' else '64m') + ',uid=1002,gid=1002,mode=1777'],
            'entrypoint': ['/run/ir35/env-exec', path]}
        command = {'auth': ['auth', 'serve'], 'rest': ['postgrest'], 'web': ['node', 'web-server.mjs'],
                   'worker': ['node', '--import', 'tsx', 'services/application-worker/mock-web-main.ts', '--run']}.get(name)
        if command is not None:
            service['command'] = command
        else:
            service['entrypoint'] += pins[name]['entrypoint']
            service['command'] = pins[name]['command']
        if name in ('web', 'worker'):
            service['init'] = True
        if name == 'web':
            service['volumes'].append('/opt/ir35/data/p8-webqa01/next-cache:/app/.next/cache')
        if name == 'worker':
            service['profiles'] = ['mock-worker']
        if name == 'storage':
            service['volumes'].append('/opt/ir35/data/p8-webqa01/storage:/var/lib/storage:ro')
        if name == 'kong':
            service['volumes'].append(environment_path('kong-config') + ':/run/ir35/.env.kong-config.json:ro')
            service['tmpfs'].append('/run/kong:rw,uid=1002,gid=1002,mode=0700')
            service['ulimits'] = {'nofile': {'soft': 4096, 'hard': 4096}}
        if name == 'auth':
            service['env_file'] = [{'path': environment_path('subjects'), 'required': True, 'format': 'raw'}]
        result['services'][name] = service
    result['services']['templates'] = {
        'image': images['web'], 'platform': 'linux/arm64', 'container_name': container_name('templates'),
        'labels': {'ir35.qa': PROJECT, 'ir35.image-source': BUILD_SHA}, 'restart': 'no', 'user': '1002:1002',
        'read_only': True, 'mem_limit': '96m', 'pids_limit': 32, 'cap_drop': ['ALL'],
        'security_opt': ['no-new-privileges:true'], 'logging': {'driver': 'none'}, 'networks': ['backend'],
        'volumes': [environment_path('templates-json') + ':/run/ir35/.env.p8-webqa01-templates:ro'],
        'entrypoint': ['node'], 'command': ['--input-type=module', '-e', TEMPLATE_SERVER]}
    return result


def subjects_preserved(parsed_compose, subjects):
    actual = parsed_compose.get('services', {}).get('auth', {}).get('environment')
    if type(actual) is not dict or actual != subjects:
        raise ConfigError('ExactSourceSubjectsNotPreserved_NoActivation')
    return {'status': 'PASS', 'fields': len(subjects), 'valuesPrinted': False}
