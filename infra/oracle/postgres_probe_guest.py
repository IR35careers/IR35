"""Disposable native ARM extension probe. No source data, credentials or ports."""
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time

NAME = "ir35-p3-extension-probe"
LABEL = "ir35.migration.probe"


def command(args, timeout=60):
    result = subprocess.run(args, capture_output=True, text=True, timeout=timeout)
    if result.returncode:
        raise RuntimeError("P3 fixed command failed: " + Path(args[0]).name + "; exit=" + str(result.returncode) + "; raw output suppressed")
    return result.stdout


def validate(config):
    if set(config) != {"uuid", "image", "extensions"}:
        raise RuntimeError("Unexpected probe input")
    if not re.fullmatch(r"[0-9a-f-]{36}", config["uuid"]) or not re.fullmatch(r"supabase/postgres:17\.[0-9.]+@sha256:[0-9a-f]{64}", config["image"]):
        raise RuntimeError("Pinned Postgres17 ARM image and UUID required")
    if config["extensions"] != {"pg_stat_statements": "1.11", "pgcrypto": "1.3", "plpgsql": "1.0", "supabase_vault": "0.3.1", "uuid-ossp": "1.1"}:
        raise RuntimeError("Cloud extension baseline changed; review required")
    return config


def sql(config):
    # Only fixed, nonsecret SQL. Errors expose SQLSTATE/extension name, not bodies.
    required = ",".join("('%s','%s')" % pair for pair in sorted(config["extensions"].items()))
    return """CREATE TEMP TABLE probe_results(name text, version text, available boolean, loaded boolean, exercised boolean, sqlstate text);
DO $probe$
DECLARE r record; actual text; code text;
BEGIN
 FOR r IN SELECT * FROM (VALUES %s) required(name,version) LOOP
  IF NOT EXISTS(SELECT 1 FROM pg_available_extension_versions a WHERE a.name=r.name AND a.version=r.version) THEN
   INSERT INTO probe_results VALUES(r.name,r.version,false,false,false,'unavailable'); CONTINUE;
  END IF;
  BEGIN
   SELECT extversion INTO actual FROM pg_extension WHERE extname=r.name;
   IF actual IS NOT NULL AND actual<>r.version THEN
    INSERT INTO probe_results VALUES(r.name,r.version,true,false,false,'installed_mismatch'); CONTINUE;
   END IF;
   IF actual IS NULL THEN EXECUTE format('CREATE EXTENSION %%I VERSION %%L',r.name,r.version); END IF;
   CASE r.name
    WHEN 'pg_stat_statements' THEN PERFORM count(*) FROM pg_stat_statements;
    WHEN 'pgcrypto' THEN IF encode(digest('abc','sha256'),'hex')<>'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad' THEN RAISE EXCEPTION 'digest mismatch'; END IF;
    WHEN 'uuid-ossp' THEN PERFORM uuid_generate_v4();
    WHEN 'supabase_vault' THEN PERFORM count(*) FROM vault.decrypted_secrets;
    WHEN 'plpgsql' THEN PERFORM 1;
   END CASE;
   INSERT INTO probe_results VALUES(r.name,r.version,true,true,true,NULL);
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS code=RETURNED_SQLSTATE;
   INSERT INTO probe_results VALUES(r.name,r.version,true,false,false,code);
  END;
 END LOOP;
END $probe$;
SELECT json_build_object('serverVersion',current_setting('server_version'),'serverVersionNum',current_setting('server_version_num')::int,
 'encoding',current_setting('server_encoding'),'collation',(SELECT datcollate FROM pg_database WHERE datname=current_database()),
 'extensions',(SELECT json_agg(row_to_json(r) ORDER BY r.name) FROM probe_results r));
""" % required


