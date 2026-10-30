"""Exact 30-Oct owner-approved backup IAM/lifecycle; no general OCI executor.

Only one existing VM, compartment and bucket. Public metadata stays journalled;
CLI authentication stays in SecurityToken config, never arguments or evidence.
"""
from datetime import datetime, timezone
import json
from pathlib import Path
import re
import subprocess
import sys

from bootstrap_audit import ocid
from key_ceremony import KeySafetyError
from p6_audit_log import Journal
from p6_pause_reconcile import verified_manifest
import p8_backup_policy as scope
from p8_oci_readonly import RecordedReads, execute
from object_storage_exact import Counter, SecurityTokenReads, digest
from resource_audit import session_account_audit
from security_session import clean_environment, command, ensure_session
from visibility import OciError, wait_for_visible

SERVICE_POLICY='ir35-backup-lifecycle-service'
TAGS={'project':'ir35','purpose':'backup','owner-scope':'20261030'}
FIRST_FAILURE_MANIFEST='57dcca1709f36f8dbe66c3c6e43b10d400a0d0be475487dab5097852149aba71'
SECOND_FAILURE_MANIFEST='b052398f71610c2323542cc275f8b6d82260709d349725f1b03417e0fae4816d'
DIAGNOSIS_MANIFEST='9234ca1d9cc64160dd4d1bc9d4d71bb062674c772512ab432203370995eaa618'


class OwnerReads(RecordedReads):
    def arguments(self,operation,**selectors):
        arguments=super().arguments(operation,**selectors)
        if operation=='bucket':
            # OCI omits this OPTIONAL response field unless requested. Keep the
            # strict Disabled assertion; fetch actual state, never coerce null.
            arguments += ['--fields','autoTiering']
        return arguments


def authenticated_bucket(reads):
    # Exact inventory uses its own metadata transport. Its GET is intentionally
    # not projected into RecordedReads.observed; do not infer absence from that
    # implementation detail. Only GET a name discovered by the full inventory.
    if scope.BUCKET not in reads.buckets:
        raise KeySafetyError('InventoriedBackupBucketRequired')
    return reads.read('bucket',bucket=scope.BUCKET)


def exact_bucket_scope(reads):
    return [(row['name'],compartment) for compartment in sorted(reads.compartments)
        for row in reads.read('buckets',compartment=compartment)]


def prior_projection_failure(root):
    anchor=verified_manifest(root)
    previous=json.loads((root/'result.json').read_bytes())
    if (anchor!=FIRST_FAILURE_MANIFEST or previous.get('status')!='FAIL'
        or previous.get('code')!='OneAuthenticatedBackupBucketRequired'
        or previous.get('freeInventory',{}).get('cloudWrites')!=0
        or any(path.name.startswith('approved-') for path in root.iterdir())):
        raise KeySafetyError('ExactBeforeMutationBucketProjectionFailureRequired')
    return anchor


def prior_optional_field_failure(parent):
    first=prior_projection_failure(parent/'backup-iam-owner-20261030-01')
    second=parent/'backup-iam-owner-20261030-repair01'
    diagnosis=parent/'bucket-metadata-diagnosis-20261030-01'
    if (verified_manifest(second)!=SECOND_FAILURE_MANIFEST
        or verified_manifest(diagnosis)!=DIAGNOSIS_MANIFEST
        or any(path.name.startswith('approved-') for path in second.iterdir())):
        raise KeySafetyError('ExactBeforeMutationOptionalFieldFailureRequired')
    result=json.loads((second/'result.json').read_bytes())
    flags=json.loads((diagnosis/'bucket-flags.json').read_bytes())
    if (result.get('status')!='FAIL' or result.get('exceptionType')!='BackupScopeError'
        or result.get('freeInventory',{}).get('cloudWrites')!=0
        or flags.get('existingValidator',{}).get('code')!='ExplicitPrivateStandardVersionOffWritableBucketRequired'
        or flags.get('flags',{}).get('auto-tiering')!={'present':True,'value':None}):
        raise KeySafetyError('ExactMissingRequestedAutoTieringMetadataRequired')
    return {'first':first,'second':SECOND_FAILURE_MANIFEST,'diagnosis':DIAGNOSIS_MANIFEST}


def service_statements():
    base='Allow service objectstorage-uk-london-1 to manage object-family in compartment id '+scope.COMPARTMENT
    # BUCKET_READ is read-only metadata for the SAME bucket, documented by OCI
    # for lifecycle execution. No bucket update/management or object overwrite.
    return [base+" where request.permission='BUCKET_INSPECT'",
        base+" where all {target.bucket.name='ir35-backups', any {request.permission='BUCKET_READ', request.permission='OBJECT_INSPECT', request.permission='OBJECT_DELETE'}}"]


