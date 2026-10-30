"""Encrypted generation + create-only single-part Object Storage transport.

Importing this module does nothing. The operator must supply *fresh measured*
capacity and a live exported snapshot for EACH database; no booleans here prove
native custody, a consistent source, eligibility, or a restore. Timer installation
is deliberately separate. No source-private identity, API key, delete, multipart,
overwrite, role/ACL repair, plaintext archive, or automatic retry exists here.
"""
from datetime import datetime, timezone
import base64
import hashlib
import json
import os
from pathlib import Path
import re
import stat

from backup_stream import encrypt_part, recipient_file, HEADER
from p8_backup_policy import generation_object, single_part_upload, usage_budget, REGION, BUCKET

BASE = Path('/opt/ir35/data/backup-ciphertext')
PARTS = ('database', 'globals', 'queue', 'storage', 'verification')
MAX_BYTES = 8_000_000_000


class GenerationError(RuntimeError):
    """Fixed non-secret codes only; never interpolate native/OCI exceptions."""


def _json(value):
    return (json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=True) + '\n').encode()


def _clock(value):
    if type(value) is not datetime or value.tzinfo != timezone.utc or value.microsecond:
        raise GenerationError('WholeSecondUtcGenerationRequired')
    return value.strftime('%Y%m%dT%H%M%SZ')


def _directory(path, uid):
    path = Path(path)
    if path.absolute() != path.resolve() or path.is_symlink():
        raise GenerationError('PhysicalOwnedCiphertextDirectoryRequired')
    info = path.lstat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != uid or stat.S_IMODE(info.st_mode) != 0o700:
        raise GenerationError('Owner700CiphertextDirectoryRequired')
    return path


def _ciphertext(path, uid):
    path = Path(path)
    if path.absolute() != path.resolve() or path.is_symlink():
        raise GenerationError('PhysicalCiphertextRequired')
    with _open_ciphertext(path, uid) as source:
        return _hash_ciphertext(source)


def _open_ciphertext(path, uid):
    # O_NOFOLLOW on the actual descriptor, not only an earlier path check.
    # The uploader hashes and sends this SAME open file, so a path replacement
    # cannot redirect its later read to an env/private-identity file.
    path = Path(path)
    if path.absolute() != path.resolve() or path.is_symlink():
        raise GenerationError('PhysicalCiphertextRequired')
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        info = os.fstat(fd)
        if (not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or info.st_uid != uid
                or stat.S_IMODE(info.st_mode) != 0o400 or not 0 < info.st_size <= MAX_BYTES):
            raise GenerationError('SealedOwnedCiphertextRequired')
        source = os.fdopen(fd, 'rb')
    except BaseException:
        os.close(fd)
        raise
    return source


def _hash_ciphertext(source):
    before = os.fstat(source.fileno())
    sha, md5, size = hashlib.sha256(), hashlib.md5(), 0
    if source.read(len(HEADER)) != HEADER:
        raise GenerationError('AgeCiphertextFramingRequired')
    source.seek(0)
    while body := source.read(1024 * 1024):
        sha.update(body); md5.update(body); size += len(body)
        if size > MAX_BYTES:
            raise GenerationError('CiphertextReadBudgetExceeded')
    after = os.fstat(source.fileno())
    if (size != before.st_size or any(getattr(before, field) != getattr(after, field)
            for field in ('st_dev', 'st_ino', 'st_size', 'st_mtime_ns', 'st_ctime_ns'))):
        raise GenerationError('CiphertextChangedWhileHashing')
    source.seek(0)
    return {'bytes': size, 'sha256': sha.hexdigest(), 'contentMd5': base64.b64encode(md5.digest()).decode()}


