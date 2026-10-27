"""Fresh tenancy-wide resource/byte inventory. No provisioning or upload API."""
from datetime import datetime, timezone
from decimal import Decimal
import json
import hashlib
from pathlib import Path
import re
import sys

from key_ceremony import KeySafetyError
from bootstrap_audit import ocid
from object_storage_exact import Counter, SecurityTokenReads, digest
from p1_control_plane import quota_statements
from p6_audit_log import Journal
from resource_audit import ReadOnlyOci, inventory, session_account_audit
from security_session import ensure_session

FAILED_FIRST = 'a7f27ed44b9cfcfed9911e10816677b3c91f0b407fa973c3e6c36b9b05c089ca'
FAILED_SECOND = '6c3b9fbddaefd41bf9c4a2604e4f755d954a2ea1befd542876968e7aaab6e860'


def storage_recorder(journal):
    def record(name, value):
        # Counter labels are public operation names, but '_' is deliberately
        # excluded from Journal filenames. Hash the ENTIRE label; do not weaken
        # the journal's filename policy or change counter observations.
        if not re.fullmatch('[a-z0-9_-]+', name):
            raise KeySafetyError('FixedStorageCounterLabelRequired')
        journal.put('storage-' + hashlib.sha256(name.encode()).hexdigest() + '.json',
                    {'counterLabel': name, 'observation': value})
    return record


def failed_first(root):
    manifest = root / 'manifest.json'
    if hashlib.sha256(manifest.read_bytes()).hexdigest() != FAILED_FIRST:
        raise KeySafetyError('OriginalFailedInventoryManifestRequired')
    entries = json.loads(manifest.read_bytes())['artifacts']
    if {path.name for path in root.iterdir()} != {'manifest.json', *(item['name'] for item in entries)}:
        raise KeySafetyError('OriginalFailedInventoryArtifactSetChanged')
    for item in entries:
        path = root / item['name']
        if path.is_symlink() or hashlib.sha256(path.read_bytes()).hexdigest() != item['sha256']:
            raise KeySafetyError('OriginalFailedInventoryArtifactChanged')
    result = json.loads((root / 'result.json').read_bytes())
    if result.get('status') != 'FAIL' or result.get('exceptionType') != 'AuditFailure':
        raise KeySafetyError('OriginalJournalAdapterFailureRequired')
    return FAILED_FIRST


def completed_snapshot(root):
    """Preserve second FAIL; finish only its missing quota GET/shape proof."""
    manifest = root / 'manifest.json'
    if hashlib.sha256(manifest.read_bytes()).hexdigest() != FAILED_SECOND:
        raise KeySafetyError('OriginalSecondFailureRequired')
    entries = json.loads(manifest.read_bytes())['artifacts']
    if {path.name for path in root.iterdir()} != {'manifest.json', *(item['name'] for item in entries)}:
        raise KeySafetyError('SecondFailureArtifactSetChanged')
    for item in entries:
        path = root / item['name']
        if path.is_symlink() or hashlib.sha256(path.read_bytes()).hexdigest() != item['sha256']:
            raise KeySafetyError('SecondFailureArtifactChanged')
    failed = json.loads((root / 'result.json').read_bytes())
    if failed.get('code') != 'ExactExistingRootQuotaMustMatch_NoChangeMade':
        raise KeySafetyError('ExactSecondQuotaListProjectionFailureRequired')
    report = json.loads((root / 'inventory.json').read_bytes())
    age = (datetime.now(timezone.utc) - datetime.fromisoformat(report['checkedAt'])).total_seconds()
    if not 0 <= age <= 900: raise KeySafetyError('CompletionRequiresFresh15MinuteInventory_NoOldEvidenceSubstitution')
    envelope(report)
    return report


