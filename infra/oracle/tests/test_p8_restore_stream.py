"""Disposable synthetic streams only; no private key, OCI, source DB or network."""
import copy
import gzip
import hashlib
import io
import json
import os
from pathlib import Path
import stat
import sys
import tarfile
import tempfile
import unittest
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import p8_restore_stream as restore

TOKEN = '20261030t021500z_1234abcd'


def fingerprint(value): return hashlib.md5(str(value).encode()).hexdigest()


def private_manifest(target=False):
    names = ['auth.users', 'auth.identities', 'auth.mfa_factors'] + ['public.table_' + str(n) for n in range(59)]
    roles = ['postgres', 'supabase_admin', 'ir35_queue', 'ir35_queue_producer']
    return {'witness': {'database': restore.target_names(TOKEN)['database'] if target else 'ir35_p5_app',
                        'clusterSystemIdentifier': '1234567890123457' if target else '1234567890123456'},
            'tables': [{'name': name, 'rows': 3 if name == 'auth.users' else 1, 'md5': fingerprint(name)} for name in names],
            'sequences': [{'name': 'public.seq_' + str(n), 'lastValue': str(n), 'isCalled': False} for n in range(2)],
            'catalogObjects': [{'kind': 'role', 'name': name, 'hash': fingerprint(name)} for name in roles],
            'extensionVersions': {'pgcrypto': '1.3', 'plpgsql': '1.0'},
            'rls': [{'schema': name.split('.')[0], 'name': name.split('.')[1], 'enabled': True, 'forced': False} for name in names],
            'authPasswordHashes': [{'userIdSHA256': hashlib.sha256(str(n).encode()).hexdigest(), 'passwordMD5': fingerprint(n)} for n in range(3)],
            'rolePasswordHashes': {name: fingerprint(name) for name in roles},
            'storage': [{'pathSHA256': hashlib.sha256(('path-' + str(n)).encode()).hexdigest(), 'bytes': n,
                         'sha256': hashlib.sha256(str(n).encode()).hexdigest()} for n in range(73)],
            'appPrivileges': [{'object': 'public.' + str(n), 'role': 'anon', 'allowed': False} for n in range(552)],
            'queuePrivileges': {name: {key: False for key in ('superuser', 'createRole', 'createDatabase', 'replication', 'bypassRLS')}
                                for name in ('ir35_queue', 'ir35_queue_producer')},
            'encoding': {'serverEncoding': 'UTF8', 'collation': {'collate': 'en_US.UTF-8', 'ctype': 'en_US.UTF-8', 'provider': 'i', 'locale': 'en-US'},
                         'unicodeRoundTripMD5': fingerprint('😀 café Ελληνικά 日本語 العربية')}}


def containment():
    checked = {'status': 'PASS', 'tables': [{}] * 62, 'sequenceChecks': 2,
               'privileges': {'status': 'PASS', 'sourceEntries': 552}, 'dataDifferences': []}
    return {'status': 'PASS', 'pg_hba': {'actualLoginChecks': 112, 'baseline552Changed': False},
            'freshLoginChecks': [{'passed': True} for n in range(112)],
            'pristine': copy.deepcopy(checked), 'P5Fixture': copy.deepcopy(checked),
            'containment': {'status': 'PASS', 'tablesEach': 62, 'sequencesEach': 2,
                'storageObjectsEach': 73, 'storageSHA256Match': True, 'appRolePrivilegesEach': 552,
                'approvedP6RolesEach': 2, 'approvedSchemaExceptionsEach': 3, 'baseline552Unchanged': True,
                'orderedMD5Each': True, 'manifests': 'PASS', 'sourceWrites': 0, 'pristineWrites': 0, 'fixtureWrites': 0}}


def denials():
    return [{'role': role, 'database': restore.target_names(TOKEN)['database'], 'transport': transport,
             'passed': True, 'connected': False, 'explicitHBAReject': True}
            for role in ('ir35_queue', 'ir35_queue_producer')
            for transport in ('docker-tcp', 'local', 'ipv4-loopback', 'ipv6-loopback')]


