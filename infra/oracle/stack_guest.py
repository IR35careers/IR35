"""Fixed staging-only Supabase bootstrap. Secret values never leave this VM."""
import base64
import hashlib
import hmac
import ipaddress
import json
import os
from pathlib import Path
import pwd
import re
import shutil
import socket
import ssl
import stat
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request

import staging_stack as stack

ROOT = Path("/opt/ir35")
CONFIG = ROOT / "config"
STATE = CONFIG / "p3-stack-state.json"
ENV = ROOT / ".env"


def run(args, *, timeout=60, input=None):
    result = subprocess.run(args, input=input, capture_output=True, text=True, timeout=timeout)
    if result.returncode:
        raise RuntimeError("Staging command failed: " + Path(args[0]).name + "; exit=" + str(result.returncode) + "; output suppressed")
    return result.stdout


def write(path, text, mode=0o644, owner=0):
    path = Path(path)
    if path.is_symlink() or path.exists() and not path.is_file():
        raise RuntimeError("Unsafe staging file type")
    if path.exists():
        observed = path.stat()
        if observed.st_uid == owner and stat.S_IMODE(observed.st_mode) == mode and path.read_text() == text:
            # Bind mounts retain their inode; replacing an unchanged secret
            # file unlinks the container's existing mount. Preserve it.
            return
    descriptor, temporary = tempfile.mkstemp(prefix=".ir35-", dir=path.parent)
    with os.fdopen(descriptor, "w") as stream:
        os.fchmod(stream.fileno(), mode)
        os.fchown(stream.fileno(), owner, owner)
        stream.write(text)
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temporary, path)


def read_env():
    observed = ENV.stat()
    if ENV.is_symlink() or observed.st_uid != 1002 or stat.S_IMODE(observed.st_mode) != 0o600:
        raise RuntimeError("VM-only env custody mismatch")
    values = {}
    for line in ENV.read_text().splitlines():
        match = re.fullmatch(r"([A-Z][A-Z0-9_]*)='([^'\r\n]*)'", line)
        if not match or match[1] in values:
            raise RuntimeError("Unexpected private env format; no values printed")
        values[match[1]] = match[2]
    if values.get("APPLY_RUNNER") != "mock" or values.get("APPLICATION_WORKER_ACCEPT_JOBS") != "false":
        raise RuntimeError("Staging mock/acceptance settings changed; no overwrite")
    return values


def env_text(values):
    if any(not re.fullmatch(r"[A-Z][A-Z0-9_]*", key) or any(c in str(value) for c in "'\r\n") for key, value in values.items()):
        raise RuntimeError("Unsafe environment encoding")
    return "".join(key + "='" + str(value) + "'\n" for key, value in sorted(values.items()))


def jwt(secret, role):
    def encode(value):
        return base64.urlsafe_b64encode(json.dumps(value, separators=(",", ":")).encode()).rstrip(b"=")
    now = int(time.time())
    body = encode({"alg": "HS256", "typ": "JWT"}) + b"." + encode({"role": role, "iss": "supabase", "iat": now, "exp": now + 315360000})
    signature = base64.urlsafe_b64encode(hmac.new(secret.encode(), body, hashlib.sha256).digest()).rstrip(b"=")
    return (body + b"." + signature).decode()


def hash_password_args(image):
    # -i keeps Docker's stdin attached; plaintext goes only over stdin.
    return ["docker", "run", "--rm", "-i", "--network", "none", "--read-only", "--memory", "128m", "--entrypoint", "caddy", image, "hash-password", "--algorithm", "bcrypt"]


def component_env(values):
    password, secret = values["POSTGRES_PASSWORD"], values["JWT_SECRET"]
    uri = lambda user: "postgres://" + user + ":" + password + "@db:5432/postgres"
    anon, service = values["ANON_KEY"], values["SERVICE_ROLE_KEY"]
    return {
        "db": {"POSTGRES_PASSWORD": password, "PGPASSWORD": password, "POSTGRES_DB": "postgres", "PGDATABASE": "postgres", "PGDATA": "/var/lib/postgresql/data",
            "POSTGRES_HOST": "/var/run/postgresql", "PGPORT": "5432", "POSTGRES_PORT": "5432", "JWT_EXP": "3600", "PGSODIUM_ROOT_KEY": values["PGSODIUM_ROOT_KEY"]},
        "auth": {"GOTRUE_API_HOST": "0.0.0.0", "GOTRUE_API_PORT": "9999", "API_EXTERNAL_URL": "https://api-staging.ir35careers.com",
            "GOTRUE_DB_DRIVER": "postgres", "GOTRUE_DB_DATABASE_URL": uri("supabase_auth_admin"), "GOTRUE_DB_MAX_POOL_SIZE": "10",
            "GOTRUE_SITE_URL": "https://staging.ir35careers.com", "GOTRUE_URI_ALLOW_LIST": "https://staging.ir35careers.com/auth/callback",
            "GOTRUE_DISABLE_SIGNUP": "true", "GOTRUE_JWT_ADMIN_ROLES": "service_role", "GOTRUE_JWT_AUD": "authenticated", "GOTRUE_JWT_DEFAULT_GROUP_NAME": "authenticated",
            "GOTRUE_JWT_EXP": "3600", "GOTRUE_JWT_SECRET": secret, "GOTRUE_EXTERNAL_EMAIL_ENABLED": "true", "GOTRUE_MAILER_AUTOCONFIRM": "false",
            "GOTRUE_SMTP_HOST": "smtp", "GOTRUE_SMTP_PORT": "1025", "GOTRUE_SMTP_ADMIN_EMAIL": "info@ir35careers.com", "GOTRUE_SMTP_USER": "", "GOTRUE_SMTP_PASS": "",
            "GOTRUE_SMTP_SENDER_NAME": "IR35 staging sink", "GOTRUE_LOG_LEVEL": "error", "GOTRUE_MFA_TOTP_ENROLL_ENABLED": "true", "GOTRUE_MFA_TOTP_VERIFY_ENABLED": "true",
            **{"GOTRUE_MAILER_URLPATHS_" + name: "/auth/v1/verify" for name in ("INVITE", "CONFIRMATION", "RECOVERY", "EMAIL_CHANGE")}},
        "rest": {"PGRST_DB_URI": uri("authenticator"), "PGRST_DB_SCHEMAS": "public,storage", "PGRST_DB_ANON_ROLE": "anon", "PGRST_DB_POOL": "10",
            "PGRST_JWT_SECRET": secret, "PGRST_DB_USE_LEGACY_GUCS": "false", "PGRST_APP_SETTINGS_JWT_EXP": "3600", "PGRST_SERVER_HOST": "0.0.0.0", "PGRST_ADMIN_SERVER_PORT": "3001", "PGRST_ADMIN_SERVER_HOST": "localhost", "PGRST_LOG_LEVEL": "crit"},
        "realtime": {"PORT": "4000", "DB_HOST": "db", "DB_PORT": "5432", "DB_USER": "supabase_admin", "DB_PASSWORD": password, "DB_NAME": "postgres", "DB_POOL_SIZE": "5",
            "DB_AFTER_CONNECT_QUERY": "SET search_path TO _realtime", "DB_ENC_KEY": values["REALTIME_DB_ENC_KEY"], "API_JWT_SECRET": secret, "SECRET_KEY_BASE": values["SECRET_KEY_BASE"],
            "METRICS_JWT_SECRET": secret, "HEALTHCHECK_ANON_KEY": anon, "ERL_AFLAGS": "-proto_dist inet_tcp +S 2:2", "DNS_NODES": "", "RLIMIT_NOFILE": "10000", "APP_NAME": "realtime",
            "SEED_SELF_HOST": "true", "RUN_JANITOR": "true", "DISABLE_HEALTHCHECK_LOGGING": "true", "LOG_LEVEL": "error", "ENABLE_ERL_CRASH_DUMP": "false", "ERL_CRASH_DUMP_SECONDS": "0", "ERL_CRASH_DUMP_BYTES": "0"},
        "storage": {"ANON_KEY": anon, "SERVICE_KEY": service, "POSTGREST_URL": "http://rest:3000", "AUTH_JWT_SECRET": secret, "DATABASE_URL": uri("supabase_storage_admin"),
            "STORAGE_PUBLIC_URL": "https://api-staging.ir35careers.com", "FILE_SIZE_LIMIT": "52428800", "STORAGE_BACKEND": "file", "GLOBAL_S3_BUCKET": "ir35-staging", "TENANT_ID": "ir35-staging",
            "FILE_STORAGE_BACKEND_PATH": "/var/lib/storage", "REGION": "uk-london-1", "ENABLE_IMAGE_TRANSFORMATION": "false", "DATABASE_MAX_CONNECTIONS": "5", "S3_PROTOCOL_ENABLED": "false", "LOG_LEVEL": "error"},
        "kong": {"KONG_DATABASE": "off", "KONG_PREFIX": "/run/kong", "KONG_DECLARATIVE_CONFIG": "/run/ir35/.env.kong-config.json", "KONG_ROUTER_FLAVOR": "expressions", "KONG_DNS_ORDER": "LAST,A,CNAME",
            "KONG_PLUGINS": "request-transformer,cors,key-auth,acl,request-termination", "KONG_PROXY_LISTEN": "0.0.0.0:8000", "KONG_ADMIN_LISTEN": "off",
            "KONG_PROXY_ACCESS_LOG": "off", "KONG_ADMIN_ACCESS_LOG": "off", "KONG_LOG_LEVEL": "crit", "KONG_NGINX_WORKER_PROCESSES": "1", "KONG_NGINX_PROXY_PROXY_BUFFER_SIZE": "160k", "KONG_NGINX_PROXY_PROXY_BUFFERS": "8 160k"},
        "meta": {"PG_META_PORT": "8080", "PG_META_DB_HOST": "db", "PG_META_DB_PORT": "5432", "PG_META_DB_NAME": "postgres", "PG_META_DB_USER": "postgres",
            "PG_META_DB_PASSWORD": password, "CRYPTO_KEY": values["PG_META_CRYPTO_KEY"], "PG_META_DB_CONNECTION_TIMEOUT": "10"},
        "studio": {"HOSTNAME": "0.0.0.0", "STUDIO_PG_META_URL": "http://meta:8080", "POSTGRES_HOST": "db", "POSTGRES_PORT": "5432", "POSTGRES_DB": "postgres", "POSTGRES_PASSWORD": password,
            "PG_META_CRYPTO_KEY": values["PG_META_CRYPTO_KEY"], "SUPABASE_URL": "http://kong:8000", "SUPABASE_PUBLIC_URL": "https://api-staging.ir35careers.com", "SUPABASE_ANON_KEY": anon,
            "SUPABASE_SERVICE_KEY": service, "AUTH_JWT_SECRET": secret, "DEFAULT_ORGANIZATION_NAME": "IR35 staging", "DEFAULT_PROJECT_NAME": "Oracle rehearsal", "ENABLED_FEATURES_LOGS_ALL": "false"},
        "smtp": {}, "caddy": {"ACME_CA": "https://acme-staging-v02.api.letsencrypt.org/directory", "STAGING_BASIC_HASH": values["STAGING_BASIC_HASH"], "STAGING_OWNER_IP": values["STAGING_OWNER_IP"]}}


