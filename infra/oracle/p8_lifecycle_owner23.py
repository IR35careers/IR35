"""ONE newly approved 23-Nov lifecycle attempt; never replay the used31-Oct slot.

The previous exact failure and completed rollback are immutable prerequisites.
Permission definitions, create-only CLI, ETag-bound cleanup and the strict fresh
inventory implementation are reused, not widened or bypassed.
"""
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import sys

from p8_lifecycle_owner31 import (OwnerRun, NativeApi, OwnerRunError, ROOT_POLICY_SHA,
                                  SHAPE_MANIFEST, SLOT as PREVIOUS_SLOT)
from p8_lifecycle_eligibility import FreshEligibility, complete_bucket_names

SLOT = 'backup-lifecycle-owner-20261123-01'
FLAG = '--apply-owner-20261123-one-bounded-run'
PREVIOUS_FAILURE_MANIFEST = 'b39704ad9a0aa340b2f93bb43c15cf9086868138eb63923f94d0d3f1cf73a0b2'


def exact_bucket_safety(reads, inventory):
    """Bind policy scope to both independent complete bucket inventories."""
    from p8_backup_iam_owner import authenticated_bucket, safe_bucket
    import p8_backup_policy as scope

    names = complete_bucket_names(inventory)
    if set(names) != reads.buckets:
        raise OwnerRunError('IndependentCompleteBucketInventoriesMustMatch_NoCreate')
    row = authenticated_bucket(reads)
    # Unlike the historical helper's singleton argument, these are the full
    # independently measured names. Keep every existing metadata assertion.
    scope.validate_bucket(row, names)
    return safe_bucket(row)


def verified_public_manifest(directory, expected):
    """Read public, sealed evidence only; no credentials or native operation."""
    if directory.is_symlink() or not directory.is_dir():
        raise OwnerRunError('ExactPriorPublicEvidenceRequired')
    path = directory / 'manifest.json'
    if path.is_symlink() or hashlib.sha256(path.read_bytes()).hexdigest() != expected:
        raise OwnerRunError('ExactPriorManifestRequired')
    manifest = json.loads(path.read_bytes())
    rows = manifest.get('artifacts')
    if manifest.get('version') != 1 or type(rows) is not list:
        raise OwnerRunError('ExactPriorArtifactManifestRequired')
    names = set()
    for row in rows:
        name = row.get('name')
        if (type(name) is not str or not re.fullmatch(r'[a-z0-9][a-z0-9-]*\.json', name)
                or name == 'manifest.json' or name in names
                or type(row.get('sha256')) is not str or not re.fullmatch(r'[a-f0-9]{64}', row['sha256'])):
            raise OwnerRunError('ExactPriorArtifactNamesRequired')
        artifact = directory / name
        if artifact.is_symlink() or hashlib.sha256(artifact.read_bytes()).hexdigest() != row['sha256']:
            raise OwnerRunError('ExactPriorArtifactHashRequired')
        names.add(name)
    if {item.name for item in directory.iterdir()} != names | {'manifest.json'}:
        raise OwnerRunError('ExactPriorArtifactSetRequired')
    return expected


def verify_previous_failure(parent):
    previous = parent / PREVIOUS_SLOT
    verified_public_manifest(previous, PREVIOUS_FAILURE_MANIFEST)
    result = json.loads((previous / 'result.json').read_bytes())
    rollback = result.get('rollback', {})
    if (result.get('status') != 'FAIL' or result.get('exceptionType') != 'OwnerRunError'
            or result.get('code') != 'FreshFiveMinuteAlwaysFreeInventoryRequired'
            or result.get('nativeRetryAllowed') is not False
            or result.get('cutover') is not False or result.get('productionChanges') != 0
            or result.get('vmChanges') != 0 or rollback.get('status') != 'PASS'
            or type(rollback.get('createdResourcesRemoved')) is not int
            or rollback.get('createdResourcesRemoved') != 1
            or rollback.get('createdLifecycleRemoved') is not False
            or rollback.get('originalRootPolicySHA256') != ROOT_POLICY_SHA):
        raise OwnerRunError('ExactFreshnessFailureAndOneResourceRollbackRequired')
    return PREVIOUS_FAILURE_MANIFEST