def prepare_generation(generation, recipient, snapshots, verification_bytes, *, source_sha, uid=None):
    """Run the existing full-schema dump/tar -> age producers, ciphertext only.

    Source writers/queue/auth cleanup must already be quiescent and verified by
    the native caller, and snapshot holder transactions remain open until this
    returns. Database and queue snapshots are separate PostgreSQL transactions.
    A fresh failed directory is intentionally retained and never retried.
    """
    uid = os.geteuid() if uid is None else uid
    if type(uid) is not int or uid != os.geteuid():
        raise GenerationError('CurrentServiceOwnerRequired')
    identity = _clock(generation)
    if type(source_sha) is not str or not re.fullmatch('[0-9a-f]{40}', source_sha):
        raise GenerationError('VerifiedSourceShaRequired')
    if (type(snapshots) is not dict or set(snapshots) != {'database', 'queue'}
            or any(type(value) is not str or not re.fullmatch('[0-9A-F]{8}-[0-9A-F]{8}-[1-9][0-9]*', value) for value in snapshots.values())):
        raise GenerationError('TwoLiveDatabaseSnapshotHandlesRequired')
    if type(verification_bytes) is not bytes or not 0 < len(verification_bytes) <= 16_000_000:
        raise GenerationError('BoundedPrivateVerificationDocumentRequired')
    try:
        if type(json.loads(verification_bytes)) is not dict:
            raise ValueError()
    except Exception:
        raise GenerationError('PrivateVerificationJsonRequired_RawWithheld') from None
    parent = _directory(BASE, uid)
    recipient_file(recipient, uid)
    target = parent / identity
    target.mkdir(mode=0o700)  # O_EXCL directory; includes failed/partial attempts.
    records = []
    remaining = MAX_BYTES
    for part in PARTS:
        args = {'snapshot': snapshots[part]} if part in snapshots else {}
        if part == 'verification':
            args['input_bytes'] = verification_bytes
        encrypted = encrypt_part(part, recipient, target / (part + '.age'), uid=uid,
                                 maximum_bytes=remaining, **args)
        observed = _ciphertext(target / (part + '.age'), uid)
        if observed['bytes'] != encrypted['ciphertextBytes'] or observed['sha256'] != encrypted['ciphertextSHA256']:
            raise GenerationError('EncryptedPartReadbackMismatch')
        records.append({'part': part, 'bytes': observed['bytes'], 'sha256': observed['sha256']})
        remaining -= observed['bytes']
        if remaining <= 0:
            raise GenerationError('GenerationExceedsEightGb_NoUpload')
    manifest = {'format': 'ir35-age-backup-v1', 'generation': identity, 'sourceSHA': source_sha,
                'database': 'ir35_p5_app', 'queueDatabase': 'postgres', 'parts': records,
                'privateIdentityOnVm': False, 'restoreVerified': False}
    # Reuse the existing proven RAM->age path without changing its part/name
    # assertions: complete/verification.age is uploaded as complete.age LAST.
    commit_directory = target / 'complete'
    commit_directory.mkdir(mode=0o700)
    encrypt_part('verification', recipient, commit_directory / 'verification.age', uid=uid,
                 maximum_bytes=remaining, input_bytes=_json(manifest))
    complete = _ciphertext(commit_directory / 'verification.age', uid)
    if sum(row['bytes'] for row in records) + complete['bytes'] > MAX_BYTES:
        raise GenerationError('GenerationIncludingCommitExceedsEightGb_NoUpload')
    return {'status': 'ENCRYPTED_NOT_UPLOADED', 'generation': identity, 'sourceSHA': source_sha,
            'parts': records, 'complete': {'bytes': complete['bytes'], 'sha256': complete['sha256']},
            'plaintextIntermediateFiles': 0, 'restoreVerified': False, 'phaseComplete': False}