def dc(*args, **kwargs):
    return run(["docker", "compose", "--env-file", str(ENV), "-f", str(ROOT / "compose.yml"), *args], **kwargs)


def diagnose_prepare(config):
    images = {}
    for name, image in config["images"].items():
        probe = subprocess.run(["docker", "image", "inspect", image["image"]], capture_output=True, timeout=10)
        images[name] = probe.returncode == 0
    metadata = {"status": "PASS", "imagesPresent": images, "envExists": ENV.exists(), "prepareMarkerExists": STATE.exists(), "composeExists": (ROOT / "compose.yml").exists()}
    if images["caddy"] and not ENV.exists():
        tests = []
        for attached in (False, True):
            args = ["docker", "run", "--rm", *(["-i"] if attached else []), "--network", "none", "--read-only", "--memory", "128m", "--entrypoint", "caddy", config["images"]["caddy"]["image"], "hash-password", "--algorithm", "bcrypt"]
            result = subprocess.run(args, input="public-synthetic-probe-not-a-credential\n", capture_output=True, text=True, timeout=60)
            tests.append({"stdinAttached": attached, "exitCode": result.returncode, "bcryptOutputShape": bool(re.fullmatch(r"\$2[aby]\$[0-9]{2}\$[A-Za-z0-9./]{53}", result.stdout.strip())),
                "inputReadError": any(token in result.stderr.lower() for token in ("eof", "reading password", "terminal"))})
        metadata["publicFixtureHashTests"] = tests
    return metadata


def diagnose_health(config):
    read_env()
    statuses = {}
    private = read_env()
    sensitive = [value for name, value in private.items() if any(word in name for word in ("PASSWORD", "SECRET", "KEY", "HASH")) and len(value) >= 16]
    for name in ("db", "smtp", "auth", "rest", "storage", "kong", "realtime", "meta"):
        identifier = dc("ps", "-a", "-q", name).strip()
        if not re.fullmatch(r"[a-f0-9]{64}", identifier):
            statuses[name] = {"state": "missing"}
            continue
        row = json.loads(run(["docker", "inspect", identifier]))[0]
        saved = "\n".join(row.get("Config", {}).get("Env", []))
        if any(value in saved for value in sensitive):
            raise RuntimeError("Private value in saved Docker environment; stop before further staging")
        health = row["State"].get("Health", {})
        output = "\n".join(entry.get("Output", "") for entry in health.get("Log", []))
        statuses[name] = {"state": row["State"]["Status"], "exitCode": row["State"].get("ExitCode"), "oomKilled": row["State"].get("OOMKilled"),
            "health": health.get("Status"), "restartCount": row.get("RestartCount"), "healthConnectionRefused": "connection refused" in output.lower(),
            "healthMissingExecutable": "executable file not found" in output.lower() or "no such file" in output.lower(),
            "healthLastExitCode": (health.get("Log") or [{}])[-1].get("ExitCode"), "healthErrorClass": classify_error(output),
            "healthReferences": [phrase for phrase in (".kong_env", "database", "prefix", "pg_host", "no file", "timeout", "supervisor", "not running", "admin_listen", "status_listen", "unsupported", "invalid") if phrase in output.lower()]}
        if name == "auth" and row["State"]["Status"] == "running":
            result = subprocess.run(["docker", "exec", identifier, "wget", "--quiet", "--tries=1", "--spider", "http://127.0.0.1:9999/health"], capture_output=True, timeout=10)
            statuses[name]["ipv4HealthExitCode"] = result.returncode
    return {"status": "PASS", "diagnostic": statuses, "privateValuesInDockerEnvironment": False, "rawLogsExported": False}


def classify_error(text):
    lower = text.lower()
    known = ("permission denied", "password authentication failed", "could not connect", "connection refused", "does not exist", "migration", "invalid jwt", "not writable", "configuration is invalid", "cannot find module")
    return {"classes": [name for name in known if name in lower], "sqlstates": sorted(set(re.findall(r"SQLSTATE[ :]+([A-Z0-9]{5})", text))),
        "knownRoles": [role for role in ("supabase_admin", "supabase_auth_admin", "authenticator", "supabase_storage_admin") if role in text],
        "knownPaths": [path for path in ("/usr/local/kong", "/app", "/run/ir35/.env.kong-config") if path in text]}


