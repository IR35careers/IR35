"""Actual pinned CLI parser, stopped before socket, browser or cloud operations."""
import contextlib
import base64
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
_INFRA = sys.argv[2].split(":") if len(sys.argv) == 3 and sys.argv[1] == "--infra-wiring" else None
_FINISH = sys.argv[2].split(":") if len(sys.argv) == 3 and sys.argv[1] == "--finish-wiring" else None
if _FINISH:
    _kind, _operation = _FINISH
    _prefix = {"attachment": ["compute", "volume-attachment"], "topic": ["ons", "topic"], "subscription": ["ons", "subscription"], "bucket": ["os", "bucket"]}[_kind]
    sys.argv = ["oci", *_prefix, "attach-paravirtualized-volume" if _kind == "attachment" and _operation == "create" else _operation]
_EXTRA_OPERATIONS = {
    "owner-history-content": ["compute", "console-history", "get-content", "--instance-console-history-id", "ocid1.consolehistory.oc1.uk-london-1.controlledfixture01", "--length", "10000000", "--offset", "0", "--file", "-"],
    "history-delete": ["compute", "console-history", "delete", "--instance-console-history-id", "ocid1.consolehistory.oc1.uk-london-1.controlledfixture01", "--force"],
    "history-list": ["compute", "console-history", "list", "--compartment-id", "ocid1.compartment.oc1..controlledfixture01", "--instance-id", "ocid1.instance.oc1.uk-london-1.controlledfixture01", "--all"],
    "history-capture": ["compute", "console-history", "capture", "--instance-id", "ocid1.instance.oc1.uk-london-1.controlledfixture01", "--display-name", "ir35-ssh-hostkey-bootstrap", "--freeform-tags", '{"ir35-phase":"P1"}'],
    "history-get": ["compute", "console-history", "get", "--instance-console-history-id", "ocid1.consolehistory.oc1.uk-london-1.controlledfixture01"],
    "history-content": ["compute", "console-history", "get-content", "--instance-console-history-id", "ocid1.consolehistory.oc1.uk-london-1.controlledfixture01", "--file", "-", "--offset", "0", "--length", "1048576"],
    "instance-encryption": ["compute", "instance", "update", "--instance-id", "ocid1.instance.oc1.uk-london-1.controlledfixture01", "--launch-options", '{"isPvEncryptionInTransitEnabled":true}', "--force"],
    "image-get": ["compute", "image", "get", "--image-id", "ocid1.image.oc1.uk-london-1.controlledfixture01"],
    "security-update": ["network", "security-list", "update", "--security-list-id", "ocid1.securitylist.oc1.uk-london-1.controlledfixture01", "--force", "--ingress-security-rules", "[]", "--egress-security-rules", "[]"],
    "nsg-rules": ["network", "nsg", "rules", "list", "--nsg-id", "ocid1.networksecuritygroup.oc1.uk-london-1.controlledfixture01", "--all"],
    "vnics": ["compute", "vnic-attachment", "list", "--compartment-id", "ocid1.compartment.oc1..controlledfixture01", "--instance-id", "ocid1.instance.oc1.uk-london-1.controlledfixture01", "--all"],
    "vnic": ["network", "vnic", "get", "--vnic-id", "ocid1.vnic.oc1.uk-london-1.controlledfixture01"],
    "boots": ["compute", "boot-volume-attachment", "list", "--compartment-id", "ocid1.compartment.oc1..controlledfixture01", "--availability-domain", "fixture:UK-LONDON-1-AD-1", "--instance-id", "ocid1.instance.oc1.uk-london-1.controlledfixture01", "--all"],
    "boot": ["bv", "boot-volume", "get", "--boot-volume-id", "ocid1.bootvolume.oc1.uk-london-1.controlledfixture01"],
}
import host_identity_iam
_iam_specs = host_identity_iam.specs("ocid1.instance.oc1.uk-london-1.controlledfixture01", "ocid1.compartment.oc1..controlledfixture01",
                                      "ocid1.tenancy.oc1..controlledfixture01", "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")
for _iam_kind in ("group", "policy"):
    for _iam_operation in ("create", "get", "list", "delete"):
        _EXTRA_OPERATIONS["hostkey-" + _iam_kind + "-" + _iam_operation] = host_identity_iam.args(_iam_kind, _iam_operation, _iam_specs[_iam_kind],
            "ocid1." + ("dynamicgroup" if _iam_kind == "group" else "policy") + ".oc1..controlledfixture01")
