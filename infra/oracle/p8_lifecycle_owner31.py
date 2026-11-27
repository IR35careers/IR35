"""ONE separately approved 31-Oct lifecycle run. No replay, generic OCI or VM API.

Every mutation is journalled once, with stdin closed and CLI retries disabled.
Rollback deletes only an ID/ETag returned by THIS run's create, after an exact
definition/ETag read-back. Existing resources are never deleted or overwritten.
"""
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys

import p8_backup_policy as scope
import p8_lifecycle_protocol as wire

SERVICE_POLICY = 'ir35-backup-lifecycle-service'
TAGS = {'project': 'ir35', 'purpose': 'backup', 'owner-scope': '20261031-bounded01'}
PRIOR_APPROVED_TAGS = {'project': 'ir35', 'purpose': 'backup', 'owner-scope': '20261030'}
ROOT_POLICY_SHA = '41836268722951511409c9ba1dd2a8b2d293f06e16a9beb7bb694f2302842e9a'
SHAPE_MANIFEST = '13f617824baff855a86c85c7d75b981e1f0c3f0d68c4069c37727ad6ff60b0db'
OLD_FINAL_MANIFEST = 'f9e2efadc36c0bc7ae68464fc91927a593de0c57ae648c5fcae90123f89b72b1'
SLOT = 'backup-lifecycle-owner-20261031-01'


class OwnerRunError(RuntimeError):
    """Fixed codes, never raw provider/credential output."""


def definition(row):
    return row.get('statements', row.get('matching-rule'))


def sha(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True).encode()).hexdigest()


def service_statements():
    base = 'Allow service objectstorage-uk-london-1 to manage object-family in compartment id ' + scope.COMPARTMENT
    return [base + " where request.permission='BUCKET_INSPECT'",
            base + " where all {target.bucket.name='ir35-backups', any {request.permission='BUCKET_READ', request.permission='OBJECT_INSPECT', request.permission='OBJECT_DELETE'}}"]


def specifications(root):
    return [
        {'list': 'groups', 'name': scope.DYNAMIC_GROUP, 'kind': 'dynamicgroup', 'create': 'create-group',
         'compartment': root, 'definition': scope.matching_rule()},
        {'list': 'child-policies', 'name': scope.POLICY_NAME, 'kind': 'policy', 'create': 'create-vm-policy',
         'compartment': scope.COMPARTMENT, 'definition': [scope.policy_statement()]},
        {'list': 'root-policies', 'name': SERVICE_POLICY, 'kind': 'policy', 'create': 'create-service-policy',
         'compartment': root, 'definition': service_statements()},
    ]


def validate(row, spec, *, require_tags=False):
    if (type(row) is not dict or row.get('name') != spec['name']
            or row.get('compartment-id') != spec['compartment']
            or row.get('lifecycle-state') != 'ACTIVE'
            or definition(row) != spec['definition']
            or require_tags and row.get('freeform-tags') != TAGS):
        raise OwnerRunError('ExactOwnerIamDefinitionRequired')
    return row


def projection(rows):
    return {key: sorted([{'id': row['id'], 'name': row.get('name'),
                          'definitionSHA256': sha(definition(row))} for row in values],
                        key=lambda row: row['id']) for key, values in rows.items()}


