"""Public P5 wiring only. New app fixture; never repoint the verified P4 DB."""
import json
import re

NODE_IMAGE='node:22-bookworm-slim@sha256:de170b39439eb0e5a3444ad7d60b015614a381e10fecae2e30ec9e735122f38d'
NODE_ARM_DIGEST='sha256:ceb43e5c219139035fb742900629e4abed89fe0997f7c03250c499e1f2710c9e'


def compose(image,backend):
    if not re.fullmatch(r'sha256:[0-9a-f]{64}',image) or not re.fullmatch(r'ir35-staging_backend',backend):raise ValueError('Exact local verified image/network required')
    return {'name':'ir35-p5','services':{'web':{'image':image,'platform':'linux/arm64','container_name':'ir35-p5-web',
        'restart':'no','user':'1002:1002','init':True,'mem_limit':'1536m','pids_limit':128,'read_only':True,
        'cap_drop':['ALL'],'security_opt':['no-new-privileges:true'],'logging':{'driver':'none'},
        'entrypoint':['/run/ir35/env-exec','/opt/ir35/.env.p5-web','node','web-server.mjs'],
        'volumes':['/opt/ir35/bin/env-exec:/run/ir35/env-exec:ro','/opt/ir35/.env.p5-web:/opt/ir35/.env.p5-web:ro',
            '/opt/ir35/data/p5-next-cache:/app/.next/cache'],
        'tmpfs':['/tmp:rw,size=128m,uid=1002,gid=1002,mode=0700'],'networks':['backend']}},
        'networks':{'backend':{'external':True,'name':backend}}}


def app_compose(image,backend,pins):
    """Additional app-fixture services use the EXISTING private Postgres host.
    No new VM/volume/network/public listener; no verified-P4 service repointing.
    """
    result=compose(image,backend)
    limits={'auth':'256m','rest':'256m','storage':'512m','kong':'384m'}
    for name,limit in limits.items():
        pin=pins[name]
        if pin['platform']!='linux/arm64' or not re.fullmatch(r'[a-z0-9/_-]+:[A-Za-z0-9_.-]+@sha256:[0-9a-f]{64}',pin['image']):raise ValueError('Pinned native backend required')
        env='/opt/ir35/.env.p5-'+name
        service={'image':pin['image'],'platform':'linux/arm64','container_name':'ir35-p5-'+name,'user':'1002:1002',
            'restart':'no','mem_limit':limit,'pids_limit':128,'read_only':True,'cap_drop':['ALL'],
            'security_opt':['no-new-privileges:true'],'logging':{'driver':'none'},'networks':['backend'],
            'entrypoint':['/run/ir35/env-exec',env,*pin['entrypoint']], 'command':pin['command'],
            'volumes':['/opt/ir35/bin/env-exec:/run/ir35/env-exec:ro',env+':'+env+':ro'],
            'tmpfs':['/tmp:rw,size=64m,uid=1002,gid=1002,mode=0700']}
        result['services'][name]=service
    result['services']['rest']['command']=['postgrest']
    # Exact-clone schema/migration history is separately verified. Serve the
    # read-only P5 fixture; do not run root-command startup migrations on it.
    result['services']['auth']['command']=['auth','serve']
    result['services']['storage']['volumes'].append('/opt/ir35/data/p5-storage:/var/lib/storage:ro')
    result['services']['kong']['volumes'].append('/opt/ir35/.env.p5-kong-config:/run/ir35/.env.kong-config.json:ro')
    result['services']['kong']['tmpfs'].append('/run/kong:rw,uid=1002,gid=1002,mode=0700')
    result['services']['kong']['ulimits']={'nofile':{'soft':4096,'hard':4096}}
    return result


def caddyfile(original):
    marker='staging.ir35careers.com {\n'
    start=original.index(marker);end=original.index('\napi-staging.ir35careers.com {',start)
    web='''staging.ir35careers.com {
    import staging_tls
    @not_owner not remote_ip {$STAGING_OWNER_IP} 132.145.28.134 127.0.0.1 ::1 172.30.35.1 172.30.35.3
    respond @not_owner "Forbidden" 403
    route {
        @sdk path /supabase/*
        handle @sdk {
            @missing_gate not header_regexp Cookie "(^|;[ ]*)__Host-ir35-staging={$STAGING_GATE_TOKEN}(;|$)"
            respond @missing_gate "Staging authentication required" 401
            uri strip_prefix /supabase
            @api path /auth/v1/* /rest/v1/* /storage/v1/* /realtime/v1/*
            reverse_proxy @api ir35-p5-kong:8000 {
                header_up -Cookie
                header_up -X-Forwarded-For
                header_up -X-Real-IP
                header_up -X-Vercel-Forwarded-For
            }
            respond "Not found" 404
        }
        handle {
            route {
                basic_auth {
                    ir35 {$STAGING_BASIC_HASH}
                }
                header >Set-Cookie "__Host-ir35-staging={$STAGING_GATE_TOKEN}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=1800"
                @basic header Authorization "Basic *"
                request_header @basic -Authorization
                reverse_proxy ir35-p5-web:3000 {
                    header_up -X-Forwarded-For
                    header_up -X-Real-IP
                    header_up -X-Vercel-Forwarded-For
                }
            }
        }
    }
}
'''
    # Both approved STAGING hosts only. Production hostnames/routes are absent.
    result=(original[:start]+web+original[end:]).replace('header X-Robots-Tag "noindex, nofollow, noarchive"',
        'header >X-Robots-Tag "noindex, nofollow, noarchive"\n    header >Cache-Control "no-store"')
    return result.replace('reverse_proxy @api kong:8000','reverse_proxy @api ir35-p5-kong:8000')


if __name__=='__main__':raise SystemExit('Imported by guarded P5 controller only')
