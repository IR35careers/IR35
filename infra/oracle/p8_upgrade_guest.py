"""Apply reviewed025 ONLY to a fresh disposable clone, then destroy that clone."""
import hashlib
import json
import re
import subprocess
import time
from pathlib import Path
from p4_recovery_guest import Recovery, RecoveryError
from p6_restart_diagnosis_guest import containment, BRIDGE_PROBE
from p6_hba_guest import actual_login
from web_edge_guest import private_env
from p6_mock_guest import prepared
from web_services_guest import require_prepared
import p6_role_policy
import upgrade_review
from p8_app_readiness import SQL as CAPABILITY_SQL, readiness

MIGRATION_SHA256 = '39fa06a4da6a8528ee0419d5fad65e36f759fd51581ec90182e6082bfce1a8e1'
SECURITY_SQL = """SELECT jsonb_build_object(
 'rls',(SELECT jsonb_agg(jsonb_build_object('schema',n.nspname,'name',c.relname,
    'enabled',c.relrowsecurity,'forced',c.relforcerowsecurity) ORDER BY n.nspname,c.relname)
   FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE c.relkind IN('r','p') AND n.nspname!~'^pg_' AND n.nspname<>'information_schema'),
 'policies',(SELECT jsonb_agg(jsonb_build_object('schema',n.nspname,'table',c.relname,'name',p.polname,
    'hash',md5(concat_ws('|',p.polpermissive::text,p.polroles::text,p.polcmd::text,
       pg_get_expr(p.polqual,p.polrelid),pg_get_expr(p.polwithcheck,p.polrelid))))
       ORDER BY n.nspname,c.relname,p.polname)
   FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid JOIN pg_namespace n ON n.oid=c.relnamespace),
 'authenticatedDirectPacketWriteColumns',(SELECT count(*) FROM pg_attribute a
   WHERE a.attrelid='public.application_packets'::regclass AND a.attnum>0 AND NOT a.attisdropped
    AND (has_column_privilege('authenticated',a.attrelid,a.attnum,'INSERT')
      OR has_column_privilege('authenticated',a.attrelid,a.attnum,'UPDATE')))
);"""


class Steps:
    def __init__(self, recovery):
        self.store = recovery.store()
        self.anchors = {}
        self.results = {}

    def step(self, number, name, action):
        for old, anchor in self.anchors.items():
            self.store.verify(old, anchor)
        stage = self.store.stage(str(number) + '-p8-upgrade01-' + name)
        self.store.put(stage, 'intent.json', json.dumps({'operation': name,
            'disposableOnly': True, 'migrationSHA256': MIGRATION_SHA256}).encode())
        result = {'status': 'FAIL'}
        try:
            result = action(stage)
        except Exception as error:
            safe = str(error) if type(error) is RecoveryError else type(error).__name__
            if type(error) is ValueError and str(error) in (
                'UpgradeTableInventoryChanged_Abort', 'UnrelatedDataOrAuthStorageMismatch_Abort',
                'ApplicationRowCountChanged_Abort', 'BackfillEventCountOutsideExplicitBound_Abort',
                'Original552ObjectsMissing_Abort', 'OriginalPrivilegeCoverageChanged_Abort',
                'ExistingAppRoleAccessBroadened_Abort', 'UnreviewedPrivilegeRestriction_Abort',
                'UnreviewedNewPrivilegeObject_Abort', 'NewFunctionAccessOutsideReviewedMigration_Abort',
                'Exact10NewFunctionsThreeRolesRequired', 'OwnedDisconnectedDisposableCloneRequired_NoDrop'):
                safe = str(error)
            result = {'status': 'FAIL', 'code': safe}
        self.store.put(stage, 'result.json', json.dumps(result, sort_keys=True).encode())
        anchor = self.store.seal(stage, previous=next(reversed(self.anchors.values()), None))
        self.anchors[stage.name] = anchor
        self.store.verify(stage.name, anchor)
        self.results[name] = {'status': result['status'], 'stage': stage.name,
                             'manifestSHA256': anchor, 'result': result}
        if result['status'] != 'PASS':
            raise RecoveryError('P8UpgradeStepFailed_' + name)
        return result


