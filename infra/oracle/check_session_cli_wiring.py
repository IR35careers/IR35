"""Actual pinned CLI parser, stopped before socket, browser or cloud operations."""
import contextlib
import io
import tempfile
from pathlib import Path
import subprocess
import sys
import unittest
from unittest.mock import patch

# OCI's dynamic loader runs at import and inspects sys.argv, not Click args.
# Mirror the real CLI process BEFORE importing it; retain the probe selector.
_PAYLOAD_KIND = sys.argv[2] if len(sys.argv) == 3 and sys.argv[1] == "--payload-wiring" and sys.argv[2] in ("compartment", "quota") else None
if _PAYLOAD_KIND:
    sys.argv = ["oci", *( ["limits", "quota", "create"] if _PAYLOAD_KIND == "quota" else ["iam", "compartment", "create"] )]

from oci_cli.cli import cli
from oci_cli import cli_setup_bootstrap
from oci_cli import cli_util
import security_session
import p1_control_plane


class CliWiringTests(unittest.TestCase):
    def test_control_plane_payloads_parse_before_any_cloud_call(self):
        for kind in ("compartment", "quota"):
            # OCI lazily mutates its command registry; actual operations each
            # run in their own CLI process too. Do not reuse one parser across
            # unrelated service invocations in this installed-CLI probe.
            child = subprocess.run([sys.executable, __file__, "--payload-wiring", kind], capture_output=True, text=True, timeout=20)
            self.assertEqual(child.returncode, 0, kind + ": isolated parser failed; raw output suppressed.")

    def check_payload(self, kind):
        payload = p1_control_plane.spec(kind, "ocid1.tenancy.oc1..controlledfixture01",
                "ocid1.compartment.oc1..controlledfixture01", "fixture:UK-LONDON-1-AD-1",
                "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")
        operation = p1_control_plane.arguments(kind, payload)
        if kind == "quota":
            self.assertEqual(operation[:3], ["limits", "quota", "create"])
        args = security_session.command(operation)[1:]
        diagnostic = "none"
        with patch.object(cli_util, "build_client", side_effect=RuntimeError("CONTROLLED_STOP")) as client:
            try:
                with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
                    cli.main(args=args, standalone_mode=False)
            except BaseException as error:
                while error.__context__ is not None:
                    error = error.__context__
                diagnostic = type(error).__name__
                option = getattr(error, "option_name", "")
                if isinstance(option, str) and option.startswith("--") and option.replace("-", "").isalpha():
                    diagnostic += " " + option
            self.assertEqual(client.call_count, 1, kind + ": " + diagnostic + "; no raw output published.")

    def test_browser_command_reaches_vendor_flow_without_config_or_api_unlock(self):
        captured = io.StringIO()
        with patch.object(cli_setup_bootstrap, "create_user_session", side_effect=RuntimeError("CONTROLLED_STOP")) as flow:
            try:
                with contextlib.redirect_stdout(captured), contextlib.redirect_stderr(captured):
                    cli.main(args=["--region", "uk-london-1", "session", "authenticate", "--profile-name", "ir35",
                                   "--config-location", "/tmp/mock-not-written"], standalone_mode=False)
            except BaseException:
                pass
            self.assertEqual(flow.call_count, 1, "Pinned CLI did not reach browser flow; no raw output published.")

    def test_full_adapter_reaches_callback_without_browser_or_cloud(self):
        captured = io.StringIO()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            root.chmod(0o700)
            with patch.object(security_session, "ROOT", root), patch.object(security_session, "CONFIG", root / "config"), \
                    patch.object(security_session.WindowsBrowser, "open_new", return_value=True) as launch, \
                    patch.object(cli_setup_bootstrap.StoppableHttpServer, "serve_forever", side_effect=RuntimeError("CONTROLLED_STOP")) as callback:
                try:
                    with contextlib.redirect_stdout(captured), contextlib.redirect_stderr(captured):
                        security_session.authenticate()
                except security_session.KeySafetyError as error:
                    # Source-frame metadata only; safe even on a parser error.
                    if not callback.called:
                        self.fail(str(error))
                self.assertEqual(launch.call_count, 1)
                self.assertEqual(callback.call_count, 1)


if __name__ == "__main__":
    if _PAYLOAD_KIND:
        CliWiringTests().check_payload(_PAYLOAD_KIND)
    else:
        result = unittest.main(exit=False).result
        if result.wasSuccessful():
            import hashlib
            import time
            from key_ceremony import private_directory
            private_directory(p1_control_plane.KEY_DIRECTORY)
            security_session.atomic_metadata(p1_control_plane.PREFLIGHT_RECEIPT,
                {"status": "PASS", "checkedAt": time.time(), "group": "limits quota", "auth": "security_token",
                 "sourceSHA256": hashlib.sha256(Path(p1_control_plane.__file__).read_bytes()).hexdigest()})
        raise SystemExit(0 if result.wasSuccessful() else 1)
