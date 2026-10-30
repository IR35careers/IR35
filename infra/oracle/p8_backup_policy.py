"""Pure owner-approved P8 backup scope; no CLI, network, IAM or object action.

These builders validate the exact requested resources, not effective IAM.
The native controller must independently authenticate, inspect every applicable
policy/dynamic group and prove fresh free usage before a create/upload. An
existing lifecycle service grant is mandatory: this module never creates or
silently approves its additional deletion/bucket permissions.
"""
from datetime import datetime, timedelta, timezone
import re

REGION = 'uk-london-1'
INSTANCE = 'ocid1.instance.oc1.uk-london-1.anwgiljrr72xucychx35t4jbeiaep4qncwolllegqazy3krrryoz7pxqusya'
COMPARTMENT = 'ocid1.compartment.oc1..aaaaaaaa3k65nsyhjrq3gcjs5gvdvdnpdty3x4ktk6m3drs7dfgnsdmwh3nq'
BUCKET = 'ir35-backups'
DYNAMIC_GROUP = 'ir35-backup-vm'
POLICY_NAME = 'ir35-backup-object-access'
PERMISSIONS = ('OBJECT_CREATE', 'OBJECT_INSPECT', 'OBJECT_READ')
LIFECYCLE_MINIMUM = frozenset(('BUCKET_INSPECT', 'BUCKET_READ', 'OBJECT_INSPECT', 'OBJECT_DELETE'))
OWNER_CAP = 8_000_000_000
FREE_COMBINED_CAP = 20_000_000_000
TRIAL_STANDARD_CAP = 10_000_000_000
FREE_MONTHLY_REQUESTS = 50_000
PREFIX = 'ir35-backups-v1'
PARTS = frozenset(('database', 'globals', 'queue', 'storage', 'verification', 'complete'))


class BackupScopeError(ValueError):
    """Fixed codes only; no supplied values/credentials in an error."""


def _scope(instance_id=INSTANCE, compartment_id=COMPARTMENT, bucket_name=BUCKET):
    if instance_id != INSTANCE or compartment_id != COMPARTMENT or bucket_name != BUCKET:
        raise BackupScopeError('ExactExistingOneVmOneBucketScopeRequired')


def matching_rule(*, instance_id=INSTANCE):
    _scope(instance_id=instance_id)
    return "instance.id = '" + INSTANCE + "'"


def policy_statement(*, compartment_id=COMPARTMENT, bucket_name=BUCKET, group_name=DYNAMIC_GROUP):
    _scope(compartment_id=compartment_id, bucket_name=bucket_name)
    if group_name != DYNAMIC_GROUP:
        raise BackupScopeError('ExactBackupDynamicGroupNameRequired')
    permissions = ', '.join("request.permission='" + item + "'" for item in PERMISSIONS)
    return ("Allow dynamic-group " + DYNAMIC_GROUP + " to manage objects in compartment id " + COMPARTMENT
            + " where all {target.bucket.name='" + BUCKET + "', any {" + permissions + '}}')


def validate_group(row):
    if (type(row) is not dict or row.get('name') != DYNAMIC_GROUP or row.get('lifecycle-state') != 'ACTIVE'
            or row.get('matching-rule') != matching_rule()):
        raise BackupScopeError('ExactActiveSingleInstanceDynamicGroupRequired')
    return {'status': 'PASS', 'name': DYNAMIC_GROUP, 'instanceId': INSTANCE, 'matchingRule': matching_rule()}


def validate_policy(row):
    # Exact statement list prevents an additional unnoticed broad grant. This
    # does NOT inspect other tenancy policies or prove effective permissions.
    if (type(row) is not dict or row.get('name') != POLICY_NAME or row.get('lifecycle-state') != 'ACTIVE'
            or row.get('compartment-id') != COMPARTMENT or row.get('statements') != [policy_statement()]):
        raise BackupScopeError('ExactActiveChildScopedThreePermissionPolicyRequired')
    return {'status': 'PASS', 'name': POLICY_NAME, 'permissions': list(PERMISSIONS),
            'bucket': BUCKET, 'compartmentId': COMPARTMENT, 'effectiveIamProven': False}


