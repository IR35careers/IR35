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
            "PGRST_JWT_SECRET": secret, "PGRST_DB_USE_LEGACY_GUCS": "false", "PGRST_APP_SETTINGS_JWT_EXP": "3600", "PGRST_ADMIN_SERVER_PORT": "3001", "PGRST_ADMIN_SERVER_HOST": "localhost", "PGRST_LOG_LEVEL": "crit"},
        "realtime": {"PORT": "4000", "DB_HOST": "db", "DB_PORT": "5432", "DB_USER": "supabase_admin", "DB_PASSWORD": password, "DB_NAME": "postgres", "DB_POOL_SIZE": "5",
            "DB_AFTER_CONNECT_QUERY": "SET search_path TO _realtime", "DB_ENC_KEY": values["REALTIME_DB_ENC_KEY"], "API_JWT_SECRET": secret, "SECRET_KEY_BASE": values["SECRET_KEY_BASE"],
            "METRICS_JWT_SECRET": secret, "HEALTHCHECK_ANON_KEY": anon, "ERL_AFLAGS": "-proto_dist inet_tcp +S 2:2", "DNS_NODES": "", "RLIMIT_NOFILE": "10000", "APP_NAME": "realtime",
            "SEED_SELF_HOST": "true", "RUN_JANITOR": "true", "DISABLE_HEALTHCHECK_LOGGING": "true", "LOG_LEVEL": "error"},
        "storage": {"ANON_KEY": anon, "SERVICE_KEY": service, "POSTGREST_URL": "http://rest:3000", "AUTH_JWT_SECRET": secret, "DATABASE_URL": uri("supabase_storage_admin"),
            "STORAGE_PUBLIC_URL": "https://api-staging.ir35careers.com", "FILE_SIZE_LIMIT": "52428800", "STORAGE_BACKEND": "file", "GLOBAL_S3_BUCKET": "ir35-staging", "TENANT_ID": "ir35-staging",
            "FILE_STORAGE_BACKEND_PATH": "/var/lib/storage", "REGION": "uk-london-1", "ENABLE_IMAGE_TRANSFORMATION": "false", "DATABASE_MAX_CONNECTIONS": "5", "S3_PROTOCOL_ENABLED": "false", "LOG_LEVEL": "error"},
        "kong": {"KONG_DATABASE": "off", "KONG_DECLARATIVE_CONFIG": "/run/ir35/.env.kong-config", "KONG_ROUTER_FLAVOR": "expressions", "KONG_DNS_ORDER": "LAST,A,CNAME",
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
            "healthMissingExecutable": "executable file not found" in output.lower() or "no such file" in output.lower()}
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
    write(ROOT / ".env.kong-config", json.dumps(stack.kong_config(values["ANON_KEY"], values["SERVICE_ROLE_KEY"])), 0o600, 1002)
    for name in stack.SQL_FILES:
        write(CONFIG / name, config["sql"][name])
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
    write(ROOT / ".env.realtime-health-header", "Authorization: Bearer " + values["ANON_KEY"] + "\n", 0o600, 1002)
    if json.loads(STATE.read_text()).get("stages", {}).get("install-launcher") != "PASS":
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


def validate_caddy():
    # Adapt only: no --validate/provisioning, no server or ACME call.
    parsed = json.loads(dc("run", "--rm", "--no-deps", "caddy", "caddy", "adapt", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"))
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
    validate_caddy()
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
            api_auth = tls_request("api-staging.ir35careers.com", "/auth/v1/health", True, {"apikey": values["ANON_KEY"], "Authorization": "Bearer " + values["ANON_KEY"]})
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
    if len(sys.argv) != 3 or sys.argv[1] not in ("prepare", "install-launcher", "internal-up", "validate-caddy", "acme-staging", "acme-trusted", "diagnose-prepare", "diagnose-health", "quarantine-diagnose", "database-metadata"):
        raise RuntimeError("Fixed staging prepare/internal-up only")
    config = json.loads(sys.argv[2])
    prerequisites(config)
    operations = {"prepare": lambda: prepare(config), "install-launcher": lambda: install_launcher(config), "internal-up": lambda: internal_up(config), "validate-caddy": validate_caddy,
        "acme-staging": lambda: acme(config, False), "acme-trusted": lambda: acme(config, True), "diagnose-prepare": lambda: diagnose_prepare(config), "diagnose-health": lambda: diagnose_health(config), "quarantine-diagnose": lambda: quarantine_diagnose(config), "database-metadata": lambda: database_metadata(config)}
    result = operations[sys.argv[1]]()
    print(json.dumps(result))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(json.dumps({"error": str(error) if isinstance(error, RuntimeError) else "Staging helper failed; all raw output suppressed"}))
        raise SystemExit(1)