class ManifestTests(unittest.TestCase):
    def gate(self, source=None, target=None, **extra):
        args = {'source': private_manifest(), 'target': private_manifest(True), 'decryptor_exit_code': 0,
                'source_containment': containment(), 'final_containment': containment(), 'clone_denials': denials()}
        if source is not None: args['source'] = source
        if target is not None: args['target'] = target
        return restore.verify_full_manifest(**(args | extra))

    def test_all_exact_sections_compared_and_no_private_values_in_summary(self):
        result = self.gate()
        self.assertEqual(result['status'], 'VERIFICATION_PASS')
        self.assertEqual(result['tablesChecked'], 62)
        self.assertEqual(result['sequencesChecked'], 2)
        self.assertEqual(result['appRolePrivilegesChecked'], 552)
        self.assertEqual(result['storageObjectsChecked'], 73)
        self.assertEqual(result['authUsersChecked'], 3)
        self.assertEqual(result['disposableQueueDenials'], 8)
        self.assertFalse(result['phaseComplete'])
        self.assertNotIn(fingerprint(0), json.dumps(result))

    def test_source_cannot_be_compared_to_itself_or_same_cluster(self):
        source = private_manifest()
        with self.assertRaises(restore.RestoreError): self.gate(source, source)
        target = private_manifest(True); target['witness']['clusterSystemIdentifier'] = source['witness']['clusterSystemIdentifier']
        with self.assertRaises(restore.RestoreError): self.gate(target=target)

    def test_age_error_or_missing_sections_prevent_verification(self):
        with self.assertRaises(restore.RestoreError): self.gate(decryptor_exit_code=1)
        target = private_manifest(True); del target['authPasswordHashes']
        with self.assertRaises(restore.RestoreError): self.gate(target=target)

    def test_each_data_security_or_metadata_difference_is_a_hard_failure(self):
        changes = [
            lambda value: value['tables'][0].update(rows=4),
            lambda value: value['tables'][1].update(md5='f' * 32),
            lambda value: value['sequences'][0].update(isCalled=True),
            lambda value: value['storage'][0].update(sha256='e' * 64),
            lambda value: value['authPasswordHashes'][0].update(passwordMD5='d' * 32),
            lambda value: value['rolePasswordHashes'].update(postgres='c' * 32),
            lambda value: value['catalogObjects'][0].update(hash='b' * 32),
            lambda value: value['appPrivileges'][0].update(allowed=True),
            lambda value: value['queuePrivileges']['ir35_queue'].update(bypassRLS=True),
            lambda value: value['extensionVersions'].update(pgcrypto='1.4'),
            lambda value: value['encoding']['collation'].update(locale='different'),
        ]
        for change in changes:
            with self.subTest(change=change):
                target = private_manifest(True); change(target)
                with self.assertRaises(restore.RestoreError): self.gate(target=target)

    def test_public_rls_disabled_even_on_both_sides_is_not_waived(self):
        source, target = private_manifest(), private_manifest(True)
        source['rls'][3]['enabled'] = target['rls'][3]['enabled'] = False
        with self.assertRaises(restore.RestoreError): self.gate(source, target)

    def test_missing_auth_hash_storage_object_sequence_privilege_or_denial_fails(self):
        for section in ('authPasswordHashes', 'storage', 'sequences', 'appPrivileges'):
            target = private_manifest(True); target[section] = target[section][:-1]
            with self.assertRaises(restore.RestoreError): self.gate(target=target)
        with self.assertRaises(restore.RestoreError): self.gate(clone_denials=denials()[:-1])
        altered = denials(); altered[0]['database'] = 'some_other_database'
        with self.assertRaises(restore.RestoreError): self.gate(clone_denials=altered)

    def test_112_baseline_never_filtered_or_expanded_to_hide_owned_clone(self):
        before = containment(); before['pg_hba']['actualLoginChecks'] = 120
        with self.assertRaises(restore.RestoreError): self.gate(source_containment=before)
        after = containment(); after['containment']['storageSHA256Match'] = False
        with self.assertRaises(restore.RestoreError): self.gate(final_containment=after)

    def test_repeated_privilege_or_rls_rows_never_substitute_for_full_coverage(self):
        source, target = private_manifest(), private_manifest(True)
        for value in (source, target):
            value['appPrivileges'][-1] = copy.deepcopy(value['appPrivileges'][0])
        with self.assertRaises(restore.RestoreError): self.gate(source, target)
        source, target = private_manifest(), private_manifest(True)
        for value in (source, target):
            value['rls'].append(copy.deepcopy(value['rls'][0]))
        with self.assertRaises(restore.RestoreError): self.gate(source, target)

    def test_no_real_source_container_or_cloud_url_can_be_a_restore_target(self):
        for token in ('postgres', 'ir35-staging-db-1', '../source', 'https://api.ir35careers.com', TOKEN + ';exit'):
            with self.assertRaises(restore.RestoreError): restore.restore_commands('database', token)
        app = restore.restore_commands('database', TOKEN)[0]
        self.assertIn('ir35-p8-restore-20261030t021500z-1234abcd', app)
        self.assertTrue(app[-1].endswith(restore.target_names(TOKEN)['database']))
        queue = restore.restore_commands('queue', TOKEN)[0]
        self.assertEqual(queue[-1], '--dbname=postgres')
        self.assertNotIn('ir35-staging-db-1', queue)
        globals_commands = restore.restore_commands('globals', TOKEN)
        self.assertEqual(globals_commands[0], ('/usr/bin/gzip', '-d', '-c'))
        self.assertIn('--username=ir35_restore_bootstrap', globals_commands[1])
        for command in (*restore.restore_commands('database', TOKEN), *globals_commands):
            for forbidden in ('--no-owner', '--no-acl', '--clean', '--if-exists', '--disable-triggers'):
                self.assertNotIn(forbidden, command)