def validate_index(index):
    if type(index) is not dict or index.get('status') != 'ENCRYPTED_NOT_UPLOADED':
        raise GenerationError('PreparedEncryptedIndexRequired')
    try:
        generation = datetime.strptime(index['generation'], '%Y%m%dT%H%M%SZ').replace(tzinfo=timezone.utc)
    except Exception:
        raise GenerationError('UtcGenerationIndexRequired') from None
    if type(index.get('sourceSHA')) is not str or not re.fullmatch('[0-9a-f]{40}', index['sourceSHA']):
        raise GenerationError('SourceBoundEncryptedIndexRequired')
    rows = index.get('parts')
    if type(rows) is not list or [row.get('part') for row in rows if type(row) is dict] != list(PARTS):
        raise GenerationError('AllFiveOrderedBackupPartsRequired')
    for position, row in enumerate(rows + [index.get('complete')]):
        expected = {'part', 'bytes', 'sha256'} if position < len(PARTS) else {'bytes', 'sha256'}
        if (type(row) is not dict or set(row) != expected
                or type(row.get('bytes')) is not int or not 0 < row['bytes'] <= MAX_BYTES
                or type(row.get('sha256')) is not str or not re.fullmatch('[0-9a-f]{64}', row['sha256'])):
            raise GenerationError('ExactCiphertextSizeAndSha256Required')
    if sum(row['bytes'] for row in rows) + index['complete']['bytes'] > MAX_BYTES:
        raise GenerationError('CompleteGenerationExceedsEightGb')
    return generation


def _new_client():
    # Imported/instantiated ONLY on explicit native upload; no profile/API-key
    # config, environment credential lookup or automatic SDK retry strategy.
    import oci
    signer = oci.auth.signers.InstancePrincipalsSecurityTokenSigner()
    return oci.object_storage.ObjectStorageClient(
        config={'region': REGION}, signer=signer, retry_strategy=oci.retry.NoneRetryStrategy())


def upload_generation(index, namespace, capacity, record, *, uid=None, _transport=None):
    """PUT new encrypted objects and verify HEAD + streamed GET; commit LAST.

    `capacity` must return freshly authenticated usage_budget kwargs except
    new_ciphertext_bytes/planned_requests/now. It must include versions, all
    multipart parts, outer-tenancy usage and monthly request counts. A VM whose
    narrow IAM cannot measure these MUST fail closed, never use cached defaults.
    `record(name,dict)` MUST be an exclusive journal writer, not a print/logger.
    Neither this callback nor an input shape substitutes for real measurements.
    """
    uid = os.geteuid() if uid is None else uid
    if type(uid) is not int or uid != os.geteuid():
        raise GenerationError('CurrentServiceOwnerRequired')
    generation = validate_index(index)
    if not callable(capacity) or not callable(record):
        raise GenerationError('FreshCapacityAndExclusiveJournalRequired')
    target = _directory(_directory(BASE, uid) / index['generation'], uid)
    # Validate namespace before creating a client or reading IMDS.
    single_part_upload(namespace=namespace, generation=generation, part='database')
    client = _transport
    rows = [*index['parts'], {'part': 'complete', **index['complete']}]
    uploaded = []
    for number, row in enumerate(rows, 1):
        part = row['part']
        path = target / (part + '.age') if part != 'complete' else target / 'complete/verification.age'
        observed = _ciphertext(path, uid)
        if any(observed[field] != row[field] for field in ('bytes', 'sha256')):
            raise GenerationError('SealedCiphertextIndexMismatch_NoPut')
        incoming = sum(item['bytes'] for item in rows[number - 1:])
        try:
            budget = capacity()
        except Exception:
            raise GenerationError('FreshMeasuredCapacityUnavailable_NoPut') from None
        if type(budget) is not dict or set(budget) & {'new_ciphertext_bytes', 'planned_requests', 'now'}:
            raise GenerationError('MeasuredCapacityFieldsRequired_NoOverrides')
        checked = usage_budget(**budget, new_ciphertext_bytes=incoming,
                               planned_requests=(len(rows) - number + 1) * 3, now=datetime.now(timezone.utc))
        spec = single_part_upload(namespace=namespace, generation=generation, part=part)['request']
        result = {'status': 'FAIL', 'part': part, 'objectNameSHA256': hashlib.sha256(spec['object_name'].encode()).hexdigest(),
                  'bytes': row['bytes'], 'sha256': row['sha256'], 'multipart': False, 'overwrite': False,
                  'deleteRequests': 0, 'automaticRetries': 0}
        record(f'backup-{number:02d}-{part}-intent.json', result | {'operation': 'PutNewObjectThenHeadGet',
               'usage': checked, 'commitMarker': part == 'complete'})
        try:
            if client is None:
                client = _new_client()
            with _open_ciphertext(path, uid) as source:
                sending = _hash_ciphertext(source)
                if any(sending[field] != observed[field] for field in ('bytes', 'sha256', 'contentMd5')):
                    raise GenerationError('CiphertextChangedBeforePut_NoPut')
                # SDK's direct put_object only; known content length prevents
                # CLI stdin/multipart convenience and If-None-Match forbids overwrite.
                put = client.put_object(**spec, put_object_body=source, content_length=row['bytes'],
                                        content_md5=observed['contentMd5'])
            if put.status != 200:
                raise GenerationError('SinglePartPutStatusMismatch')
            selectors = {key: spec[key] for key in ('namespace_name', 'bucket_name', 'object_name')}
            head = client.head_object(**selectors)
            if head.status != 200 or int(head.headers.get('content-length', '-1')) != row['bytes']:
                raise GenerationError('ObjectHeadSizeMismatch')
            downloaded = client.get_object(**selectors)
            if downloaded.status != 200:
                raise GenerationError('ObjectGetStatusMismatch')
            digest, count = hashlib.sha256(), 0
            try:
                for chunk in downloaded.data.raw.stream(1024 * 1024, decode_content=False):
                    if type(chunk) is not bytes:
                        raise GenerationError('ExactCiphertextReadbackBytesRequired')
                    count += len(chunk)
                    if count > row['bytes']:
                        raise GenerationError('ObjectReadbackTooLong')
                    digest.update(chunk)
            finally:
                downloaded.data.close()
            if count != row['bytes'] or digest.hexdigest() != row['sha256']:
                raise GenerationError('ObjectReadbackSha256Mismatch')
            result.update(status='UPLOADED_VERIFIED', headBytes=count, getSha256=digest.hexdigest())
        except Exception as error:
            result['code'] = str(error) if type(error) is GenerationError else type(error).__name__
            result['ambiguousPutMustBeReconciledBeforeAnotherAttempt'] = True
        record(f'backup-{number:02d}-{part}-result.json', result)
        if result['status'] != 'UPLOADED_VERIFIED':
            raise GenerationError('GenerationUploadStopped_JournalRetained_NoRetry')
        uploaded.append(result)
    return {'status': 'COMMITTED_CIPHERTEXT', 'objects': len(uploaded), 'parts': uploaded,
            'commitMarkerLast': uploaded[-1]['part'] == 'complete', 'deleteRequests': 0,
            'restoreVerified': False, 'phaseComplete': False}