def quarantine_diagnose(config):
    # A failed initial startup must not keep retrying in background. Scope is
    # only this explicitly disposable, empty P3 project; no Caddy/worker/data copy.
    state = json.loads(STATE.read_text())
    if state.get("purpose") != "ir35-disposable-staging":
        raise RuntimeError("Staging identity mismatch")
    users = dc("exec", "-T", "db", "/run/ir35/env-exec", "/opt/ir35/.env.db", "psql", "-XqAt", "-v", "ON_ERROR_STOP=1", "-U", "supabase_admin", "-d", "postgres", "-c", "SELECT count(*) FROM auth.users").strip()
    if users != "0" or state.get("dataRehearsalStarted"):
        raise RuntimeError("Diagnostic restart requires empty disposable Auth; no action on copied data")
    names = ("auth", "rest", "storage", "kong", "realtime", "meta")
    dc("stop", *names, timeout=60)
    result = {}
    for name in ("auth", "storage", "kong", "realtime"):
        identifier = dc("ps", "-a", "-q", name).strip()
        row = json.loads(run(["docker", "inspect", identifier]))[0]
        if row.get("Config", {}).get("Labels", {}).get("com.docker.compose.project") != "ir35-staging" or row["Config"].get("Image") != config["images"][name]["image"]:
            raise RuntimeError("Container target mismatch; no diagnostic restart")
        run(["docker", "update", "--restart=no", identifier])
        output = ""
        exit_code = None
        try:
            captured = subprocess.run(["docker", "start", "--attach", identifier], capture_output=True, text=True, timeout=15)
            output = captured.stdout + "\n" + captured.stderr
            exit_code = captured.returncode
        except subprocess.TimeoutExpired as error:
            def text(value):
                return value.decode(errors="replace") if isinstance(value, bytes) else value or ""
            output = text(error.stdout) + "\n" + text(error.stderr)
        finally:
            run(["docker", "stop", identifier], timeout=20)
        result[name] = {"exitCode": exit_code, **classify_error(output)}
    return {"status": "PASS", "quarantinedServices": list(names), "backgroundRestartLoopsStopped": True, "diagnostic": result, "rawOutputStoredOrExported": False}


def database_metadata(config):
    # The newly initialized, isolated P3 database only. Never a cloud connection.
    if json.loads(STATE.read_text()).get("purpose") != "ir35-disposable-staging":
        raise RuntimeError("Disposable target identity required")
    sql = """SELECT json_build_object('roles',(SELECT json_agg(json_build_object('name',rolname,'login',rolcanlogin,'passwordSet',rolpassword IS NOT NULL)) FROM pg_authid WHERE rolname IN ('supabase_admin','postgres','supabase_auth_admin','authenticator','supabase_storage_admin')),
        'schemas',(SELECT json_agg(json_build_object('name',nspname,'owner',pg_get_userbyid(nspowner))) FROM pg_namespace WHERE nspname IN ('auth','storage','_realtime','public')),
        'databases',(SELECT json_agg(datname) FROM pg_database WHERE datname IN ('postgres','_supabase')),
        'authUserRows',(SELECT count(*) FROM auth.users));"""
    args = ["exec", "-T", "db", "/run/ir35/env-exec", "/opt/ir35/.env.db", "psql", "-XqAt", "-v", "ON_ERROR_STOP=1", "-U", "supabase_admin", "-d", "postgres", "-c", sql]
    metadata = json.loads(dc(*args))
    checks = {}
    for role in ("supabase_auth_admin", "authenticator", "supabase_storage_admin"):
        result = subprocess.run(["docker", "compose", "--env-file", str(ENV), "-f", str(ROOT / "compose.yml"), "exec", "-T", "db", "/run/ir35/env-exec", "/opt/ir35/.env.db", "psql", "-XqAt", "-h", "127.0.0.1", "-U", role, "-d", "postgres", "-c", "SELECT 1"], capture_output=True, text=True, timeout=15)
        checks[role] = {"loopbackConnectionCompleted": result.returncode == 0, "passwordAuthenticationProven": False, **classify_error(result.stderr)}
    return {"status": "PASS", "metadata": metadata, "freshRoleConnectionChecks": checks, "passwordHashesExported": False}


def diagnose_bootstrap(config):
    # Immutable public images only: no env, DB volume or service restart.
    scripts = {
        "db": "find /docker-entrypoint-initdb.d -maxdepth 3 -type f -print; sed -n '300,390p' /usr/local/bin/docker-entrypoint.sh",
        "kong": "id; ls -ld /usr/local/kong /tmp; sed -n '1,180p' /entrypoint.sh",
    }
    result = {}
    for name, script in scripts.items():
        output = run(["docker", "run", "--rm", "--network", "none", "--read-only", "--memory", "128m", "--log-driver", "none", "--entrypoint", "/bin/sh", config["images"][name]["image"], "-c", script])
        if len(output) > 24000:
            raise RuntimeError("Public image diagnostic exceeds bound")
        result[name] = output.splitlines()
    return {"status": "PASS", "publicImageCode": result, "secretMounts": 0, "serviceRestarts": 0}


def inspect_bootstrap_sql(config):
    script = "cat /docker-entrypoint-initdb.d/migrate.sh; grep -nE 'OWNER|GRANT|ALTER ROLE|ALTER USER|PGUSER|POSTGRES|psql|migrations|init-scripts' /docker-entrypoint-initdb.d/init-scripts/*.sql /docker-entrypoint-initdb.d/migrations/20211124212715_update-auth-owner.sql"
    output = run(["docker", "run", "--rm", "--network", "none", "--read-only", "--memory", "128m", "--log-driver", "none", "--entrypoint", "/bin/sh", config["images"]["db"]["image"], "-c", script])
    if len(output) > 30000:
        raise RuntimeError("Public bootstrap SQL inspection exceeds bound")
    # Synthetic Kong prefix test: no actual env/config/keys or service start.
    args = ["docker", "run", "--rm", "--network", "none", "--read-only", "--memory", "384m", "--log-driver", "none", "--user", "1002:1002",
        "--tmpfs", "/usr/local/kong:rw,uid=1002,gid=1002,mode=0700", "--tmpfs", "/tmp:rw,size=32m", "--env", "KONG_DATABASE=off", "--env", "KONG_ADMIN_LISTEN=off",
        "--entrypoint", "/bin/sh", config["images"]["kong"]["image"], "-c", "id; ls -ld /usr/local/kong; /entrypoint.sh kong prepare"]
    kong = subprocess.run(args, capture_output=True, text=True, timeout=45)
    fixture_output = kong.stdout + "\n" + kong.stderr
    if len(fixture_output) > 12000:
        raise RuntimeError("Synthetic Kong diagnostic exceeds bound")
    return {"status": "PASS", "publicBootstrapSQL": output.splitlines(), "syntheticKong": {"exitCode": kong.returncode, "publicOutput": fixture_output.splitlines()}, "secretMounts": 0, "serviceRestarts": 0}


def bootstrap_plan(config):
    if json.loads(STATE.read_text()).get("purpose") != "ir35-disposable-staging":
        raise RuntimeError("Disposable staging identity required")
    sql = """SELECT json_build_object(
      'authTables',(SELECT json_agg(json_build_object('name',c.relname,'owner',pg_get_userbyid(c.relowner))) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='auth' AND c.relkind='r'),
      'permissions',(SELECT json_agg(json_build_object('role',r,'schemaCreate',has_schema_privilege(r,'auth','CREATE'),'dbCreate',has_database_privilege(r,'postgres','CREATE'))) FROM unnest(ARRAY['supabase_auth_admin','supabase_storage_admin']) r),
      'roles',(SELECT json_agg(json_build_object('name',rolname,'superuser',rolsuper,'inherit',rolinherit)) FROM pg_roles WHERE rolname IN ('supabase_admin','postgres','supabase_auth_admin','supabase_storage_admin')),
      'installedExtensions',(SELECT json_agg(json_build_object('name',extname,'version',extversion)) FROM pg_extension),
      'hbaMethods',(SELECT json_agg(json_build_object('type',type,'method',auth_method)) FROM pg_hba_file_rules));"""
    metadata = json.loads(dc("exec", "-T", "db", "/run/ir35/env-exec", "/opt/ir35/.env.db", "psql", "-XqAt", "-v", "ON_ERROR_STOP=1", "-U", "supabase_admin", "-d", "postgres", "-c", sql))
    paths = ["/docker-entrypoint-initdb.d/init-scripts/00000000000000-initial-schema.sql", "/docker-entrypoint-initdb.d/init-scripts/00000000000002-storage-schema.sql", "/docker-entrypoint-initdb.d/migrations/20211115181400_update-auth-permissions.sql", "/docker-entrypoint-initdb.d/migrations/20211118015519_create-realtime-schema.sql", "/docker-entrypoint-initdb.d/migrations/20211124212715_update-auth-owner.sql"]
    output = dc("exec", "-T", "db", "cat", *paths)
    if len(output) > 24000:
        raise RuntimeError("Public bootstrap reference exceeds bound")
    return {"status": "PASS", "metadata": metadata, "publicReferenceSQL": output.splitlines(), "dataChanged": False}