class OwnerRun:
    """Pure orchestration, tested with an in-memory provider and no credentials."""
    def __init__(self, api, journal, root, free_check, wait):
        self.api, self.journal, self.root = api, journal, root
        self.free_check, self.wait = free_check, wait
        self.before = None
        self.created = []
        self.lifecycle_created = None
        self.events = 0

    def log(self, name, value):
        self.events += 1
        self.journal.put(f'owner31-{self.events:03d}-{name}.json', value)

    def inventory(self):
        values = {key: self.api.call(key)['data'] for key in ('groups', 'root-policies', 'child-policies')}
        for rows in values.values():
            if type(rows) is not list or len({row['id'] for row in rows}) != len(rows):
                raise OwnerRunError('UniqueIamInventoryRequired')
        return values

    def read_resource(self, spec, identifier):
        return self.api.call('get-group' if spec['kind'] == 'dynamicgroup' else 'get-policy', identifier=identifier)

    def one(self, spec):
        matches = [row for row in self.before[spec['list']] if row.get('name') == spec['name']]
        if len(matches) > 1:
            raise OwnerRunError('AmbiguousOwnerResourceName_NoCreate')
        if matches:
            if matches[0].get('freeform-tags') not in (TAGS, PRIOR_APPROVED_TAGS):
                raise OwnerRunError('ExistingResourceOwnerTagsRequired_NoCreate')
            self.api.ids.add(matches[0]['id'])
            current = self.read_resource(spec, matches[0]['id'])
            validate(current['data'], spec)
            if current['data'].get('freeform-tags') != matches[0].get('freeform-tags'):
                raise OwnerRunError('ExistingResourceOwnerTagsChanged')
            return {'id': matches[0]['id'], 'name': spec['name'], 'created': False}
        self.free_check(spec['name'])
        result = self.api.call(spec['create'])  # Exactly once, never retried.
        row = result['data']
        identifier = self.api.identifier(row.get('id'), spec['kind'])
        if identifier in {item['id'] for rows in self.before.values() for item in rows}:
            raise OwnerRunError('CreateReturnedExistingIdentifier_NoRollbackOfExisting')
        self.api.ids.add(identifier)
        # Receipt immediately after CREATE, BEFORE validation or any waiter.
        owned = {'id': identifier, 'spec': spec, 'etag': result.get('etag'),
                 'definitionSHA256': sha(definition(row)), 'tags': row.get('freeform-tags')}
        self.created.append(owned)
        self.log('created-receipt', {'id': identifier, 'name': spec['name'],
            'etagSHA256': sha(owned['etag']), 'definitionSHA256': owned['definitionSHA256'],
            'runCreated': True, 'tagsMatch': owned['tags'] == TAGS})
        wire.etag(owned['etag'])
        def visible():
            current = self.read_resource(spec, identifier)
            if current['data'].get('lifecycle-state') != 'ACTIVE':
                return None
            validate(current['data'], spec, require_tags=True)
            if current.get('etag') != owned['etag']:
                raise OwnerRunError('CreatedIamEtagChanged_HardStop')
            return current
        self.wait(visible, label=spec['name'], record=lambda event: self.log('visibility', event))
        return {'id': identifier, 'name': spec['name'], 'created': True}

    def verify_iam(self, expected, *, pending_removals=None):
        def visible():
            after = self.inventory()
            for key in expected:
                observed = {row['id'] for row in after[key]}
                additional = observed - expected[key]
                if additional:
                    if (pending_removals is not None and additional <= pending_removals
                            and all(row.get('lifecycle-state') in ('DELETING', 'DELETED')
                                    for row in after[key] if row['id'] in additional)):
                        return None
                    raise OwnerRunError('UnexpectedAdditionalIamResource_HardStop')
                if observed != expected[key]:
                    return None
            return after
        after = self.wait(visible, label='owner31-iam-lists', record=lambda event: self.log('visibility', event))
        for key, rows in self.before.items():
            for row in rows:
                current = [item for item in after[key] if item['id'] == row['id']]
                if len(current) != 1 or definition(current[0]) != definition(row):
                    raise OwnerRunError('OriginalIamDefinitionChanged_HardStop')
        if sum(sha(definition(row)) == ROOT_POLICY_SHA for row in after['root-policies']) != 1:
            raise OwnerRunError('OriginalRootPolicyShaMismatch_HardStop')
        return after

    def execute(self):
        self.before = self.inventory()
        self.log('iam-before', projection(self.before))
        if sum(sha(definition(row)) == ROOT_POLICY_SHA for row in self.before['root-policies']) != 1:
            raise OwnerRunError('OriginalRootPolicyShaMismatch_HardStop')
        # Read BEFORE any CREATE, so an unrelated/empty existing policy cannot
        # be silently overwritten after IAM resources have been created.
        initial = self.api.lifecycle_or_absent()
        if initial is not None:
            wire.normalize_cli_items(initial['data'].get('items'))
        self.log('lifecycle-before', {'exists': initial is not None,
            'items': None if initial is None else initial['data']['items']})
        resources = [self.one(spec) for spec in specifications(self.root)]
        expected = {key: {row['id'] for row in rows} for key, rows in self.before.items()}
        for spec, item in zip(specifications(self.root), resources):
            expected[spec['list']].add(item['id'])
        after = self.verify_iam(expected)
        self.log('iam-after', projection(after))
        if initial is None:
            self.free_check('ir35-backups-lifecycle', exact_storage=True)
            reply = self.api.call('create-lifecycle')
            # A successful create-only response proves THIS run created it.
            self.lifecycle_created = {'etag': reply.get('etag')}
            self.log('lifecycle-created-receipt', {'runCreated': True,
                'etagSHA256': sha(reply.get('etag')), 'ifNoneMatchStar': True})
            wire.etag(reply.get('etag'))
        actual = self.api.call('get-lifecycle')
        canonical = wire.normalize_cli_items(actual['data'].get('items'))
        if self.lifecycle_created and actual.get('etag') != self.lifecycle_created['etag']:
            raise OwnerRunError('CreatedLifecycleEtagChanged_HardStop')
        self.log('lifecycle-after', {'status': 'PASS', 'items': canonical,
            'expiryExecutionProven': False, 'vmDeleteGranted': False})
        self.verify_iam(expected)
        return {'status': 'PASS', 'resources': resources,
            'lifecycleCreated': self.lifecycle_created is not None,
            'policyTexts': {'vm': scope.policy_statement(), 'service': service_statements()},
            'lifecycleConfigured': True, 'backupUploaded': False, 'restoreProven': False,
            'timerInstalled': False, 'phaseComplete': False}

    def rollback(self):
        """Never delete a reused ID, changed representation or an ambiguous create."""
        errors = []
        if self.lifecycle_created:
            try:
                current = self.api.call('get-lifecycle')
                wire.normalize_cli_items(current['data'].get('items'))
                expected = wire.etag(self.lifecycle_created['etag'])
                if current.get('etag') != expected:
                    raise OwnerRunError('RollbackLifecycleOwnershipEtagMismatch_NoDelete')
                self.api.call('delete-created-lifecycle', expected_etag=expected)
                if self.api.lifecycle_or_absent() is not None:
                    raise OwnerRunError('CreatedLifecycleRemovalNotVerified')
                self.log('rollback-lifecycle', {'status': 'PASS', 'deletedRunCreatedOnly': True})
            except Exception as error:
                code = str(error) if re.fullmatch('[A-Za-z0-9_]+', str(error)) else 'RawErrorWithheld'
                errors.append(code)
                self.log('rollback-lifecycle-failed', {'status': 'FAIL', 'code': code,
                    'exceptionType': type(error).__name__, 'retry': False})
        for owned in reversed(self.created):
            try:
                spec = owned['spec']
                current = self.read_resource(spec, owned['id'])
                row = current['data']
                validate(row, spec, require_tags=True)
                expected = wire.etag(owned['etag'])
                if (current.get('etag') != expected or sha(definition(row)) != owned['definitionSHA256']
                        or row.get('freeform-tags') != owned['tags']):
                    raise OwnerRunError('RollbackIamOwnershipEtagMismatch_NoDelete')
                self.api.call('delete-created-group' if spec['kind'] == 'dynamicgroup' else 'delete-created-policy',
                              identifier=owned['id'], expected_etag=expected)
                self.log('rollback-resource', {'id': owned['id'], 'name': spec['name'],
                    'status': 'PASS', 'deletedRunCreatedOnly': True})
            except Exception as error:
                code = str(error) if re.fullmatch('[A-Za-z0-9_]+', str(error)) else 'RawErrorWithheld'
                errors.append(code)
                self.log('rollback-resource-failed', {'id': owned['id'], 'status': 'FAIL', 'code': code,
                    'exceptionType': type(error).__name__, 'retry': False})
        # Independently prove the original root definition even if a separate
        # cleanup could not safely delete a changed run-created resource.
        root_readback = self.api.call('root-policies')['data']
        root_match = sum(sha(definition(row)) == ROOT_POLICY_SHA for row in root_readback) == 1
        self.log('rollback-original-root', {'status': 'PASS' if root_match else 'FAIL',
            'originalRootPolicySHA256': ROOT_POLICY_SHA, 'definitionMatches': root_match})
        if errors or not root_match:
            raise OwnerRunError(errors[0] if errors else 'OriginalRootPolicyShaMismatch_HardStop')
        if self.before is None:
            return {'status': 'PASS', 'knownCreatedResources': 0,
                    'originalRootPolicySHA256': ROOT_POLICY_SHA}
        expected = {key: {row['id'] for row in rows} for key, rows in self.before.items()}
        after = self.verify_iam(expected, pending_removals={row['id'] for row in self.created})
        self.log('rollback-iam-after', projection(after))
        if projection(after) != projection(self.before):
            raise OwnerRunError('RollbackIamBeforeAfterMismatch_HardStop')
        return {'status': 'PASS', 'originalRootPolicySHA256': ROOT_POLICY_SHA,
                'createdResourcesRemoved': len(self.created),
                'createdLifecycleRemoved': self.lifecycle_created is not None}