@unittest.skipUnless(hasattr(os, 'geteuid'), 'POSIX native disposable fixture')
class NativeStreamTests(unittest.TestCase):
    def test_binary_stream_is_consumed_without_plaintext_file_or_output(self):
        data = ('public fixture café 日本語 😀\n' * 2000).encode()
        command = (sys.executable, '-c', 'import sys;sys.stdin.buffer.read();sys.stdout.write("output-must-not-escape");sys.stderr.write("stderr-must-not-escape")')
        with patch.object(restore, 'restore_commands', return_value=(command,)):
            result = restore.stream_to_restore(io.BytesIO(data), TOKEN, 'database')
        self.assertEqual(result['status'], 'CONSUMED_NOT_AUTHENTICATED_OR_VERIFIED')
        self.assertEqual(result['bytesConsumed'], len(data))
        self.assertEqual(result['plaintextSha256'], hashlib.sha256(data).hexdigest())
        self.assertEqual(result['exitCodes'], [0])
        self.assertNotIn('must-not-escape', json.dumps(result))
        self.assertEqual(result['plaintextIntermediateArchives'], 0)
        self.assertFalse(result['sourceAgeAuthenticityVerified'])

    def test_globals_gzip_stream_keeps_every_role_owner_acl_and_password_byte_in_ram(self):
        # Synthetic SQL ONLY. The consumer verifies exact bytes, without printing
        # SQL or a role verifier. No skip/owner/ACL rewriting stage exists.
        sql = (b'CREATE ROLE source_role;\n'
               b'ALTER ROLE source_role WITH PASSWORD \'synthetic-private-verifier\';\n'
               b'ALTER DATABASE owned_database OWNER TO source_role;\n'
               b'GRANT CONNECT ON DATABASE owned_database TO source_role;\n'
               b'ALTER DEFAULT PRIVILEGES FOR ROLE source_role GRANT SELECT ON TABLES TO source_role;\n')
        expected = hashlib.sha256(sql).hexdigest()
        consumer = (sys.executable, '-c',
            'import hashlib,sys;body=sys.stdin.buffer.read();'
            f'sys.exit(0 if hashlib.sha256(body).hexdigest()=="{expected}" else 19)')
        commands = (('/usr/bin/gzip', '-d', '-c'), consumer)
        encrypted_plaintext = gzip.compress(sql, mtime=0)
        with patch.object(restore, 'restore_commands', return_value=commands):
            result = restore.stream_to_restore(io.BytesIO(encrypted_plaintext), TOKEN, 'globals')
        self.assertEqual(result['status'], 'CONSUMED_NOT_AUTHENTICATED_OR_VERIFIED')
        self.assertEqual(result['exitCodes'], [0, 0])
        self.assertEqual(result['bytesConsumed'], len(encrypted_plaintext))
        self.assertNotIn('synthetic-private-verifier', json.dumps(result))
        self.assertEqual(result['plaintextIntermediateArchives'], 0)

    def test_consumer_error_deadline_and_input_budget_fail_without_raw_values(self):
        failure = (sys.executable, '-c', 'import sys;sys.stdin.buffer.read();sys.stderr.write("private-error");sys.exit(7)')
        with patch.object(restore, 'restore_commands', return_value=(failure,)):
            result = restore.stream_to_restore(io.BytesIO(b'public'), TOKEN, 'database')
        self.assertEqual(result['status'], 'FAIL'); self.assertNotIn('private-error', json.dumps(result))
        slow = (sys.executable, '-c', 'import time;time.sleep(5)')
        with patch.object(restore, 'restore_commands', return_value=(slow,)):
            result = restore.stream_to_restore(io.BytesIO(b'public'), TOKEN, 'database', timeout=0.05)
        self.assertEqual(result['status'], 'FAIL'); self.assertEqual(result['code'], 'RestorePipelineDeadline')
        consumer = (sys.executable, '-c', 'import sys;sys.stdin.buffer.read()')
        with patch.object(restore, 'restore_commands', return_value=(consumer,)):
            result = restore.stream_to_restore(io.BytesIO(b'public'), TOKEN, 'database', maximum_bytes=3)
        self.assertEqual(result['status'], 'FAIL')

    def test_successful_early_exit_without_consuming_input_is_not_a_restore_pass(self):
        early = (sys.executable, '-c', 'pass')
        with patch.object(restore, 'restore_commands', return_value=(early,)):
            result = restore.stream_to_restore(io.BytesIO(b'x' * 1_000_000), TOKEN, 'database')
        self.assertEqual(result['status'], 'FAIL')
        self.assertFalse(result['sourceAgeAuthenticityVerified'])
        self.assertFalse(result['fullVerificationPassed'])

    def test_corrupt_globals_gzip_fails_without_skipping_or_plaintext_output(self):
        consumer = (sys.executable, '-c', 'import sys;sys.stdin.buffer.read()')
        commands = (('/usr/bin/gzip', '-d', '-c'), consumer)
        with patch.object(restore, 'restore_commands', return_value=commands):
            result = restore.stream_to_restore(io.BytesIO(b'synthetic-invalid-gzip'), TOKEN, 'globals')
        self.assertEqual(result['status'], 'FAIL')
        self.assertTrue(any(code != 0 for code in result['exitCodes']))
        self.assertNotIn('synthetic-invalid-gzip', json.dumps(result))


