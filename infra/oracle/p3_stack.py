#!/usr/bin/env python3
"""Guarded existing-VM P3 staging setup; no production/cloud-data operations."""
from datetime import datetime, timezone
import fcntl
import hashlib
import json
import os
from pathlib import Path
import sys
import urllib.request

from bootstrap_audit import KEY_DIRECTORY
import host_ssh
from key_ceremony import KeySafetyError
import p1_infrastructure as infra
from p1_compute import verify_network
from p2_harden import next_attempt
from p3_native import STATE as NATIVE
import stack_guest
import staging_stack
import staging_dns
from security_session import atomic_metadata, private_file

STATE = KEY_DIRECTORY / "p3-stack.json"
REPO = Path(__file__).resolve().parents[2]


def assert_schema_not_failed():
    report = REPO / "docs/evidence/oracle-p3-schema-gate.json"
    if report.exists():
        if report.is_symlink() or report.stat().st_size > 2_000_000:
            raise KeySafetyError("Unsafe schema comparison report; no VM operation")
        status = json.loads(report.read_text()).get("status")
        if status != "SUBSET_MATCH_ONLY":
            raise KeySafetyError("P3 schema comparison FAIL/incomplete; owner baseline/order decision required before any VM operation")


def public_bundle():
    # Code goes through stdin; only reviewed public source/config reaches argv.
    source = Path(staging_stack.__file__).read_text() + "\nAPP_MIGRATIONS = " + repr(repo_migrations()) + "\n"
    source += "SCHEMA_GATE_SQL = " + repr((REPO / "supabase/verification/oracle_p3_schema_gate.sql").read_text()) + "\n"
    return "import types,sys\nm=types.ModuleType('staging_stack')\nsys.modules['staging_stack']=m\nexec(" + repr(source) + ",m.__dict__)\n" + Path(stack_guest.__file__).read_text()


def repo_migrations():
    files = [REPO / "supabase/waitlist.sql", *sorted((REPO / "supabase/migrations").glob("*.sql"))]
    if len(files) != 25 or any(path.is_symlink() or not path.is_file() for path in files):
        raise KeySafetyError("Expected reviewed legacy waitlist baseline plus24 repository migrations")
    return {path.relative_to(REPO).as_posix(): path.read_text() for path in files}


def assets():
    result, proof = {}, {}
    for name in staging_stack.SQL_FILES:
        url = "https://raw.githubusercontent.com/supabase/supabase/" + staging_stack.UPSTREAM + "/docker/volumes/db/" + name
        with urllib.request.urlopen(url, timeout=15) as response:
            body = response.read(65537)
        if len(body) > 65536:
            raise KeySafetyError("Upstream SQL asset exceeds bound")
        result[name] = body.decode()
        proof[name] = hashlib.sha256(body).hexdigest()
    return result, proof