def scoped_recovery(data, runtime):
    original = Recovery(data['p4'], runtime)
    source = original.source()
    expiry = json.loads(original.query(original.sql['expiry'], 'postgres'))
    base = runtime['verifiers']['fidelity_compare']
    def compare(source_catalog, target_catalog, conditions, privileges, unused):
        return p6_role_policy.compare(source_catalog, target_catalog, conditions, privileges,
            source['roleExpiry'], expiry, base)
    return Recovery(data['p4'], runtime | {'verifiers': runtime['verifiers'] | {'fidelity_compare': compare}})


def clone_denials(recovery, target):
    checks = []
    for role, suffix in (('ir35_queue', 'owner'), ('ir35_queue_producer', 'producer')):
        credentials = private_env(Path('/opt/ir35') / ('.env.p6-queue-' + suffix))
        if (credentials.get('PGUSER') != role or credentials.get('PGDATABASE') != 'postgres'
                or not re.fullmatch('[a-f0-9]{64}', credentials.get('PGPASSWORD', ''))):
            raise RecoveryError('ExistingQueueCredentialIdentityRequired')
        try:
            for transport in ('local', 'ipv4-loopback', 'ipv6-loopback'):
                checks.append(actual_login(role, target, transport, credentials))
            reply = subprocess.run(['docker', 'exec', '-i', '--user', '1002:1002',
                'ir35-p6-mock-worker-v7-fixedip', 'node', '--input-type=module', '-e', BRIDGE_PROBE],
                input=json.dumps({'role': role, 'database': target, 'password': credentials['PGPASSWORD']}).encode(),
                capture_output=True, timeout=20)
            if reply.returncode or len(reply.stdout) > 4096:
                raise RecoveryError('BoundedQueueCloneLoginProofRequired')
            observed = json.loads(reply.stdout)
            checks.append({'role': role, 'transport': 'docker-tcp',
                'passed': observed['explicitHBAReject'] is True and observed['connected'] is False,
                'applicationFunctionCalled': False})
        finally:
            credentials.clear()
    if len(checks) != 8 or any(row.get('passed') is not True for row in checks):
        raise RecoveryError('QueueCloneBoundaryMismatch_Abort')
    return {'status': 'PASS', 'deniedLogins': 8, 'functionCalls': 0}


