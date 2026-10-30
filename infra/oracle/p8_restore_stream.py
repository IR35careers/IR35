"""Disposable-target-only streaming restore and exact private-manifest gate.

No private age identity is read here. The laptop's decryptor must stream through
the attested SSH path and its own exit/authentication must be checked separately.
This module never opens a plaintext dump/archive file or restores into the source
container/roles. Imports have no I/O; no target is created or removed here.
"""
import gzip
from decimal import Decimal
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import select
import signal
import stat
import subprocess
import tarfile
import threading
import time

RESTORE_BASE = Path('/opt/ir35/data/p8-restore')
TOKEN = r'[0-9]{8}t[0-9]{6}z_[0-9a-f]{8}'
MAX_BYTES = 8_000_000_000


class RestoreError(RuntimeError):
    """Fixed code; never native errors, customer bytes, paths or hash values."""


def target_names(token):
    if type(token) is not str or not re.fullmatch(TOKEN, token):
        raise RestoreError('OwnedDisposableRestoreIdentityRequired')
    return {'container': 'ir35-p8-restore-' + token.replace('_', '-'),
            'database': 'ir35_p8_restore_' + token, 'queueDatabase': 'postgres',
            'storage': RESTORE_BASE / token / 'storage'}


def restore_commands(part, token):
    target = target_names(token)
    base = ('/usr/bin/docker', 'exec', '-i', target['container'], '/run/ir35/env-exec', '/opt/ir35/.env.p8-restore')
    if part in ('database', 'queue'):
        database = target['database' if part == 'database' else 'queueDatabase']
        return (base + ('pg_restore', '--no-password', '--single-transaction', '--exit-on-error',
                        '--username=supabase_admin', '--dbname=' + database),)
    if part == 'globals':
        # NEW isolated cluster MUST be initialized under this separate admin,
        # so strict CREATE ROLE statements are not skipped or edited. The
        # operator removes only that owned bootstrap role before verification.
        return (('/usr/bin/gzip', '-d', '-c'), base + ('psql', '-XqAt', '--no-password', '--single-transaction',
                '-v', 'ON_ERROR_STOP=1', '--username=ir35_restore_bootstrap', '--dbname=postgres', '-f', '-'))
    raise RestoreError('FixedDatabaseOrGlobalsRestorePartRequired')