_EXTRA_OPERATIONS.update({
    "hostkey-command-create": host_identity_iam.command_args(host_identity_iam.command_payload("ocid1.instance.oc1.uk-london-1.controlledfixture01", "ocid1.compartment.oc1..controlledfixture01")),
    "hostkey-command-get": ["instance-agent", "command", "get", "--command-id", "ocid1.instanceagentcommand.oc1.uk-london-1.controlledfixture01"],
    "hostkey-command-list": ["instance-agent", "command", "list", "--compartment-id", "ocid1.compartment.oc1..controlledfixture01", "--all"],
    "hostkey-command-execution": ["instance-agent", "command-execution", "get", "--command-id", "ocid1.instanceagentcommand.oc1.uk-london-1.controlledfixture01", "--instance-id", "ocid1.instance.oc1.uk-london-1.controlledfixture01"],
})
import host_identity_bastion
_bastion_spec = host_identity_bastion.payload("ocid1.bastion.oc1.uk-london-1.controlledfixture01", "ocid1.instance.oc1.uk-london-1.controlledfixture01",
    "10.35.1.8", "ssh-ed25519 " + base64.b64encode(b"\0\0\0\x0bssh-ed25519\0\0\0\x20" + b"\0" * 32).decode())
_EXTRA_OPERATIONS.update({
    "bastion-session-create": host_identity_bastion.create_args(_bastion_spec),
    "bastion-session-get": ["bastion", "session", "get", "--session-id", "ocid1.bastionsession.oc1.uk-london-1.controlledfixture01"],
    "bastion-session-delete": ["bastion", "session", "delete", "--session-id", "ocid1.bastionsession.oc1.uk-london-1.controlledfixture01", "--force"],
    "bastion-session-list": ["bastion", "session", "list", "--bastion-id", "ocid1.bastion.oc1.uk-london-1.controlledfixture01", "--all"],
})
_EXTRA = sys.argv[2] if len(sys.argv) == 3 and sys.argv[1] == "--extra-wiring" and sys.argv[2] in _EXTRA_OPERATIONS else None
if _EXTRA:
    sys.argv = ["oci", *_EXTRA_OPERATIONS[_EXTRA][:3]]
if _INFRA:
    import p1_infrastructure
    _kind, _operation = _INFRA
    _prefix = p1_infrastructure.KINDS[_kind][0].split()
    sys.argv = ["oci", *_prefix, "launch" if _kind == "instance" and _operation == "create" else _operation]
if _PAYLOAD_KIND:
    sys.argv = ["oci", *( ["limits", "quota", "create"] if _PAYLOAD_KIND == "quota" else ["iam", "compartment", "create"] )]

from oci_cli.cli import cli
from oci_cli import cli_setup_bootstrap
from oci_cli import cli_util
import security_session
import p1_control_plane