def collect_upgraded_rows(recovery):
    """Use the UNCHANGED original fingerprint code on ALL current columns."""
    source = recovery.source()
    inventory = json.loads(recovery.query(recovery.sql['inventory']))
    original = source['rows']['inventory']
    names = lambda entries: sorted((row['schema'], row['name']) for row in entries)
    if (names(inventory['tables']) != names(original['tables'])
            or inventory['sequences'] != original['sequences']):
        raise RecoveryError('UpgradeInventoryChanged_Abort')
    v = recovery.verifiers
    tables = []
    for table in inventory['tables']:
        statement = 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; ' + v['SETTINGS'] + v['copy_sql'](table) + ' ROLLBACK;'
        fingerprint = v['fingerprint'](recovery.base + ['psql', '-XqAt', '-v', 'ON_ERROR_STOP=1',
            '-U', 'supabase_admin', '-d', recovery.database, '-f', '-'],
            {'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'LC_ALL': 'C.UTF-8'}, statement)
        tables.append({'name': table['schema'] + '.' + table['name'], **fingerprint})
    sequences = []
    for seq in inventory['sequences']:
        value = json.loads(recovery.query("SELECT jsonb_build_object('lastValue',last_value::text,'isCalled',is_called) FROM "
            + v['identifier'](seq['schema']) + '.' + v['identifier'](seq['name']) + ';'))
        sequences.append({'name': seq['schema'] + '.' + seq['name'], **value})
    if sequences != source['rows']['sequences']:
        raise RecoveryError('SequenceMismatch_Abort')
    return tables


def catalog_delta(before, after):
    def index(catalog):
        result = {row['kind'] + ':' + row['name']: row for row in catalog['objects']}
        if len(result) != len(catalog['objects']):
            raise RecoveryError('DuplicateCatalogObject_Abort')
        return result
    left, right = index(before), index(after)
    if any(before[key] != after[key] for key in ('encoding', 'collation', 'schemas')):
        raise RecoveryError('PlatformMetadataChanged_Abort')
    result = []
    for name in sorted(set(left) | set(right)):
        a, b = left.get(name), right.get(name)
        if a and b and a['hash'] == b['hash']:
            continue
        if (a or b)['kind'] in ('role', 'role-membership', 'extension'):
            raise RecoveryError('ClusterRoleOrExtensionChanged_Abort')
        result.append({'object': name, 'beforeHash': a['hash'] if a else None, 'afterHash': b['hash'] if b else None})
    return result


def run(data, runtime, migration):
    if hashlib.sha256(migration.encode()).hexdigest() != MIGRATION_SHA256:
        raise RecoveryError('ExactReviewed025GitBytesRequired')
    prepared(data); require_prepared(data)
    recovery = scoped_recovery(data, runtime)
    pristine = recovery.database
    target = upgrade_review.clone_name(pristine)
    annotation = 'ir35-p8-upgrade01:' + recovery.run_id + ':' + MIGRATION_SHA256
    steps = Steps(recovery)
    result = {'status': 'FAIL', 'phaseComplete': False, 'appQAProven': False,
        'sourceWrites': 0, 'pristineWrites': 0, 'P5FixtureWrites': 0,
        'migrationSHA256': MIGRATION_SHA256, 'cloneDatabase': target,
        'scope': 'DISPOSABLE_UPGRADE_TEST_NOT_MIGRATION_FIDELITY_SIGNOFF'}
    state = {'creationIntent': False}
    before = {}

    def preflight(stage):
        full = containment(data, runtime, probe_container='ir35-p6-mock-worker-v7-fixedip')
        steps.store.put(stage, 'containment.json', json.dumps(full, sort_keys=True).encode())
        if full['status'] != 'PASS':
            raise RecoveryError('PreUpgradeContainmentMismatch_Abort')
        if recovery.query('SELECT 1 FROM pg_database WHERE datname=' + recovery.verifiers['literal'](target) + ';', 'postgres').strip():
            raise RecoveryError('UpgradeCloneAlreadyExists_NoReplay')
        return {'status': 'PASS', 'fullContainment': full}

    def clone(stage):
        state['creationIntent'] = True
        sql = 'CREATE DATABASE ' + target + ' WITH TEMPLATE ' + pristine + ' OWNER postgres; COMMENT ON DATABASE ' + target + ' IS ' + recovery.verifiers['literal'](annotation) + ';'
        recovery.command(recovery.base + ['psql', '-XqAt', '-v', 'ON_ERROR_STOP=1', '-U', 'supabase_admin', '-d', 'postgres', '-f', '-'], input=sql.encode())
        recovery.database = target
        proof = recovery.check_database()
        steps.store.put(stage, 'clone-before.json', json.dumps(proof, sort_keys=True).encode())
        if proof['status'] != 'PASS':
            raise RecoveryError('DisposableCloneFidelityMismatch_Abort')
        before.update(fidelity=proof, catalog=recovery.catalog(),
            privileges=json.loads(recovery.query(recovery.sql['privileges'])),
            security=json.loads(recovery.query(SECURITY_SQL)))
        return {'status': 'PASS', 'cloneBefore': proof, 'queueBoundary': clone_denials(recovery, target)}

    def apply(stage):
        if recovery.database != target or target != upgrade_review.clone_name(pristine):
            raise RecoveryError('DisposableMigrationTargetRequired')
        started = time.monotonic()
        with steps.store.sink(stage, 'migration.log') as log:
            reply = subprocess.run(recovery.base + ['psql', '-Xq', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=sqlstate',
                '-U', 'supabase_admin', '-d', target, '-f', '-'], input=migration.encode(), stdout=log, stderr=log, timeout=180)
        if reply.returncode:
            raise RecoveryError('Reviewed025Failed_PrivateLogPreserved_NoReplay')
        return {'status': 'PASS', 'migrationAppliedOnce': True, 'seconds': round(time.monotonic() - started, 3)}

    def review(stage):
        current_security = json.loads(recovery.query(SECURITY_SQL))
        if (current_security['rls'] != before['security']['rls']
                or current_security['policies'] != before['security']['policies']
                or current_security['authenticatedDirectPacketWriteColumns'] != 0):
            raise RecoveryError('UpgradeRLSPolicyOrDirectWriteMismatch_Abort')
        capabilities = readiness(json.loads(recovery.query(CAPABILITY_SQL)))
        if capabilities['schemaCapabilities'] != 'PRESENT_ONLY':
            raise RecoveryError('DeliveryCapabilitiesStillMissing_Abort')
        return {'status': 'PASS', 'capabilities': capabilities, 'unchangedRLSAndPolicies': True,
            'directAuthenticatedPacketWriteColumns': 0,
            'dataDelta': upgrade_review.data_delta(before['fidelity']['tables'], collect_upgraded_rows(recovery)),
            'privilegeDelta': upgrade_review.privilege_delta(before['privileges'], json.loads(recovery.query(recovery.sql['privileges']))),
            'rawSchemaDelta': catalog_delta(before['catalog'], recovery.catalog()),
            'queueBoundaryAfterUpgrade': clone_denials(recovery, target), 'appQAProven': False}

    def cleanup(stage):
        recovery.database = pristine
        present = recovery.query('SELECT count(*) FROM pg_database WHERE datname=' + recovery.verifiers['literal'](target) + ';', 'postgres').strip()
        if present == '0':
            return {'status': 'PASS', 'cloneAbsent': True, 'dropExecuted': False}
        comment = recovery.query("SELECT coalesce(shobj_description(oid,'pg_database'),'') FROM pg_database WHERE datname="
            + recovery.verifiers['literal'](target) + ';', 'postgres').strip()
        connections = recovery.query('SELECT count(*) FROM pg_stat_activity WHERE datname=' + recovery.verifiers['literal'](target) + ';', 'postgres').strip()
        upgrade_review.assert_owned_clone(pristine, target, comment, annotation, connections)
        recovery.command(recovery.base + ['psql', '-XqAt', '-v', 'ON_ERROR_STOP=1', '-U', 'supabase_admin', '-d', 'postgres', '-f', '-'], input=('DROP DATABASE ' + target + ';').encode())
        if recovery.query('SELECT count(*) FROM pg_database WHERE datname=' + recovery.verifiers['literal'](target) + ';', 'postgres').strip() != '0':
            raise RecoveryError('OwnedCloneCleanupReadbackFailed_Abort')
        return {'status': 'PASS', 'cloneAbsent': True, 'dropExecuted': True, 'exactAnnotationAndZeroConnectionsVerified': True}

    try:
        steps.step(14, 'preflight', preflight)
        steps.step(15, 'clone', clone)
        steps.step(16, 'apply', apply)
        steps.step(17, 'review', review)
        result['status'] = 'PASS'
    except Exception as error:
        result['code'] = str(error) if type(error) is RecoveryError else type(error).__name__
    finally:
        try:
            if state['creationIntent']:
                result['cleanup'] = steps.step(18, 'cleanup', cleanup)
        except Exception as error:
            result.update(status='FAIL', cleanupCode=type(error).__name__)
        recovery.database = pristine
        try:
            final = containment(data, runtime, probe_container='ir35-p6-mock-worker-v7-fixedip')
            result['fullContainment'] = final
            if final['status'] != 'PASS':
                result.update(status='FAIL', code='PostUpgradeContainmentMismatch_Abort')
        except Exception as error:
            result.update(status='FAIL', containmentCode=type(error).__name__)
    result['steps'] = steps.results
    return result