def psql(sql=None, path=None, transaction=True, role="supabase_admin"):
    if role not in ("supabase_admin", "postgres"):
        raise RuntimeError("Fixed staging migration roles only")
    args = ["exec", "-T", "db", "/run/ir35/env-exec", "/opt/ir35/.env.db", "psql", "-XqAt", "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=sqlstate", "-U", role, "-d", "postgres"]
    if role == "postgres":
        # The image's local all/all peer rule cannot map root to postgres.
        # Use its existing loopback rule, never edit/weaken pg_hba.conf.
        args.extend(["-h", "127.0.0.1"])
    if transaction:
        args.append("--single-transaction")
    args.extend(["-f", path or "-"])
    # Even password-changing upstream SQL uses protected env/stdin, not -c.
    result = subprocess.run(["docker", "compose", "--env-file", str(ENV), "-f", str(ROOT / "compose.yml"), *args], input=sql, capture_output=True, text=True, timeout=90)
    if result.returncode:
        codes = sorted(set(re.findall(r"(?:ERROR|FATAL):\s+([A-Z0-9]{5})(?:\s|$)", result.stderr)))
        safe = sanitized_kong_error(result.stderr, read_env())
        raise RuntimeError("Empty staging bootstrap SQL failed; asset=" + (path or "public-stdin") + "; SQLSTATE=" + ",".join(codes) + "; redactedError=" + json.dumps(safe))
    return result.stdout


def assert_empty_staging():
    state = json.loads(STATE.read_text())
    if state.get("purpose") != "ir35-disposable-staging" or state.get("dataRehearsalStarted") or state.get("promotedToProduction"):
        raise RuntimeError("Empty disposable staging identity required; no bootstrap on copied/promoted data")
    for name in ("auth", "rest", "storage", "kong", "realtime", "meta"):
        identifier = dc("ps", "-a", "-q", name).strip()
        row = json.loads(run(["docker", "inspect", identifier]))[0]
        if row["State"]["Running"] or row.get("Config", {}).get("Labels", {}).get("com.docker.compose.project") != "ir35-staging":
            raise RuntimeError("Dependent services must be stopped before empty bootstrap repair")
    names = json.loads(psql("SELECT coalesce(json_agg(json_build_array(n.nspname,c.relname)), '[]') FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','auth','storage') AND c.relkind IN ('r','p') AND c.relname NOT IN ('schema_migrations','migrations');"))
    if len(names) > 200:
        raise RuntimeError("Unexpected staging relation inventory")
    for schema, table in names:
        identifier = '"' + schema.replace('"', '""') + '"."' + table.replace('"', '""') + '"'
        if psql("SELECT count(*) FROM " + identifier).strip() != "0":
            raise RuntimeError("Customer rows present; empty bootstrap repair refused")
    return state, len(names)


def repair_bootstrap(config):
    read_env()
    state, checked = assert_empty_staging()
    repair = state.setdefault("bootstrapRepair", {"steps": {}})
    # In-place completion only; never remove/reinitialize any data directory.
    write(CONFIG / "functions-role.sql", stack.FUNCTIONS_ROLE_SQL)
    def apply(name, body=None, path=None, transaction=True):
        source = body if body is not None else dc("exec", "-T", "db", "cat", path)
        digest = hashlib.sha256(source.encode()).hexdigest()
        previous = repair["steps"].get(name)
        if previous:
            if previous.get("sha256") != digest or previous.get("status") != "PASS":
                raise RuntimeError("Ambiguous/different bootstrap step; reconcile before retry: " + name)
            return
        repair["steps"][name] = {"sha256": digest, "status": "PENDING"}
        write(STATE, json.dumps(state), 0o600)
        psql(body, path, transaction)
        repair["steps"][name]["status"] = "PASS"
        write(STATE, json.dumps(state), 0o600)
    apply("functions-role", stack.FUNCTIONS_ROLE_SQL)
    apply("roles", path="/docker-entrypoint-initdb.d/init-scripts/99-roles.sql")
    apply("jwt", path="/docker-entrypoint-initdb.d/init-scripts/99-jwt.sql")
    files = dc("exec", "-T", "db", "find", "/docker-entrypoint-initdb.d/migrations", "-maxdepth", "1", "-type", "f", "-name", "*.sql").splitlines()
    if not 30 <= len(files) <= 100 or any(not re.fullmatch(r"/docker-entrypoint-initdb.d/migrations/[0-9][A-Za-z0-9_-]*\.sql", path) for path in files):
        raise RuntimeError("Unexpected pinned image migration inventory")
    for path in sorted(files):
        name = Path(path).name
        apply(name, path=path, transaction=name != "97-_supabase.sql")
    # Match upstream Storage schema access, absent in the interrupted target.
    apply("storage-schema-grant", "GRANT ALL ON SCHEMA storage TO supabase_storage_admin WITH GRANT OPTION;")
    repair["status"] = "PASS"
    write(STATE, json.dumps(state), 0o600)
    return {"status": "PASS", "emptyTablesChecked": checked, "steps": repair["steps"], "dataReinitialized": False, "customerRowsChanged": 0, "secretValuesExported": False}


def sanitized_kong_error(text, values):
    for key, value in values.items():
        if any(part in key for part in ("PASSWORD", "SECRET", "KEY", "HASH")) and len(value) >= 8:
            for encoded in (value, base64.b64encode(value.encode()).decode()):
                text = text.replace(encoded, "[REDACTED]")
    text = re.sub(r"[A-Za-z][A-Za-z0-9+.-]*://[^\s/@:]+:[^\s/@]+@", "[REDACTED-URI]@", text)
    text = re.sub(r"eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+", "[REDACTED-JWT]", text)
    text = re.sub(r"(?i)\b[a-f0-9]{32,}\b", "[REDACTED-HEX]", text)
    return text[:5000].splitlines()[:30]


def kong_preflight(config):
    values = read_env()
    # Prepare config only in a disposable private-network container; no ports
    # or server/ACME/DB start. Runtime secret values remain scoped file mounts.
    args = ["docker", "compose", "--env-file", str(ENV), "-f", str(ROOT / "compose.yml"), "run", "--rm", "--no-deps", "kong", "kong", "prepare"]
    result = subprocess.run(args, capture_output=True, text=True, timeout=60)
    return {"status": "PASS", "configurationValid": result.returncode == 0, "exitCode": result.returncode,
        "sanitizedError": sanitized_kong_error(result.stderr, values), "serverStarted": False, "secretValuesExported": False}


def kong_nginx_preflight(config):
    values = read_env()
    write(ROOT / "compose.yml", json.dumps(stack.compose(config["images"]), indent=2))
    write(ROOT / ".env.kong", env_text(component_env(values)["kong"]), 0o600, 1002)
    write(ROOT / ".env.kong-config.json", json.dumps(stack.kong_config(values["ANON_KEY"], values["SERVICE_ROLE_KEY"])), 0o600, 1002)
    script = "set -e; find /usr/local/kong/lib -maxdepth 1 -iname '*ada*' -print; kong config parse /run/ir35/.env.kong-config.json >/dev/null; kong prepare; ln -sfn /dev/stderr /run/kong/logs/error.log; /usr/local/openresty/nginx/sbin/nginx -t -p /run/kong -c nginx.conf"
    args = ["docker", "compose", "--env-file", str(ENV), "-f", str(ROOT / "compose.yml"), "run", "--rm", "--no-deps", "--entrypoint", "/run/ir35/env-exec", "kong", "/opt/ir35/.env.kong", "/bin/sh", "-c", script]
    result = subprocess.run(args, capture_output=True, text=True, timeout=60)
    return {"status": "PASS", "parseAndNginxValid": result.returncode == 0, "exitCode": result.returncode, "imageLibAdaVisible": "libada" in result.stdout,
        "sanitizedError": sanitized_kong_error(result.stderr, values), "serverStarted": False, "secretValuesExported": False}


