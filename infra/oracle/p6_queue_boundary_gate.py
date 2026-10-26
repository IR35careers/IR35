"""Owner-approved connection boundary, not a waiver of raw function ACLs."""
import json

from immutable_artifacts import digest
from p4_recovery_guest import RecoveryError
from p6_queue_hba import ROLES, QUEUE_DATABASE, verify_parsed

TRANSPORTS = ('docker-tcp', 'local', 'ipv4-loopback', 'ipv6-loopback')


def anchored_result(store, report):
    store.verify(report['stage'], report['manifestSHA256'])
    native = json.loads((store.root / report['stage'] / 'result.json').read_bytes())
    supplied = {key: value for key, value in report.items() if key not in ('stage', 'manifestSHA256')}
    if supplied != native:
        raise RecoveryError('PublicProofDiffersFromSealedNativeResult')
    return native


def require_proof(proof, original_failure, current_scope, information, body, custody, parsed_rules):
    if (proof.get('status') != 'PASS' or proof.get('queueOnlyConnectionBoundary') != 'PASS'
            or proof.get('stage') != '10-owner-queue-hba-boundary'
            or proof.get('baseline552Changed') is not False or proof.get('functionCalls') != 0
            or proof.get('rawFunctionFindingRetained') is not True
            or proof.get('inaccessibleApplicationFunctions') is not True
            or proof.get('postmasterStartUnchanged') is not True or proof.get('reloaded') is not True
            or proof.get('queueDatabase') != QUEUE_DATABASE
            or proof.get('applicationDataMustNeverBeRestoredIntoQueueDatabase') is not True):
        raise RecoveryError('OwnerHBAActualProofRequired_NoScopeWaiver')
    for field in ('roleWrites', 'grantWrites', 'customerWrites', 'passwordChanges', 'postgresRestarts',
                  'workerStarts', 'ociNetworkChanges'):
        if proof.get(field) != 0:
            raise RecoveryError('OwnerBoundaryScopeExceeded')
    containment = proof.get('containment', {})
    if (containment.get('status') != 'PASS' or containment.get('tablesEach') != 62
            or containment.get('orderedMD5Each') is not True or containment.get('sequencesEach') != 2
            or containment.get('approvedSchemaExceptionsEach') != 3
            or containment.get('appRolePrivilegesEach') != 552 or containment.get('storageObjectsEach') != 73
            or containment.get('storageSHA256Match') is not True or containment.get('baseline552Unchanged') is not True
            or containment.get('sourceRolesUnchanged') is not True or containment.get('approvedP6RolesEach') != 2):
        raise RecoveryError('OwnerHBAFullContainmentRequired')
    # The raw REVIEW_REQUIRED finding remains verbatim. Only connection reachability
    # is classified separately under the explicit owner decision, never the ACL.
    if (original_failure.get('code') != 'QueueRoleDefinerAccessOutsideQueueSchema_SecurityStop'
            or current_scope != original_failure.get('queueFunctionScope')
            or current_scope != proof.get('rawFunctionScopeBefore')
            or current_scope != proof.get('rawFunctionScopeAfter')):
        raise RecoveryError('RawFunctionScopeChanged_NoApprovedBoundary')
    reports = current_scope.get('databases', [])
    queue_reports = [row for row in reports if row.get('database') == QUEUE_DATABASE]
    if len(queue_reports) != 1 or queue_reports[0].get('outsideQueueDefiners') != []:
        raise RecoveryError('QueueDatabaseHasReachableApplicationFunction')
    backup = proof.get('backup', {})
    if (information.get('hbaFile') != backup.get('originalPath') or custody != backup.get('originalCustody')
            or digest(body) != proof.get('candidateSHA256')):
        raise RecoveryError('CurrentHBAHashPathOrCustodyMismatch')
    inventory = information.get('databases', [])
    names = [row['name'] for row in inventory]
    connectable = sorted(row['name'] for row in inventory if row['allowConnections'])
    disabled = sorted(row['name'] for row in inventory if not row['allowConnections'])
    if (sorted(proof.get('databasesWithConnections', [])) != connectable
            or sorted(proof.get('disabledDatabaseRules', [])) != disabled
            or any(row.get('database') != QUEUE_DATABASE for row in information.get('queueSessions', []))):
        raise RecoveryError('CurrentDatabaseOrQueueSessionBoundaryChanged')
    verify_parsed(parsed_rules, names)
    expected = {(role, database, transport) for role in ROLES for database in connectable for transport in TRANSPORTS}
    checks = proof.get('loginChecks', [])
    observed = {(row.get('role'), row.get('database'), row.get('transport')) for row in checks}
    if observed != expected or len(checks) != len(expected):
        raise RecoveryError('EveryRoleDatabaseTransportActualLoginRequired')
    for row in checks:
        if row.get('passed') is not True or row.get('applicationFunctionCalled') is not False:
            raise RecoveryError('QueueActualLoginProofFailed')
        if row['database'] == QUEUE_DATABASE:
            if row.get('exitCode') != 0 or row.get('connectedAsExpected') is not True:
                raise RecoveryError('ActualQueuePasswordLoginMissing')
        elif row.get('exitCode') == 0 or row.get('explicitHBAReject') is not True or row.get('connectedAsExpected') is not False:
            raise RecoveryError('ActualApplicationConnectionRejectionMissing')
    return {'status': 'PASS', 'ownerApprovedConnectionBoundary': True, 'rawFunctionACLStatus': current_scope['status'],
            'rawFindingUnchanged': True, 'baseline552Changed': False, 'currentHBAHash': digest(body),
            'actualLoginChecks': len(checks), 'functionCalls': 0, 'queueDatabase': QUEUE_DATABASE}


def verify_live(data, recovery, store, current_scope):
    # Read-only verifier. It never invokes the HBA writer/reloader or functions.
    from p6_hba_guest import INFO_SQL, RULE_SQL, read_hba
    proof = data['ownerHBABoundary']
    anchored_result(store, proof)
    anchored_result(store, data['scopeFailure'])
    information = json.loads(recovery.query(INFO_SQL, QUEUE_DATABASE))
    body, custody = read_hba(information['hbaFile'])
    parsed = json.loads(recovery.query(RULE_SQL, QUEUE_DATABASE))
    return require_proof(proof, data['scopeFailure'], current_scope, information, body, custody, parsed)