def shell(config):
    return """pg_bin="$(pg_config --bindir)"
"$pg_bin/initdb" -D /tmp/ir35-pgprobe --auth=trust --encoding=UTF8 --locale=C.UTF-8 > /tmp/init.log 2>&1
trap '"$pg_bin/pg_ctl" -D /tmp/ir35-pgprobe -m immediate stop >/dev/null 2>&1 || true' EXIT
"$pg_bin/pg_ctl" -D /tmp/ir35-pgprobe -l /tmp/postgres.log -o "-c listen_addresses='' -c unix_socket_directories=/tmp -c shared_preload_libraries=pg_stat_statements -c max_connections=10 -c shared_buffers=64MB" -w start >/dev/null 2>&1
"$pg_bin/psql" -XqAt -v ON_ERROR_STOP=1 -h /tmp -U postgres -d postgres <<'IR35_PUBLIC_SQL'
%s
IR35_PUBLIC_SQL
""" % sql(config)


def create_args(config):
    return ["docker", "create", "--name", NAME, "--label", LABEL + "=P3-native-arm",
        "--network", "none", "--read-only", "--user", "postgres", "--memory", "3g", "--cpus", "2", "--pids-limit", "256",
        "--tmpfs", "/tmp:rw,size=512m,mode=1777", "--entrypoint", "/bin/bash", config["image"], "-ceu", shell(config)]


def diagnostic(text):
    # Logs are solely fixed synthetic SQL on this empty/no-network probe.
    # Emit classifications and allowlisted identifiers, never raw log lines.
    result = {"sqlSyntaxError": "syntax error at or near" in text,
        "unknownConfiguration": "unrecognized configuration parameter" in text,
        "ambiguousReference": "is ambiguous" in text,
        "permissionDenied": "permission denied" in text,
        "missingFunction": "does not exist" in text,
        "errorLineCount": sum("ERROR:" in line for line in text.splitlines())}
    result["knownErrorTokens"] = [name for name in ("lc_collate", "sqlstate", "row_to_json", "pg_stat_statements", "vault.decrypted_secrets", "r.name", "r.version", "pg_config")
                                  if any("ERROR:" in line and name in line for line in text.splitlines())]
    return result


def repairable_empty_probe(row, config, logs):
    host = row.get("HostConfig", {})
    return (row.get("Config", {}).get("Labels", {}).get(LABEL) == "P3-native-arm"
        and row["Config"].get("Image") == config["image"]
        and row.get("State", {}).get("Status") == "exited" and row["State"].get("ExitCode") == 3
        and host.get("NetworkMode") == "none" and host.get("ReadonlyRootfs") is True
        and row.get("Mounts") == [] and not host.get("Binds") and not host.get("PortBindings")
        and "current_setting('lc_collate')" in " ".join(row["Config"].get("Cmd", []))
        and diagnostic(logs)["unknownConfiguration"] and diagnostic(logs)["knownErrorTokens"] == ["lc_collate"])