def check_entry(parent):
    # Must run before importing/calling any native authentication helpers.
    if (parent / SLOT).exists() or (parent / SLOT).is_symlink():
        raise OwnerRunError('Owner23NativeAllowanceConsumed_NoReplay')
    previous = verify_previous_failure(parent)
    verified_public_manifest(parent / 'lifecycle-cli-shape-diagnosis-20261030-01', SHAPE_MANIFEST)
    return previous


def main(argv=None):
    if (sys.argv[1:] if argv is None else argv) != [FLAG]:
        raise OwnerRunError('ExplicitOwner23BoundedInvocationRequired')
    parent = Path(__file__).resolve().parents[2] / 'docs/evidence/p8'
    previous = check_entry(parent)

    from p6_audit_log import Journal
    from p8_backup_iam_owner import OwnerReads
    from p8_oci_readonly import execute
    from object_storage_exact import SecurityTokenReads
    from resource_audit import session_account_audit
    from security_session import ensure_session
    from visibility import wait_for_visible

    profile = ensure_session(minimum_seconds=1800)
    journal = Journal(parent / SLOT)
    result = {'status': 'FAIL', 'runIdentity': SLOT, 'productionChanges': 0, 'vmChanges': 0,
              'cutover': False, 'nativeRetryAllowed': False}
    run = None
    try:
        journal.put('owner23-intent.json', {'approval': '23Nov-one-new-bounded-lifecycle-attempt',
            'runIdentity': SLOT, 'previousUsedSlot': PREVIOUS_SLOT,
            'previousFailureManifestSHA256': previous, 'diagnosisManifestSHA256': SHAPE_MANIFEST,
            'fixedPermissionProtocol': 'reviewed-owner31-unchanged', 'previousSlotReplayed': False,
            'auth': 'SecurityToken', 'cloudOnly': True, 'vmOperations': 0,
            'assertionsChanged': False, 'observerPermissions': False, 'nativeRetryAllowed': False})
        reads = OwnerReads(profile, journal)
        result['freeInventory'] = execute(reads, journal, SecurityTokenReads(profile))
        initial_inventory = json.loads((journal.root / 'inventory.json').read_bytes())
        journal.put('bucket-safety.json', exact_bucket_safety(reads, initial_inventory))
        api = NativeApi(profile, journal)
        api.namespace = reads.namespace

        def measure_eligibility(child):
            current = OwnerReads(profile, child)
            proof = execute(current, child, SecurityTokenReads(profile))
            report_bytes = child.path('inventory.json').read_bytes()
            inventory = json.loads(report_bytes)
            account = session_account_audit(current)
            bucket = exact_bucket_safety(current, inventory)
            if current.namespace != api.namespace:
                raise OwnerRunError('AuthenticatedNamespaceChanged_NoCreate')
            child.put('bucket-safety.json', bucket)
            return {'inventory': inventory, 'inventorySHA256': hashlib.sha256(report_bytes).hexdigest(),
                    'account': account, 'bucket': bucket, 'freeInventory': proof}

        free_check = FreshEligibility(journal, measure_eligibility)
        api.create_guard = free_check
        run = OwnerRun(api, journal, profile['tenancy'], free_check, wait_for_visible)
        result.update(run.execute())
        result['checkedAt'] = datetime.now(timezone.utc).isoformat()
    except Exception as error:
        result.update(exceptionType=type(error).__name__, code=str(error) if re.fullmatch(
            '[A-Za-z0-9_]+', str(error)) else 'RawErrorWithheld')
        if run is not None:
            try:
                result['rollback'] = run.rollback()
            except Exception as rollback_error:
                result['rollback'] = {'status': 'FAIL', 'exceptionType': type(rollback_error).__name__,
                    'code': str(rollback_error) if re.fullmatch('[A-Za-z0-9_]+', str(rollback_error)) else 'RawErrorWithheld'}
    finally:
        result['manifestSHA256'] = journal.seal(result)
    print(json.dumps(result))
    return 0 if result['status'] == 'PASS' else 1


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except OwnerRunError as error:
        print(json.dumps({'status': 'FAIL', 'code': str(error), 'nativeRetryAllowed': False}))
        raise SystemExit(1)
