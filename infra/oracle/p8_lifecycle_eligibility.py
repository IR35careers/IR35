"""Fresh per-create eligibility receipts; no OCI, private state or import I/O.

This is a source-only repair. It does not grant another native attempt. Each
measurement uses the existing full inventory/envelope implementation through an
injected callback, with a new exclusive journal prefix. No stale timestamp is
renewed and the 300-second limit is not configurable.
"""
from copy import deepcopy
from datetime import datetime, timezone
from decimal import Decimal
import re

import p8_backup_policy as scope

MAX_AGE_SECONDS = 300
RESOURCE_NAMES = frozenset((scope.DYNAMIC_GROUP, scope.POLICY_NAME,
                            'ir35-backup-lifecycle-service', 'ir35-backups-lifecycle'))


class EligibilityError(RuntimeError):
    """Fixed codes only; never interpolate remote values or credentials."""


def complete_bucket_names(inventory):
    """Use the complete exact-counter inventory, never a made-up singleton.

    OCI bucket-name IAM conditions are case-insensitive. A second casefold
    match would widen the approved policy even when it contains no objects.
    This validates names only; the authenticated metadata read must separately
    prove the approved bucket's exact compartment and private configuration.
    """
    storage = inventory.get('objectStorage', {}) if type(inventory) is dict else {}
    reports, count = storage.get('bucketReports'), storage.get('buckets')
    if (type(reports) is not list or type(count) is not int
            or count != len(reports) or count < 1):
        raise EligibilityError('CompleteExactBucketInventoryRequired_NoCreate')
    names = []
    for row in reports:
        name = row.get('bucket') if type(row) is dict else None
        if type(name) is not str or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.:-]{0,254}', name):
            raise EligibilityError('CompleteExactBucketNamesRequired_NoCreate')
        names.append(name)
    if (len(set(names)) != count or scope.BUCKET not in names
            or sum(name.casefold() == scope.BUCKET.casefold() for name in names) != 1):
        raise EligibilityError('UniqueExactBackupBucketScopeRequired_NoCreate')
    return sorted(names)


class PrefixedJournal:
    """Fixed flat-file namespace over the original write-once journal."""
    def __init__(self, parent, number):
        if type(number) is not int or not 1 <= number <= len(RESOURCE_NAMES):
            raise EligibilityError('BoundedPerCreateEligibilityMeasurementRequired')
        self.parent, self.prefix = parent, f'eligibility-{number:03d}-'
        self.written = set()

    def put(self, name, value):
        if (type(name) is not str or not re.fullmatch(r'[a-z0-9][a-z0-9-]*\.json', name)
                or name in self.written):
            raise EligibilityError('ExclusiveEligibilityArtifactRequired')
        self.parent.put(self.prefix + name, value)
        self.written.add(name)

    def verify(self):
        self.parent.verify()

    def path(self, name):
        if name not in self.written:
            raise EligibilityError('RecordedEligibilityArtifactRequired')
        self.verify()
        return self.parent.root / (self.prefix + name)


def age_seconds(checked_at, now):
    try:
        if type(checked_at) is not str:
            raise ValueError()
        stamp = datetime.fromisoformat(checked_at)
        if (stamp.tzinfo is None or stamp.utcoffset().total_seconds() != 0
                or not isinstance(now, datetime) or now.tzinfo is None):
            raise ValueError()
        age = (now - stamp).total_seconds()
    except (ValueError, TypeError, AttributeError, OverflowError):
        raise EligibilityError('FreshFiveMinuteAlwaysFreeInventoryRequired') from None
    if not 0 <= age <= MAX_AGE_SECONDS:
        raise EligibilityError('FreshFiveMinuteAlwaysFreeInventoryRequired')
    return age