def main():
    if len(sys.argv) != 3 or sys.argv[1] not in ("pull", "probe", "diagnose", "inspect-static"):
        raise RuntimeError("Fixed image pull or disposable probe only")
    config = validate(json.loads(sys.argv[2]))
    if os.geteuid() != 0 or os.uname().machine != "aarch64":
        raise RuntimeError("Approved native ARM guest required")
    if command(["findmnt", "-n", "-o", "UUID,FSTYPE,TARGET", "--mountpoint", "/opt/ir35/data"]).split() != [config["uuid"], "ext4", "/opt/ir35/data"]:
        raise RuntimeError("Data mount identity mismatch; no image pull/probe")
    started = time.monotonic()
    if sys.argv[1] == "pull":
        space = os.statvfs("/opt/ir35/data")
        if space.f_bavail * space.f_frsize < 10 * 1024**3:
            raise RuntimeError("Less than10GiB free; no pull")
        command(["docker", "pull", "--platform", "linux/arm64", config["image"]], timeout=1200)
        image = json.loads(command(["docker", "image", "inspect", config["image"]]))[0]
        if image.get("Architecture") != "arm64" or image.get("Os") != "linux" or config["image"].split("@", 1)[1] not in " ".join(image.get("RepoDigests", [])):
            raise RuntimeError("Image digest/architecture mismatch; no execution")
        result = {"status": "PASS", "platform": "linux/arm64", "image": config["image"], "imageId": image["Id"], "sizeBytes": image["Size"]}
    elif sys.argv[1] == "inspect-static":
        # Only immutable public image startup/configuration text; never run its
        # database entrypoint or read a key/data directory.
        script = "grep -nE 'pgsodium|vault|shared_preload|PGDATA|initdb|docker_process|docker_setup' /usr/local/bin/docker-entrypoint.sh /etc/postgresql/postgresql.conf 2>/dev/null || true"
        output = command(["docker", "run", "--rm", "--network", "none", "--read-only", "--memory", "128m", "--entrypoint", "/bin/sh", config["image"], "-c", script])
        if len(output) > 20000:
            raise RuntimeError("Static image inspection exceeds bound")
        result = {"status": "PASS", "publicImageCodeReferences": output.splitlines()}
    elif sys.argv[1] == "diagnose":
        row = json.loads(command(["docker", "inspect", NAME]))[0]
        if row.get("Config", {}).get("Labels", {}).get(LABEL) != "P3-native-arm" or row["Config"].get("Image") != config["image"]:
            raise RuntimeError("Probe identity mismatch; no diagnostic")
        logs = subprocess.run(["docker", "logs", NAME], capture_output=True, text=True, timeout=30)
        if logs.returncode or len(logs.stdout) + len(logs.stderr) > 100000:
            raise RuntimeError("Probe logs unavailable or exceed bound; raw output suppressed")
        result = {"status": "DIAGNOSED", "containerState": row["State"]["Status"], "exitCode": row["State"]["ExitCode"],
            "diagnostic": diagnostic(logs.stdout + "\n" + logs.stderr)}
    else:
        # Idempotency: list exact name first; never rerun an existing container.
        found = command(["docker", "ps", "-aq", "--filter", "name=^/" + NAME + "$"]).strip()
        if found:
            row = json.loads(command(["docker", "inspect", NAME]))[0]
            if row.get("Config", {}).get("Labels", {}).get(LABEL) != "P3-native-arm" or row["Config"].get("Image") != config["image"]:
                raise RuntimeError("Probe container name/identity collision; no replacement")
            if row["State"]["Status"] != "exited" or row["State"]["ExitCode"] != 0:
                logs = subprocess.run(["docker", "logs", NAME], capture_output=True, text=True, timeout=30)
                if logs.returncode or len(logs.stdout) + len(logs.stderr) > 100000 or not repairable_empty_probe(row, config, logs.stdout + "\n" + logs.stderr):
                    raise RuntimeError("Existing probe not successfully exited; reconcile, never restart blindly")
                # Owner self-heal: only our identified PG17 diagnostic bug,
                # no mounts/ports/network/customer data. Never touch a DB volume.
                command(["docker", "rm", NAME])
                found = ""
            else:
                output = command(["docker", "logs", NAME])
        if not found:
            command(create_args(config))
            output = command(["docker", "start", "--attach", NAME], timeout=180)
        result = json.loads(output)
        rows = result.get("extensions", [])
        if len(rows) != len(config["extensions"]) or set(row["name"] for row in rows) != set(config["extensions"]):
            raise RuntimeError("Incomplete extension evidence")
        result["status"] = "PASS" if all(row["available"] and row["loaded"] and row["exercised"] for row in rows) and result["serverVersionNum"] >= 170006 and result["serverVersionNum"] < 180000 else "FAIL"
        result.update(network="none", publicPorts=[], customerRows=0, probeContainer=NAME)
        # Retain the exited, read-only container for independent reconciliation.
        # Its tmpfs contains only synthetic empty DB state, gone after stop.
    result["elapsedSeconds"] = round(time.monotonic() - started, 3)
    print(json.dumps(result))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(json.dumps({"error": str(error) if isinstance(error, RuntimeError) else "Native probe failed; raw output suppressed"}))
        raise SystemExit(1)
