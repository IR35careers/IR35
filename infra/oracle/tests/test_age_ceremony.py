"""Synthetic fake-age fixtures only: never generate a real key or use network."""
import base64
import ast
from contextlib import redirect_stderr, redirect_stdout
from io import StringIO
import json
import inspect
import os
from pathlib import Path
import stat
import subprocess
import sys
import tempfile
import types
import unittest
from unittest.mock import Mock, patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import age_ceremony as ceremony

VERSION = 'v1.3.2'
# These checksum-invalid repeated-character strings are NOT actual keys.
MOCK_PRIVATE = b'AGE-SECRET-' + b'KEY-1' + b'Q' * 58
MOCK_PUBLIC = b'age1' + b'q' * 58
MOCK_IDENTITY = b'# created: synthetic-fixture\n# public key: ' + MOCK_PUBLIC + b'\n' + MOCK_PRIVATE + b'\n'
MOCK_CIPHERTEXT = b'age-encryption.org/v1\nfixture-only-NOT-CRYPTO\n'


class FakeAge:
    def __init__(self): self.calls = []
    def __call__(self, args, *, body=None):
        self.calls.append((args, body))
        if args[-1] == '--version': return VERSION.encode() + b'\n'
        if len(args) == 1 and Path(args[0]).name == 'age-keygen.exe': return MOCK_IDENTITY
        if args[-1] == '-y':
            if body != MOCK_IDENTITY: raise AssertionError('Wrong RAM-only fixture identity')
            return MOCK_PUBLIC + b'\n'
        if '--encrypt' in args:
            if body != ceremony.SYNTHETIC: raise AssertionError('Wrong synthetic input')
            return MOCK_CIPHERTEXT
        if '--decrypt' in args:
            if body != MOCK_CIPHERTEXT: raise AssertionError('Wrong synthetic ciphertext')
            return ceremony.SYNTHETIC
        raise AssertionError('Unknown mock command')