def app_migrations(config):
    read_env()
    state = json.loads(STATE.read_text())
    if state.get("purpose") != "ir35-disposable-staging" or state.get("dataRehearsalStarted") or state.get("promotedToProduction"):
        raise RuntimeError("Repository migrations require disposable pre-rehearsal target")
    counts = psql("SELECT (SELECT count(*) FROM auth.users) + (SELECT count(*) FROM storage.objects);").strip()
    if counts != "0":
        raise RuntimeError("Copied/customer rows present; fresh migration path refused")
    ledger = state.setdefault("appMigrations", {})
    sources = stack.APP_MIGRATIONS
    if len(sources) != 25 or next(iter(sources)) != "supabase/waitlist.sql":
        raise RuntimeError("Reviewed legacy baseline and24 migrations required")
    if not ledger and psql("SELECT count(*) FROM pg_tables WHERE schemaname='public';").strip() != "0":
        raise RuntimeError("Unowned pre-existing application schema; no overlay")
    for name, source in sources.items():
        digest = hashlib.sha256(source.encode()).hexdigest()
        prior = ledger.get(name)
        if prior:
            if prior.get("status") != "PASS" or prior.get("sha256") != digest:
                raise RuntimeError("Ambiguous/different migration; reconcile first: " + name)
            continue
        ledger[name] = {"status": "PENDING", "sha256": digest}
        write(STATE, json.dumps(state), 0o600)
        try:
            psql(source, role="postgres")
        except RuntimeError as error:
            raise RuntimeError("Repository migration " + name + " failed: " + str(error)) from None
        ledger[name]["status"] = "PASS"
        write(STATE, json.dumps(state), 0o600)
    disabled = json.loads(psql("SELECT coalesce(json_agg(c.relname), '[]') FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p') AND NOT c.relrowsecurity;"))
    if disabled:
        raise RuntimeError("Public table RLS disabled after migration; no automatic weakening/repair")
    psql("NOTIFY pgrst, 'reload schema';")
    return {"status": "PASS", "baselineFiles": 1, "orderedMigrationFiles": len(sources) - 1, "migrations": ledger, "publicTablesWithoutRLS": disabled, "customerRowsImported": 0, "sourceCloudChanged": False}


def migration_diagnose(config):
    state = json.loads(STATE.read_text())
    if state.get("purpose") != "ir35-disposable-staging" or state.get("dataRehearsalStarted"):
        raise RuntimeError("Disposable pre-rehearsal target required")
    metadata = json.loads(psql("SELECT json_build_object('publicTables',(SELECT coalesce(json_agg(tablename),'[]') FROM pg_tables WHERE schemaname='public'),'authUsers',(SELECT count(*) FROM auth.users),'postgresRole',(SELECT rolcanlogin FROM pg_roles WHERE rolname='postgres'));"))
    loopback = psql("SELECT current_user;", role="postgres").strip() == "postgres"
    return {"status": "PASS", "appMigrations": state.get("appMigrations", {}), "metadata": metadata, "postgresLoopbackConnection": loopback, "hbaChanged": False}


def schema_gate(config):
    state = json.loads(STATE.read_text())
    if state.get("purpose") != "ir35-disposable-staging" or state.get("dataRehearsalStarted") or state.get("promotedToProduction"):
        raise RuntimeError("Schema gate requires disposable pre-rehearsal target")
    ledger = state.get("appMigrations", {})
    if set(ledger) != set(stack.APP_MIGRATIONS) or any(row.get("status") != "PASS" for row in ledger.values()):
        raise RuntimeError("All reviewed migrations must PASS before schema catalog retrieval")
    catalog = json.loads(psql(stack.SCHEMA_GATE_SQL, transaction=False))
    if not isinstance(catalog, dict) or not isinstance(catalog.get("objects"), list):
        raise RuntimeError("Schema catalog result invalid; no raw output")
    # PASS means read-only retrieval only, never schema equivalence.
    return {"status": "PASS", "schemaCatalog": catalog, "readOnly": True, "parityVerified": False}


def repair_env_binds(config):
    state = json.loads(STATE.read_text())
    if state.get("purpose") != "ir35-disposable-staging" or state.get("dataRehearsalStarted") or state.get("promotedToProduction"):
        raise RuntimeError("Env bind reconciliation limited to disposable pre-rehearsal staging")
    # Existing loopback admin rule: read-only guard, no password/HBA changes.
    if dc("exec", "-T", "db", "psql", "-XqAt", "-w", "-h", "127.0.0.1", "-U", "supabase_admin", "-d", "postgres", "-c", "SELECT count(*) FROM auth.users;").strip() != "0":
        raise RuntimeError("Customer Auth rows present; no automatic bind repair")
    evidence = {}
    for name in ("db", "smtp", "auth", "rest", "storage", "kong", "realtime", "meta", "caddy"):
        identifier = dc("ps", "-a", "-q", name).strip()
        row = json.loads(run(["docker", "inspect", identifier]))[0]
        if row["Config"].get("Image") != config["images"][name]["image"] or row["Config"].get("Labels", {}).get("com.docker.compose.project") != "ir35-staging" or not row["State"]["Running"]:
            raise RuntimeError("Running exact staging container required for bind reconciliation: " + name)
        pid = row["State"]["Pid"]
        path = ROOT / (".env." + name)
        host = path.stat()
        mounted = (Path("/proc") / str(pid) / "root" / path.relative_to("/")).stat()
        if host.st_uid != 1002 or stat.S_IMODE(host.st_mode) != 0o600 or host.st_nlink != 1:
            raise RuntimeError("Protected env source custody mismatch")
        different = (host.st_dev, host.st_ino) != (mounted.st_dev, mounted.st_ino)
        evidence[name] = {"staleBind": different, "mountedLinkCount": mounted.st_nlink, "sourceMode": "600", "sourceOwnerUID": 1002}
        if different:
            if mounted.st_nlink != 0:
                raise RuntimeError("Ambiguous env bind difference, not the diagnosed atomic-replace bug")
            dc("restart", "--timeout", "60", name, timeout=90)
            current = json.loads(run(["docker", "inspect", identifier]))[0]
            fresh = (Path("/proc") / str(current["State"]["Pid"]) / "root" / path.relative_to("/")).stat()
            if (fresh.st_dev, fresh.st_ino, fresh.st_nlink) != (host.st_dev, host.st_ino, 1):
                raise RuntimeError("Staging env bind did not reconcile after one targeted restart")
            evidence[name]["reattachedCurrentInode"] = True
    # Wait for fresh health results, not an immediately retained old status.
    time.sleep(35)
    statuses = wait_healthy(tuple(evidence), 180)
    return {"status": "PASS", "binds": evidence, "services": statuses, "fullStartupAttemptsReset": False, "envValuesChanged": False, "productionChanged": False}


def runtime_audit(config):
    values = read_env()
    services = {}
    realtime = None
    for name in ("db", "smtp", "auth", "rest", "storage", "kong", "realtime", "meta", "caddy"):
        identifier = dc("ps", "-a", "-q", name).strip()
        row = json.loads(run(["docker", "inspect", identifier]))[0]
        if row["Config"].get("Image") != config["images"][name]["image"]:
            raise RuntimeError("Unexpected staging image in runtime audit")
        health = row["State"].get("Health", {})
        last = (health.get("Log") or [{}])[-1]
        record = {"running": row["State"]["Running"], "health": health.get("Status"), "oomKilled": row["State"].get("OOMKilled"), "lastHealthExitCode": last.get("ExitCode"),
            "healthError": sanitized_kong_error(last.get("Output", ""), values)}
        if row["State"]["Running"]:
            path = ROOT / (".env." + name)
            mounted = (Path("/proc") / str(row["State"]["Pid"]) / "root" / path.relative_to("/")).stat()
            source = path.stat()
            record["currentEnvBind"] = (source.st_dev, source.st_ino, 1) == (mounted.st_dev, mounted.st_ino, mounted.st_nlink)
        services[name] = record
        if name == "realtime":
            realtime = row
    result = realtime_probe(realtime, values)
    healthy = all(row["running"] and row.get("currentEnvBind") and row["health"] in (None, "healthy") for row in services.values()) and result["statusCode"] == 200
    baseline = json.loads(psql("SELECT json_build_object('publicTableCount',(SELECT count(*) FROM pg_tables WHERE schemaname='public'),'authUserRows',(SELECT count(*) FROM auth.users));"))
    return {"status": "PASS", "runtimeHealthy": healthy, "services": services, "realtimeHealth": result, "migrationBaseline": baseline, "appMigrations": json.loads(STATE.read_text()).get("appMigrations", {}), "credentialValuesExported": False, "mutations": 0}