def envelope(report):
    usage = report['usage']
    if (usage['instances'] != 1 or Decimal(usage['a1Ocpus']) != 2
            or Decimal(usage['a1MemoryGB']) != 12 or Decimal(usage['liveVolumeGB']) != 150
            or usage['bootVolumes'] != 1 or usage['blockVolumes'] != 1
            or usage['volumeBackups'] > 5):
        raise KeySafetyError('CurrentAllocationOutsideApprovedSingleVM2CPU12GB150GBEnvelope')
    storage = report['objectStorage']
    if (storage.get('exactBytesProven') is not True or not storage.get('standardOnly')
            or storage['exactBytes'] > 8_000_000_000 or storage['overEightyPercent']):
        raise KeySafetyError('ExactStandardStorageWithin8GBRequired')
    if any(Decimal(row['positive']) > 0 for row in report['costReport']['amounts'].values()):
        raise KeySafetyError('PositiveReportedCost_Stop_NoCreditOffset')
    return True


class RecordedReads(ReadOnlyOci):
    def __init__(self, profile, journal):
        super().__init__(profile)
        self.journal = journal
        self.calls = 0
        self.observed = []
        self.quota_ids = set()

    def arguments(self, operation, **selectors):
        if operation == 'quotaDetails':
            if set(selectors) != {'quota'} or selectors['quota'] not in self.quota_ids:
                raise KeySafetyError('OnlyInventoriedExactRootQuotaGetAllowed')
            return ['limits', 'quota', 'get', '--quota-id', ocid(selectors['quota'], 'quota')]
        return super().arguments(operation, **selectors)

    def read(self, operation, **selectors):
        self.calls += 1
        prefix = f'oci-{self.calls:03d}'
        self.journal.put(prefix + '-intent.json', {'operation': operation,
            'selectorSHA256': digest(selectors), 'readOnly': True})
        try:
            result = super().read(operation, **selectors)
        except Exception as error:
            # No provider message, raw response, credentials or arbitrary text.
            code = getattr(error, 'code', None)
            self.journal.put(prefix + '-result.json', {'status': 'FAIL',
                'exceptionType': type(error).__name__, 'httpStatus': getattr(error, 'status', None),
                'serviceCode': code if isinstance(code, str) and re.fullmatch('[A-Za-z][A-Za-z0-9_]{0,63}', code) else None})
            raise
        self.journal.put(prefix + '-result.json', {'status': 'PASS', 'operation': operation})
        # Raw metadata stays in memory only, never in journal or console output.
        self.observed.append((operation, selectors, result))
        return result


def execute(client, journal, storage_api):
    account = session_account_audit(client)
    journal.put('account.json', account)
    counter = Counter(storage_api, record=storage_recorder(journal))
    report = inventory(client, account, exact_storage=lambda namespace, buckets, compartments:
        counter.full_audit(namespace, compartments, expected_buckets=buckets) | {'status': 'PASS'})
    journal.put('inventory.json', report)
    envelope(report)
    return finish(client, journal, report) | {'objectStorageReads': counter.requests}


def finish(client, journal, report):
    policies = [row for row in client.read('quotas', compartment=client.profile['tenancy'])
                if row.get('name') == 'ir35-always-free-cap']
    if len(policies) != 1 or policies[0].get('lifecycle-state') != 'ACTIVE':
        raise KeySafetyError('ExactExistingRootQuotaMustMatch_NoChangeMade')
    identifier = ocid(policies[0]['id'], 'quota')
    client.quota_ids.add(identifier)
    quota = client.read('quotaDetails', quota=identifier)
    if (quota.get('id') != identifier or quota.get('compartment-id') != client.profile['tenancy']
            or quota.get('lifecycle-state') != 'ACTIVE' or quota.get('statements') != quota_statements()):
        raise KeySafetyError('ExactQuotaGetMismatch_HardStop_NoChangeMade')
    client.domains = {row['domain'] for row in report['availabilityDomains']}
    child = 'ocid1.compartment.oc1..aaaaaaaa3k65nsyhjrq3gcjs5gvdvdnpdty3x4ktk6m3drs7dfgnsdmwh3nq'
    client.compartments.add(child)
    instances = [row for compartment in sorted(client.compartments)
                 for row in client.read('instances', compartment=compartment)
                 if row.get('lifecycle-state') not in ('TERMINATED', 'DELETED')]
    if len(instances) != 1:
        raise KeySafetyError('SingleInventoriedInstanceRequired')
    ad = instances[0]['availability-domain']
    shapes = client.read('shapes', ad=ad)
    a1 = [row for row in shapes if row.get('shape') == 'VM.Standard.A1.Flex']
    if len(a1) != 1 or a1[0].get('billing-type') != 'LIMITED_FREE':
        raise KeySafetyError('LiveA1LimitedFreeShapeLabelRequired')
    journal.put('envelope.json', {'status': 'PASS', 'shape': 'VM.Standard.A1.Flex',
        'billingType': 'LIMITED_FREE', 'ocpu': 2, 'memoryGB': 12, 'liveVolumeGB': 150,
        'ownerVolumeCapGB': 150, 'freeLiveVolumeCapGB': 200, 'volumeBackups': report['usage']['volumeBackups'],
        'maximumVolumeBackups': 5, 'quotaStatementsMatch': True,
        'objectBytes': report['objectStorage']['exactBytes'], 'objectCapBytes': 8_000_000_000,
        'realTimeZeroBillProven': False, 'createGateGranted': False})
    return {'status': 'PASS', 'readOnly': True, 'checkedAt': datetime.now(timezone.utc).isoformat(),
        'ociReads': client.calls, 'cloudWrites': 0,
        'keyOrIAMChanges': 0, 'phaseComplete': False, 'cutover': False}