@unittest.skipUnless(hasattr(os, 'setxattr') and hasattr(os, 'geteuid'), 'POSIX final Storage custody/xattrs')
class StorageRestoreTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name); self.root.chmod(0o700)
        self.patch = patch.object(restore, 'RESTORE_BASE', self.root); self.patch.start(); self.addCleanup(self.patch.stop)
        (self.root / TOKEN).mkdir(mode=0o700)
        self.expected = {f'bucket/object-{n}/version': {'bytes': len(str(n).encode()), 'sha256': hashlib.sha256(str(n).encode()).hexdigest(),
                         'uid': os.geteuid(), 'gid': os.getegid(), 'mode': 0o400,
                         'xattrs': {'user.supabase.content-type': b'application/octet-stream'}} for n in range(73)}

    def archive(self, *, missing=False, duplicate=False, unsafe=None, changed=False, directory_xattr=False):
        data = io.BytesIO()
        directories = {'.', 'bucket'} | {f'bucket/object-{n}' for n in range(73)}
        with tarfile.open(fileobj=data, mode='w', format=tarfile.PAX_FORMAT) as out:
            for name in sorted(directories, key=lambda item: (len(Path(item).parts), item)):
                info = tarfile.TarInfo(name); info.type = tarfile.DIRTYPE; info.mode = 0o700
                info.uid, info.gid, info.mtime = os.geteuid(), os.getegid(), 1
                if directory_xattr and name == '.': info.pax_headers = {'SCHILY.xattr.user.uninventoried': 'must-not-be-dropped'}
                out.addfile(info)
            for number, (name, item) in enumerate(self.expected.items()):
                if missing and number == 72: continue
                body = str(number).encode()
                if changed and number == 0: body = b'x'
                info = tarfile.TarInfo(name); info.mode = 0o400; info.uid, info.gid, info.mtime = item['uid'], item['gid'], 1
                info.size = len(body); info.pax_headers = {'SCHILY.xattr.' + key: value.decode() for key, value in item['xattrs'].items()}
                out.addfile(info, io.BytesIO(body))
            if duplicate:
                info = tarfile.TarInfo(next(iter(self.expected))); info.mode = 0o400
                info.uid, info.gid, info.mtime, info.size = os.geteuid(), os.getegid(), 1, 1
                info.pax_headers = {'SCHILY.xattr.user.supabase.content-type': 'application/octet-stream'}
                out.addfile(info, io.BytesIO(b'0'))
            if unsafe:
                info = tarfile.TarInfo(unsafe); info.type = tarfile.SYMTYPE; info.linkname = '../../outside'
                out.addfile(info)
        return io.BytesIO(gzip.compress(data.getvalue()))

    def test_all73_bytes_paths_owner_mode_xattrs_restored_without_intermediate_archive(self):
        result = restore.extract_storage_stream(self.archive(), TOKEN, self.expected)
        self.assertEqual(result['status'], 'STORAGE_RESTORED_NOT_FULLY_VERIFIED')
        self.assertEqual(result['files'], 73)
        self.assertEqual(result['plaintextIntermediateArchives'], 0)
        self.assertFalse(result['fullVerificationPassed'])
        for name, item in self.expected.items():
            path = self.root / TOKEN / 'storage' / name
            self.assertEqual(hashlib.sha256(path.read_bytes()).hexdigest(), item['sha256'])
            self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o400)
            self.assertEqual(os.getxattr(path, 'user.supabase.content-type'), b'application/octet-stream')
            self.assertEqual(path.stat().st_mtime_ns, 1_000_000_000)
        self.assertEqual(stat.S_IMODE((self.root / TOKEN / 'storage').stat().st_mode), 0o700)
        with self.assertRaises(FileExistsError): restore.extract_storage_stream(self.archive(), TOKEN, self.expected)

    def test_sha_difference_missing_object_and_duplicate_each_fail(self):
        # Each fixture has its own new target; no failed target is overwritten.
        for number, kwargs in enumerate(({'changed': True}, {'missing': True}, {'duplicate': True})):
            token = TOKEN[:-1] + str(number)
            if token != TOKEN: (self.root / token).mkdir(mode=0o700)
            with self.assertRaises(restore.RestoreError): restore.extract_storage_stream(self.archive(**kwargs), token, self.expected)

    def test_traversal_and_symlink_are_rejected_without_outside_write(self):
        with self.assertRaises(restore.RestoreError): restore.extract_storage_stream(self.archive(unsafe='../escape'), TOKEN, self.expected)
        self.assertFalse((self.root / 'escape').exists())

    def test_uninventoried_directory_xattrs_are_not_silently_dropped(self):
        with self.assertRaises(restore.RestoreError) as caught:
            restore.extract_storage_stream(self.archive(directory_xattr=True), TOKEN, self.expected)
        self.assertEqual(str(caught.exception), 'UninventoriedStorageDirectoryXattrsRefused')

    def test_corrupt_gzip_trailer_fails_instead_of_ignoring_integrity(self):
        raw = self.archive().getvalue()
        with self.assertRaises((OSError, EOFError)):
            restore.extract_storage_stream(io.BytesIO(raw[:-4]), TOKEN, self.expected)


if __name__ == '__main__': unittest.main()