def realtime_probe(row, values):
    ip = row.get("NetworkSettings", {}).get("Networks", {}).get("ir35-staging_backend", {}).get("IPAddress")
    if not row["State"]["Running"] or not ip:
        return {"statusCode": 0, "transportUnavailable": True}
    if not ipaddress.ip_address(ip).is_private:
        raise RuntimeError("Private backend IP required")
    request = urllib.request.Request("http://" + ip + ":4000/api/tenants/realtime-dev/health", headers={"Authorization": "Bearer " + values["ANON_KEY"]})
    try:
        response = urllib.request.urlopen(request, timeout=10)
    except urllib.error.HTTPError as error:
        response = error
    except (urllib.error.URLError, OSError):
        response = None
    if response is None:
        result = {"statusCode": 0, "transportUnavailable": True}
    else:
        with response:
            body = response.read(8001)
            if len(body) > 8000:
                raise RuntimeError("Health response exceeds bound")
            result = {"statusCode": response.status, "redactedResponse": sanitized_kong_error(body.decode(), values)}
    return result


def recover_realtime(config):
    values = read_env()
    state = json.loads(STATE.read_text())
    if state.get("purpose") != "ir35-disposable-staging" or state.get("dataRehearsalStarted") or state.get("promotedToProduction"):
        raise RuntimeError("Realtime recovery limited to pre-rehearsal staging")
    if psql("SELECT count(*) FROM auth.users;").strip() != "0":
        raise RuntimeError("Customer Auth rows present; no automatic recovery")
    wait_healthy(("db",), 120)
    identifier = dc("ps", "-a", "-q", "realtime").strip()
    row = json.loads(run(["docker", "inspect", identifier]))[0]
    if row["Config"].get("Image") != config["images"]["realtime"]["image"] or row["Config"].get("Labels", {}).get("com.docker.compose.project") != "ir35-staging" or row["State"].get("OOMKilled"):
        raise RuntimeError("Exact non-OOM staging Realtime required; no recreation")
    attempted = state.get("realtimeRecovery")
    if not row["State"]["Running"]:
        if attempted or row["State"]["ExitCode"] not in (0, 1):
            raise RuntimeError("Unexpected/repeated Realtime exit; no blind restart")
        # Exit1 was independently observed after the controlled DB restart,
        # with no OOM/automatic restart. Permit one recorded recovery only,
        # after DB health; capture any new startup failure without persisting it.
        write(ROOT / ".env.realtime", env_text(component_env(values)["realtime"]), 0o600, 1002)
        state["realtimeRecovery"] = {"containerId": identifier, "status": "PENDING"}
        write(STATE, json.dumps(state), 0o600)
        # One existing-container start after DB health, with startup output in
        # RAM only. Killing the attach client on timeout does not stop server.
        try:
            process = subprocess.run(["docker", "start", "--attach", identifier], capture_output=True, text=True, timeout=20)
            if process.returncode:
                raise RuntimeError("Realtime recovery exit=" + str(process.returncode) + "; redacted=" + json.dumps(sanitized_kong_error(process.stderr, values)))
        except subprocess.TimeoutExpired:
            pass
    wait_healthy(("realtime",), 180)
    result = runtime_audit(config)
    if result["runtimeHealthy"] is not True:
        raise RuntimeError("Realtime recovery did not prove current runtime health")
    state["realtimeRecovery"] = {"containerId": identifier, "status": "PASS"}
    write(STATE, json.dumps(state), 0o600)
    result["existingContainerOnly"] = True
    result["fullStartupAttemptsReset"] = False
    return result


def realtime_exit_diagnose(config):
    identifier = dc("ps", "-a", "-q", "realtime").strip()
    row = json.loads(run(["docker", "inspect", identifier]))[0]
    if row["Config"].get("Image") != config["images"]["realtime"]["image"]:
        raise RuntimeError("Pinned staging Realtime image required")
    state = row["State"]
    raw = run(["docker", "events", "--since", "24h", "--until", str(int(time.time())), "--filter", "container=" + identifier, "--format", "{{json .}}"], timeout=15)
    events = []
    for line in raw.splitlines():
        event = json.loads(line)
        if event.get("Action") in ("start", "stop", "die", "kill", "restart", "oom"):
            attributes = event.get("Actor", {}).get("Attributes", {})
            events.append({"time": event.get("time"), "action": event["Action"], "exitCode": attributes.get("exitCode"), "signal": attributes.get("signal")})
    public = run(["docker", "run", "--rm", "--network", "none", "--read-only", "--memory", "128m", "--log-driver", "none", "--entrypoint", "/bin/sh", config["images"]["realtime"]["image"], "-c", "cat /app/run.sh; ls -ld /app /app/bin /app/releases /app/lib"])
    return {"status": "PASS", "containerState": {key: state.get(key) for key in ("Status", "Running", "ExitCode", "OOMKilled", "StartedAt", "FinishedAt")},
        "exitEvents": events[-20:], "immutablePublicEntrypoint": public.splitlines(), "restartCount": row.get("RestartCount"), "mutations": 0}


def prerequisites(config):
    if os.geteuid() != 0 or os.uname().machine != "aarch64" or pwd.getpwnam("ir35").pw_uid != 1002:
        raise RuntimeError("Exact hardened ARM guest/ir35 identity required")
    if run(["findmnt", "-n", "-o", "UUID,FSTYPE,TARGET", "--mountpoint", str(ROOT / "data")]).split() != [config["uuid"], "ext4", str(ROOT / "data")]:
        raise RuntimeError("Data mount mismatch")
    owner = ipaddress.ip_network(config["ownerCIDR"], strict=True)
    if owner.prefixlen != 32 or owner.version != 4 or not owner.network_address.is_global:
        raise RuntimeError("Exact owner IPv4 /32 required")
    if config["upstreamCommit"] != stack.UPSTREAM or set(config["images"]) != set(stack.compose(config["images"])["services"]):
        raise RuntimeError("Reviewed upstream/service set required")
    for image in config["images"].values():
        if not re.fullmatch(r"[a-z0-9/_-]+:[A-Za-z0-9_.-]+@sha256:[0-9a-f]{64}", image["image"]) or image["platform"] != "linux/arm64":
            raise RuntimeError("Pinned native ARM service image required")


def install_launcher(config):
    if not ENV.exists() or not STATE.exists():
        raise RuntimeError("Prepared VM-only env required before launcher install")
    read_env()
    if not shutil.which("gcc"):
        run(["apt-get", "update", "-q"], timeout=180)
        run(["apt-get", "install", "-y", "--no-install-recommends", "gcc", "libc6-dev"], timeout=300)
    source = CONFIG / "env-exec.c"
    write(source, config["launcherSource"])
    directory = ROOT / "bin"
    directory.mkdir(mode=0o755, exist_ok=True)
    output = directory / "env-exec"
    run(["gcc", "-static", "-Os", "-Wall", "-Wextra", "-Werror", "-fstack-protector-strong", str(source), "-o", str(output)], timeout=120)
    os.chmod(output, 0o755)
    # Only public command/mount metadata. Env values stay in protected files.
    write(ROOT / "compose.yml", json.dumps(stack.compose(config["images"]), indent=2))
    os.chown(ROOT / "data/storage", 1002, 1002)
    dc("config", "--quiet")
    state = json.loads(STATE.read_text())
    state["stages"]["install-launcher"] = "PASS"
    write(STATE, json.dumps(state), 0o600)
    return {"status": "PASS", "staticNativeLauncher": True, "dockerSecretEnvValues": False, "envFileMode": "600", "runtimeValuesLogged": False}