def main():
    if sys.argv[1:] not in (["prepare"], ["install-launcher"], ["internal-up"], ["validate-caddy"], ["acme-staging"], ["acme-trusted"], ["diagnose-prepare"], ["diagnose-health"], ["quarantine-diagnose"], ["database-metadata"], ["diagnose-bootstrap"], ["inspect-bootstrap-sql"], ["bootstrap-plan"], ["repair-bootstrap"], ["kong-preflight"], ["kong-nginx-preflight"], ["app-migrations"], ["migration-diagnose"], ["repair-env-binds"], ["runtime-audit"], ["realtime-recovery"], ["realtime-exit-diagnose"], ["schema-gate"]):
        raise KeySafetyError("Fixed P3 staging prepare/internal-up only")
    stage = sys.argv[1]
    assert_schema_not_failed()
    descriptor = os.open(KEY_DIRECTORY / "p1-control-plane.lock", os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    try:
        fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        journal = json.loads(private_file(infra.JOURNAL))
        native = json.loads(private_file(NATIVE))
        target = journal["created"]["instance"]["id"]
        if native.get("instanceId") != target or native.get("stages", {}).get("probe", {}).get("status") != "PASS":
            raise KeySafetyError("Native image/extension probe must PASS on same target first")
        network = verify_network(journal)
        pins = json.loads((REPO / "infra/oracle/staging-images.json").read_text())
        sql, proof = assets()
        config = {"uuid": journal["dataMountIntent"]["uuid"], "ownerCIDR": journal["ownerCIDR"], "images": pins["images"], "upstreamCommit": pins["upstreamCommit"], "sql": sql,
            "launcherSource": (REPO / "infra/oracle/env-exec.c").read_text()}
        state = json.loads(private_file(STATE)) if STATE.exists() else {"phase": "P3", "instanceId": target}
        if state["instanceId"] != target:
            raise KeySafetyError("Staging target changed; no replacement")
        prerequisites = {"prepare": [], "diagnose-prepare": [], "install-launcher": ["prepare"], "internal-up": ["install-launcher"], "diagnose-health": ["install-launcher"], "quarantine-diagnose": ["install-launcher"], "database-metadata": ["install-launcher"], "diagnose-bootstrap": ["install-launcher"], "inspect-bootstrap-sql": ["install-launcher"], "bootstrap-plan": ["install-launcher"], "repair-bootstrap": ["bootstrap-plan"], "kong-preflight": ["install-launcher"], "kong-nginx-preflight": ["install-launcher"], "validate-caddy": ["install-launcher"],
            "acme-staging": ["internal-up", "validate-caddy"], "acme-trusted": ["internal-up", "acme-staging"], "app-migrations": ["internal-up", "acme-trusted"], "migration-diagnose": ["internal-up"], "repair-env-binds": ["internal-up"], "runtime-audit": ["install-launcher"], "realtime-recovery": ["runtime-audit"], "realtime-exit-diagnose": ["install-launcher"], "schema-gate": ["app-migrations"]}
        for previous in prerequisites[stage]:
            if state.get("stages", {}).get(previous, {}).get("status") != "PASS":
                raise KeySafetyError("Staging prerequisite not PASS: " + previous)
        if stage == "internal-up" and (state.get("stages", {}).get("repair-bootstrap", {}).get("status") != "PASS" or state.get("stages", {}).get("kong-nginx-preflight", {}).get("result", {}).get("parseAndNginxValid") is not True):
            raise KeySafetyError("Empty bootstrap repair and real Kong parse/nginx preflight must PASS before startup retry")
        if stage == "app-migrations" and not any(state.get("stages", {}).get(name, {}).get("result", {}).get("runtimeHealthy") is True for name in ("runtime-audit", "realtime-recovery")):
            raise KeySafetyError("Current bind identity and runtime health must PASS before repository migrations")
        if stage.startswith("acme-"):
            ready, observations = staging_dns.observe()
            if not ready:
                raise KeySafetyError("Dual-resolver staging DNS/CAA not PASS; no ACME request")
            state["certificateDnsGateAt"] = datetime.now(timezone.utc).isoformat()
        if state.get("stages", {}).get(stage, {}).get("status") == "PASS" and stage not in ("diagnose-health", "database-metadata", "kong-nginx-preflight"):
            print("PASS: existing verified staging stage reused; no repeat mutation: " + stage, flush=True)
            return
        source = public_bundle()
        entry = next_attempt(state, stage, hashlib.sha256(source.encode()).hexdigest())
        atomic_metadata(STATE, state)
        print("P3 STAGING CHECK: same Always Free A1 2/12/150GB; pinned ARM images, VM-only secrets, SMTP sink/mock/private network; operation=" + stage + "; no source data or production changes.", flush=True)
        try:
            result = host_ssh.run_remote(source, [stage, json.dumps(config, separators=(",", ":"))], timeout=1800 if stage == "prepare" else 650)
            if result.get("status") != "PASS":
                raise KeySafetyError("Staging result not PASS")
            if stage == "schema-gate":
                catalog = result.pop("schemaCatalog")
                (REPO / "docs/evidence/oracle-p3-target-schema.json").write_text(json.dumps(catalog, indent=2) + "\n")
                result["catalogPath"] = "docs/evidence/oracle-p3-target-schema.json"
                result["objects"] = len(catalog["objects"])
                result["parityVerified"] = False
            entry.update(status="PASS", result=result, checkedAt=datetime.now(timezone.utc).isoformat())
        except Exception:
            entry["status"] = "FAIL"
            atomic_metadata(STATE, state)
            raise
        state["assetSHA256"] = proof
        atomic_metadata(STATE, state)
        report = {"phase": "P3", "phaseComplete": False, "checkedAt": entry["checkedAt"], "upstreamCommit": pins["upstreamCommit"], "assetSHA256": proof,
            "stages": {name: {key: value[key] for key in ("status", "attempts", "sourceSHA256", "result") if key in value} for name, value in state["stages"].items()},
            "network": network, "productionChanges": 0, "sourceCustomerRowsExported": 0,
            "remaining": ["Source/target full schema parity (ordered fresh-target migrations and trusted ACME already PASS)", "P4 full data/object verification and restore rehearsal not started"]}
        (REPO / "docs/evidence/oracle-p3-stack.json").write_text(json.dumps(report, indent=2) + "\n")
        print("PASS: " + stage + "; " + json.dumps(result), flush=True)
    finally:
        os.close(descriptor)


if __name__ == "__main__":
    try:
        main()
    except KeySafetyError as error:
        print("STOP: " + str(error), file=sys.stderr)
        raise SystemExit(1)
    except Exception:
        print("STOP: P3 staging helper failed; output suppressed, durable attempt retained", file=sys.stderr)
        raise SystemExit(1)