def validate_bucket(row, all_compartment_bucket_names):
    if (type(all_compartment_bucket_names) is not list or not all_compartment_bucket_names
            or any(type(name) is not str or not name for name in all_compartment_bucket_names)
            or sum(name.casefold() == BUCKET.casefold() for name in all_compartment_bucket_names) != 1
            or BUCKET not in all_compartment_bucket_names):
        # OCI target.bucket.name condition matching is case-insensitive.
        raise BackupScopeError('CompleteUniqueCasefoldBucketInventoryRequired')
    if (type(row) is not dict or row.get('name') != BUCKET or row.get('compartment-id') != COMPARTMENT
            or row.get('storage-tier') != 'Standard' or row.get('public-access-type') != 'NoPublicAccess'
            or row.get('versioning') != 'Disabled' or row.get('auto-tiering') != 'Disabled'
            or row.get('is-read-only') is not False):
        raise BackupScopeError('ExplicitPrivateStandardVersionOffWritableBucketRequired')
    return {'status': 'PASS', 'bucket': BUCKET, 'tier': 'Standard', 'private': True,
            'casefoldCollision': False, 'versioning': 'Disabled', 'autoTiering': 'Disabled'}


def _count(value):
    if type(value) is not int or value < 0:
        raise BackupScopeError('ExactNonnegativeIntegerRequired')
    return value


def usage_budget(*, bucket_bytes, tenancy_standard_bytes, tenancy_all_tier_bytes, new_ciphertext_bytes,
                 monthly_requests_so_far, planned_requests, exact_inventory, exact_request_count,
                 account_state, checked_at, now):
    """Totals MUST include current objects, versions and unfinished parts.

    Input flags are shape checks, NOT authentication/measurement substitutes.
    Lifetime/pruning is asynchronous: never subtract expected expired objects
    or use an estimate to fit an upload. Count every prospective ciphertext,
    encrypted manifest/commit marker and all planned API calls before uploading.
    """
    if (type(checked_at) is not datetime or type(now) is not datetime
            or checked_at.tzinfo != timezone.utc or now.tzinfo != timezone.utc
            or checked_at > now or now - checked_at > timedelta(minutes=5)):
        raise BackupScopeError('FreshUtcAuthenticatedUsageRequired')
    if exact_inventory is not True or exact_request_count is not True:
        raise BackupScopeError('ExactObjectVersionMultipartAndMonthlyRequestEvidenceRequired')
    if account_state not in ('FREE_TRIAL', 'ALWAYS_FREE'):
        raise BackupScopeError('VerifiedFreeAccountStateRequired_NoUpgrade')
    bucket, standard, total, incoming, requests, planned = map(_count,
        (bucket_bytes, tenancy_standard_bytes, tenancy_all_tier_bytes, new_ciphertext_bytes,
         monthly_requests_so_far, planned_requests))
    if not bucket <= standard <= total:
        raise BackupScopeError('ConsistentExactUsageInventoryRequired')
    if total * 5 > FREE_COMBINED_CAP * 4 or (total + incoming) * 5 > FREE_COMBINED_CAP * 4:
        raise BackupScopeError('CombinedStorageAboveEightyPercent_Stop')
    if bucket + incoming > OWNER_CAP:
        raise BackupScopeError('UploadOverlapExceedsEightGb_Stop_NoPredelete')
    standard_cap = TRIAL_STANDARD_CAP if account_state == 'FREE_TRIAL' else FREE_COMBINED_CAP
    if standard + incoming > standard_cap or total + incoming > FREE_COMBINED_CAP:
        raise BackupScopeError('AlwaysFreeStorageEnvelopeExceeded_Stop')
    if requests + planned > FREE_MONTHLY_REQUESTS:
        raise BackupScopeError('AlwaysFreeMonthlyRequestEnvelopeExceeded_Stop')
    return {'status': 'PASS', 'bucket': BUCKET, 'ownerCapBytes': OWNER_CAP, 'beforeBytes': bucket,
            'uploadOverlapBytes': bucket + incoming, 'tenancyStandardAfterBytes': standard + incoming,
            'tenancyCombinedAfterBytes': total + incoming, 'standardFreeCapBytes': standard_cap,
            'requestsAfterPlanned': requests + planned, 'monthlyRequestCap': FREE_MONTHLY_REQUESTS,
            'expectedLifecycleDeletionsSubtracted': 0, 'cloudWrites': 0, 'billingZeroProven': False}