def prepare(config):
    CONFIG.mkdir(mode=0o755, exist_ok=True)
    if not STATE.exists():
        if ENV.exists() or (ROOT / "data/postgres/PG_VERSION").exists():
            raise RuntimeError("Unowned existing env/database; no overwrite")
        write(STATE, json.dumps({"purpose": "ir35-disposable-staging", "upstreamCommit": config["upstreamCommit"], "stages": {}}), 0o600)
    state = json.loads(STATE.read_text())
    if state.get("purpose") != "ir35-disposable-staging" or state.get("upstreamCommit") != config["upstreamCommit"]:
        raise RuntimeError("Existing staging identity differs")
    for name, image in config["images"].items():
        if name != "studio":
            run(["docker", "pull", "--platform", "linux/arm64", image["image"]], timeout=1200)
    if not ENV.exists():
        random = lambda size=32: run(["openssl", "rand", "-hex", str(size)]).strip()
        secret = random()
        basic = random(24)
        hashed = run(hash_password_args(config["images"]["caddy"]["image"]), input=basic + "\n").strip()
        if not re.fullmatch(r"\$2[aby]\$[0-9]{2}\$[A-Za-z0-9./]{53}", hashed):
            raise RuntimeError("Caddy stdin password hashing failed; no values printed")
        values = {"POSTGRES_PASSWORD": random(), "JWT_SECRET": secret, "ANON_KEY": jwt(secret, "anon"), "SERVICE_ROLE_KEY": jwt(secret, "service_role"),
            "PGSODIUM_ROOT_KEY": random(), "SECRET_KEY_BASE": random(64), "REALTIME_DB_ENC_KEY": random(8), "PG_META_CRYPTO_KEY": random(),
            "STAGING_BASIC_PASSWORD": basic, "STAGING_BASIC_HASH": hashed, "STAGING_OWNER_IP": config["ownerCIDR"], "APPLY_RUNNER": "mock", "APPLICATION_WORKER_ACCEPT_JOBS": "false"}
        write(ENV, env_text(values), 0o600, 1002)
    values = read_env()
    if values["STAGING_OWNER_IP"] != config["ownerCIDR"]:
        raise RuntimeError("Owner access source changed; no automatic env overwrite")
    components = component_env(values)
    if (ROOT / ".env.caddy").exists():
        current = (ROOT / ".env.caddy").read_text()
        if "https://acme-v02.api.letsencrypt.org/directory" in current:
            components["caddy"]["ACME_CA"] = "https://acme-v02.api.letsencrypt.org/directory"
    for name, environment in components.items():
        write(ROOT / (".env." + name), env_text(environment), 0o600, 1002)
    write(ROOT / ".env.kong-config.json", json.dumps(stack.kong_config(values["ANON_KEY"], values["SERVICE_ROLE_KEY"])), 0o600, 1002)
    for name in stack.SQL_FILES:
        write(CONFIG / name, config["sql"][name])
    write(CONFIG / "functions-role.sql", stack.FUNCTIONS_ROLE_SQL)
    write(CONFIG / "pgsodium-env-key.sh", stack.GETKEY, 0o755)
    write(CONFIG / "Caddyfile", stack.CADDYFILE)
    write(ROOT / "compose.yml", json.dumps(stack.compose(config["images"]), indent=2))
    for name in ("caddy", "postgres", "storage"):
        path = ROOT / "data" / name
        if path.is_symlink():
            raise RuntimeError("Unsafe data directory")
        path.mkdir(mode=0o700, exist_ok=True)
        if name == "caddy":
            os.chown(path, 1002, 1002)
            os.chmod(path, 0o700)
    dc("config", "--quiet")
    state["stages"]["prepare"] = "PASS"
    write(STATE, json.dumps(state), 0o600)
    return {"status": "PASS", "secretPaths": ["/opt/ir35/.env*"], "secretMode": "600", "secretOwner": "ir35", "caddyState": {"path": "/opt/ir35/data/caddy", "directoryMode": "700", "ownerUID": 1002, "excludedFromBackups": True},
        "services": list(stack.compose(config["images"])["services"]), "studioProfile": "off", "publicBindings": [80, 443], "certificateRequests": 0, "APPLY_RUNNER": "mock", "APPLICATION_WORKER_ACCEPT_JOBS": False}


def internal_up(config):
    values = read_env()
    for name, environment in component_env(values).items():
        if name != "caddy":
            write(ROOT / (".env." + name), env_text(environment), 0o600, 1002)
    write(ROOT / ".env.realtime-health-header", "Authorization: Bearer " + values["ANON_KEY"] + "\n", 0o600, 1002)
    state = json.loads(STATE.read_text())
    if state.get("stages", {}).get("install-launcher") != "PASS" or state.get("bootstrapRepair", {}).get("status") != "PASS":
        raise RuntimeError("Protected runtime environment launcher must PASS first")
    # Re-render the current reviewed public metadata just before first launch;
    # never resolve private values into Docker's Env or the public manifest.
    write(ROOT / "compose.yml", json.dumps(stack.compose(config["images"]), indent=2))
    dc("config", "--quiet")
    dc("up", "-d", "db", "smtp", timeout=240)
    wait_healthy(("db", "smtp"), 180)
    try:
        dc("up", "-d", "auth", "rest", "storage", "kong", "realtime", "meta", timeout=240)
        statuses = wait_healthy(("db", "smtp", "auth", "rest", "storage", "kong", "realtime", "meta"), 240)
    except Exception:
        dc("stop", "auth", "rest", "storage", "kong", "realtime", "meta", timeout=60)
        raise
    return {"status": "PASS", "services": statuses, "publicContainersStarted": False, "studioStarted": False, "smtpNetworkInternal": True, "certificateRequests": 0}


def wait_healthy(names, timeout):
    started = time.monotonic()
    while time.monotonic() - started < timeout:
        statuses = {}
        for name in names:
            identifier = dc("ps", "-a", "-q", name).strip()
            if not re.fullmatch(r"[a-f0-9]{64}", identifier):
                raise RuntimeError("Missing/ambiguous staging service: " + name)
            row = json.loads(run(["docker", "inspect", identifier]))[0]
            statuses[name] = row["State"].get("Health", {}).get("Status", row["State"]["Status"])
            if statuses[name] in ("unhealthy", "exited", "dead"):
                raise RuntimeError("Staging service not healthy: " + name + "; status=" + statuses[name] + "; logs withheld")
        if all(value in ("healthy", "running") for value in statuses.values()):
            return statuses
        time.sleep(5)
    raise RuntimeError("Staging health timeout; no production fallback")


def validate_caddy(config):
    # Adapt only, no network or persisted Docker stdout: adapted JSON contains
    # the private bcrypt hash, so it is captured in RAM with log-driver none.
    write(CONFIG / "Caddyfile", stack.CADDYFILE)
    args = ["docker", "run", "--rm", "--network", "none", "--read-only", "--memory", "128m", "--user", "1002:1002", "--log-driver", "none",
        "--volume", "/opt/ir35/bin/env-exec:/run/ir35/env-exec:ro", "--volume", "/opt/ir35/.env.caddy:/opt/ir35/.env.caddy:ro", "--volume", "/opt/ir35/config/Caddyfile:/etc/caddy/Caddyfile:ro",
        "--entrypoint", "/run/ir35/env-exec", config["images"]["caddy"]["image"], "/opt/ir35/.env.caddy", "caddy", "adapt", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]
    parsed = json.loads(run(args))
    if parsed.get("admin", {}).get("disabled") is not True or parsed.get("admin", {}).get("config", {}).get("persist") is not False:
        raise RuntimeError("Caddy admin/autosave must be disabled")
    text = json.dumps(parsed)
    if "acme-staging-v02.api.letsencrypt.org/directory" not in text and "acme-v02.api.letsencrypt.org/directory" not in text:
        raise RuntimeError("Only Let's Encrypt issuer allowed")
    if "ZeroSSL" in text or "noindex, nofollow, noarchive" not in text or "http_basic" not in text:
        raise RuntimeError("Caddy staging protection/issuer mismatch")
    return {"status": "PASS", "adminDisabled": True, "autosaveDisabled": True, "basicAuth": True, "noindex": True, "certificateRequests": 0}