def safe_bucket(row):
    scope.validate_bucket(row,[scope.BUCKET])
    if 'kms-key-id' not in row or row.get('replication-enabled') is not False or row['kms-key-id'] is not None:
        raise KeySafetyError('NoReplicationOrCustomerManagedKeyBucketRequired')
    return {'status':'PASS','bucket':scope.BUCKET,'storageTier':'Standard','versioning':'Disabled',
        'autoTiering':'Disabled','replicationEnabled':False,'customerManagedKey':False}


def validate_service(row,root):
    if (row.get('name')!=SERVICE_POLICY or row.get('compartment-id')!=root
        or row.get('lifecycle-state')!='ACTIVE' or row.get('statements')!=service_statements()):
        raise KeySafetyError('ExactChildScopedServicePermissionStatementsRequired')
    return row


def retention_items():
    return [{'name':'ir35-'+lane+'-expiry','target':'objects','action':'DELETE','timeAmount':days,
        'timeUnit':'DAYS','isEnabled':True,'objectNameFilter':{'inclusionPrefixes':[scope.PREFIX+'/'+lane+'/']}}
        for lane,days in (('daily',7),('weekly',28))]


class ApprovedApi:
    def __init__(self,profile,journal):
        self.profile=profile;self.journal=journal;self.count=0;self.ids=set();self.namespace=None

    def call(self,operation,*,identifier=None):
        root=self.profile['tenancy'];child=scope.COMPARTMENT
        commands={
          'groups':['iam','dynamic-group','list','--compartment-id',root,'--all'],
          'root-policies':['iam','policy','list','--compartment-id',root,'--all'],
          'child-policies':['iam','policy','list','--compartment-id',child,'--all'],
          'create-group':['iam','dynamic-group','create','--compartment-id',root,'--name',scope.DYNAMIC_GROUP,
              '--matching-rule',scope.matching_rule(),'--description','IR35 exact existing backup VM only','--freeform-tags',json.dumps(TAGS)],
          'create-vm-policy':['iam','policy','create','--compartment-id',child,'--name',scope.POLICY_NAME,
              '--description','IR35 one-bucket create inspect read only','--statements',json.dumps([scope.policy_statement()]),'--freeform-tags',json.dumps(TAGS)],
          'create-service-policy':['iam','policy','create','--compartment-id',root,'--name',SERVICE_POLICY,
              '--description','IR35 London lifecycle service exact compartment and bucket only','--statements',json.dumps(service_statements()),'--freeform-tags',json.dumps(TAGS)]}
        if operation in ('get-group','get-policy'):
            if identifier not in self.ids:raise KeySafetyError('OnlyInventoriedOwnerResourceGetAllowed')
            commands[operation]=['iam','dynamic-group' if operation=='get-group' else 'policy','get',
                '--dynamic-group-id' if operation=='get-group' else '--policy-id',identifier]
        if operation in ('get-lifecycle','put-lifecycle'):
            if type(self.namespace)is not str or not re.fullmatch('[a-z0-9]{1,63}',self.namespace):
                raise KeySafetyError('AuthenticatedExactNamespaceRequired')
            commands[operation]=['os','object-lifecycle-policy','get' if operation=='get-lifecycle' else 'put',
                '--namespace-name',self.namespace,'--bucket-name',scope.BUCKET]
            if operation=='put-lifecycle':commands[operation]+=['--items',json.dumps(retention_items())]
        if operation not in commands:raise KeySafetyError('OperationOutsideExactOwnerBackupScope')
        fresh=ensure_session()
        if any(fresh[key]!=self.profile[key] for key in ('tenancy','user')):raise KeySafetyError('BrowserIdentityChanged')
        self.count+=1;label=f'approved-{self.count:03d}'
        self.journal.put(label+'-intent.json',{'operation':operation,'readOnly':not operation.startswith(('create-','put-')),
            'scope':'exact-owner-20261030','region':'uk-london-1'})
        reply=subprocess.run(command(commands[operation]),capture_output=True,text=True,timeout=65,env=clean_environment(),check=False)
        if reply.returncode:
            error=OciError.from_stderr(operation,reply.stderr)
            self.journal.put(label+'-result.json',{'status':'FAIL','httpStatus':error.status,'serviceCode':error.code,'rawWithheld':True})
            raise error
        value=json.loads(reply.stdout)['data'] if reply.stdout else []
        self.journal.put(label+'-result.json',{'status':'PASS','operation':operation})
        return value


