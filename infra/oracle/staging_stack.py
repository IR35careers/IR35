"""Generate the slim official Supabase Compose adaptation (no secret values)."""
import json
from pathlib import Path

UPSTREAM = "bc27d2661edd09a5d0b8d76ce33da6d4071a756e"
SQL_FILES = ("realtime.sql", "roles.sql", "jwt.sql", "_supabase.sql")

# The omitted webhooks service normally creates this role before99-roles.sql.
# Preserve that bootstrap prerequisite without enabling pg_net/webhook egress.
FUNCTIONS_ROLE_SQL = """DO $$ BEGIN
IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='supabase_functions_admin') THEN
CREATE USER supabase_functions_admin NOINHERIT CREATEROLE LOGIN NOREPLICATION;
END IF; END $$;
"""


def compose(images):
    services = {}
    limits = {"db": "3g", "auth": "256m", "rest": "256m", "realtime": "256m", "storage": "512m", "kong": "384m", "meta": "128m", "smtp": "64m", "caddy": "128m", "studio": "512m"}
    for name, limit in limits.items():
        services[name] = {"image": images[name]["image"], "platform": "linux/arm64", "restart": "no",
            "mem_limit": limit, "pids_limit": 256, "networks": ["backend"],
            "command": images[name]["command"],
            "entrypoint": ["/run/ir35/env-exec", "/opt/ir35/.env." + name, *images[name]["entrypoint"]],
            "volumes": ["/opt/ir35/bin/env-exec:/run/ir35/env-exec:ro", "/opt/ir35/.env." + name + ":/opt/ir35/.env." + name + ":ro"],
            "logging": {"driver": "json-file", "options": {"max-size": "10m", "max-file": "3"}}}
    healthy = {"db": {"condition": "service_healthy"}}
    services["db"].update(volumes=["/opt/ir35/data/postgres:/var/lib/postgresql/data",
        "/opt/ir35/config/pgsodium-env-key.sh:/run/ir35/pgsodium-env-key.sh:ro",
        "/opt/ir35/config/realtime.sql:/docker-entrypoint-initdb.d/migrations/99-realtime.sql:ro",
        "/opt/ir35/config/roles.sql:/docker-entrypoint-initdb.d/init-scripts/99-roles.sql:ro",
        "/opt/ir35/config/functions-role.sql:/docker-entrypoint-initdb.d/init-scripts/98-functions-role.sql:ro",
        "/opt/ir35/config/jwt.sql:/docker-entrypoint-initdb.d/init-scripts/99-jwt.sql:ro",
        "/opt/ir35/config/_supabase.sql:/docker-entrypoint-initdb.d/migrations/97-_supabase.sql:ro"],
        command=["postgres", "-c", "config_file=/etc/postgresql/postgresql.conf", "-c", "log_min_messages=fatal",
            "-c", "log_statement=none", "-c", "log_min_error_statement=panic", "-c", "shared_buffers=768MB", "-c", "effective_cache_size=2GB", "-c", "max_connections=60",
            "-c", "pgsodium.getkey_script=/run/ir35/pgsodium-env-key.sh", "-c", "vault.getkey_script=/run/ir35/pgsodium-env-key.sh"],
        healthcheck={"test": ["CMD", "pg_isready", "-U", "postgres", "-h", "localhost"], "interval": "5s", "timeout": "5s", "retries": 10})
    services["auth"].update(depends_on=healthy, healthcheck={"test": ["CMD", "wget", "--quiet", "--tries=1", "--spider", "http://127.0.0.1:9999/health"], "interval": "10s", "timeout": "5s", "retries": 5})
    services["rest"].update(depends_on=healthy, command=["postgrest"], healthcheck={"test": ["CMD", "/run/ir35/env-exec", "/opt/ir35/.env.rest", "postgrest", "--ready"], "interval": "10s", "timeout": "5s", "retries": 5})
    services["realtime"].update(container_name="realtime-dev.supabase-realtime", depends_on=healthy,
        volumes=["/opt/ir35/.env.realtime-health-header:/opt/ir35/.env.realtime-health-header:ro"],
        healthcheck={"test": ["CMD", "curl", "-sSf", "--head", "-o", "/dev/null", "-H", "@/opt/ir35/.env.realtime-health-header", "http://127.0.0.1:4000/api/tenants/realtime-dev/health"],
            "interval": "30s", "timeout": "5s", "retries": 5, "start_period": "30s"})
    services["storage"].update(depends_on={**healthy, "rest": {"condition": "service_started"}}, volumes=["/opt/ir35/data/storage:/var/lib/storage"],
        healthcheck={"test": ["CMD", "wget", "--quiet", "--tries=1", "--spider", "http://127.0.0.1:5000/status"], "interval": "10s", "timeout": "5s", "retries": 5})
    services["kong"].update(user="1002:1002", depends_on={"auth": {"condition": "service_started"}, "rest": {"condition": "service_started"}},
        ulimits={"nofile": {"soft": 4096, "hard": 4096}},
        volumes=["/opt/ir35/.env.kong-config.json:/run/ir35/.env.kong-config.json:ro"], tmpfs=["/run/kong:rw,uid=1002,gid=1002,mode=0700"],
        healthcheck={"test": ["CMD", "/run/ir35/env-exec", "/opt/ir35/.env.kong", "kong", "health"], "interval": "10s", "timeout": "5s", "retries": 5})
    services["meta"].update(depends_on=healthy)
    services["smtp"].update(environment={"MP_DATABASE": "/tmp/mailpit.db", "MP_MAX_MESSAGES": "100", "MP_SMTP_BIND_ADDR": "0.0.0.0:1025", "MP_UI_BIND_ADDR": "0.0.0.0:8025"},
        read_only=True, tmpfs=["/tmp:rw,size=32m"], healthcheck={"test": ["CMD", "/mailpit", "readyz"], "interval": "10s", "timeout": "5s", "retries": 5})
    services["studio"].update(profiles=["studio"], depends_on=healthy, ports=["127.0.0.1:54323:3000"])
    services["caddy"].update(user="1002:1002", restart="no", networks={"edge": {"ipv4_address": "172.30.35.2"}, "backend": {}},
        cap_drop=["ALL"], cap_add=["NET_BIND_SERVICE"], security_opt=["no-new-privileges:true"], read_only=True,
        ports=["80:80/tcp", "443:443/tcp"], tmpfs=["/tmp:rw,size=16m"],
        volumes=["/opt/ir35/config/Caddyfile:/etc/caddy/Caddyfile:ro", "/opt/ir35/data/caddy:/data"],
        environment={"XDG_DATA_HOME": "/data", "XDG_CONFIG_HOME": "/data/config"},
        command=["caddy", "run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"])
    # update() above sets service-specific mounts. Restore only the protected
    # per-service env file and public launcher, never secret Docker Env values.
    for name, service in services.items():
        service["volumes"] = [mount for mount in service.get("volumes", []) if ":/run/ir35/env-exec:" not in mount and ":/opt/ir35/.env." + name + ":" not in mount]
        service["volumes"].extend(["/opt/ir35/bin/env-exec:/run/ir35/env-exec:ro", "/opt/ir35/.env." + name + ":/opt/ir35/.env." + name + ":ro"])
        if name not in ("db", "smtp"):
            service["user"] = "1002:1002"
        if name == "storage":
            service.setdefault("environment", {})["NODE_OPTIONS"] = "--max-old-space-size=384"
        if name != "caddy":
            # Third-party startup errors must not persist credential-bearing
            # settings. Use explicit health/SQLSTATE probes, not raw log dumps.
            service["logging"] = {"driver": "none"}
    return {"name": "ir35-staging", "services": services, "networks": {"backend": {"internal": True},
        "edge": {"ipam": {"config": [{"subnet": "172.30.35.0/24"}]}}}}


