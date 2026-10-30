"""One read-only public bucket-flag diagnosis; no IAM/object mutation API."""
import json
from pathlib import Path
import sys

from p6_audit_log import Journal
from p6_pause_reconcile import verified_manifest
from p8_oci_readonly import RecordedReads
from key_ceremony import KeySafetyError
from security_session import ensure_session
import p8_backup_policy as scope

PRIOR='b052398f71610c2323542cc275f8b6d82260709d349725f1b03417e0fae4816d'
FIELDS=('name','compartment-id','storage-tier','public-access-type','versioning','auto-tiering',
    'is-read-only','replication-enabled','kms-key-id')


def project(row):
    result={}
    for name in FIELDS:
        value=row.get(name)
        if name=='kms-key-id':
            result[name]={'present':name in row,'configured':value is not None}
        elif name=='compartment-id':
            result[name]={'present':name in row,'matchesApproved':value==scope.COMPARTMENT}
        elif name=='name':
            result[name]={'present':name in row,'matchesApproved':value==scope.BUCKET}
        else:
            if value is not None and type(value) not in (str,bool):
                raise KeySafetyError('BoundedPublicBucketFlagsRequired')
            if type(value) is str and value not in ('Standard','InfrequentAccess','Archive','NoPublicAccess',
                'ObjectRead','ObjectReadWithoutList','Enabled','Disabled','Suspended'):
                raise KeySafetyError('KnownPublicBucketFlagRequired')
            result[name]={'present':name in row,'value':value}
    return result


def main():
    if sys.argv[1:]!=['--read-only']:raise KeySafetyError('FixedReadOnlyDiagnosisRequired')
    parent=Path(__file__).resolve().parents[2]/'docs/evidence/p8'
    previous=parent/'backup-iam-owner-20261030-repair01'
    if verified_manifest(previous)!=PRIOR:raise KeySafetyError('ExactRetainedBucketSafetyFailureRequired')
    if any(path.name.startswith('approved-') for path in previous.iterdir()):
        raise KeySafetyError('BeforeMutationFailureRequired')
    journal=Journal(parent/'bucket-metadata-diagnosis-20261030-01')
    result={'status':'FAIL','readOnly':True,'cloudWrites':0,'iamChanges':0,'vmChanges':0,
        'originalFailureManifestSHA256':PRIOR,'phaseComplete':False}
    try:
        profile=ensure_session()
        reads=RecordedReads(profile,journal)
        reads.namespace=reads.read('namespace')
        reads.buckets={scope.BUCKET}
        row=reads.read('bucket',bucket=scope.BUCKET)
        flags=project(row)
        try:
            scope.validate_bucket(row,[scope.BUCKET])
            validation={'status':'PASS'}
        except scope.BackupScopeError as error:
            validation={'status':'FAIL','code':str(error)}
        journal.put('bucket-flags.json',{'flags':flags,'existingValidator':validation})
        result.update(status='PASS',metadataCaptured=True,existingValidator=validation,
            broaderPermissionsRequested=False)
    except Exception as error:
        result.update(exceptionType=type(error).__name__,rawErrorWithheld=True)
    finally:result['manifestSHA256']=journal.seal(result)
    print(json.dumps(result));return 0 if result['status']=='PASS' else 1


if __name__=='__main__':raise SystemExit(main())