def caddy_permissions():
    root = ROOT / "data/caddy"
    directories, files = 0, 0
    for directory, subdirs, names in os.walk(root, followlinks=False):
        for path in [Path(directory), *[Path(directory) / name for name in subdirs]]:
            if path.is_symlink():
                raise RuntimeError("Unexpected symlink in Caddy private state")
            os.chown(path, 1002, 1002)
            os.chmod(path, 0o700)
        directories += 1
        for name in names:
            path = Path(directory) / name
            observed = path.lstat()
            if not stat.S_ISREG(observed.st_mode) or observed.st_nlink != 1:
                raise RuntimeError("Unsafe Caddy private state file")
            os.chown(path, 1002, 1002)
            os.chmod(path, 0o600)
            files += 1
    return {"path": "/opt/ir35/data/caddy", "directories": directories, "files": files, "directoryMode": "700", "fileMode": "600", "ownerUID": 1002, "backupExcluded": True}


def tls_request(host, path, trusted, headers=None):
    if host not in ("staging.ir35careers.com", "api-staging.ir35careers.com"):
        raise RuntimeError("Staging hosts only")
    # No credentials ever sent using the untrusted staging-CA context.
    if headers and not trusted:
        raise RuntimeError("Never send credentials through untrusted staging TLS")
    context = ssl.create_default_context() if trusted else ssl._create_unverified_context()
    with socket.create_connection(("127.0.0.1", 443), timeout=8) as raw:
        with context.wrap_socket(raw, server_hostname=host) as connection:
            certificate = connection.getpeercert(binary_form=True)
            # openssl consumes public DER through stdin, never a private key.
            observed = subprocess.run(["openssl", "x509", "-inform", "DER", "-noout", "-issuer", "-ext", "subjectAltName"], input=certificate, capture_output=True, timeout=5)
            public = observed.stdout.decode()
            if observed.returncode or ("DNS:" + host) not in public or (not trusted and "STAGING" not in public):
                raise RuntimeError("Staging certificate identity/issuer mismatch")
            request = "GET " + path + " HTTP/1.1\r\nHost: " + host + "\r\nConnection: close\r\n"
            request += "".join(name + ": " + value + "\r\n" for name, value in (headers or {}).items())
            connection.sendall((request + "\r\n").encode())
            response = b""
            while b"\r\n\r\n" not in response and len(response) <= 32768:
                part = connection.recv(8192)
                if not part:
                    break
                response += part
            head = response.split(b"\r\n\r\n", 1)[0].decode("latin1")
            status = int(head.split(" ", 2)[1])
            return {"status": status, "noindex": "x-robots-tag: noindex" in head.lower(), "issuer": "trusted" if trusted else "letsencrypt-staging"}


def acme(config, trusted):
    state = json.loads(STATE.read_text())
    if trusted and state.get("stages", {}).get("acme-staging") != "PASS":
        raise RuntimeError("Staging-CA HTTP-01 must PASS before trusted issuance")
    values = read_env()
    caddy = component_env(values)["caddy"]
    caddy["ACME_CA"] = "https://acme-v02.api.letsencrypt.org/directory" if trusted else "https://acme-staging-v02.api.letsencrypt.org/directory"
    write(ROOT / ".env.caddy", env_text(caddy), 0o600, 1002)
    validate_caddy(config)
    dc("up", "-d", "--no-deps", "--force-recreate", "caddy", timeout=60)
    started = time.monotonic()
    try:
        while True:
            try:
                app = tls_request("staging.ir35careers.com", "/", trusted)
                api = tls_request("api-staging.ir35careers.com", "/auth/v1/settings", trusted)
                if app != {"status": 401, "noindex": True, "issuer": "trusted" if trusted else "letsencrypt-staging"} or api["status"] != 401 or not api["noindex"]:
                    raise RuntimeError("Staging Basic/API protection mismatch")
                break
            except (OSError, ssl.SSLError):
                if time.monotonic() - started >= 180:
                    raise RuntimeError("ACME issuance/HTTP-01 not proven within180s; Caddy stopped")
                time.sleep(5)
        if trusted:
            basic = base64.b64encode(("ir35:" + values["STAGING_BASIC_PASSWORD"]).encode()).decode()
            app_auth = tls_request("staging.ir35careers.com", "/", True, {"Authorization": "Basic " + basic})
            if app_auth["status"] != 503 or not app_auth["noindex"]:
                raise RuntimeError("Authenticated setup placeholder must remain503/noindex")
            api_auth = tls_request("api-staging.ir35careers.com", "/auth/v1/health", True, {"X-Staging-Authorization": "Basic " + basic, "apikey": values["ANON_KEY"], "Authorization": "Bearer " + values["ANON_KEY"]})
            if api_auth["status"] != 200 or not api_auth["noindex"]:
                raise RuntimeError("Trusted authenticated staging Auth health failed")
        permissions = caddy_permissions()
        state["stages"]["acme-trusted" if trusted else "acme-staging"] = "PASS"
        write(STATE, json.dumps(state), 0o600)
        return {"status": "PASS", "issuer": "letsencrypt-trusted" if trusted else "letsencrypt-staging", "http01Only": True, "appUnauthenticated": app["status"], "apiNoKey": api["status"], "noindex": True, "privateState": permissions}
    except Exception:
        dc("stop", "caddy")
        caddy_permissions()
        raise


def main():
    if len(sys.argv) != 3 or sys.argv[1] not in ("prepare", "install-launcher", "internal-up", "validate-caddy", "acme-staging", "acme-trusted", "diagnose-prepare", "diagnose-health", "quarantine-diagnose", "database-metadata", "diagnose-bootstrap", "inspect-bootstrap-sql", "bootstrap-plan", "repair-bootstrap", "kong-preflight", "kong-nginx-preflight", "app-migrations", "migration-diagnose", "repair-env-binds", "runtime-audit", "realtime-recovery", "realtime-exit-diagnose", "schema-gate"):
        raise RuntimeError("Fixed staging prepare/internal-up only")
    config = json.loads(sys.argv[2])
    prerequisites(config)
    operations = {"prepare": lambda: prepare(config), "install-launcher": lambda: install_launcher(config), "internal-up": lambda: internal_up(config), "validate-caddy": lambda: validate_caddy(config),
        "acme-staging": lambda: acme(config, False), "acme-trusted": lambda: acme(config, True), "diagnose-prepare": lambda: diagnose_prepare(config), "diagnose-health": lambda: diagnose_health(config), "quarantine-diagnose": lambda: quarantine_diagnose(config), "database-metadata": lambda: database_metadata(config), "diagnose-bootstrap": lambda: diagnose_bootstrap(config), "inspect-bootstrap-sql": lambda: inspect_bootstrap_sql(config), "bootstrap-plan": lambda: bootstrap_plan(config), "repair-bootstrap": lambda: repair_bootstrap(config), "kong-preflight": lambda: kong_preflight(config), "kong-nginx-preflight": lambda: kong_nginx_preflight(config), "app-migrations": lambda: app_migrations(config), "migration-diagnose": lambda: migration_diagnose(config), "repair-env-binds": lambda: repair_env_binds(config), "runtime-audit": lambda: runtime_audit(config), "realtime-recovery": lambda: recover_realtime(config), "realtime-exit-diagnose": lambda: realtime_exit_diagnose(config)}
    operations["schema-gate"] = lambda: schema_gate(config)
    result = operations[sys.argv[1]]()
    print(json.dumps(result))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        trace = error.__traceback__
        while trace.tb_next:
            trace = trace.tb_next
        public_location = type(error).__name__ + ":" + trace.tb_frame.f_code.co_name + ":" + str(trace.tb_lineno)
        print(json.dumps({"error": str(error) if isinstance(error, RuntimeError) else "Staging helper failed; location=" + public_location + "; raw output suppressed"}))
        raise SystemExit(1)