def kong_config(anon, service):
    # Derived from upstream Kong override. No Studio/meta/functions/GraphQL
    # route; preserve user Bearer tokens and the official key-auth/ACL boundary.
    def protected(name, url, path, websocket=False):
        transformer = {"add": {"headers": ["Authorization: $((headers.authorization ~= nil and headers.authorization) or headers.apikey)"]},
            "replace": {"headers": ["Authorization: $((headers.authorization ~= nil and headers.authorization) or headers.apikey)"]}}
        if websocket:
            transformer = {"add": {"headers": ["x-api-key:$(query_params.apikey)"]}}
        return {"name": name, "url": url, "routes": [{"name": name, "strip_path": True, "paths": [path]}],
            "plugins": [{"name": "cors"}, {"name": "key-auth", "config": {"hide_credentials": False}},
                {"name": "request-transformer", "config": transformer}, {"name": "acl", "config": {"hide_groups_header": True, "allow": ["admin", "anon"]}}]}
    routes = [protected("auth-v1", "http://auth:9999/", "/auth/v1/"), protected("rest-v1", "http://rest:3000/", "/rest/v1/"),
        protected("realtime-v1-ws", "http://realtime-dev.supabase-realtime:4000/socket", "/realtime/v1/", True)]
    for part in ("verify", "callback", "authorize", ".well-known/jwks.json"):
        routes.append({"name": "auth-open-" + part.replace("/", "-"), "url": "http://auth:9999/" + part,
            "routes": [{"name": "auth-open-" + part.replace("/", "-"), "strip_path": True, "paths": ["/auth/v1/" + part]}], "plugins": [{"name": "cors"}]})
    # Storage validates signed download URLs itself; don't replace them with a
    # key-auth requirement that breaks private signed downloads.
    routes.append({"name": "storage-v1", "url": "http://storage:5000/", "routes": [{"name": "storage-v1", "strip_path": True, "paths": ["/storage/v1/"]}], "plugins": [{"name": "cors"}]})
    for name, path in (("rt-admin-tenants", "/realtime/v1/api/tenants"), ("rt-admin-openapi", "/realtime/v1/api/openapi")):
        routes.append({"name": name, "url": "http://realtime:4000/api", "routes": [{"name": name, "paths": [path]}],
            "plugins": [{"name": "request-termination", "config": {"status_code": 403, "message": "Forbidden"}}]})
    return {"_format_version": "3.0", "_transform": True, "consumers": [{"username": "anon", "keyauth_credentials": [{"key": anon}]},
        {"username": "service_role", "keyauth_credentials": [{"key": service}]}], "acls": [{"consumer": "anon", "group": "anon"}, {"consumer": "service_role", "group": "admin"}], "services": routes}


