"""Owner-approved read-only exact storage audit; exclusive, sealed attempts."""
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import sys

from bootstrap_audit import KEY_DIRECTORY, ocid
from immutable_artifacts import Store
from key_ceremony import KeySafetyError, private_directory
from object_storage_exact import Counter, SecurityTokenReads
import p1_control_plane as control
from resource_audit import ReadOnlyOci
from security_session import ensure_session, private_file

ROOT = KEY_DIRECTORY / 'exact-storage-20261025'
PUBLIC = Path(__file__).resolve().parents[2] / 'docs/evidence/p6'


def audit(*, slot='01-audit', namespace=None, expected_buckets=None, compartments=None, api=None):
    if slot not in ('01-audit', '01-after-browser', '02-repair-one', '03-repair-two', '04-bastion-eligibility'):
        raise KeySafetyError('FixedExactStorageAuditSlotRequired')
    os.umask(0o077)
    if not ROOT.exists():
        ROOT.mkdir(mode=0o700)
    private_directory(ROOT)
    store = Store(ROOT)
    if slot == '01-after-browser':
        receipt = json.loads((PUBLIC / 'exact-storage-01-audit.json').read_text())
        manifest = store.verify(receipt['stage'], receipt['manifestSHA256'])
        if (receipt.get('status') != 'FAIL' or not receipt.get('code', '').startswith('G2:')
                or {row['name'] for row in manifest['artifacts']} != {'00001-intent.json', 'result.json'}):
            raise KeySafetyError('OnlyZeroRequestBrowserGateMayResumeWithoutToolingRepair')
    # Preserve every failure. Never automatically rerun an API request or slot.
    if slot.startswith(('02-', '03-')):
        prior = ('01-after-browser' if (ROOT / '01-after-browser').exists() else '01-audit') if slot.startswith('02-') else '02-repair-one'
        if not (ROOT / prior / 'manifest.json').is_file():
            raise KeySafetyError('PriorExactAuditFailureEvidenceRequired')
        previous = json.loads((ROOT / prior / 'result.json').read_text())
        if previous.get('status') != 'FAIL':
            raise KeySafetyError('OnlyFailedToolingMayUseRepairSlot')
        code = previous.get('code', '')
        if code not in ('TypeError', 'AttributeError', 'ValueError'):
            raise KeySafetyError('UnclearUsageSecurityOrOwnerGateIsNotAToolingRetry')
    stage = store.stage(slot)
    result = {'status': 'FAIL', 'readOnly': True, 'mutations': 0, 'purpose': slot, 'startedAt': datetime.now(timezone.utc).isoformat()}
    sequence = 0
    counter = None
    def record(name, value):
        nonlocal sequence
        sequence += 1
        store.put(stage, f'{sequence:05d}-' + name + '.json', json.dumps(value, sort_keys=True).encode())
    try:
        record('intent', {'operation': 'exact complete objects+versions+unfinished upload parts, stable two-pass GETs', 'mutations': 0,
                         'freeLimitBytes': 20_000_000_000, 'stopOverBytes': 16_000_000_000, 'ownerBackupCapBytes': 8_000_000_000})
        profile = ensure_session() if api is None else None
        if compartments is None:
            child = json.loads(private_file(control.JOURNAL))['created']['compartment']['id']
            compartments = [ocid(child, 'compartment')]
        if namespace is None:
            namespace = ReadOnlyOci(profile).read('namespace')
        counter = Counter(api or SecurityTokenReads(profile), record=record)
        proof = counter.full_audit(namespace, compartments, expected_buckets)
        result.update(proof, status='PASS')
    except Exception as error:
        result['code'] = str(error) if isinstance(error, KeySafetyError) else type(error).__name__
    result['attemptedObjectStorageRequests'] = counter.requests if counter is not None else 0
    result['finishedAt'] = datetime.now(timezone.utc).isoformat()
    store.put(stage, 'result.json', json.dumps(result, sort_keys=True).encode())
    result.update(stage=stage.name, manifestSHA256=store.seal(stage))
    with (PUBLIC / ('exact-storage-' + slot + '.json')).open('x', encoding='utf-8') as output:
        json.dump(result, output, indent=2)
    if result['status'] != 'PASS':
        raise KeySafetyError('ExactStorageAuditStopped_' + result['code'])
    return result


def eligibility_counter(namespace, expected_buckets, *, compartments):
    return audit(slot='04-bastion-eligibility', namespace=namespace, expected_buckets=expected_buckets, compartments=compartments)


def latest_pass():
    receipt = None
    for name in ('01-audit', '01-after-browser', '02-repair-one', '03-repair-two'):
        path = PUBLIC / ('exact-storage-' + name + '.json')
        if path.exists():
            receipt = json.loads(path.read_text())
    if receipt is None or receipt.get('status') != 'PASS':
        raise KeySafetyError('LatestExactStorageAuditMustPass_NoOlderPassFallback')
    Store(ROOT).verify(receipt['stage'], receipt['manifestSHA256'])
    return receipt


if __name__ == '__main__':
    try:
        choices = {'--audit': '01-audit', '--resume-after-login': '01-after-browser', '--repair-one': '02-repair-one', '--repair-two': '03-repair-two'}
        if len(sys.argv) != 2 or sys.argv[1] not in choices:
            raise KeySafetyError('ExplicitBoundedReadOnlyAuditRequired')
        print(json.dumps(audit(slot=choices[sys.argv[1]])))
    except Exception as error:
        print(json.dumps({'status': 'STOP', 'code': str(error) if isinstance(error, KeySafetyError) else type(error).__name__}))
        raise SystemExit(1)