class NativeApi:
    def __init__(self, profile, journal, *, create_guard=None):
        self.profile, self.journal = profile, journal
        self.ids = set()
        self.namespace = None
        self.count = 0
        self.creation_calls = set()
        self.create_guard = create_guard

    def identifier(self, value, kind):
        from bootstrap_audit import ocid
        return ocid(value, kind)

    def arguments(self, operation, *, identifier=None, expected_etag=None):
        root = self.profile['tenancy']
        fixed = {
            'groups': ['iam', 'dynamic-group', 'list', '--compartment-id', root, '--all'],
            'root-policies': ['iam', 'policy', 'list', '--compartment-id', root, '--all'],
            'child-policies': ['iam', 'policy', 'list', '--compartment-id', scope.COMPARTMENT, '--all'],
            'create-group': ['iam', 'dynamic-group', 'create', '--compartment-id', root,
                '--name', scope.DYNAMIC_GROUP, '--matching-rule', scope.matching_rule(),
                '--description', 'IR35 exact existing backup VM only', '--freeform-tags', json.dumps(TAGS)],
            'create-vm-policy': ['iam', 'policy', 'create', '--compartment-id', scope.COMPARTMENT,
                '--name', scope.POLICY_NAME, '--description', 'IR35 exact one-bucket create inspect read only',
                '--statements', json.dumps([scope.policy_statement()]), '--freeform-tags', json.dumps(TAGS)],
            'create-service-policy': ['iam', 'policy', 'create', '--compartment-id', root,
                '--name', SERVICE_POLICY, '--description', 'IR35 London lifecycle exact compartment and bucket only',
                '--statements', json.dumps(service_statements()), '--freeform-tags', json.dumps(TAGS)]}
        if operation in fixed:
            if identifier is not None or expected_etag is not None:
                raise OwnerRunError('UnexpectedOwnerOperationSelector')
            return fixed[operation]
        if operation in ('get-group', 'get-policy', 'delete-created-group', 'delete-created-policy'):
            if identifier not in self.ids:
                raise OwnerRunError('OnlyInventoriedOwnerIdentifierAllowed')
            group = operation.endswith('group')
            args = ['iam', 'dynamic-group' if group else 'policy',
                    'get' if operation.startswith('get-') else 'delete',
                    '--dynamic-group-id' if group else '--policy-id', identifier]
            if operation.startswith('delete-'):
                args += ['--if-match', wire.etag(expected_etag), '--force']
            elif expected_etag is not None:
                raise OwnerRunError('GetCannotMutate')
            return args
        lifecycle = {'get-lifecycle': 'get', 'create-lifecycle': 'create',
                     'delete-created-lifecycle': 'delete-created'}
        if operation in lifecycle and identifier is None:
            return wire.lifecycle_arguments(lifecycle[operation], self.namespace, expected_etag=expected_etag)
        raise OwnerRunError('OperationOutsideExactOwnerScope')

    def call(self, operation, **selectors):
        from security_session import ensure_session, command, clean_environment
        from visibility import OciError, call_timeout
        args = self.arguments(operation, **selectors)
        fresh = ensure_session()
        if any(fresh[key] != self.profile[key] for key in ('tenancy', 'user', 'region')):
            raise OwnerRunError('BrowserIdentityChanged')
        if operation.startswith('create-'):
            names = {item['create']: item['name'] for item in specifications(self.profile['tenancy'])}
            names['create-lifecycle'] = 'ir35-backups-lifecycle'
            if self.create_guard is None:
                raise OwnerRunError('FreshPerCreateEligibilityGuardRequired')
            # Session refresh can consume time. Recheck the REAL measurement
            # timestamp after authentication, immediately before mutation intent.
            self.create_guard.assert_fresh(names[operation])
            if operation in self.creation_calls:
                raise OwnerRunError('NativeCreateAlreadyAttempted_NoRetry')
            self.creation_calls.add(operation)
        self.count += 1
        label = f'approved31-{self.count:03d}'
        self.journal.put(label + '-intent.json', {'operation': operation,
            'readOnly': not operation.startswith(('create-', 'delete-')),
            'scope': 'owner31-single-bounded-run', 'region': scope.REGION})
        try:
            reply = subprocess.run(command(args), stdin=subprocess.DEVNULL, capture_output=True,
                text=True, timeout=call_timeout(), env=clean_environment(), check=False)
            if reply.returncode:
                raise OciError.from_stderr(operation, reply.stderr)
            if operation.startswith('delete-'):
                # CLI renders an empty HTTP204 as no stdout, or metadata only.
                raw = json.loads(reply.stdout) if reply.stdout.strip() else {}
                if type(raw) is not dict or set(raw) - {'data', 'etag', 'opc-request-id'}:
                    raise OwnerRunError('ExpectedDeleteResponseEnvelopeRequired')
                parsed = {'data': None}
            elif operation in ('groups', 'root-policies', 'child-policies'):
                # Installed CLI render([]) omits data, including when known
                # display/pagination headers still produce a metadata envelope.
                parsed = wire.list_response(json.loads(reply.stdout) if reply.stdout.strip() else {})
            else:
                parsed = wire.response(json.loads(reply.stdout))
        except Exception as error:
            self.journal.put(label + '-result.json', {'status': 'FAIL',
                'exceptionType': type(error).__name__, 'httpStatus': getattr(error, 'status', None),
                'serviceCode': getattr(error, 'code', None), 'rawOutputWithheld': True,
                'ambiguousCreatePossible': operation.startswith('create-')})
            raise
        self.journal.put(label + '-result.json', {'status': 'PASS', 'operation': operation,
            'etagPresent': 'etag' in parsed})
        return parsed

    def lifecycle_or_absent(self):
        from visibility import OciError
        try:
            return self.call('get-lifecycle')
        except OciError as error:
            if error.status != 404:
                raise
            return None


