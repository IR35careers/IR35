"""Upgrade-only delta checks. Never substitutes for the migration verifier."""
import re

CHANGED_TABLES = frozenset(('public.application_packets', 'public.application_events',
                           'public.application_worker_tasks'))
PURE_FUNCTIONS = frozenset(('application_has_delivery_receipt', 'application_delivery_can_transition'))
DELIVERY_FUNCTIONS = PURE_FUNCTIONS | frozenset((
    'guard_application_delivery', 'audit_application_delivery', 'transition_application_delivery',
    'commit_application_delivery_result', 'project_application_task_delivery',
    'guard_application_task_attempt', 'claim_application_delivery_task', 'save_application_draft'))


def clone_name(pristine):
    if type(pristine) is not str or not re.fullmatch(r'ir35_p4_[0-9]{8}t[0-9]{6}z_[0-9a-f]{8}', pristine):
        raise ValueError('VerifiedPristineNameRequired')
    target = pristine + '_p8_upgrade01'
    if len(target.encode()) > 63:
        raise ValueError('PostgresIdentifierLengthExceeded')
    return target


def assert_owned_clone(pristine, target, annotation, expected_annotation, connections):
    if target != clone_name(pristine) or annotation != expected_annotation or connections != '0':
        raise ValueError('OwnedDisconnectedDisposableCloneRequired_NoDrop')


def data_delta(before, after):
    """Retain raw hashes for all62, do NOT normalise upgraded rows to cloud.

    Only025's three relations can differ. This is NOT fidelity PASS after an
    upgrade: deliberately changed rows/columns remain explicit review deltas.
    Original pristine/P5 full fidelity is independently required afterward.
    """
    def index(rows):
        result = {row['name']: row for row in rows}
        if len(result) != 62 or len(result) != len(rows):
            raise ValueError('Exact62UniqueTableFingerprintsRequired')
        for row in rows:
            if (set(row) != {'name', 'algorithm', 'md5', 'rows', 'serializedBytes'}
                    or row['algorithm'] != 'pg17-copy-binary-framed-text-v1'
                    or not re.fullmatch(r'[a-f0-9]{32}', row['md5'])
                    or not re.fullmatch(r'[0-9]+', row['rows'])
                    or not re.fullmatch(r'[0-9]+', row['serializedBytes'])):
                raise ValueError('UnmodifiedCompleteFingerprintRequired')
        return result
    left, right = index(before), index(after)
    if set(left) != set(right) or not CHANGED_TABLES <= set(left):
        raise ValueError('UpgradeTableInventoryChanged_Abort')
    changed = [name for name in sorted(left) if left[name] != right[name]]
    if set(changed) - CHANGED_TABLES:
        raise ValueError('UnrelatedDataOrAuthStorageMismatch_Abort')
    for name in CHANGED_TABLES - {'public.application_events'}:
        if left[name]['rows'] != right[name]['rows']:
            raise ValueError('ApplicationRowCountChanged_Abort')
    events_before, events_after = (int(rows['public.application_events']['rows']) for rows in (left, right))
    packets = int(left['public.application_packets']['rows'])
    if not events_before <= events_after <= events_before + packets:
        raise ValueError('BackfillEventCountOutsideExplicitBound_Abort')
    return {'scope': 'UPGRADE_DELTA_REVIEW_ONLY_NOT_MIGRATION_FIDELITY',
        'tablesCompared': 62, 'unrelatedTablesExact': 59,
        'rawChangedTables': [{'name': name, 'before': left[name], 'after': right[name]} for name in changed],
        'originalHashesEdited': False, 'fullMigrationFidelityClaimed': False}


def privilege_delta(before, after):
    def index(value):
        if value.get('version') != 1 or set(value.get('roles', [])) != {'anon', 'authenticated', 'service_role'}:
            raise ValueError('CompleteOriginalRoleMatrixRequired')
        result = {}
        for row in value['entries']:
            if (set(row) != {'kind', 'name', 'role', 'privileges'} or row['role'] not in value['roles']
                    or not row['privileges'] or any(type(flag) is not bool for flag in row['privileges'].values())):
                raise ValueError('TypedPrivilegeMatrixRequired')
            key = row['kind'], row['name'], row['role']
            if key in result:
                raise ValueError('DuplicatePrivilegeEntry')
            result[key] = row
        for kind, name, _ in result:
            if any((kind, name, role) not in result for role in value['roles']):
                raise ValueError('MissingRolePrivilegeEntry')
        return result
    left, right = index(before), index(after)
    if len(left) != 552 or not set(left) <= set(right):
        raise ValueError('Original552ObjectsMissing_Abort')
    changes, additions = [], []
    for key, old in left.items():
        new = right[key]
        if set(old['privileges']) != set(new['privileges']):
            raise ValueError('OriginalPrivilegeCoverageChanged_Abort')
        for privilege, value in old['privileges'].items():
            current = new['privileges'][privilege]
            if current is value:
                continue
            if current:
                raise ValueError('ExistingAppRoleAccessBroadened_Abort')
            if (key != ('table', 'public.application_packets', 'authenticated')
                    or privilege not in ('INSERT', 'UPDATE', 'INSERT WITH GRANT OPTION', 'UPDATE WITH GRANT OPTION')):
                raise ValueError('UnreviewedPrivilegeRestriction_Abort')
            changes.append({'kind': key[0], 'name': key[1], 'role': key[2], 'privilege': privilege,
                            'before': value, 'after': current})
    for key in sorted(set(right) - set(left)):
        kind, name, role = key
        match = re.fullmatch(r'public\.([a-z_]+)\([^;]*\)', name)
        if kind != 'function' or not match or match[1] not in DELIVERY_FUNCTIONS:
            raise ValueError('UnreviewedNewPrivilegeObject_Abort')
        row = right[key]
        if set(row['privileges']) != {'EXECUTE', 'EXECUTE WITH GRANT OPTION'}:
            raise ValueError('NewFunctionPrivilegeCoverageRequired')
        maximum = role == 'service_role' or match[1] in PURE_FUNCTIONS or (
            role == 'authenticated' and match[1] == 'save_application_draft')
        if row['privileges']['EXECUTE WITH GRANT OPTION'] or (row['privileges']['EXECUTE'] and not maximum):
            raise ValueError('NewFunctionAccessOutsideReviewedMigration_Abort')
        additions.append(row)
    actual = {re.fullmatch(r'public\.([a-z_]+)\([^;]*\)', row['name'])[1] for row in additions}
    if actual != DELIVERY_FUNCTIONS or len(additions) != 30:
        raise ValueError('Exact10NewFunctionsThreeRolesRequired')
    return {'scope': 'UPGRADE_PRIVILEGE_DELTAS_NOT_BASELINE_EXCEPTION', 'originalEntries': 552,
        'originalAccessBroadened': False, 'restrictions': changes, 'newFunctionPrivileges': additions,
        'baseline552Edited': False}