class AgeCeremonyTests(unittest.TestCase):
    def directory(self, temporary):
        root = Path(temporary); root.chmod(0o700)
        if os.name == 'nt':
            # ONLY a fresh TemporaryDirectory, never the real owner folder.
            self.assertTrue(root.resolve().is_relative_to(Path(tempfile.gettempdir()).resolve()))
            ceremony._set_windows_owner_dacl(root, temporary_directory=True)
            ceremony.directory_custody(root)
        return root

    def tools(self, root):
        return {'age.exe': root / 'age.exe', 'age-keygen.exe': root / 'age-keygen.exe'}

    def run_mock(self, root, fake=None):
        fake = fake or FakeAge()
        with patch.object(ceremony, 'age_call', side_effect=fake):
            return ceremony.perform_ceremony(root, self.tools(root), VERSION)

    def test_success_is_one_generation_owner_only_before_private_bytes_and_no_secret_in_summary(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = self.directory(temporary); fake = FakeAge(); original = ceremony.custody
            observations = []
            def custody(path, *, apply=False):
                if apply:
                    observations.append((path.name, path.stat().st_size))
                    self.assertEqual(path.stat().st_size, 0)
                return original(path, apply=apply)
            with patch.object(ceremony, 'custody', side_effect=custody): result = self.run_mock(root, fake)
            self.assertEqual(result['status'], 'PASS'); self.assertEqual(result['synthetic_encrypt_decrypt'], 'PASS')
            self.assertEqual(result['recipient'], MOCK_PUBLIC.decode())
            self.assertEqual((root / ceremony.IDENTITY_NAME).read_bytes(), MOCK_IDENTITY)
            self.assertEqual((root / ceremony.RESTORED_NAME).read_bytes(), ceremony.SYNTHETIC)
            self.assertEqual((root / ceremony.CIPHERTEXT_NAME).read_bytes(), MOCK_CIPHERTEXT)
            self.assertNotIn(MOCK_PRIVATE.decode(), json.dumps(result))
            self.assertNotIn('identity_sha256', result)
            self.assertEqual(sum(len(args) == 1 for args, _ in fake.calls), 1)
            self.assertEqual(set(path.name for path in root.iterdir()), set(ceremony.NAMES))
            self.assertEqual(len(observations), len(ceremony.NAMES))
            for path in root.iterdir(): ceremony.custody(path)
            self.assertIn('store an offline copy of the age key file in your password manager or on a USB drive', result['owner_action'])

    def test_replay_preserves_every_artifact_and_never_invokes_any_age_command(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = self.directory(temporary); self.run_mock(root)
            before = {path.name: path.read_bytes() for path in root.iterdir()}
            with patch.object(ceremony, 'age_call') as child:
                with self.assertRaisesRegex(ceremony.CeremonyRefused, 'ExistingCeremonyArtifactPreserved'):
                    ceremony.perform_ceremony(root, self.tools(root), VERSION)
            child.assert_not_called(); self.assertEqual(before, {path.name: path.read_bytes() for path in root.iterdir()})

    def test_even_empty_existing_identity_is_preserved_not_treated_as_permission_to_regenerate(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = self.directory(temporary); (root / ceremony.IDENTITY_NAME).touch()
            with patch.object(ceremony, 'age_call') as child:
                with self.assertRaises(ceremony.CeremonyRefused): ceremony.perform_ceremony(root, self.tools(root), VERSION)
            child.assert_not_called(); self.assertEqual((root / ceremony.IDENTITY_NAME).read_bytes(), b'')

    def test_acl_refusal_precedes_key_generation_and_keeps_empty_reservation(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = self.directory(temporary); fake = FakeAge()
            with patch.object(ceremony, 'age_call', side_effect=fake), patch.object(ceremony, 'custody', side_effect=RuntimeError('fixture-private-error')):
                with self.assertRaises(RuntimeError): ceremony.perform_ceremony(root, self.tools(root), VERSION)
            self.assertTrue((root / ceremony.IDENTITY_NAME).exists()); self.assertEqual((root / ceremony.IDENTITY_NAME).stat().st_size, 0)
            self.assertEqual(len(fake.calls), 2); self.assertTrue(all(args[-1] == '--version' for args, _ in fake.calls))

    def test_failure_after_generation_preserves_identity_and_sealed_fixed_summary_without_raw_error(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = self.directory(temporary); fake = FakeAge()
            def invoke(args, *, body=None):
                if '--decrypt' in args: raise RuntimeError('fixture-secret-error-message')
                return fake(args, body=body)
            with self.assertRaisesRegex(ceremony.CeremonyRefused, 'PrivateReceiptPreserved'): self.run_mock(root, invoke)
            receipt = json.loads((root / ceremony.RECEIPT_NAME).read_bytes())
            self.assertEqual(receipt['status'], 'FAIL'); self.assertEqual(receipt['code'], 'RuntimeError')
            self.assertTrue(receipt['key_generation_may_have_run'])
            self.assertNotIn('fixture-secret', json.dumps(receipt)); self.assertNotIn(MOCK_PRIVATE.decode(), json.dumps(receipt))
            self.assertEqual((root / ceremony.IDENTITY_NAME).read_bytes(), MOCK_IDENTITY)

    def test_roundtrip_mismatch_is_fail_never_generates_again_or_writes_restored_file(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = self.directory(temporary); fake = FakeAge()
            def invoke(args, *, body=None):
                return b'wrong-synthetic-roundtrip' if '--decrypt' in args else fake(args, body=body)
            with self.assertRaises(ceremony.CeremonyRefused): self.run_mock(root, invoke)
            receipt = json.loads((root / ceremony.RECEIPT_NAME).read_bytes())
            self.assertEqual(receipt['code'], 'SyntheticAgeRoundTripMismatch'); self.assertFalse((root / ceremony.RESTORED_NAME).exists())
            self.assertEqual(sum(len(args) == 1 for args, _ in fake.calls), 1)

    def test_invalid_key_or_recipient_is_refused_before_any_private_content_is_written(self):
        for operation in ('identity', 'recipient'):
            with tempfile.TemporaryDirectory() as temporary:
                root = self.directory(temporary); fake = FakeAge()
                def invoke(args, *, body=None):
                    if (operation == 'identity' and len(args) == 1) or (operation == 'recipient' and args[-1] == '-y'):
                        return b'fixture-malformed-native-output'
                    return fake(args, body=body)
                with self.assertRaises(ceremony.CeremonyRefused): self.run_mock(root, invoke)
                self.assertEqual((root / ceremony.IDENTITY_NAME).read_bytes(), b'')
                self.assertNotIn('fixture-malformed', (root / ceremony.RECEIPT_NAME).read_text())

    def test_bad_version_is_refused_before_reserving_identity(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = self.directory(temporary)
            with patch.object(ceremony, 'age_call', return_value=b'v0.0.0\n'):
                with self.assertRaisesRegex(ceremony.CeremonyRefused, 'ExactReviewedAgeVersionRequired'):
                    ceremony.perform_ceremony(root, self.tools(root), VERSION)
            self.assertEqual(list(root.iterdir()), [])

    def test_paths_with_a_reparse_ancestor_are_refused_before_any_generation(self):
        with tempfile.TemporaryDirectory() as temporary:
            with patch.object(Path, 'is_symlink', return_value=True), patch.object(ceremony, 'age_call') as child:
                with self.assertRaisesRegex(ceremony.CeremonyRefused, 'ReparsePathRefused'):
                    ceremony.perform_ceremony(Path(temporary), self.tools(Path(temporary)), VERSION)
            child.assert_not_called()

    def test_reviewed_tool_hashes_names_and_one_release_directory_are_required(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = self.directory(temporary); tools = self.tools(root)
            for name, path in tools.items(): path.write_bytes(('public-fixture-binary:' + name).encode())
            pins = [ceremony.sha256(tools[name].read_bytes()) for name in ('age.exe', 'age-keygen.exe')]
            self.assertEqual(ceremony.verify_tools(tools['age.exe'], tools['age-keygen.exe'], *pins, VERSION), tools)
            with self.assertRaises(ceremony.CeremonyRefused): ceremony.verify_tools(tools['age.exe'], tools['age-keygen.exe'], '0' * 64, pins[1], VERSION)
            with self.assertRaises(ceremony.CeremonyRefused): ceremony.verify_tools(tools['age.exe'], tools['age-keygen.exe'], *pins, 'latest')

    def test_child_never_receives_identity_in_argv_or_environment_and_raw_failure_is_withheld(self):
        reply = subprocess.CompletedProcess(['fixture'], 0, stdout=MOCK_PUBLIC, stderr=b'')
        with patch.object(ceremony.subprocess, 'run', return_value=reply) as child:
            self.assertEqual(ceremony.age_call([Path('age-keygen.exe'), '-y'], body=MOCK_IDENTITY), MOCK_PUBLIC)
        self.assertNotIn(MOCK_PRIVATE.decode(), repr(child.call_args.args))
        self.assertEqual(child.call_args.kwargs['input'], MOCK_IDENTITY)
        self.assertEqual(set(child.call_args.kwargs['env']), {'SystemRoot', 'WINDIR'})
        self.assertTrue(child.call_args.kwargs['capture_output']); self.assertNotIn('shell', child.call_args.kwargs)
        with patch.object(ceremony.subprocess, 'run', side_effect=RuntimeError(MOCK_PRIVATE.decode())):
            with self.assertRaises(ceremony.CeremonyRefused) as caught: ceremony.age_call(['age.exe'])
        self.assertNotIn(MOCK_PRIVATE.decode(), str(caught.exception)); self.assertEqual(str(caught.exception), 'OfficialAgeCommandFailed_RawWithheld')

    def test_descriptor_identity_change_blocks_sensitive_write_without_content(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = self.directory(temporary); path = root / 'fixture-empty'; fd = ceremony.open_private(path)
            try:
                held = os.fstat(fd)
                fake = types.SimpleNamespace(st_dev=held.st_dev, st_ino=held.st_ino + 1, st_nlink=1)
                with patch.object(ceremony.os, 'fstat', return_value=fake):
                    with self.assertRaisesRegex(ceremony.CeremonyRefused, 'ExclusiveArtifactIdentityChanged'):
                        ceremony.fill_descriptor(path, fd, MOCK_IDENTITY)
                self.assertEqual(path.stat().st_size, 0)
            finally: os.close(fd)

    def test_native_cli_rejects_unknown_destination_or_private_arguments_without_echo(self):
        out, err = StringIO(), StringIO()
        with redirect_stdout(out), redirect_stderr(err):
            status = ceremony.main(['--directory', MOCK_PRIVATE.decode()])
        self.assertEqual(status, 1); self.assertEqual(err.getvalue(), '')
        self.assertNotIn(MOCK_PRIVATE.decode(), out.getvalue())
        self.assertEqual(json.loads(out.getvalue())['status'], 'STOP')

    def test_directory_windows_acl_check_is_read_only_and_receives_only_public_path_code(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            with patch.object(ceremony, 'native_windows', return_value=True), patch.object(ceremony.subprocess, 'CREATE_NO_WINDOW', 0, create=True), \
                    patch.object(ceremony.subprocess, 'run', return_value=Mock(returncode=0, stdout=b'ok')) as child:
                ceremony.directory_custody(root)
            arguments = child.call_args.args[0]
            script = base64.b64decode(arguments[-1]).decode('utf-16le')
            self.assertNotIn('Set-Acl', script); self.assertNotIn(MOCK_PRIVATE.decode(), script)
            self.assertEqual(set(child.call_args.kwargs['env']), {'SystemRoot', 'WINDIR'})

    def test_private_windows_acl_modifies_dacl_only_never_audit_owner_or_credential_values(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / 'empty-fixture'; path.touch()
            with patch.object(ceremony, 'native_windows', return_value=True), patch.object(ceremony.subprocess, 'CREATE_NO_WINDOW', 0, create=True), \
                    patch.object(ceremony.subprocess, 'run', return_value=Mock(returncode=0, stdout=b'ok')) as child, \
                    patch.object(ceremony, '_set_windows_owner_dacl') as apply_dacl:
                ceremony.custody(path, apply=True)
            apply_dacl.assert_called_once_with(path)
            script = base64.b64decode(child.call_args.args[0][-1]).decode('utf-16le')
            self.assertNotIn('Set-Acl', script); self.assertIn('Get-Acl -LiteralPath', script)
            for forbidden in ('FileSecurity]::new', 'DirectorySecurity]::new', 'SetOwner(', '-Audit', 'SetAudit', 'SeSecurityPrivilege'):
                self.assertNotIn(forbidden, script)
            self.assertNotIn(MOCK_PRIVATE.decode(), script)

    def test_win32_mutation_uses_only_protected_dacl_flags_and_null_owner_group_sacl(self):
        source = inspect.getsource(ceremony._set_windows_owner_dacl)
        calls = [node for node in ast.walk(ast.parse(source)) if isinstance(node, ast.Call)
                 and isinstance(node.func, ast.Attribute) and node.func.attr == 'SetNamedSecurityInfoW']
        self.assertEqual(len(calls), 1)
        arguments = calls[0].args
        self.assertEqual(ast.literal_eval(arguments[1]), 1)  # SE_FILE_OBJECT
        flags = arguments[2]
        self.assertIsInstance(flags, ast.BinOp); self.assertIsInstance(flags.op, ast.BitOr)
        self.assertEqual(ast.literal_eval(flags.left), 0x00000004)  # DACL_SECURITY_INFORMATION
        self.assertEqual(ast.literal_eval(flags.right), 0x80000000)  # PROTECTED_DACL_SECURITY_INFORMATION
        for index in (3, 4, 6): self.assertIsNone(ast.literal_eval(arguments[index]))
        self.assertEqual(arguments[5].id, 'dacl')
        for forbidden in ('AdjustTokenPrivileges', 'SetOwner', 'Set-Acl', 'SACL_SECURITY_INFORMATION'):
            # The docstring explains the removed PowerShell command; executable code must not use it.
            self.assertNotIn(forbidden, ast.unparse(ast.parse(source).body[0].body[1:]))


if __name__ == '__main__': unittest.main()