def main(argv=None):
    from key_ceremony import KeySafetyError
    from p6_audit_log import Journal
    from p6_pause_reconcile import verified_manifest
    from p8_backup_iam_owner import OwnerReads, authenticated_bucket, safe_bucket
    from p8_lifecycle_eligibility import FreshEligibility
    from p8_oci_readonly import execute
    from object_storage_exact import SecurityTokenReads
    from resource_audit import session_account_audit
    from security_session import ensure_session
    from ssh_agent_session import ensure_agent
    from visibility import wait_for_visible
    if (sys.argv[1:] if argv is None else argv) != ['--apply-owner-20261031-one-bounded-run']:
        raise OwnerRunError('ExplicitOwner31BoundedInvocationRequired')
    parent = Path(__file__).resolve().parents[2] / 'docs/evidence/p8'
    if (parent / SLOT).exists():
        raise OwnerRunError('Owner31NativeAllowanceConsumed_NoReplay')
    # Immutable retained failures and recorded serializer diagnosis, not a reset.
    if (verified_manifest(parent / 'lifecycle-cli-shape-diagnosis-20261030-01') != SHAPE_MANIFEST
            or verified_manifest(parent / 'backup-iam-owner-20261030-repair02') != OLD_FINAL_MANIFEST):
        raise OwnerRunError('PriorSealedEvidenceRequired')
    agent = ensure_agent()
    if not agent.get('keyLoaded') or agent.get('keyLeaseMode') != 'until-agent-restart':
        raise KeySafetyError('LoadedMigrationSshFingerprintRequired_NoPrompt')
    profile = ensure_session(minimum_seconds=1800)
    journal = Journal(parent / SLOT)  # Fixed O_EXCL allowance; never replay.
    result = {'status': 'FAIL', 'productionChanges': 0, 'vmChanges': 0, 'cutover': False}
    run = None
    try:
        journal.put('owner31-intent.json', {'approval': '31Oct-decoupled-one-bounded-lifecycle-run',
            'priorStoppedManifestSHA256': OLD_FINAL_MANIFEST, 'diagnosisManifestSHA256': SHAPE_MANIFEST,
            'keyLoaded': True, 'keyFingerprint': agent['keyFingerprint'],
            'assertionsChanged': False, 'observerPermissions': False, 'nativeRetryAllowed': False})
        reads = OwnerReads(profile, journal)
        result['freeInventory'] = execute(reads, journal, SecurityTokenReads(profile))
        journal.put('bucket-safety.json', safe_bucket(authenticated_bucket(reads)))
        api = NativeApi(profile, journal)
        api.namespace = reads.namespace
        def measure_eligibility(child):
            current = OwnerReads(profile, child)
            proof = execute(current, child, SecurityTokenReads(profile))
            report_bytes = child.path('inventory.json').read_bytes()
            account = session_account_audit(current)
            bucket = safe_bucket(authenticated_bucket(current))
            if current.namespace != api.namespace:
                raise OwnerRunError('AuthenticatedNamespaceChanged_NoCreate')
            child.put('bucket-safety.json', bucket)
            return {'inventory': json.loads(report_bytes), 'inventorySHA256': hashlib.sha256(report_bytes).hexdigest(),
                'account': account, 'bucket': bucket, 'freeInventory': proof}
        free_check = FreshEligibility(journal, measure_eligibility)
        api.create_guard = free_check
        run = OwnerRun(api, journal, profile['tenancy'], free_check, wait_for_visible)
        result.update(run.execute())
        result['checkedAt'] = datetime.now(timezone.utc).isoformat()
    except Exception as error:
        result.update(exceptionType=type(error).__name__, code=str(error) if re.fullmatch(
            '[A-Za-z0-9_]+', str(error)) else 'RawErrorWithheld', nativeRetryAllowed=False)
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
    raise SystemExit(main())
