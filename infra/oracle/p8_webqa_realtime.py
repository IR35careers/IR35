"""Pure owned-fixture Realtime plan; never a tenant/API/database action.

Pinned upstream v2.143.3 seeds its tenant into DB_NAME and derives a websocket
tenant from the first host label. Both metadata and CDC MUST use the disposable
QA database; a unique host alias and replication-slot suffix prevent original
tenant/slot collisions. The runtime must still attest the cloned schema,
publication, source slot inventory and cleanup; this plan is not native proof.
"""
import copy
from p8_webqa_config import PROJECT, NETWORK, ConfigError, database_name

NAME = PROJECT + '-realtime'
ALIAS = PROJECT + '.supabase-realtime'
ENV_PATH = '/opt/ir35/.env.p8-webqa01-realtime'
PIN = 'supabase/realtime:v2.143.3@sha256:39abd3593110424c8512ffdaefd6b3ef016a5867065a87c1658e9bc55199a464'


def environment(base, pristine):
    # Explicit field set, not inherited arbitrary provider/cloud credentials.
    required = ('DB_PASSWORD', 'DB_ENC_KEY', 'API_JWT_SECRET', 'SECRET_KEY_BASE', 'METRICS_JWT_SECRET', 'HEALTHCHECK_ANON_KEY')
    if (type(base) is not dict or base.get('DB_HOST') != 'db' or base.get('DB_PORT') != '5432'
            or base.get('DB_USER') != 'supabase_admin' or base.get('DB_NAME') != 'postgres'
            or any(type(base.get(key)) is not str or not base[key] or any(c in base[key] for c in '\r\n\0') for key in required)
            or any(base.get(key) not in (None, '', 'false') for key in ('GENERATE_CLUSTER_CERTS', 'ENABLE_ERL_CRASH_DUMP'))):
        raise ConfigError('ExistingPrivateRealtimeCredentialsRequired')
    return {key: base[key] for key in required} | {
        'PORT': '4000', 'DB_HOST': 'db', 'DB_PORT': '5432', 'DB_USER': 'supabase_admin',
        'DB_NAME': database_name(pristine), 'DB_POOL_SIZE': '2', 'DB_REPLICA_POOL_SIZE': '1', 'DB_IP_VERSION': 'ipv4', 'DB_SSL': 'false',
        'DB_AFTER_CONNECT_QUERY': 'SET search_path TO _realtime',
        'APP_NAME': 'realtime', 'SELF_HOST_TENANT_NAME': PROJECT, 'SEED_SELF_HOST': 'true',
        'SLOT_NAME_SUFFIX': 'p8_webqa01', 'RUN_JANITOR': 'false', 'CLUSTER_STRATEGIES': 'POSTGRES',
        'ERL_AFLAGS': '-proto_dist inet_tcp +S 2:2', 'DNS_NODES': '', 'RLIMIT_NOFILE': '4096',
        'DISABLE_HEALTHCHECK_LOGGING': 'true', 'LOG_LEVEL': 'error', 'ENABLE_ERL_CRASH_DUMP': 'false',
        'ERL_CRASH_DUMP_SECONDS': '0', 'ERL_CRASH_DUMP_BYTES': '0',
        'TENANT_MAX_CONCURRENT_USERS': '50', 'TENANT_MAX_CHANNELS_PER_CLIENT': '10'}


def gateway(owned, original):
    value = copy.deepcopy(owned)
    names = ('realtime-v1-ws', 'rt-admin-tenants', 'rt-admin-openapi')
    extra = [copy.deepcopy(row) for row in original.get('services', []) if row.get('name') in names]
    if (len(extra) != 3 or {row['name'] for row in extra} != set(names)
            or any(row.get('name') in names for row in value.get('services', []))
            or value.get('consumers') != original.get('consumers') or value.get('acls') != original.get('acls')):
        raise ConfigError('ExactOwnedGatewayAndOriginalRealtimeRoutesRequired')
    for row in extra:
        if row['name'] == 'realtime-v1-ws':
            if row.get('url') != 'http://realtime-dev.supabase-realtime:4000/socket':
                raise ConfigError('OriginalRealtimeWebsocketRouteRequired')
            row['url'] = 'http://' + ALIAS + ':4000/socket'
            # Kong's normal upstream Host now selects ONLY our tenant; don't
            # preserve public staging Host or add the old global alias.
            if any(route.get('preserve_host') for route in row.get('routes', [])):
                raise ConfigError('UpstreamTenantHostRequired')
        else:
            plugins = row.get('plugins', [])
            if (row.get('url') != 'http://realtime:4000/api' or len(plugins) != 1
                    or plugins[0].get('name') != 'request-termination' or plugins[0].get('config', {}).get('status_code') != 403):
                raise ConfigError('RealtimeAdminMustRemainBlocked')
            row['url'] = 'http://' + NAME + ':4000/api'
    value['services'].extend(extra)
    return value


def compose_service(pin):
    if type(pin) is not dict or pin.get('platform') != 'linux/arm64' or pin.get('image') != PIN:
        raise ConfigError('ExactExistingArmRealtimePinRequired')
    entry, command = pin.get('entrypoint'), pin.get('command')
    if (entry != ['/usr/bin/tini', '-s', '-g', '--', '/app/run.sh'] or command != ['/app/bin/server']):
        raise ConfigError('ExactOfficialRealtimeEntrypointRequired')
    return {'image': PIN, 'platform': 'linux/arm64', 'container_name': NAME,
        'labels': {'ir35.qa': PROJECT}, 'restart': 'no', 'user': '1002:1002', 'read_only': True,
        'mem_limit': '256m', 'pids_limit': 128, 'cap_drop': ['ALL'], 'security_opt': ['no-new-privileges:true'],
        'logging': {'driver': 'none'}, 'networks': {'backend': {'aliases': [ALIAS]}},
        'ulimits': {'nofile': {'soft': 4096, 'hard': 4096}},
        'volumes': ['/opt/ir35/bin/env-exec:/run/ir35/env-exec:ro', ENV_PATH + ':' + ENV_PATH + ':ro'],
        'tmpfs': ['/tmp:rw,size=64m,uid=1002,gid=1002,mode=1777'],
        'entrypoint': ['/run/ir35/env-exec', ENV_PATH, *entry], 'command': command}


def add_to_compose(plan, pin):
    if (plan.get('name') != PROJECT or plan.get('networks') != {'backend': {'external': True, 'name': NETWORK}}
            or 'realtime' in plan.get('services', {})):
        raise ConfigError('NewOwnedRealtimeComposeRequired_NoReplacement')
    value = copy.deepcopy(plan)
    value['services']['realtime'] = compose_service(pin)
    return value
