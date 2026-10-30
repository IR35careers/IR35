"""Private fixture edge only. No public edge edit, ACME, key copy or activation."""
import ipaddress
import re
from p8_webqa_config import PROJECT, NETWORK, container_name, ConfigError

STAGING_HOST = 'staging.ir35careers.com'
CERTIFICATE = '/data/certificates/acme-v02.api.letsencrypt.org-directory/' + STAGING_HOST + '/' + STAGING_HOST


def gateway_source(value):
    try:
        address = ipaddress.IPv4Address(value)
    except (ValueError, TypeError):
        raise ConfigError('ExistingPrivateDockerGatewayRequired') from None
    if not any(address in ipaddress.IPv4Network(network) for network in ('10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16')):
        raise ConfigError('ExistingPrivateDockerGatewayRequired')
    return str(address) + '/32'


def caddyfile(gateway):
    source = gateway_source(gateway)
    # Literal route order: deny non-tunnel peers -> SDK cookie guard -> prefix
    # rewrite -> fixed owned proxy ->404. Do NOT use sorted sibling handlers.
    return '''{
    admin off
    persist_config off
    auto_https off
    https_port 8443
    log {
        level ERROR
    }
}
https://staging.ir35careers.com {
    tls CERTIFICATE.crt CERTIFICATE.key
    header >X-Robots-Tag "noindex, nofollow, noarchive"
    header >Cache-Control "no-store"
    header X-Caddy-Request-ID {http.request.uuid}
    header >X-Caddy-Request-ID {http.request.uuid}
    header -Server
    handle_errors {
        route {
            header >Cache-Control "no-store"
            header >X-Robots-Tag "noindex, nofollow, noarchive"
            header >X-Caddy-Request-ID {http.request.uuid}
            header -Server
            respond "" {err.status_code}
        }
    }
    route {
        @not_tunnel not remote_ip GATEWAY_SOURCE
        respond @not_tunnel "Forbidden" 403
        @blocked path /api/applications/worker/* /api/queues/* /api/pipeline/* /api/cron/* /api/integrations/email/* /api/billing/*
        respond @blocked "Not found" 404
        @sdk path /supabase/*
        handle @sdk {
            route {
                @missing_gate not header_regexp Cookie "(^|;[ ]*)__Host-ir35-staging={$STAGING_GATE_TOKEN}(;|$)"
                header @missing_gate >X-IR35-Matched-Route "sdk-guard"
                respond @missing_gate "Staging authentication required" 401
                uri strip_prefix /supabase
                @api path /auth/v1/* /rest/v1/* /storage/v1/* /realtime/v1/*
                header @api X-IR35-Matched-Route "sdk-proxy"
                reverse_proxy @api OWN_KONG:8000 {
                    header_up -Cookie
                    header_up -X-Staging-Authorization
                    header_up -X-Forwarded-For
                    header_up -X-Real-IP
                    header_up -X-Vercel-Forwarded-For
                }
                header X-IR35-Matched-Route "sdk-fallback"
                respond "Not found" 404
            }
        }
        handle {
            route {
                vars original_auth ""
                @bearer header Authorization "Bearer *"
                vars @bearer original_auth "{http.request.header.Authorization}"
                @staging_header header X-Staging-Authorization *
                request_header @staging_header Authorization "{http.request.header.X-Staging-Authorization}"
                header X-IR35-Matched-Route "basic-auth-rejection"
                basic_auth {
                    ir35 {$STAGING_BASIC_HASH}
                }
                request_header -Authorization
                @restore_bearer expression `{vars.original_auth} != ""`
                request_header @restore_bearer Authorization "{vars.original_auth}"
                request_header -X-Staging-Authorization
                header >Set-Cookie "__Host-ir35-staging={$STAGING_GATE_TOKEN}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=1800"
                header X-IR35-Matched-Route "page-proxy"
                reverse_proxy OWN_WEB:3000 {
                    header_up -X-Forwarded-For
                    header_up -X-Real-IP
                    header_up -X-Vercel-Forwarded-For
                }
            }
        }
    }
}
'''.replace('CERTIFICATE', CERTIFICATE).replace('GATEWAY_SOURCE', source).replace('OWN_KONG', container_name('kong')).replace('OWN_WEB', container_name('web'))


def compose_service(pin):
    if (type(pin) is not dict or pin.get('platform') != 'linux/arm64'
            or not re.fullmatch(r'caddy:[A-Za-z0-9_.-]+@sha256:[a-f0-9]{64}', pin.get('image', ''))):
        raise ConfigError('PinnedArmCaddyImageRequired')
    path = '/opt/ir35/.env.p8-webqa01-caddy'
    return {'image': pin['image'], 'platform': 'linux/arm64', 'container_name': PROJECT + '-caddy',
        'labels': {'ir35.qa': PROJECT}, 'restart': 'no', 'user': '1002:1002', 'read_only': True,
        'mem_limit': '128m', 'pids_limit': 128, 'cap_drop': ['ALL'], 'security_opt': ['no-new-privileges:true'],
        'logging': {'driver': 'none'}, 'networks': ['backend'],
        'volumes': ['/opt/ir35/bin/env-exec:/run/ir35/env-exec:ro', path + ':' + path + ':ro',
            '/opt/ir35/.env.p8-webqa01-caddyfile:/etc/caddy/Caddyfile:ro', '/opt/ir35/data/caddy:/data:ro'],
        'tmpfs': ['/config:rw,size=16m,uid=1002,gid=1002,mode=0700', '/tmp:rw,size=16m,uid=1002,gid=1002,mode=0700'],
        'entrypoint': ['/run/ir35/env-exec', path, 'caddy'], 'command': ['run', '--config', '/etc/caddy/Caddyfile', '--adapter', 'caddyfile']}


def add_to_compose(plan, pin):
    import copy
    if (plan.get('name') != PROJECT or plan.get('networks') != {'backend': {'external': True, 'name': NETWORK}}
            or 'caddy' in plan.get('services', {})):
        raise ConfigError('ExclusiveOwnedQaComposeRequired')
    result = copy.deepcopy(plan)
    result['services']['caddy'] = compose_service(pin)
    return result
