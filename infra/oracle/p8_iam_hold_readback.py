"""Read-only IAM reconciliation after the bounded controller was held.

No retry, resource create, policy repair, VM action or secret capture.
"""
import json
from pathlib import Path
import sys

from key_ceremony import KeySafetyError
from p6_audit_log import Journal
from p6_pause_reconcile import verified_manifest
from p8_backup_access_readonly import project,read
from security_session import ensure_session

PREVIOUS='aff7d4de5e906dccb5fc30a58b3a86a07016a3428142effa48e0199f2b48ec66'
STOPPED='f9e2efadc36c0bc7ae68464fc91927a593de0c57ae648c5fcae90123f89b72b1'
CASES=(('groups','02-groups-result.json'),('root-policies','03-root-policies-result.json'),
    ('child-policies','04-child-policies-result.json'))


def compare(before,after):
    if before!=after:raise KeySafetyError('UnexpectedIamChangeDuringBeforeMutationHold_HardStop')
    return {'status':'PASS','before':before,'after':after,'unchanged':True}


def main():
    if sys.argv[1:]!=['--read-only']:raise KeySafetyError('FixedReadOnlyHoldReconciliationRequired')
    parent=Path(__file__).resolve().parents[2]/'docs/evidence/p8'
    baseline=parent/'owner-resume-readonly-20261030-01'
    stopped=parent/'backup-iam-owner-20261030-repair02'
    if verified_manifest(baseline)!=PREVIOUS or verified_manifest(stopped)!=STOPPED:
        raise KeySafetyError('ExactPreflightAndInterruptedControllerManifestsRequired')
    if any(path.name.startswith('approved-') for path in stopped.iterdir()):
        raise KeySafetyError('NoApprovedMutationIntentRequired')
    journal=Journal(parent/'iam-hold-readback-20261030-01')
    result={'status':'FAIL','readOnly':True,'iamChanges':0,'vmChanges':0,'retryStarted':False,
        'phaseComplete':False,'cutover':False,'controllerStoppedManifestSHA256':STOPPED}
    try:
        profile=ensure_session()
        for index,(operation,filename) in enumerate(CASES,1):
            journal.put(f'{index:02d}-{operation}-intent.json',{'operation':operation,'readOnly':True})
            before=json.loads((baseline/filename).read_bytes())
            after=project(operation,read(operation,profile))
            journal.put(f'{index:02d}-{operation}-result.json',compare(before,after))
        result.update(status='PASS',iamBeforeAfterUnchanged=True,metadataReads=3,
            dynamicGroups=0,childPolicies=0,rootPolicies=1,lifecycleCreated=False)
    except Exception as error:
        result.update(exceptionType=type(error).__name__,rawErrorWithheld=True)
    finally:result['manifestSHA256']=journal.seal(result)
    print(json.dumps(result));return 0 if result['status']=='PASS' else 1


if __name__=='__main__':raise SystemExit(main())