class CliWiringTests(unittest.TestCase):
    def test_finish_payloads_parse_before_any_cloud_call(self):
        import p1_finish
        for kind in p1_finish.KINDS:
            for operation in ("create", "get", "list"):
                child = subprocess.run([sys.executable, __file__, "--finish-wiring", kind + ":" + operation], capture_output=True, text=True, timeout=20)
                self.assertEqual(child.returncode, 0, kind + ":" + operation + ": finish parser failed; raw output suppressed.")

    def check_finish(self, kind, operation):
        import p1_finish as finish
        import p1_infrastructure as infra
        child = "ocid1.compartment.oc1..controlledfixture01"
        journal = {"intent": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "created": {
            key: {"id": "ocid1." + value[2] + ".oc1.uk-london-1.controlledfixture01"} for key, value in infra.KINDS.items()}}
        journal["created"]["topic"] = {"id": "ocid1.onstopic.oc1.uk-london-1.controlledfixture01"}
        payload = finish.spec(kind, journal, child, "controlledfixture")
        identifier = "ocid1." + finish.KINDS[kind] + ".oc1.uk-london-1.controlledfixture01"
        command_args = finish.args(kind, operation, payload, child, identifier)
        with patch.object(cli_util, "build_client", side_effect=RuntimeError("CONTROLLED_STOP")) as client:
            try:
                with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
                    cli.main(args=security_session.command(command_args)[1:], standalone_mode=False)
            except BaseException:
                pass
            self.assertEqual(client.call_count, 1, kind + ":" + operation + ": parser failed; raw output suppressed.")

    def test_compute_inspection_and_narrow_ingress_update_wiring(self):
        for name in _EXTRA_OPERATIONS:
            child = subprocess.run([sys.executable, __file__, "--extra-wiring", name], capture_output=True, text=True, timeout=20)
            self.assertEqual(child.returncode, 0, name + ": isolated parser failed; raw output suppressed.")

    def check_extra(self, name):
        # The real get-content --file - command requires stdout.buffer. Use a
        # binary-capable private sink, not StringIO; retain client interception.
        captured = io.TextIOWrapper(io.BytesIO(), encoding="utf-8")
        with tempfile.TemporaryDirectory() as directory, patch.object(cli_util, "build_client", side_effect=RuntimeError("CONTROLLED_STOP")) as client:
            operation = _EXTRA_OPERATIONS[name][:]
            if name == "bastion-session-create":
                public_key = Path(directory) / "fixture.pub"
                public_key.write_text(_bastion_spec["keyDetails"]["publicKeyContent"])
                operation[operation.index("--ssh-public-key-file") + 1] = str(public_key)
            try:
                with contextlib.redirect_stdout(captured), contextlib.redirect_stderr(io.StringIO()):
                    cli.main(args=security_session.command(operation)[1:], standalone_mode=False)
            except BaseException:
                pass
            self.assertEqual(client.call_count, 1, name + ": parser failed; raw output suppressed.")

    def test_infrastructure_payloads_parse_before_any_cloud_call(self):
        import p1_infrastructure
        for kind in p1_infrastructure.KINDS:
            for operation in ("create", "get", "list"):
                child = subprocess.run([sys.executable, __file__, "--infra-wiring", kind + ":" + operation], capture_output=True, text=True, timeout=20)
                self.assertEqual(child.returncode, 0, kind + ":" + operation + ": isolated parser failed; raw output suppressed.")

    def check_infrastructure(self, kind, operation):
        import p1_infrastructure as infra
        child = "ocid1.compartment.oc1..controlledfixture01"
        journal = {"intent": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "ownerCIDR": "8.8.8.8/32",
                   "created": {key: {"id": "ocid1." + value[2] + ".oc1.uk-london-1.controlledfixture01"} for key, value in infra.KINDS.items()}}
        payload = infra.specification(kind, journal, child, "fixture:UK-LONDON-1-AD-1",
                                      "ocid1.image.oc1.uk-london-1.controlledfixture01", "ssh-ed25519 " + "A" * 68)
        args = security_session.command(infra.cli_arguments(kind, operation, payload=payload, child=child, journal=journal,
                                        resource_id=journal["created"][kind]["id"]))[1:]
        with patch.object(cli_util, "build_client", side_effect=RuntimeError("CONTROLLED_STOP")) as client:
            try:
                with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
                    cli.main(args=args, standalone_mode=False)
            except BaseException:
                pass
            self.assertEqual(client.call_count, 1, kind + ":" + operation + ": parser failed; raw output suppressed.")

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
    if _FINISH:
        CliWiringTests().check_finish(*_FINISH)
    elif _EXTRA:
        CliWiringTests().check_extra(_EXTRA)
    elif _INFRA:
        CliWiringTests().check_infrastructure(*_INFRA)
    elif _PAYLOAD_KIND:
        CliWiringTests().check_payload(_PAYLOAD_KIND)
    else:
        result = unittest.main(exit=False).result
        if result.wasSuccessful():
            import p1_infrastructure
            import p1_compute
            import p1_finish
            import p1_encryption
            import host_ssh
            import hashlib
            import time
            from key_ceremony import private_directory
            private_directory(p1_control_plane.KEY_DIRECTORY)
            security_session.atomic_metadata(p1_control_plane.PREFLIGHT_RECEIPT,
                {"status": "PASS", "checkedAt": time.time(), "group": "limits quota", "auth": "security_token",
                 "infrastructureSHA256": hashlib.sha256(Path(p1_infrastructure.__file__).read_bytes()).hexdigest(),
                 "computeSHA256": hashlib.sha256(Path(p1_compute.__file__).read_bytes()).hexdigest(),
                 "finishSHA256": hashlib.sha256(Path(p1_finish.__file__).read_bytes()).hexdigest(),
                 "encryptionSHA256": hashlib.sha256(Path(p1_encryption.__file__).read_bytes()).hexdigest(),
                 "hostSSHSHA256": hashlib.sha256(Path(host_ssh.__file__).read_bytes()).hexdigest(),
                 "sourceSHA256": hashlib.sha256(Path(p1_control_plane.__file__).read_bytes()).hexdigest()})
        raise SystemExit(0 if result.wasSuccessful() else 1)
