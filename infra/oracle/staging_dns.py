"""Read-only dual-resolver staging DNS/CAA gate. No certificate/DNS writes."""
from datetime import datetime, timezone
import json
from pathlib import Path
import re
import shlex
import subprocess
import sys
import time

HOSTS = ("staging.ir35careers.com", "api-staging.ir35careers.com")
RESOLVERS = ("1.1.1.1", "8.8.8.8")
ADDRESS = "132.145.28.134"
REPORT = Path(__file__).resolve().parents[2] / "docs/evidence/oracle-p3-dns.json"


def query(resolver, name, kind):
    if resolver not in RESOLVERS or name not in (*HOSTS, "ir35careers.com", "com", ".") or kind not in ("A", "AAAA", "CAA"):
        raise RuntimeError("Fixed read-only staging DNS queries only")
    result = subprocess.run(["dig", "@" + resolver, name, kind, "+time=3", "+tries=1", "+noall", "+comments", "+answer"], capture_output=True, text=True, timeout=5)
    if result.returncode:
        return {"status": "UNAVAILABLE", "records": []}
    status = re.search(r"status: ([A-Z]+),", result.stdout)
    if not status:
        raise RuntimeError("Unrecognized dig header; no certificate permission")
    records = []
    for line in result.stdout.splitlines():
        if not line.strip() or line.startswith(";"):
            continue
        fields = shlex.split(line)
        if len(fields) < 5 or fields[2] != "IN" or fields[0].rstrip(".") != name.rstrip(".") or fields[3] != kind:
            raise RuntimeError("Unexpected DNS answer/alias; no certificate permission")
        records.append(fields[4:])
    return {"status": status[1], "records": records}


def caa_allows(records):
    issues = []
    for row in records:
        if len(row) != 3 or not row[0].isdigit() or int(row[0]) > 255:
            raise RuntimeError("Malformed CAA answer")
        flag, tag, value = int(row[0]), row[1].lower(), row[2]
        if flag & 128 and tag not in ("issue", "issuewild", "iodef"):
            return False
        if tag == "issue":
            pieces = [part.strip() for part in value.split(";")]
            parameters = dict(part.split("=", 1) for part in pieces[1:] if "=" in part)
            issues.append(pieces[0].lower() == "letsencrypt.org"
                and "accounturi" not in parameters
                and ("validationmethods" not in parameters or "http-01" in parameters["validationmethods"].split(","))
                and set(parameters) <= {"validationmethods"})
    return not issues or any(issues)


def observe():
    observations = []
    ready = True
    for resolver in RESOLVERS:
        for host in HOSTS:
            a, aaaa = query(resolver, host, "A"), query(resolver, host, "AAAA")
            matches = a["status"] == "NOERROR" and a["records"] == [[ADDRESS]]
            no_ipv6 = aaaa["status"] == "NOERROR" and not aaaa["records"]
            ready = ready and matches and no_ipv6
            effective, records = None, []
            caa_ready = True
            for name in (host, "ir35careers.com", "com", "."):
                caa = query(resolver, name, "CAA")
                if caa["status"] not in ("NOERROR", "NXDOMAIN"):
                    caa_ready = False
                    break
                if caa["records"]:
                    effective, records = name, caa["records"]
                    break
            if caa_ready and not caa_allows(records):
                raise RuntimeError("CAA does not authorize a new letsencrypt.org HTTP-01 account for " + host + "; owner DNS gate")
            ready = ready and caa_ready
            observations.append({"resolver": resolver, "host": host, "a": a, "aaaa": aaaa,
                "effectiveCAAName": effective, "caa": records, "caaReady": caa_ready})
    return ready, observations


def main():
    if sys.argv[1:] not in (["check"], ["wait"]):
        raise RuntimeError("Use fixed check or wait only")
    started, delay, count = time.monotonic(), 5, 0
    while True:
        ready, rows = observe()
        count += 1
        expired = time.monotonic() - started >= 1800
        report = {"phase": "P3", "status": "PASS" if ready else "TIMEOUT" if expired else "WAIT", "checkedAt": datetime.now(timezone.utc).isoformat(),
            "elapsedSeconds": round(time.monotonic() - started, 3), "observations": rows,
            "certificateRequests": 0, "dnsWrites": 0, "attempts": count}
        REPORT.write_text(json.dumps(report, indent=2) + "\n")
        if ready:
            print("PASS: both staging A records match132.145.28.134 via dig@1.1.1.1 and@8.8.8.8; no AAAA; effective CAA permits Let's Encrypt HTTP-01", flush=True)
            return
        if sys.argv[1] == "check" or time.monotonic() - started >= 1800:
            raise RuntimeError("Staging DNS not propagated at both resolvers; no certificate request")
        remaining = 1800 - (time.monotonic() - started)
        pause = min(delay, remaining, 60)
        print("WAIT: staging DNS/CAA propagation; next read in " + str(round(pause)) + "s; no DNS write/certificate request", flush=True)
        time.sleep(pause)
        delay = min(delay * 2, 60)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print("STOP: " + str(error) if isinstance(error, RuntimeError) else "STOP: DNS gate failed; raw output suppressed", file=sys.stderr)
        raise SystemExit(1)