CADDYFILE = """{
    admin off
    persist_config off
    email info@ir35careers.com
    log {
        level ERROR
    }
    storage file_system {
        root /data
    }
}
(staging_tls) {
    tls {
        issuer acme {
            dir {$ACME_CA}
            disable_tlsalpn_challenge
        }
    }
    header X-Robots-Tag "noindex, nofollow, noarchive"
    header -Server
}
staging.ir35careers.com {
    import staging_tls
    basic_auth {
        ir35 {$STAGING_BASIC_HASH}
    }
    respond "IR35 staging setup in progress" 503
}
api-staging.ir35careers.com {
    import staging_tls
    @not_allowed not remote_ip {$STAGING_OWNER_IP} 132.145.28.134 127.0.0.1 ::1 172.30.35.1 172.30.35.3
    respond @not_allowed "Forbidden" 403
    route {
        vars original_auth ""
        @bearer header Authorization "Bearer *"
        vars @bearer original_auth "{http.request.header.Authorization}"
        @staging_header header X-Staging-Authorization *
        request_header @staging_header Authorization "{http.request.header.X-Staging-Authorization}"
        basic_auth {
            ir35 {$STAGING_BASIC_HASH}
        }
        request_header -Authorization
        @restore_bearer expression `{vars.original_auth} != ""`
        request_header @restore_bearer Authorization "{vars.original_auth}"
        request_header -X-Staging-Authorization
        @api path /auth/v1/* /rest/v1/* /storage/v1/* /realtime/v1/*
        reverse_proxy @api kong:8000 {
            header_up -X-Forwarded-For
            header_up -X-Real-IP
            header_up -X-Vercel-Forwarded-For
        }
        respond "Not found" 404
    }
}
"""

GETKEY = '#!/bin/sh\nset -eu\n[ "${#PGSODIUM_ROOT_KEY}" = 64 ]\nprintf "%s\\n" "$PGSODIUM_ROOT_KEY"\n'


if __name__ == "__main__":
    root = Path(__file__).parent
    images = json.loads((root / "staging-images.json").read_text())["images"]
    (root / "staging-compose.yml").write_text(json.dumps(compose(images), indent=2) + "\n")
