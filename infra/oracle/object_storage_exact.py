"""Exact GET/list-only Object Storage accounting; no object names in evidence.

Version listings include current versions: count those bytes ONCE, then add
unfinished multipart PART bytes. Two identical complete passes are mandatory.
SDK imports are lazy; CI unit tests need no owner files, OCI SDK or network.
"""
from datetime import datetime, timezone
import hashlib
import json
import logging
import re

from key_ceremony import KeySafetyError

LIMIT = 20_000_000_000
STOP_AT = LIMIT * 80 // 100
OWNER_CAP = 8_000_000_000
FIELDS = 'name,size,etag,md5,storageTier'
READS = {'get_bucket', 'list_buckets', 'list_objects', 'list_object_versions', 'list_multipart_uploads', 'list_multipart_upload_parts'}


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def field(value, name, default=None):
    return value.get(name, default) if isinstance(value, dict) else getattr(value, name, default)


def size(value):
    if type(value) is not int or not 0 <= value <= 2**63-1:
        raise KeySafetyError('UnclearStorageSize_Stop_NoEstimate')
    return value


def text(value):
    if not isinstance(value, str) or not value or len(value) > 4096:
        raise KeySafetyError('UnclearStorageIdentity_Stop')
    return value


class SecurityTokenReads:
    """Fixed London endpoint, existing browser signer, verified TLS, NO retries."""
    def __init__(self, profile):
        self.identity = {key: profile[key] for key in ('tenancy', 'user')}

    def read(self, operation, namespace, **kwargs):
        if operation not in READS or not re.fullmatch(r'[a-z0-9]{1,63}', namespace or ''):
            raise KeySafetyError('ObjectStorageReadOutsideFixedScope')
        from security_session import ensure_session, private_file, SESSION
        profile = ensure_session()
        if any(profile[key] != value for key, value in self.identity.items()):
            raise KeySafetyError('ObjectStorageBrowserIdentityChanged')
        import oci
        # Never use an API-key/default signer or a passphrase. These are ONLY
        # the existing owner600 ephemeral browser-session files.
        key = oci.signer.load_private_key(private_file(SESSION / 'oci_api_key.pem'), None)
        signer = oci.auth.signers.SecurityTokenSigner(private_file(SESSION / 'token'), key)
        logging.getLogger('oci').disabled = True
        client = oci.object_storage.ObjectStorageClient({'region': 'uk-london-1'}, signer=signer,
                   service_endpoint='https://objectstorage.uk-london-1.oraclecloud.com',
                   retry_strategy=oci.retry.NoneRetryStrategy(), timeout=(5, 30))
        client.base_client.logger.disabled = True
        client.base_client.session.trust_env = False
        try:
            response = getattr(client, operation)(namespace, retry_strategy=oci.retry.NoneRetryStrategy(), **kwargs)
            return response.data, {str(k).lower(): v for k, v in response.headers.items()}
        except Exception as error:
            status = getattr(error, 'status', None)
            code = getattr(error, 'code', None)
            if type(status) is not int:
                status = 'unknown'
            if not isinstance(code, str) or not re.fullmatch(r'[A-Za-z][A-Za-z0-9_]{0,63}', code):
                code = type(error).__name__
            raise KeySafetyError('ObjectStorageReadFailed_' + operation + '_' + str(status) + '_' + code + '; raw response suppressed') from None
        finally:
            client.base_client.session.close()