def nightly_units():
    """Configuration only. Root must wire/prove runner+fresh usage first.

    Root service is intentional: ir35 MUST NOT gain Docker-socket/group access.
    The installed runner must be immutable root-owned code, not ir35-writable.
    Encrypted outputs live in a root700 directory; private age identities never do.
    """
    return {'service': '''[Unit]
Description=IR35 encrypted staging backup (fail closed)
Requires=docker.service
After=docker.service network-online.target
ConditionPathIsReadWrite=/opt/ir35/data
[Service]
Type=oneshot
User=root
Group=root
UMask=0077
ExecStart=/usr/bin/python3 -I /opt/ir35/bin/backup-nightly.py --staging-only
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/opt/ir35/data/backup-ciphertext /opt/ir35/.env.p8-backup-runs
MemoryMax=512M
TimeoutStartSec=1800
StandardOutput=null
StandardError=null
''', 'timer': '''[Unit]
Description=IR35 nightly encrypted staging backup
[Timer]
OnCalendar=*-*-* 02:15:00 UTC
Persistent=true
RandomizedDelaySec=0
Unit=ir35-backup.service
[Install]
WantedBy=timers.target
''', 'installed': False, 'enabled': False, 'nativeRestoreProven': False,
        'requiresProvenNativeRunnerAndFreshUsage': True, 'vmDeletePermissionRequired': False}


if __name__ == '__main__':
    raise SystemExit('Library only: native snapshot, custody, capacity and restore gates required')