def generation_object(generation, part):
    if type(generation) is not datetime or generation.tzinfo != timezone.utc or type(part) is not str or part not in PARTS:
        raise BackupScopeError('UtcOwnedEncryptedBackupPartRequired')
    # Weekly generations also supply that day's restore point; do not upload
    # the same snapshot twice merely to satisfy two retention labels.
    lane = 'weekly' if generation.weekday() == 6 else 'daily'
    return PREFIX + '/' + lane + '/' + generation.strftime('%Y%m%dT%H%M%SZ') + '/' + part + '.age'


def single_part_upload(*, namespace, generation, part):
    if type(namespace) is not str or not re.fullmatch('[a-z0-9]{1,256}', namespace):
        raise BackupScopeError('ExplicitValidatedNamespaceRequired')
    return {'authentication': 'instance_principal', 'multipartAllowed': False, 'overwriteAllowed': False,
            'cliStdinAllowed': False, 'request': {'namespace_name': namespace, 'bucket_name': BUCKET,
            'object_name': generation_object(generation, part), 'if_none_match': '*', 'storage_tier': 'Standard',
            'content_type': 'application/octet-stream', 'cache_control': 'no-store'}}


def operation_allowed(operation):
    # New-object PutObject ONLY with the single_part_upload constraints. No
    # multipart convenience or management/delete/overwrite fallback is allowed.
    return operation in ('PutNewObject', 'ListObjects', 'HeadObject', 'GetObject')


def lifecycle_readiness(*, service_principal, compartment_id, bucket_name, observed_permissions,
                        authenticated_scope_verified, new_grant_required):
    _scope(compartment_id=compartment_id, bucket_name=bucket_name)
    if (service_principal != 'objectstorage-' + REGION or authenticated_scope_verified is not True
            or type(observed_permissions) is not list
            or any(type(item) is not str or not re.fullmatch('[A-Z_]{3,64}', item) for item in observed_permissions)
            or len(set(observed_permissions)) != len(observed_permissions)
            or type(new_grant_required) is not bool):
        raise BackupScopeError('AuthenticatedExactBucketLifecycleServiceEvidenceRequired')
    missing = sorted(LIFECYCLE_MINIMUM - set(observed_permissions))
    ready = not new_grant_required and not missing
    return {'status': 'PASS' if ready else 'BLOCKED_OWNER_DECISION_REQUIRED', 'bucket': BUCKET,
            'compartmentId': COMPARTMENT, 'servicePrincipal': service_principal,
            'missingPermissions': missing, 'newGrantRequired': new_grant_required,
            'vmDeleteAllowed': False, 'servicePolicyCreated': False, 'iamWrites': 0,
            'prerequisiteNotGrantedByVmPolicy': True}


def lifecycle_rules(readiness):
    """SDK model kwargs, NOT CLI JSON. Never install without owner preflight.

    Age rules delete only encrypted owned prefixes. OCI may run them late and
    does not atomically delete generations, so actual complete restore points
    and exact bytes must be read back; this is not an exact-count guarantee.
    """
    if (type(readiness) is not dict or readiness.get('status') != 'PASS' or readiness.get('bucket') != BUCKET
            or readiness.get('compartmentId') != COMPARTMENT or readiness.get('servicePrincipal') != 'objectstorage-' + REGION
            or readiness.get('missingPermissions') != [] or readiness.get('newGrantRequired') is not False):
        raise BackupScopeError('LifecycleServicePermissionMissing_Stop_NoBroaderGrant')
    return [{'name': 'ir35-' + lane + '-expiry', 'target': 'objects', 'action': 'DELETE',
             'time_amount': days, 'time_unit': 'DAYS', 'is_enabled': True,
             'object_name_filter': {'inclusion_prefixes': [PREFIX + '/' + lane + '/']}}
            for lane, days in (('daily', 7), ('weekly', 28))]