def stream_to_restore(reader, token, part, *, timeout=300, maximum_bytes=MAX_BYTES):
    """Consume decrypted bytes in fixed owned-container commands, no raw logs.

    Return is deliberately NOT a verification PASS. The laptop must prove age
    decrypt exit0 after authenticated EOF, and the exact full manifest must pass.
    The caller already proved container labels/mounts/target custody and capacity;
    a syntactically valid target name alone is not proof of native ownership.
    """
    commands = restore_commands(part, token)
    if (os.name != 'posix' or not isinstance(reader, (io.RawIOBase, io.BytesIO))
            or type(timeout) not in (int, float) or not 0 < timeout <= 300
            or type(maximum_bytes) is not int or not 0 < maximum_bytes <= MAX_BYTES):
        raise RestoreError('BoundedNativeBinaryRestoreRequired')
    children, drains, diagnostics = [], [], []
    transfer = {'bytes': 0, 'sha256': None, 'eof': False, 'error': None}
    result = {'status': 'FAIL', 'part': part, 'plaintextIntermediateArchives': 0,
              'rawOutputPrinted': False, 'sourceAgeAuthenticityVerified': False,
              'fullVerificationPassed': False, 'phaseComplete': False}
    environment = {'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'LANG': 'C.UTF-8', 'LC_ALL': 'C.UTF-8'}
    started = time.monotonic()
    source_fd, source_blocking = None, None
    def drain(stream, record):
        digest, size = hashlib.sha256(), 0
        try:
            while body := stream.read(65536): digest.update(body); size += len(body)
        except Exception: record['captureFailed'] = True
        finally:
            stream.close(); record.update(bytes=size, sha256Prefix=digest.hexdigest()[:16])
    try:
        previous = None
        for index, args in enumerate(commands):
            child = subprocess.Popen(args, stdin=previous if previous is not None else subprocess.PIPE,
                stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=environment, start_new_session=True)
            children.append(child)
            if previous is not None: previous.close()
            previous = child.stdout
            capture = {'stage': index, 'stream': 'stderr'}; diagnostics.append(capture)
            thread = threading.Thread(target=drain, args=(child.stderr, capture), daemon=True)
            thread.start(); drains.append(thread)
        capture = {'stage': len(commands) - 1, 'stream': 'stdout'}; diagnostics.append(capture)
        thread = threading.Thread(target=drain, args=(children[-1].stdout, capture), daemon=True)
        thread.start(); drains.append(thread)
        # The actual SSH stdin must be supplied as sys.stdin.buffer.raw (or an
        # equivalent owned unbuffered pipe). Nonblocking descriptor I/O avoids
        # an uninterruptible feeder thread surviving a restore deadline. Small
        # BytesIO fixtures/explicit RAM streams have no blocking descriptor.
        if not isinstance(reader, io.BytesIO):
            source_fd = reader.fileno(); source_blocking = os.get_blocking(source_fd)
            os.set_blocking(source_fd, False)
        input_fd = children[0].stdin.fileno(); os.set_blocking(input_fd, False)
        digest, pending, input_closed = hashlib.sha256(), bytearray(), False
        while True:
            if any(child.poll() not in (None, 0) for child in children):
                raise RestoreError('RestorePipelineStageFailed')
            if time.monotonic() - started > timeout: raise RestoreError('RestorePipelineDeadline')
            if not transfer['eof'] and not pending:
                if source_fd is None:
                    body = reader.read(65536)
                elif select.select([source_fd], [], [], 0)[0]:
                    body = os.read(source_fd, 65536)
                else:
                    body = None
                if body == b'': transfer['eof'] = True
                elif body is not None:
                    if type(body) is not bytes: raise RestoreError('BinaryRestoreInputRequired')
                    transfer['bytes'] += len(body)
                    if transfer['bytes'] > maximum_bytes: raise RestoreError('RestoreInputBudgetExceeded')
                    digest.update(body); pending.extend(body)
            if pending and select.select([], [input_fd], [], 0)[1]:
                written = os.write(input_fd, pending); del pending[:written]
            if transfer['eof'] and not pending and not input_closed:
                children[0].stdin.close(); input_closed = True
                transfer['sha256'] = digest.hexdigest()
            if all(child.poll() is not None for child in children): break
            time.sleep(0.01)
        if not transfer['eof'] or not input_closed or pending or any(child.returncode != 0 for child in children):
            raise RestoreError('RestoreInputOrExitIncomplete')
        result['status'] = 'CONSUMED_NOT_AUTHENTICATED_OR_VERIFIED'
    except Exception as error:
        result['code'] = str(error) if type(error) is RestoreError else type(error).__name__
    finally:
        if source_fd is not None and source_blocking is not None:
            try: os.set_blocking(source_fd, source_blocking)
            except OSError: result.update(status='FAIL', code='RestoreInputDescriptorCleanupFailed')
        for child in children:
            if child.poll() is None:
                try: os.killpg(child.pid, signal.SIGKILL)
                except ProcessLookupError: pass
        for child in children: child.wait()
        if children and not children[0].stdin.closed:
            try: children[0].stdin.close()
            except OSError: result.update(status='FAIL', code='RestoreInputPipeCleanupFailed')
        for thread in drains: thread.join(timeout=5)
        if any(thread.is_alive() for thread in drains) or any(row.get('captureFailed') for row in diagnostics):
            result.update(status='FAIL', code='RestoreDiagnosticsIncomplete')
        result.update(bytesConsumed=transfer['bytes'], plaintextSha256=transfer['sha256'],
                      exitCodes=[child.returncode for child in children], diagnostics=diagnostics,
                      seconds=round(time.monotonic() - started, 3))
    return result


def _relative(value):
    if (type(value) is not str or not value or '\\' in value or '\x00' in value
            or PurePosixPath(value).is_absolute() or '..' in value.split('/')
            or PurePosixPath(value).as_posix() != value or value == '.'):
        raise RestoreError('ExactPrivateStorageLocatorRequired')
    return value


def extract_storage_stream(reader, token, expected_files):
    """Extract a trusted encrypted-backup tar stream into one NEW final root.

    Exactly73 paths/bytes/SHA/xattrs from the decrypted private manifest are
    required; symlinks/hardlinks/devices/ACL/sparse/unexpected paths fail. Final
    Storage objects are plaintext by design; no plaintext intermediate archive is
    created. Original source paths are never touched or printed. A partial target
    is retained on failure for owned cleanup, never overwritten/retried.
    """
    target = target_names(token)['storage']
    parent = target.parent
    if (parent.absolute() != parent.resolve() or parent.is_symlink() or not parent.is_dir()
            or parent.stat().st_uid != os.geteuid() or stat.S_IMODE(parent.stat().st_mode) != 0o700):
        raise RestoreError('FreshOwnedRestoreParentRequired')
    if type(expected_files) is not dict or len(expected_files) != 73:
        raise RestoreError('All73PrivateStorageEntriesRequired')
    directories = {'.'}
    for name, item in expected_files.items():
        _relative(name)
        if (type(item) is not dict or type(item.get('bytes')) is not int or item['bytes'] < 0
                or not re.fullmatch('[0-9a-f]{64}', item.get('sha256', ''))
                or type(item.get('uid')) is not int or item['uid'] < 0
                or type(item.get('gid')) is not int or item['gid'] < 0 or item.get('mode') != 0o400
                or type(item.get('xattrs')) is not dict
                or any(type(key) is not str or not key.startswith('user.supabase.') or type(value) is not bytes
                       for key, value in item['xattrs'].items())):
            raise RestoreError('ExactStorageBytesCustodyAndXattrsRequired')
        directories.update(str(path) for path in PurePosixPath(name).parents)
    owners = {(item['uid'], item['gid']) for item in expected_files.values()}
    if len(owners) != 1: raise RestoreError('InventoriedSingleStorageOwnerRequired')
    owner = next(iter(owners))
    target.mkdir(mode=0o700)  # Never existing source/destination/failed slot.
    seen, output, directory_metadata = set(), [], {}
    with gzip.GzipFile(fileobj=reader, mode='rb') as compressed:
        with tarfile.open(fileobj=compressed, mode='r|') as archive:
            for member in archive:
                name = member.name[2:] if member.name.startswith('./') else member.name
                if name not in directories: _relative(name)
                if member.issym() or member.islnk() or member.isdev() or member.isfifo() or member.issparse():
                    raise RestoreError('StorageLinksDevicesAndSparseEntriesRefused')
                if any(key.startswith('SCHILY.acl.') for key in member.pax_headers):
                    raise RestoreError('UninventoriedStorageAclRefused')
                if member.isdir():
                    if (name not in directories or name in directory_metadata or (member.uid, member.gid) != owner
                            or stat.S_IMODE(member.mode) != 0o700):
                        raise RestoreError('UnmanifestedOrChangedStorageDirectory')
                    # This manifest protocol inventories xattrs on objects,
                    # not directories. Refuse rather than silently discarding
                    # unrepresented directory metadata during a "full" restore.
                    if any(key.startswith('SCHILY.xattr.') for key in member.pax_headers):
                        raise RestoreError('UninventoriedStorageDirectoryXattrsRefused')
                    directory_metadata[name] = member
                    if name != '.': (target / name).mkdir(mode=0o700, parents=True, exist_ok=True)
                    continue
                if not member.isfile() or name not in expected_files or name in seen:
                    raise RestoreError('DuplicateOrUnmanifestedStorageObject')
                seen.add(name); expected = expected_files[name]
                attrs = {key.removeprefix('SCHILY.xattr.'): value.encode() for key, value in member.pax_headers.items()
                         if key.startswith('SCHILY.xattr.')}
                if (member.size != expected['bytes'] or member.uid != expected['uid'] or member.gid != expected['gid']
                        or stat.S_IMODE(member.mode) != expected['mode'] or attrs != expected['xattrs']):
                    raise RestoreError('StorageArchiveMetadataMismatch')
                destination = target / name; destination.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
                fd = os.open(destination, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
                digest, size = hashlib.sha256(), 0
                try:
                    source = archive.extractfile(member)
                    if source is None: raise RestoreError('StorageFileBodyMissing')
                    with os.fdopen(fd, 'wb', closefd=False) as stream:
                        while body := source.read(65536):
                            stream.write(body); digest.update(body); size += len(body)
                        stream.flush(); os.fsync(fd)
                    if size != expected['bytes'] or digest.hexdigest() != expected['sha256']:
                        raise RestoreError('StorageRestoreSha256Mismatch')
                    if os.fstat(fd).st_uid != expected['uid'] or os.fstat(fd).st_gid != expected['gid']:
                        os.fchown(fd, expected['uid'], expected['gid'])
                    for key, value in expected['xattrs'].items(): os.setxattr(fd, key, value)
                    os.fchmod(fd, 0o400)
                    mtime = int(Decimal(member.pax_headers.get('mtime', str(member.mtime))) * 1_000_000_000)
                    atime = int(Decimal(member.pax_headers.get('atime', str(member.mtime))) * 1_000_000_000)
                    os.utime(fd, ns=(atime, mtime))
                    if set(os.listxattr(fd)) != set(expected['xattrs']) or any(os.getxattr(fd, key) != value for key, value in expected['xattrs'].items()):
                        raise RestoreError('StorageRestoredXattrMismatch')
                finally:
                    os.fchmod(fd, 0o400); os.close(fd)
                output.append({'pathSHA256': hashlib.sha256(name.encode()).hexdigest(), 'bytes': size, 'sha256': digest.hexdigest()})
        # Consume gzip footer/CRC and bounded ordinary tar zero padding. The
        # laptop still must verify the age decryptor exit0/authentication tag.
        padding = 0
        while body := compressed.read(65536):
            padding += len(body)
            if any(body) or padding > 16_000_000: raise RestoreError('UnexpectedStorageArchiveTail')
    if seen != set(expected_files) or set(directory_metadata) != directories:
        raise RestoreError('MissingStorageObjectsOrDirectoriesAfterRestore')
    for name in sorted(directories, key=lambda item: len(PurePosixPath(item).parts), reverse=True):
        directory = target if name == '.' else target / name
        member = directory_metadata[name]
        if directory.stat().st_uid != owner[0] or directory.stat().st_gid != owner[1]: os.chown(directory, *owner)
        os.chmod(directory, 0o700)
        mtime = int(Decimal(member.pax_headers.get('mtime', str(member.mtime))) * 1_000_000_000)
        atime = int(Decimal(member.pax_headers.get('atime', str(member.mtime))) * 1_000_000_000)
        os.utime(directory, ns=(atime, mtime))
    return {'status': 'STORAGE_RESTORED_NOT_FULLY_VERIFIED', 'files': len(output),
            'bytes': sum(item['bytes'] for item in output), 'manifest': sorted(output, key=lambda row: row['pathSHA256']),
            'plaintextIntermediateArchives': 0, 'sourceAgeAuthenticityVerified': False,
            'fullVerificationPassed': False, 'phaseComplete': False}


def verify_full_manifest(source, target, *, decryptor_exit_code, source_containment, final_containment, clone_denials):
    """Compare actual independent manifests; never prints private comparisons.

    This strict new protocol needs native adapters to populate EVERY field from
    real queries/physical reads. No status-only callback can substitute for the
    exact source/target arrays. Source is encrypted in verification.age; target is
    freshly read from the disposable restored cluster, never source twice.
    """
    fields = {'witness', 'tables', 'sequences', 'catalogObjects', 'extensionVersions', 'rls',
              'authPasswordHashes', 'rolePasswordHashes', 'storage', 'appPrivileges', 'queuePrivileges', 'encoding'}
    if (source is target or type(source) is not dict or type(target) is not dict
            or set(source) != fields or set(target) != fields or type(decryptor_exit_code) is not int or decryptor_exit_code != 0):
        raise RestoreError('AuthenticatedIndependentCompleteManifestsRequired')
    for value in (source, target):
        if (type(value['tables']) is not list or len(value['tables']) != 62
                or type(value['sequences']) is not list or len(value['sequences']) != 2
                or type(value['storage']) is not list or len(value['storage']) != 73
                or type(value['appPrivileges']) is not list or len(value['appPrivileges']) != 552
                or any(type(row) is not dict or not row for row in value['appPrivileges'])
                or type(value['queuePrivileges']) is not dict
                or set(value['queuePrivileges']) != {'ir35_queue', 'ir35_queue_producer'}):
            raise RestoreError('Exact62Tables2Sequences552Privileges73ObjectsRequired')
        if len({json.dumps(row, sort_keys=True, separators=(',', ':')) for row in value['appPrivileges']}) != 552:
            raise RestoreError('All552DistinctBaselinePrivilegeChecksRequired')
        for row in value['tables']:
            if (type(row) is not dict or set(row) != {'name', 'rows', 'md5'} or type(row['name']) is not str
                    or type(row['rows']) is not int or row['rows'] < 0 or not re.fullmatch('[0-9a-f]{32}', row['md5'])):
                raise RestoreError('ExactNamedRowCountsAndOrderedMd5Required')
        if len({row['name'] for row in value['tables']}) != 62:
            raise RestoreError('UniqueFullTableCoverageRequired')
        tables = {row['name']: row for row in value['tables']}
        if not {'auth.users', 'auth.identities', 'auth.mfa_factors'} <= set(tables):
            raise RestoreError('AuthUsersIdentitiesAndMfaCoverageRequired')
        if (type(value['authPasswordHashes']) is not list
                or len(value['authPasswordHashes']) != tables['auth.users']['rows']
                or any(type(row) is not dict or set(row) != {'userIdSHA256', 'passwordMD5'}
                       or not re.fullmatch('[0-9a-f]{64}', row['userIdSHA256'])
                       or row['passwordMD5'] is not None and not re.fullmatch('[0-9a-f]{32}', row['passwordMD5'])
                       for row in value['authPasswordHashes'])
                or len({row['userIdSHA256'] for row in value['authPasswordHashes']}) != len(value['authPasswordHashes'])):
            raise RestoreError('EveryAuthPasswordHashProjectionRequired')
        for row in value['sequences']:
            if (type(row) is not dict or set(row) != {'name', 'lastValue', 'isCalled'}
                    or type(row['name']) is not str or not re.fullmatch('-?[0-9]+', row['lastValue'])
                    or type(row['isCalled']) is not bool):
                raise RestoreError('ExactSequenceValuesAndCalledFlagsRequired')
        if len({row['name'] for row in value['sequences']}) != 2:
            raise RestoreError('TwoUniqueSequencesRequired')
        for row in value['storage']:
            if (type(row) is not dict or set(row) != {'pathSHA256', 'bytes', 'sha256'}
                    or not re.fullmatch('[0-9a-f]{64}', row['pathSHA256']) or type(row['bytes']) is not int or row['bytes'] < 0
                    or not re.fullmatch('[0-9a-f]{64}', row['sha256'])):
                raise RestoreError('ExactStoragePathSizeAndByteHashesRequired')
        if len({row['pathSHA256'] for row in value['storage']}) != 73:
            raise RestoreError('UniqueAll73StoragePathsRequired')
        if (type(value['catalogObjects']) is not list or not value['catalogObjects']
                or any(type(row) is not dict or set(row) != {'kind', 'name', 'hash'}
                       or type(row['kind']) is not str or type(row['name']) is not str
                       or not re.fullmatch('[0-9a-f]{32}', row['hash']) for row in value['catalogObjects'])
                or len({(row['kind'], row['name']) for row in value['catalogObjects']}) != len(value['catalogObjects'])):
            raise RestoreError('FullNamedCatalogObjectsRequired')
        if (type(value['rolePasswordHashes']) is not dict or not value['rolePasswordHashes']
                or any(type(name) is not str or body is not None and not re.fullmatch('[0-9a-f]{32}', body)
                       for name, body in value['rolePasswordHashes'].items())
                or not {row['name'] for row in value['catalogObjects'] if row['kind'] == 'role'} <= set(value['rolePasswordHashes'])):
            raise RestoreError('EveryRolePasswordHashProjectionRequired')
        for role in value['queuePrivileges'].values():
            if type(role) is not dict or any(role.get(key) is not False for key in ('superuser', 'createRole', 'createDatabase', 'replication', 'bypassRLS')):
                raise RestoreError('MinimalQueueRoleAttributesRequired')
        if (type(value['rls']) is not list or len(value['rls']) != 62
                or any(type(row) is not dict or set(row) != {'schema', 'name', 'enabled', 'forced'}
                       or type(row['schema']) is not str or type(row['name']) is not str
                       or type(row['enabled']) is not bool or type(row['forced']) is not bool
                       or row.get('schema') == 'public' and row.get('enabled') is not True for row in value['rls'])
                or {row['schema'] + '.' + row['name'] for row in value['rls']} != set(tables)):
            raise RestoreError('PublicTableRlsDisabledOrMissing')
        if (type(value['encoding']) is not dict or set(value['encoding']) != {'serverEncoding', 'collation', 'unicodeRoundTripMD5'}
                or value['encoding']['serverEncoding'] != 'UTF8' or type(value['encoding']['collation']) is not dict
                or not re.fullmatch('[0-9a-f]{32}', value['encoding']['unicodeRoundTripMD5'])
                or type(value['extensionVersions']) is not dict or not value['extensionVersions']):
            raise RestoreError('Utf8CollationAndUnicodeEvidenceRequired')
    witness_source, witness_target = source['witness'], target['witness']
    if (type(witness_source) is not dict or type(witness_target) is not dict
            or witness_source.get('database') != 'ir35_p5_app'
            or not re.fullmatch('ir35_p8_restore_' + TOKEN, witness_target.get('database', ''))
            or not re.fullmatch('[0-9]{15,20}', str(witness_source.get('clusterSystemIdentifier', '')))
            or not re.fullmatch('[0-9]{15,20}', str(witness_target.get('clusterSystemIdentifier', '')))
            or witness_source['clusterSystemIdentifier'] == witness_target['clusterSystemIdentifier']):
        raise RestoreError('NewIsolatedClusterWitnessRequired_NoSourceRestore')
    compared = []
    for name in sorted(fields - {'witness'}):
        # Canonical JSON orders mapping keys only. No values/columns/rows,
        # exceptions, catalogue objects, user fields or timestamps are omitted.
        if json.dumps(source[name], sort_keys=True, separators=(',', ':')) != json.dumps(target[name], sort_keys=True, separators=(',', ':')):
            raise RestoreError('RestoredManifestMismatch_' + name)
        compared.append(name)
    for proof in (source_containment, final_containment):
        if (type(proof) is not dict or proof.get('status') != 'PASS'
                or proof.get('pg_hba', {}).get('actualLoginChecks') != 112
                or proof.get('pg_hba', {}).get('baseline552Changed') is not False
                or len(proof.get('freshLoginChecks', [])) != 112
                or any(row.get('passed') is not True for row in proof['freshLoginChecks'])):
            raise RestoreError('ActualOriginalFull112HbaContainmentRequired')
        summary = proof.get('containment', {})
        if (summary.get('status') != 'PASS' or summary.get('tablesEach') != 62 or summary.get('sequencesEach') != 2
                or summary.get('storageObjectsEach') != 73 or summary.get('storageSHA256Match') is not True
                or summary.get('appRolePrivilegesEach') != 552 or summary.get('approvedP6RolesEach') != 2
                or summary.get('approvedSchemaExceptionsEach') != 3 or summary.get('baseline552Unchanged') is not True
                or summary.get('orderedMD5Each') is not True or summary.get('manifests') != 'PASS'
                or any(summary.get(name) != 0 for name in ('sourceWrites', 'pristineWrites', 'fixtureWrites'))):
            raise RestoreError('FullOriginalDataStorageRoleContainmentRequired')
        for database in ('pristine', 'P5Fixture'):
            checked = proof.get(database, {})
            if (checked.get('status') != 'PASS' or len(checked.get('tables', [])) != 62
                    or checked.get('sequenceChecks') != 2
                    or checked.get('privileges', {}).get('status') != 'PASS'
                    or checked['privileges'].get('sourceEntries') != 552
                    or checked.get('dataDifferences') != []):
                raise RestoreError('OriginalFullDatabaseContainmentRequired')
    if (type(clone_denials) is not list or len(clone_denials) != 8
            or any(row.get('passed') is not True or row.get('connected') is not False
                   or row.get('explicitHBAReject') is not True or row.get('database') != witness_target['database'] for row in clone_denials)
            or {(row.get('role'), row.get('transport')) for row in clone_denials}
               != {(role, mode) for role in ('ir35_queue', 'ir35_queue_producer')
                   for mode in ('docker-tcp', 'local', 'ipv4-loopback', 'ipv6-loopback')}):
        raise RestoreError('AllEightActualDisposableQueueLoginDenialsRequired')
    return {'status': 'VERIFICATION_PASS', 'tablesChecked': 62, 'sequencesChecked': 2,
            'authUsersChecked': len(source['authPasswordHashes']), 'rolePasswordHashesChecked': len(source['rolePasswordHashes']),
            'storageObjectsChecked': 73, 'appRolePrivilegesChecked': 552,
            'queueRolesChecked': 2, 'originalHbaChecksBefore': 112, 'originalHbaChecksAfter': 112,
            'disposableQueueDenials': 8, 'sectionsCompared': compared,
            'privateValuesPrinted': False, 'phaseComplete': False}


if __name__ == '__main__':
    raise SystemExit('Library only: attested disposable target and local authenticated decrypt stream required')