def one_resource(api,list_operation,name,create_operation,kind,validate,free_check):
    matches=[row for row in api.call(list_operation) if row.get('name')==name]
    if len(matches)>1:raise KeySafetyError('AmbiguousOwnerResourceName_NoCreate')
    if matches:
        row=matches[0];identifier=ocid(row['id'],kind);api.ids.add(identifier)
        row=api.call('get-group' if kind=='dynamicgroup' else 'get-policy',identifier=identifier)
        validate(row)
        return {'id':identifier,'name':name,'created':False}
    free_check(name)
    print('ALWAYS FREE: '+name+'; IAM control plane only, no compute/storage allocation or paid tier.',flush=True)
    row=api.call(create_operation);identifier=ocid(row['id'],kind);api.ids.add(identifier)
    events=[]
    def seen(event):
        events.append(event);api.journal.put(f'visibility-{name}-{len(events):03d}.json',event)
    def visible():
        current=api.call('get-group' if kind=='dynamicgroup' else 'get-policy',identifier=identifier)
        if current.get('lifecycle-state')!='ACTIVE':return None
        validate(current);return current
    wait_for_visible(visible,label=name,record=seen)
    return {'id':identifier,'name':name,'created':True}


def main(argv=None):
    arguments=sys.argv[1:] if argv is None else argv
    repair=arguments==['--repair-bucket-projection-owner-20261030']
    final_repair=arguments==['--repair-explicit-fields-owner-20261030']
    if arguments!=['--apply-owner-20261030'] and not repair and not final_repair:
        raise KeySafetyError('ExplicitExactOwnerBackupScopeRequired')
    parent=Path(__file__).resolve().parents[2]/'docs/evidence/p8'
    prior=prior_projection_failure(parent/'backup-iam-owner-20261030-01') if repair else None
    final_prior=prior_optional_field_failure(parent) if final_repair else None
    journal=Journal(parent/('backup-iam-owner-20261030-repair02' if final_repair else 'backup-iam-owner-20261030-repair01' if repair else 'backup-iam-owner-20261030-01'))
    result={'status':'FAIL','scope':'owner-approved-one-vm-one-bucket','productionChanges':0,'vmChanges':0,'cutover':False}
    try:
        if repair:
            journal.put('repair-intent.json',{'priorManifestSHA256':prior,'repairAttempt':1,
                'cause':'Exact inventory metadata GET uses separate transport; observed projection has no bucket row',
                'change':'Explicit GET of inventoried bucket; exact counter receives documented name-compartment pairs',
                'assertionsChanged':False,'counterChanged':False,'previousCloudWrites':0})
        if final_repair:
            journal.put('repair-intent.json',{'priorManifestsSHA256':final_prior,'repairAttempt':2,
                'cause':'CLI bucket GET omitted optional autoTiering field; separate exact SDK GET already explicitly requests it',
                'change':'Request optional autoTiering field on read-back; keep strict Disabled/null-rejection assertions',
                'assertionsChanged':False,'counterChanged':False,'nullDefaultInferred':False,
                'previousCloudWrites':0,'nextFailureHardStop':True})
        profile=ensure_session(minimum_seconds=1800);reads=OwnerReads(profile,journal)
        result['freeInventory']=execute(reads,journal,SecurityTokenReads(profile))
        journal.verify()
        preflight=json.loads((journal.root/'inventory.json').read_bytes())
        journal.put('bucket-safety.json',safe_bucket(authenticated_bucket(reads)))
        api=ApprovedApi(profile,journal);api.namespace=reads.namespace
        before={name:api.call(name) for name in ('groups','root-policies','child-policies')}
        journal.put('iam-before.json',{name:[{'id':row['id'],'name':row.get('name'),
            'definitionSHA256':__import__('hashlib').sha256(json.dumps(row.get('statements',row.get('matching-rule')),sort_keys=True).encode()).hexdigest()}
            for row in rows] for name,rows in before.items()})
        def free_check(name):
            account=session_account_audit(reads)
            if account.get('homeRegion')!='uk-london-1' or not account.get('activeUserMatch'):
                raise KeySafetyError('FreshFreeHomeAccountRequired')
            if any(row.get('paymentModel') not in ('FREE_TRIAL','ALWAYS_FREE','FREE_ONLY') or row.get('state')!='ACTIVE' for row in account['subscriptions']):
                raise KeySafetyError('AlwaysFreeAccountRequired_NoUpgrade')
            journal.put('free-before-'+name+'.json',{'status':'PASS','account':account,'resource':'free-iam-control-plane',
                'liveVolumeGB':150,'objectBytesAtPreflight':preflight['objectStorage']['exactBytes'],'newPaidResources':0,'realTimeZeroBillProven':False})
        resources=[]
        resources.append(one_resource(api,'groups',scope.DYNAMIC_GROUP,'create-group','dynamicgroup',scope.validate_group,free_check))
        resources.append(one_resource(api,'child-policies',scope.POLICY_NAME,'create-vm-policy','policy',scope.validate_policy,free_check))
        resources.append(one_resource(api,'root-policies',SERVICE_POLICY,'create-service-policy','policy',lambda row:validate_service(row,profile['tenancy']),free_check))
        expected={name:{row['id'] for row in rows} for name,rows in before.items()}
        for name,item in zip(('groups','child-policies','root-policies'),resources):expected[name].add(item['id'])
        visibility=[]
        def after_visible():
            value={name:api.call(name) for name in before}
            if any({row['id'] for row in value[name]}-expected[name] for name in before):
                raise KeySafetyError('UnexpectedAdditionalIamResource_HardStop')
            return value if all({row['id'] for row in value[name]}==expected[name] for name in before) else None
        def after_event(event):
            visibility.append(event);journal.put(f'visibility-iam-after-{len(visibility):03d}.json',event)
        after=wait_for_visible(after_visible,label='owner-backup-iam-lists',record=after_event)
        journal.put('iam-after.json',{name:[{'id':row['id'],'name':row.get('name'),
            'statements':row.get('statements') if row.get('name') in (scope.POLICY_NAME,SERVICE_POLICY) else None,
            'matchingRule':row.get('matching-rule') if row.get('name')==scope.DYNAMIC_GROUP else None,
            'definitionSHA256':__import__('hashlib').sha256(json.dumps(row.get('statements',row.get('matching-rule')),sort_keys=True).encode()).hexdigest()}
            for row in rows] for name,rows in after.items()})
        for name,rows in before.items():
            for row in rows:
                same=[value for value in after[name] if value['id']==row['id']]
                if len(same)!=1 or same[0].get('statements',same[0].get('matching-rule'))!=row.get('statements',row.get('matching-rule')):
                    raise KeySafetyError('OriginalIamDefinitionChanged_HardStop')
        journal.put('exact-approved-policy-text.json',{'vm':scope.policy_statement(),'service':service_statements(),
            'vmDeleteGranted':False,'bucket':scope.BUCKET,'serviceObjectReadGranted':False})
        try:current=api.call('get-lifecycle')
        except OciError as error:
            if error.status!=404:raise
            current={'items':[]}
        items=current.get('items',[])
        if items and items!=retention_items():raise KeySafetyError('ExistingLifecycleMustNotBeOverwritten')
        if not items:
            all_buckets=exact_bucket_scope(reads)
            fresh_counter=Counter(SecurityTokenReads(profile),record=lambda name,value:journal.put('lifecycle-storage-'+digest(name)+'.json',value))
            current_storage=fresh_counter.full_audit(reads.namespace,sorted(reads.compartments),expected_buckets=all_buckets)
            if current_storage['exactBytes']>scope.OWNER_CAP:raise KeySafetyError('BackupEightGbCapExceeded_NoLifecycleMutation')
            journal.put('storage-before-lifecycle.json',current_storage)
            safe_bucket(reads.read('bucket',bucket=scope.BUCKET))
            free_check('ir35-backups-lifecycle')
            print('ALWAYS FREE: lifecycle DELETE only owned encrypted prefixes; Standard, no tier transition/replication.',flush=True)
            api.call('put-lifecycle')
        actual=api.call('get-lifecycle')
        if actual.get('items')!=retention_items():raise KeySafetyError('ExactLifecycleReadbackMismatch_HardStop')
        journal.put('lifecycle.json',{'status':'PASS','items':actual['items'],'expiryExecutionProven':False,
            'asynchronousUpTo24h':True,'vmDeleteGranted':False})
        result.update(status='PASS',resources=resources,policyTexts={'vm':scope.policy_statement(),'service':service_statements()},
            lifecycleConfigured=True,backupUploaded=False,restoreProven=False,phaseComplete=False,
            checkedAt=datetime.now(timezone.utc).isoformat())
    except Exception as error:
        code=str(error) if isinstance(error,(KeySafetyError,scope.BackupScopeError)) and re.fullmatch('[A-Za-z0-9_]+',str(error)) else 'RawErrorWithheld'
        result.update(exceptionType=type(error).__name__,code=code)
    finally:result['manifestSHA256']=journal.seal(result)
    print(json.dumps(result))
    return 0 if result['status']=='PASS' else 1


if __name__=='__main__':raise SystemExit(main())
