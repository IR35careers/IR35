#!/usr/bin/env python3
"""Owner browser login, then bounded SecurityToken-only OCI calls. No API unlock."""

import base64
import configparser
import contextlib
import fcntl
import io
import json
import os
from pathlib import Path
import re
import resource
import stat
import subprocess
import sys
import time
from urllib.parse import parse_qs, urlparse

from bootstrap_audit import CLI, read_profile
from key_ceremony import KeySafetyError, private_directory, write_new

REGION = "uk-london-1"
PROFILE = "ir35"
ROOT = Path.home() / ".oci"
CONFIG = ROOT / "config"
SESSION = ROOT / "sessions" / PROFILE
RECEIPT = ROOT / "ir35-browser-session.json"


def private_file(path):
    if not path.is_absolute() or path.resolve() != path:
        raise KeySafetyError("Session file must not traverse a symlink.")
    info = path.lstat()
    if (not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid()
            or stat.S_IMODE(info.st_mode) != 0o600 or info.st_nlink != 1 or info.st_size > 65536):
        raise KeySafetyError("Session file must be small, owner-only mode600, single-link.")
    return path.read_text()


def atomic_metadata(path, value):
    temporary = path.with_name(path.name + ".pending")
    write_new(temporary, (json.dumps(value) + "\n").encode())
    os.replace(temporary, path)
    descriptor = os.open(path.parent, os.O_DIRECTORY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def token_metadata(token):
    try:
        part = token.strip().split(".")[1]
        value = json.loads(base64.urlsafe_b64decode(part + "=" * (-len(part) % 4)))
        expected = read_profile()  # Public IDs only; never reads/unlocks its key.
        if value.get("sub") != expected["user"] or value.get("tenant") != expected["tenancy"]:
            raise ValueError()
        expiry = value["exp"]
        if type(expiry) is not int:
            raise ValueError()
        return {"user": expected["user"], "tenancy": expected["tenancy"], "expiresAt": expiry}
    except Exception:
        raise KeySafetyError("Session identity/expiry metadata is invalid; token suppressed.") from None


def session_profile():
    private_directory(ROOT)
    parser = configparser.ConfigParser(interpolation=None)
    try:
        parser.read_string(private_file(CONFIG))
        if any(parser[section].get("pass_phrase") for section in ["DEFAULT", *parser.sections()]):
            raise ValueError()
        entry = parser[PROFILE]
        if entry.get("region") != REGION:
            raise ValueError()
        token = Path(entry["security_token_file"])
        key = Path(entry["key_file"])
        if token != SESSION / "token" or key != SESSION / "oci_api_key.pem":
            raise ValueError()
        private_directory(SESSION.parent)
        private_directory(SESSION)
        private_file(key)  # Ephemeral CLI session signer, NOT an existing API key.
        metadata = token_metadata(private_file(token))
        if entry.get("tenancy") != metadata["tenancy"]:
            raise ValueError()
        return metadata
    except KeySafetyError:
        raise
    except Exception:
        raise KeySafetyError("Browser profile ir35 is missing/unsafe; no API-key fallback.") from None


def command(arguments):
    return [str(CLI), "--config-file", str(CONFIG), "--profile", PROFILE, "--auth", "security_token",
            "--cli-rc-file", "/dev/null", "--region", REGION, "--no-retry", "--connection-timeout", "5",
            "--read-timeout", "30", "--output", "json", *arguments]


def clean_environment():
    # No inherited signer, debug, endpoint override or passphrase reaches the CLI.
    return {key: value for key, value in os.environ.items() if not key.startswith("OCI_")}


def ensure_session(now=None):
    now = time.time() if now is None else now
    private_directory(ROOT)
    lock = ROOT / "ir35-session.lock"
    fd = os.open(lock, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    try:
        private_file(lock)
        fcntl.flock(fd, fcntl.LOCK_EX)
        receipt = json.loads(private_file(RECEIPT))
        started = receipt.get("browserAuthenticatedAt")
        if type(started) not in (int, float) or now < started or now - started >= 86400:
            raise KeySafetyError("G2: daily browser sign-in required; no API-key fallback.")
        profile = session_profile()
        if profile["expiresAt"] - now <= 600:
            # Exactly one refresh, before each active operation when <10min remain.
            # A failed/expired refresh is a browser owner gate, never a retry loop.
            result = subprocess.run(command(["session", "refresh"]), capture_output=True, text=True,
                                    timeout=65, env=clean_environment(), check=False)
            if result.returncode:
                raise KeySafetyError("G2: security-token refresh failed; browser sign-in required. Raw output suppressed.")
            profile = session_profile()
            if profile["expiresAt"] <= now + 600:
                raise KeySafetyError("G2: refreshed expiry is insufficient; browser sign-in required.")
        return {**profile, "region": REGION}
    except (OSError, ValueError, TypeError):
        raise KeySafetyError("G2: safe browser session is unavailable; no API passphrase request.") from None
    finally:
        os.close(fd)


class WindowsBrowser:
    def open(self, url, new=0, autoraise=True):
        parsed = urlparse(url)
        if (parsed.scheme != "https" or parsed.netloc != "login.uk-london-1.oraclecloud.com"
                or parsed.path != "/v1/oauth2/authorize"):
            raise KeySafetyError("Unexpected Oracle browser login URL; not opened.")
        if os.environ.get("IR35_BROWSER_BRIDGE_PIPE") != "1" or sys.__stdout__.isatty():
            raise KeySafetyError("Use the native Windows session launcher; no URL may reach a terminal/log.")
        # Private child->parent pipe, consumed/suppressed by open-security-session.ps1.
        # Contains only the vendor's public-key/nonce authorization request, NOT a
        # token, password or verification code. WSL Windows interop is not required.
        sys.__stdout__.write("IR35_BROWSER_REQUEST " + url + "\n")
        sys.__stdout__.flush()
        return True

    open_new = open


def authenticate():
    """Equivalent to oci session authenticate, with no URL/token console logging."""
    import webbrowser
    from oci_cli.cli import cli
    from oci_cli import cli_setup_bootstrap as bootstrap

    os.umask(0o077)
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    if not ROOT.exists():
        ROOT.mkdir(mode=0o700)
    private_directory(ROOT)
    if CONFIG.exists():
        private_file(CONFIG)  # Preserve other profiles; vendor changes ir35 only.
    # Never reuse/remove encryption from either long-lived SSH/API key. OCI creates
    # its own short-lived session signer/token, both owner600 outside Git.
    original_server = bootstrap.StoppableHttpServer

    class LoopbackServer(original_server):
        def __init__(self, address, handler):
            super().__init__(("127.0.0.1", address[1]), handler)

    class QuietCallback(bootstrap.StoppableHttpRequestHandler):
        def do_GET(self):
            if self.headers.get("Host") not in ("localhost:8181", "127.0.0.1:8181"):
                self.send_error(400)
                return
            self.send_response(200)
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.end_headers()
            if self.path == "/":
                # Vendor callback transport, minus its console.log(hash).
                self.wfile.write(b"<script>let h=location.hash.slice(1);history.replaceState(null,'','/');"
                                 b"fetch('/token?'+h,{cache:'no-store'}).then(()=>{document.body.textContent="
                                 b"'Oracle authentication completed. You may close this tab.'});</script>")
            elif self.path.startswith("/token?"):
                token = parse_qs(urlparse(self.path).query).get("security_token", [])
                if len(token) == 1:
                    self.server.ret_value = token[0]
                    self.server.stop = True

    browser = WindowsBrowser()
    # No fallback launcher/second browser attempt if the Windows launch fails.
    webbrowser.open_new = browser.open_new
    bootstrap.StoppableHttpServer = LoopbackServer
    bootstrap.StoppableHttpRequestHandler = QuietCallback
    # Vendor stdout normally includes the full auth URL; keep all of it in RAM.
    captured = io.StringIO()
    print("Opening normal Windows browser: sign in to Oracle yourself. No API passphrase needed.", flush=True)
    try:
        with contextlib.redirect_stdout(captured), contextlib.redirect_stderr(captured):
            result = cli.main(args=["--region", REGION, "session", "authenticate", "--profile-name", PROFILE,
                                   "--config-location", str(CONFIG)], standalone_mode=False)
    except BaseException as error:
        # Exception type and source line only; neither arbitrary message nor URL.
        while error.__context__ is not None:
            error = error.__context__
        trace = error.__traceback__
        while trace and trace.tb_next:
            trace = trace.tb_next
        location = (Path(trace.tb_frame.f_code.co_filename).name + ":" + str(trace.tb_lineno)) if trace else "unknown"
        raise KeySafetyError("Browser session stopped: " + type(error).__name__ + " at " + location + "; raw output suppressed.") from None
    if result not in (0, None):
        raise KeySafetyError("G2: browser authentication did not complete; raw output suppressed.")
    session_profile()
    atomic_metadata(RECEIPT, {"browserAuthenticatedAt": time.time(), "profile": PROFILE, "auth": "security_token"})
    print("PASS: ir35 browser session saved owner-only. Routine calls use SecurityToken; old keys unchanged.", flush=True)


if __name__ == "__main__":
    try:
        if sys.argv[1:] == ["authenticate"]:
            authenticate()
        elif sys.argv[1:] == ["check"]:
            ensure_session()
            print("PASS: SecurityToken profile ir35 ready; expiry checked/refreshed, no API key used.")
        else:
            raise KeySafetyError("Use authenticate or check only; no arbitrary command execution.")
    except KeySafetyError as error:
        print("STOP: " + str(error), file=sys.stderr)
        raise SystemExit(1)
    except BaseException:
        print("STOP: session operation failed; all provider/token output suppressed. No automatic login retry.", file=sys.stderr)
        raise SystemExit(1)