def main():
    repair = sys.argv[1:] == ['--read-only', '--repair-one']
    completion = sys.argv[1:] == ['--read-only', '--complete-quota-get']
    if sys.argv[1:] != ['--read-only'] and not repair and not completion:
        raise KeySafetyError('FixedReadOnlyInvocationRequired')
    parent = Path(__file__).resolve().parents[2] / 'docs/evidence/p8'
    prior = failed_first(parent / 'oci-readonly-01') if repair or completion else None
    snapshot = completed_snapshot(parent / 'oci-readonly-02') if completion else None
    root = parent / ('oci-readonly-03' if completion else 'oci-readonly-02' if repair else 'oci-readonly-01')
    if not root.parent.is_dir():
        raise KeySafetyError('ExistingPhaseEvidenceParentRequired')
    journal = Journal(root)  # O_EXCL slot; failed runs cannot be replayed.
    if prior:
        journal.put('repair-intent.json', {'originalFailedManifestSHA256': prior, 'secondFailedManifestSHA256': FAILED_SECOND if completion else None,
            'repairAttempt': 2 if completion else 1,
            'cause': 'Quota LIST summaries omit statements; authenticated GET matches all 3 exact statements' if completion else 'Counter operation underscores rejected by strict journal filename policy before any Object Storage request',
            'change': 'Use scoped limits quota GET; retain fresh sealed exact-byte inventory, no object re-list' if completion else 'Hash complete public counter label for filename; preserve original label and observation in JSON',
            'journalPolicyChanged': False, 'assertionsChanged': False, 'readOnly': True})
    result = {'status': 'FAIL', 'readOnly': True, 'cloudWrites': 0, 'phaseComplete': False, 'cutover': False}
    try:
        profile = ensure_session(minimum_seconds=1800)
        client = RecordedReads(profile, journal)
        if completion:
            account = session_account_audit(client)
            journal.put('account.json', account)
            journal.put('snapshot-reference.json', {'manifestSHA256': FAILED_SECOND, 'checkedAt': snapshot['checkedAt'],
                'exactBytes': snapshot['objectStorage']['exactBytes'], 'sourceStatusRemains': 'FAIL', 'maximumAgeSeconds': 900})
            result = finish(client, journal, snapshot) | {'priorInventoryManifestSHA256': FAILED_SECOND,
                'objectStorageReads': 0, 'priorExactStorageReads': snapshot['objectStorage']['requests']}
        else:
            result = execute(client, journal, SecurityTokenReads(profile))
    except Exception as error:
        result['exceptionType'] = type(error).__name__
        # Internal fixed error class only; never interpolate raw provider data.
        if isinstance(error, KeySafetyError) and re.fullmatch('[A-Za-z0-9_]+', str(error)):
            result['code'] = str(error)
    finally:
        result['manifestSHA256'] = journal.seal(result)
    print(json.dumps(result))
    return 0 if result['status'] == 'PASS' else 1


if __name__ == '__main__':
    raise SystemExit(main())