class Counter:
    def __init__(self, api, *, record=lambda name, value: None):
        self.api = api
        self.record = record
        self.requests = 0

    def call(self, op, namespace, **kwargs):
        if op not in READS:
            raise KeySafetyError('ReadOnlyStorageOperationRequired')
        self.requests += 1
        if self.requests > 10_000:
            raise KeySafetyError('ObjectStorageRequestBoundExceeded_UnclearTotal')
        label = f'{self.requests:05d}-{op}'
        self.record(label + '-intent', {'operation': op, 'method': 'GET', 'selectorSHA256': digest(kwargs)})
        try:
            data, headers = self.api.read(op, namespace, **kwargs)
        except Exception as error:
            self.record(label + '-result', {'status': 'FAIL', 'code': str(error) if isinstance(error, KeySafetyError) else type(error).__name__})
            raise
        self.record(label + '-result', {'status': 'PASS', 'httpSuccess': True, 'nextPagePresent': bool(headers.get('opc-next-page'))})
        return data, headers

    def pages(self, op, namespace, bucket=None, **selectors):
        cursor = None
        seen = set()
        rows = []
        for _ in range(1000):
            kwargs = {'limit': 1000, **selectors}
            if bucket is not None:
                kwargs['bucket_name'] = bucket
            if cursor is not None:
                kwargs['start' if op == 'list_objects' else 'page'] = cursor
            if op in ('list_objects', 'list_object_versions'):
                kwargs['fields'] = FIELDS
            data, headers = self.call(op, namespace, **kwargs)
            if op == 'list_objects':
                batch, after = field(data, 'objects'), field(data, 'next_start_with')
                if headers.get('opc-next-page'):
                    raise KeySafetyError('UnexpectedObjectPaginationHeader_Stop')
            elif op == 'list_object_versions':
                batch, after = field(data, 'items'), headers.get('opc-next-page')
            else:
                batch, after = data, headers.get('opc-next-page')
            if field(data, 'prefixes') not in (None, []):
                raise KeySafetyError('StorageListingContainsFilteredPrefixes_Stop')
            if not isinstance(batch, list):
                raise KeySafetyError('IncompleteObjectStoragePage_Stop')
            rows.extend(batch)
            if not after:
                return rows
            after = text(after)
            if after in seen:
                raise KeySafetyError('RepeatedStoragePageCursor_Stop_NoPartialTotal')
            seen.add(after)
            cursor = after  # Empty pages with next-page MUST continue.
        raise KeySafetyError('StoragePaginationBoundExceeded_UnclearTotal')

    def snapshot(self, namespace, bucket, compartment):
        metadata, _ = self.call('get_bucket', namespace, bucket_name=bucket, fields=['autoTiering'])
        config = {name: field(metadata, name) for name in ('name', 'compartment_id', 'storage_tier', 'versioning', 'auto_tiering', 'public_access_type')}
        if config['name'] != bucket or config['compartment_id'] != compartment:
            raise KeySafetyError('BucketIdentityMismatch_Stop')
        if config['storage_tier'] != 'Standard' or config['auto_tiering'] != 'Disabled':
            raise KeySafetyError('OnlyExplicitStandardTierWithoutAutoTieringApproved')
        if config['versioning'] not in ('Disabled', 'Enabled', 'Suspended') or config['public_access_type'] != 'NoPublicAccess':
            raise KeySafetyError('UnclearOrPublicBucketConfiguration_Stop')
        current = self.pages('list_objects', namespace, bucket)
        versions = self.pages('list_object_versions', namespace, bucket)
        uploads = self.pages('list_multipart_uploads', namespace, bucket)
        live, stored, multipart = {}, {}, {}
        total_versions = 0
        markers = 0
        for obj in current:
            name, etag = text(field(obj, 'name')), text(field(obj, 'etag'))
            count = size(field(obj, 'size'))
            if field(obj, 'storage_tier') != 'Standard' or name in live:
                raise KeySafetyError('ObjectTierOrDuplicateNameUnclear_Stop')
            live[name] = (etag, count)
        for obj in versions:
            name = text(field(obj, 'name'))
            version = field(obj, 'version_id')
            if version is None and config['versioning'] != 'Disabled':
                raise KeySafetyError('MissingVersionIdentity_Stop')
            if version is not None:
                text(version)
            key = (name, version)
            marker = field(obj, 'is_delete_marker')
            if type(marker) is not bool or key in stored:
                raise KeySafetyError('UnclearOrDuplicateObjectVersion_Stop')
            count = size(field(obj, 'size'))  # NULL is never guessed as zero.
            if marker:
                if count != 0:
                    raise KeySafetyError('UnclearDeleteMarkerSize_Stop')
                etag = None
                markers += 1
            else:
                etag = text(field(obj, 'etag'))
                if field(obj, 'storage_tier') != 'Standard':
                    raise KeySafetyError('NonStandardObjectVersion_Stop')
            stored[key] = (etag, count, marker)
            total_versions += count
        for name, value in live.items():
            if not any(key[0] == name and stored_value[:2] == value and stored_value[2] is False for key, stored_value in stored.items()):
                raise KeySafetyError('CurrentObjectMissingFromVersionAccounting_Stop')
        multipart_bytes = 0
        part_count = 0
        for upload in uploads:
            obj, upload_id = text(field(upload, 'object')), text(field(upload, 'upload_id'))
            identity = (obj, upload_id)
            if identity in multipart or field(upload, 'storage_tier') != 'Standard':
                raise KeySafetyError('MultipartIdentityOrTierUnclear_Stop')
            parts = self.pages('list_multipart_upload_parts', namespace, bucket, object_name=obj, upload_id=upload_id)
            seen_parts = {}
            for part in parts:
                number = field(part, 'part_number')
                count = size(field(part, 'size'))
                if type(number) is not int or not 1 <= number <= 10_000 or number in seen_parts:
                    raise KeySafetyError('UnclearOrDuplicateMultipartPart_Stop')
                seen_parts[number] = (text(field(part, 'etag')), count)
                multipart_bytes += count
                part_count += 1
            multipart[identity] = sorted(seen_parts.items())
        end, _ = self.call('get_bucket', namespace, bucket_name=bucket, fields=['autoTiering'])
        if config != {name: field(end, name) for name in config}:
            raise KeySafetyError('BucketChangedDuringExactAudit_Stop')
        manifest = {'config': config, 'current': sorted(live.items()),
                    'versions': sorted([(name, version, *value) for (name, version), value in stored.items()], key=lambda row: (row[0], row[1] or '')),
                    'multipart': sorted([(name, upload_id, parts) for (name, upload_id), parts in multipart.items()])}
        return {'bucket': bucket, 'objectCount': len(live), 'versionCount': len(stored), 'deleteMarkerCount': markers,
                'versionBytesIncludingCurrent': total_versions, 'unfinishedUploadCount': len(uploads),
                'unfinishedPartCount': part_count, 'unfinishedPartBytes': multipart_bytes,
                'totalBytes': total_versions + multipart_bytes, 'manifestSHA256': digest(manifest), 'tier': 'Standard'}

    def audit(self, namespace, buckets):
        if len({name for name, _ in buckets}) != len(buckets):
            raise KeySafetyError('DuplicateBucketInExactAudit_Stop')
        reports = []
        for bucket, compartment in sorted(buckets):
            if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.:-]{0,254}', bucket or ''):
                raise KeySafetyError('UnsafeBucketName_Stop')
            first = self.snapshot(namespace, bucket, compartment)
            second = self.snapshot(namespace, bucket, compartment)
            self.record('bucket-' + digest(bucket)[:16] + '-first', first)
            self.record('bucket-' + digest(bucket)[:16] + '-second', second)
            if first != second:
                raise KeySafetyError('StorageChangedBetweenCompletePasses_UnclearTotal_Stop')
            reports.append(second)
        total = sum(row['totalBytes'] for row in reports)
        proof = {'accountingVersion': 1, 'checkedAt': datetime.now(timezone.utc).isoformat(), 'buckets': len(reports), 'bucketReports': reports,
                 'exactBytes': total, 'exactBytesProven': True, 'stableCompletePasses': 2, 'requests': self.requests,
                 'freeAllowanceBytes': LIMIT, 'eightyPercentBytes': STOP_AT, 'overEightyPercent': total > STOP_AT,
                 'ownerBackupCapBytes': OWNER_CAP, 'standardOnly': True, 'mutations': 0}
        self.record('exact-total', proof)
        if total > STOP_AT:
            raise KeySafetyError('ExactStorageUsageOver80PercentOf20GB_Stop')
        if total > OWNER_CAP:
            raise KeySafetyError('ExactStorageUsageOverExisting8GBBackupCap_Stop')
        return proof

    def full_audit(self, namespace, compartments, expected_buckets=None):
        if not compartments or len(set(compartments)) != len(compartments):
            raise KeySafetyError('ExplicitUniqueCompartmentScopeRequired')
        def discover():
            found = []
            for compartment in sorted(compartments):
                for bucket in self.pages('list_buckets', namespace, compartment_id=compartment):
                    if field(bucket, 'compartment_id') != compartment:
                        raise KeySafetyError('ListedBucketCompartmentMismatch_Stop')
                    found.append((text(field(bucket, 'name')), compartment))
            if len({name for name, _ in found}) != len(found):
                raise KeySafetyError('DuplicateBucketAcrossPages_Stop')
            return sorted(found)
        first = discover()
        if expected_buckets is not None and first != sorted(expected_buckets):
            raise KeySafetyError('BucketSetChangedSinceResourceInventory_Stop')
        proof = self.audit(namespace, first)
        if discover() != first:
            raise KeySafetyError('BucketSetChangedDuringExactAudit_Stop')
        return proof | {'bucketListingStable': True, 'compartmentsInspected': len(compartments), 'requests': self.requests}