class FreshEligibility:
    def __init__(self, journal, measure, *, clock=lambda: datetime.now(timezone.utc)):
        self.journal, self.measure, self.clock = journal, measure, clock
        self.measurements = 0
        self.receipt = None

    def __call__(self, name, *, exact_storage=False):
        if name not in RESOURCE_NAMES or type(exact_storage) is not bool:
            raise EligibilityError('ExactPerCreateEligibilityScopeRequired')
        # Always re-measure the FULL account/resources/quotas/shape/exact bytes,
        # even when the preceding create's receipt is still within five minutes.
        self.receipt = None
        self.measurements += 1
        child = PrefixedJournal(self.journal, self.measurements)
        child.put('intent.json', {'resource': name, 'readOnly': True,
            'fullInventoryRequired': True, 'maximumAgeSeconds': MAX_AGE_SECONDS,
            'exactStorageRequired': True, 'createGateGranted': False})
        try:
            observed = deepcopy(self.measure(child))
            inventory, account, bucket = observed['inventory'], observed['account'], observed['bucket']
            age_seconds(inventory['checkedAt'], self.clock())
            usage, storage = inventory['usage'], inventory['objectStorage']
            if (account.get('homeRegion') != scope.REGION or not account.get('activeUserMatch')
                    or not account.get('subscriptions')
                    or any(row.get('paymentModel') not in ('FREE_TRIAL', 'ALWAYS_FREE', 'FREE_ONLY')
                           or row.get('state') != 'ACTIVE' for row in account['subscriptions'])):
                raise EligibilityError('FreshAlwaysFreeHomeAccountRequired')
            if (usage['instances'] != 1 or Decimal(usage['a1Ocpus']) != 2
                    or Decimal(usage['a1MemoryGB']) != 12 or Decimal(usage['liveVolumeGB']) != 150
                    or usage['bootVolumes'] != 1 or usage['blockVolumes'] != 1
                    or type(usage['volumeBackups']) is not int or not 0 <= usage['volumeBackups'] <= 5):
                raise EligibilityError('FreshSingleVmFreeEnvelopeRequired')
            if (storage.get('exactBytesProven') is not True or storage.get('standardOnly') is not True
                    or type(storage.get('exactBytes')) is not int or not 0 <= storage['exactBytes'] <= scope.OWNER_CAP
                    or storage.get('overEightyPercent') is not False):
                raise EligibilityError('ExactFreshFreeStorageCapRequired')
            if any(Decimal(row['positive']) > 0 for row in inventory['costReport']['amounts'].values()):
                raise EligibilityError('PositiveReportedCost_NoCreate')
            if (bucket.get('status') != 'PASS' or bucket.get('bucket') != scope.BUCKET
                    or bucket.get('storageTier') != 'Standard' or bucket.get('versioning') != 'Disabled'
                    or bucket.get('autoTiering') != 'Disabled' or bucket.get('replicationEnabled') is not False
                    or bucket.get('customerManagedKey') is not False):
                raise EligibilityError('FreshPrivateStandardBucketRequired')
            proof = observed['freeInventory']
            if (proof.get('status') != 'PASS' or proof.get('readOnly') is not True
                    or proof.get('cloudWrites') != 0 or proof.get('keyOrIAMChanges') != 0
                    or type(observed.get('inventorySHA256')) is not str
                    or not re.fullmatch(r'[a-f0-9]{64}', observed['inventorySHA256'])):
                raise EligibilityError('FullReadOnlyInventoryReceiptRequired')
            self.receipt = {'resource': name, 'checkedAt': inventory['checkedAt'],
                'inventorySHA256': observed['inventorySHA256']}
            child.put('result.json', {'status': 'PASS', 'resource': name, 'account': account,
                'bucket': bucket, 'shape': 'VM.Standard.A1.Flex', 'billingType': 'LIMITED_FREE',
                'a1OCPU': usage['a1Ocpus'], 'a1MemoryGB': usage['a1MemoryGB'],
                'liveVolumeGB': usage['liveVolumeGB'], 'inventorySHA256': observed['inventorySHA256'],
                'inventoryCheckedAt': inventory['checkedAt'], 'maximumAgeSeconds': MAX_AGE_SECONDS,
                'exactObjectBytes': storage['exactBytes'], 'newPaidResources': 0,
                'realTimeZeroBillProven': False, 'createGateGranted': False})
            self.assert_fresh(name)
            print('ALWAYS FREE: ' + name + '; VM.Standard.A1.Flex 2 OCPU/12 GB; '
                  '150 GB live volumes; exact Standard bytes verified; '
                  'existing one-VM/one-bucket control plane only.', flush=True)
        except Exception as error:
            self.receipt = None
            child.put('failure.json', {'status': 'FAIL', 'exceptionType': type(error).__name__,
                'code': str(error) if re.fullmatch('[A-Za-z0-9_]+', str(error)) else 'RawErrorWithheld',
                'createGateGranted': False, 'remeasureRetryAllowed': False})
            raise

    def assert_fresh(self, name):
        self.journal.verify()
        if self.receipt is None or self.receipt['resource'] != name:
            raise EligibilityError('FreshEligibilityForExactCreateRequired')
        age_seconds(self.receipt['checkedAt'], self.clock())
