"""List-only backup/monitoring IAM metadata. Never creates policies or keys."""
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import subprocess
import sys

from bootstrap_audit import ocid
from key_ceremony import KeySafetyError
from p6_audit_log import Journal
from security_session import clean_environment, command, ensure_session
from visibility import OciError

CHILD = 'ocid1.compartment.oc1..aaaaaaaa3k65nsyhjrq3gcjs5gvdvdnpdty3x4ktk6m3drs7dfgnsdmwh3nq'
INSTANCE = 'ocid1.instance.oc1.uk-london-1.anwgiljrr72xucychx35t4jbeiaep4qncwolllegqazy3krrryoz7pxqusya'


def arguments(operation, root):
    ocid(root, 'tenancy')
    commands = {
        'groups': ['iam', 'dynamic-group', 'list', '--compartment-id', root, '--all'],
        'root-policies': ['iam', 'policy', 'list', '--compartment-id', root, '--all'],
        'child-policies': ['iam', 'policy', 'list', '--compartment-id', CHILD, '--all'],
        'alarms': ['monitoring', 'alarm', 'list', '--compartment-id', CHILD, '--all'],
        'topics': ['ons', 'topic', 'list', '--compartment-id', CHILD, '--all'],
        'subscriptions': ['ons', 'subscription', 'list', '--compartment-id', CHILD, '--all'],
    }
    if operation not in commands:
        raise KeySafetyError('OnlyFixedBackupMetadataListOperationsAllowed')
    return commands[operation]


def read(operation, profile):
    fresh = ensure_session()
    if any(fresh[key] != profile[key] for key in ('tenancy', 'user')):
        raise KeySafetyError('BrowserIdentityChanged')
    reply = subprocess.run(command(arguments(operation, profile['tenancy'])),
        capture_output=True, text=True, timeout=65, env=clean_environment(), check=False)
    if reply.returncode:
        raise OciError.from_stderr(operation, reply.stderr)
    if reply.stdout == '': return []  # Pinned CLI empty successful --all list.
    if len(reply.stdout) > 8_000_000:
        raise KeySafetyError('MetadataResponseTooLarge')
    try:
        value = json.loads(reply.stdout)
        if value.get('opc-next-page') or not isinstance(value['data'], list): raise ValueError()
        return value['data']
    except (ValueError, KeyError, TypeError, AttributeError):
        raise KeySafetyError('CompleteMetadataListRequired_RawOutputSuppressed') from None


def sha(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True).encode()).hexdigest()


def project(operation, rows):
    """No freeform statements, matching rules, endpoints or service payloads."""
    if not isinstance(rows, list): raise KeySafetyError('CompleteMetadataListRequired')
    result = {'status': 'PASS', 'operation': operation, 'count': len(rows)}
    if operation == 'groups':
        active = [row for row in rows if row.get('lifecycle-state') == 'ACTIVE']
        result.update(activeGroups=len(active), exactVMRuleGroups=sum(
            row.get('matching-rule') == "instance.id = '" + INSTANCE + "'" for row in active),
            ruleSHA256=[sha(row.get('matching-rule')) for row in active],
            accessDecision='NOT_PROVEN_BY_LISTING_ONLY')
    elif operation.endswith('policies'):
        result.update(activePolicies=sum(row.get('lifecycle-state') == 'ACTIVE' for row in rows),
            statementSHA256=[sha(row.get('statements')) for row in rows])
    elif operation == 'alarms':
        result.update(enabledAlarms=sum(row.get('is-enabled') is True for row in rows),
            configurationSHA256=[sha({key: row.get(key) for key in ('namespace', 'query', 'destinations', 'is-enabled')}) for row in rows])
    elif operation == 'topics':
        result['expectedActiveTopicCount'] = sum(row.get('name') == 'ir35-alerts' and row.get('lifecycle-state') == 'ACTIVE' for row in rows)
    elif operation == 'subscriptions':
        result['expectedActiveEmailSubscriptionCount'] = sum(row.get('protocol') == 'EMAIL'
            and row.get('endpoint') == 'info@ir35careers.com' and row.get('lifecycle-state') == 'ACTIVE' for row in rows)
    else: raise KeySafetyError('OnlyFixedBackupMetadataListOperationsAllowed')
    return result


def main():
    if sys.argv[1:] != ['--read-only']: raise KeySafetyError('FixedReadOnlyInvocationRequired')
    root = Path(__file__).resolve().parents[2] / 'docs/evidence/p8/backup-access-readonly-01'
    journal = Journal(root)
    result = {'status': 'FAIL', 'readOnly': True, 'cloudWrites': 0, 'iamChanges': 0,
        'keyChanges': 0, 'uploadRequests': 0, 'phaseComplete': False, 'cutover': False}
    try:
        profile = ensure_session(minimum_seconds=1800)
        for index, operation in enumerate(('groups', 'root-policies', 'child-policies', 'alarms', 'topics', 'subscriptions'), 1):
            journal.put(f'{index:02d}-{operation}-intent.json', {'readOnly': True, 'operation': operation})
            try:
                projected = project(operation, read(operation, profile))
            except Exception as error:
                journal.put(f'{index:02d}-{operation}-result.json', {'status': 'FAIL',
                    'exceptionType': type(error).__name__, 'httpStatus': getattr(error, 'status', None),
                    'serviceCode': error.code if isinstance(error, OciError) else None})
                raise
            journal.put(f'{index:02d}-{operation}-result.json', projected)
        result.update(status='PASS', metadataReads=6, checkedAt=datetime.now(timezone.utc).isoformat(),
            effectiveBackupAccessProven=False, alertDeliveryProven=False)
    except Exception as error: result['exceptionType'] = type(error).__name__
    finally: result['manifestSHA256'] = journal.seal(result)
    print(json.dumps(result))
    return 0 if result['status'] == 'PASS' else 1


if __name__ == '__main__': raise SystemExit(main())
