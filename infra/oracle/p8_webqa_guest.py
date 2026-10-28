"""Owned writable-QA preparation primitives. No CLI or import-time execution.

The eventual bounded QA controller must own the whole create/test/cleanup
cycle. It must run original full containment BEFORE creation and AFTER cleanup;
the unchanged historical 112-login verifier cannot be run while this extra
database exists. Actual eight-role/transport denials cover the extra clone.
"""
import copy
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess

from immutable_artifacts import digest
from p4_recovery_guest import RecoveryError
from p8_upgrade_guest import (MIGRATION_SHA256, SECURITY_SQL, scoped_recovery,
                              clone_denials, collect_upgraded_rows, catalog_delta)
import p8_webqa_config as config
import p7_auth_profile as auth_profile
import upgrade_review
from p8_app_readiness import SQL as CAPABILITY_SQL, readiness

ROOT = Path('/opt/ir35')


class Fixture:
    def __init__(self, data, runtime, store):
        # Constructed only by the future journalled controller after original
        # full containment and custody checks. No service or clone starts here.
        self.data, self.runtime, self.store = data, runtime, store
        self.compose_version = config.require_compose(runtime['run'](['docker', 'compose', 'version', '--short']).strip())
        self.recovery = scoped_recovery(data, runtime)
        self.pristine = self.recovery.database
        self.target = config.database_name(self.pristine)
        self.source = self.recovery.source()
        self.images = config.image_pair(data['webQaImages'])
        self.annotation = 'ir35-p8-webqa01:' + config.BUILD_SHA + ':' + MIGRATION_SHA256
        self.database_intent = False
        self.files = []
        self.storage_records = []
        self.before = {}
        self.upgrade_verified = False

    def create_clone(self, stage):
        recovery = self.recovery
        if recovery.database != self.pristine:
            raise RecoveryError('QaCloneMustStartFromVerifiedPristine')
        if recovery.query('SELECT count(*) FROM pg_database WHERE datname=' + recovery.verifiers['literal'](self.target) + ';', 'postgres').strip() != '0':
            raise RecoveryError('QaCloneExists_NoReplay')
        if recovery.check_database()['status'] != 'PASS':
            raise RecoveryError('QaPristineFidelityMismatch_Abort')
        self.store.put(stage, 'clone-intent.json', json.dumps({'target': self.target, 'source': self.pristine,
            'annotation': self.annotation, 'customerSourceWrites': 0}).encode())
        self.database_intent = True  # Ambiguous create must be reconciled, never replayed.
        recovery.command(recovery.base + ['psql', '-XqAt', '-v', 'ON_ERROR_STOP=1', '-U', 'supabase_admin', '-d', 'postgres', '-f', '-'],
            input=('CREATE DATABASE ' + self.target + ' WITH TEMPLATE ' + self.pristine + ' OWNER postgres;\n'
                   'COMMENT ON DATABASE ' + self.target + ' IS ' + recovery.verifiers['literal'](self.annotation) + ';').encode())
        recovery.database = self.target
        proof = recovery.check_database()
        self.store.put(stage, 'clone-baseline.json', json.dumps(proof, sort_keys=True).encode())
        if proof['status'] != 'PASS':
            raise RecoveryError('QaCloneBaselineMismatch_Abort')
        self.before = {'fidelity': proof, 'catalog': recovery.catalog(),
            'privileges': json.loads(recovery.query(recovery.sql['privileges'])),
            'security': json.loads(recovery.query(SECURITY_SQL))}
        return {'status': 'PASS', 'database': self.target, 'baselineExact': True,
                'cloneRoleDenials': clone_denials(recovery, self.target)}

    def apply_reviewed_upgrade(self, stage, migration):
        if hashlib.sha256(migration.encode()).hexdigest() != MIGRATION_SHA256:
            raise RecoveryError('ExactReviewed025GitBytesRequired')
        recovery = self.recovery
        if not self.before or recovery.database != self.target:
            raise RecoveryError('VerifiedOwnedQaCloneRequired')
        self.store.put(stage, 'upgrade-intent.json', json.dumps({'database': self.target,
            'migrationSHA256': MIGRATION_SHA256, 'upgradeDeltaNotMigrationParity': True}).encode())
        with self.store.sink(stage, 'migration.log') as log:
            reply = subprocess.run(recovery.base + ['psql', '-Xq', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=sqlstate',
                '-U', 'supabase_admin', '-d', self.target, '-f', '-'], input=migration.encode(), stdout=log, stderr=log, timeout=180)
        if reply.returncode:
            raise RecoveryError('QaReviewed025Failed_NoReplay_PrivateLogPreserved')
        security = json.loads(recovery.query(SECURITY_SQL))
        if (security['rls'] != self.before['security']['rls']
                or security['policies'] != self.before['security']['policies']
                or security['authenticatedDirectPacketWriteColumns'] != 0):
            raise RecoveryError('QaUpgradeRlsOrDirectWriteMismatch_Abort')
        capabilities = readiness(json.loads(recovery.query(CAPABILITY_SQL)))
        if capabilities['schemaCapabilities'] != 'PRESENT_ONLY':
            raise RecoveryError('QaDeliveryCapabilitiesMissing_Abort')
        report = {'status': 'PASS', 'migrationSHA256': MIGRATION_SHA256,
            'capabilities': capabilities,
            'dataDelta': upgrade_review.data_delta(self.before['fidelity']['tables'], collect_upgraded_rows(recovery)),
            'privilegeDelta': upgrade_review.privilege_delta(self.before['privileges'], json.loads(recovery.query(recovery.sql['privileges']))),
            'rawSchemaDelta': catalog_delta(self.before['catalog'], recovery.catalog()),
            'queueCloneBoundary': clone_denials(recovery, self.target), 'migrationFidelityClaimed': False}
        self.store.put(stage, 'upgrade-review.json', json.dumps(report, sort_keys=True).encode())
        self.upgrade_verified = True
        return report

    def copy_storage(self, stage):
        destination = ROOT / 'data/p8-webqa01/storage'
        if destination.exists() or destination.is_symlink() or destination.absolute() != destination.resolve():
            raise RecoveryError('NewOwnedQaStoragePathRequired_NoOverwrite')
        parent = destination.parent
        if parent.exists() or parent.is_symlink():
            raise RecoveryError('QaDataRootAlreadyExists_NoReplay')
        parent.mkdir(mode=0o700); os.chown(parent, 1002, 1002)
        destination.mkdir(mode=0o700); os.chown(destination, 1002, 1002)
        cache = parent / 'next-cache'; cache.mkdir(mode=0o700); os.chown(cache, 1002, 1002)
        self.recovery.check_storage_files(self.source)
        for obj in self.source['storage']['privateObjects']:
            relative = self.runtime['verifiers']['backend_path'](obj['bucket'], obj['name'], obj['version'])
            origin = ROOT / 'data/p4-runs' / self.recovery.run_id / relative
            target = destination / relative
            if target.absolute() != target.resolve() or not target.is_relative_to(destination):
                raise RecoveryError('QaStorageDestinationEscapeRefused')
            target.parent.mkdir(parents=True, exist_ok=True)
            fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
            try:
                os.fchown(fd, 1002, 1002)
                with origin.open('rb') as incoming, os.fdopen(fd, 'wb', closefd=False) as outgoing:
                    shutil.copyfileobj(incoming, outgoing); outgoing.flush(); os.fsync(outgoing.fileno())
                # Apply metadata through the SAME owned descriptor while it is
                # writable, then seal400. Non-root verification must not depend
                # on root's ability to modify attributes of a readonly file.
                for key in os.listxattr(origin):
                    os.setxattr(fd, key, os.getxattr(origin, key))
                os.fchmod(fd, 0o400)
                os.fsync(fd)
            finally:
                os.close(fd)
            if (target.stat().st_size != int(obj['bytes']) or digest(target.read_bytes()) != obj['sha256']
                    or {key: os.getxattr(target, key) for key in os.listxattr(target)}
                    != {key: os.getxattr(origin, key) for key in os.listxattr(origin)}):
                raise RecoveryError('QaStorageBytesOrMetadataMismatch_Abort')
            self.storage_records.append({'pathSHA256': digest(str(relative).encode()), 'sha256': obj['sha256'],
                'bytes': int(obj['bytes'])})
        expected = {str(self.runtime['verifiers']['backend_path'](obj['bucket'], obj['name'], obj['version']))
                    for obj in self.source['storage']['privateObjects']}
        if {str(path.relative_to(destination)) for path in destination.rglob('*') if path.is_file()} != expected:
            raise RecoveryError('QaStorageInventoryMismatch_Abort')
        for path in destination.rglob('*'):
            if path.is_dir():
                os.chown(path, 1002, 1002); os.chmod(path, 0o700)
        self.store.put(stage, 'storage-copy.json', json.dumps(self.storage_records, sort_keys=True).encode())
        return {'status': 'PASS', 'objects': len(self.storage_records), 'bytes': sum(row['bytes'] for row in self.storage_records),
                'sha256AndHeadersExact': True, 'rawPathsPrinted': False}

    def private_file(self, name, body):
        if type(body) is not bytes or len(body) > 4 * 1024 * 1024:
            raise RecoveryError('BoundedPrivateQaBytesRequired')
        path = Path(config.environment_path(name))
        if path.parent != ROOT:
            raise RecoveryError('QaEnvironmentDestinationRefused')
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        try:
            os.fchown(fd, 1002, 1002)
            with os.fdopen(fd, 'wb', closefd=False) as output:
                output.write(body); output.flush(); os.fsync(output.fileno())
        finally:
            os.close(fd)
        self.files.append({'name': path.name, 'sha256': digest(body), 'mode': '600', 'owner': 'ir35'})
        return path

    def write_configuration(self, stage):
        from web_edge_guest import private_env
        if (not self.database_intent or not self.before or not self.upgrade_verified
                or self.recovery.database != self.target or len(self.storage_records) != 73
                or len(self.source['storage']['privateObjects']) != 73):
            raise RecoveryError('OwnedVerifiedUpgradedAndCopiedQaFixtureRequired')
        path = ROOT / '.env.auth-source-handoff.json'
        metadata = path.lstat()
        if (path.is_symlink() or not stat.S_ISREG(metadata.st_mode) or metadata.st_uid != 1002
                or stat.S_IMODE(metadata.st_mode) != 0o600 or metadata.st_nlink != 1):
            raise RecoveryError('ExistingAuthHandoffCustodyRequired')
        body = path.read_bytes()
        expected = self.data.get('sourceAuthHandoffSHA256', '')
        if not re.fullmatch('[a-f0-9]{64}', expected) or digest(body) != expected:
            raise RecoveryError('ExactP7SourceHandoffHashRequired')
        handoff = json.loads(body); auth_profile.validate(handoff)
        values = self.runtime['read_env'](); base = self.runtime['component_env'](values)
        auth, templates, subjects, projection = auth_profile.configure(base['auth'], handoff, config.TEMPLATE_HOST)
        environments = config.environments(base, auth, values, private_env(ROOT / '.env.p5-web'),
            private_env(ROOT / '.env.p6-queue-owner'), private_env(ROOT / '.env.p6-queue-producer'),
            self.pristine, self.images, self.source['storageMigrations'])
        for name, environment in environments.items():
            self.private_file(name, self.runtime['env_text'](environment).encode())
        self.private_file('subjects', auth_profile.subject_env(subjects).encode())
        self.private_file('templates-json', json.dumps(templates, ensure_ascii=False).encode())
        gateway = config.gateway(self.runtime['kong_config'](values['ANON_KEY'], values['SERVICE_ROLE_KEY']))
        self.private_file('kong-config', json.dumps(gateway).encode())
        plan = config.compose(self.images, self.data['p4']['pins'])
        public_plan = ROOT / 'p8-webqa01-compose.json'
        descriptor = os.open(public_plan, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o644)
        try:
            with os.fdopen(descriptor, 'wb', closefd=False) as output:
                output.write((json.dumps(plan, sort_keys=True, indent=2) + '\n').encode()); output.flush(); os.fsync(output.fileno())
        finally:
            os.close(descriptor)
        # Capture in RAM only: Compose resolves the PUBLIC subjects, never send
        # config output to logs/evidence. Reject any interpolation/quote loss.
        parsed = json.loads(self.runtime['run'](['docker', 'compose', '-f', str(public_plan), 'config', '--format', 'json']))
        subject_proof = config.subjects_preserved(parsed, subjects)
        result = {'status': 'PASS', 'environmentFiles': self.files, 'composeSHA256': digest(public_plan.read_bytes()),
            'authProjection': projection, 'credentialValuesChanged': 0, 'servicesStarted': 0, 'workerSetupRun': False,
            'publicPorts': 0, 'realtimeConfigured': False, 'fullQaClaimed': False,
            'composeVersion': self.compose_version, 'subjectsPreserved': subject_proof}
        self.store.put(stage, 'configuration.json', json.dumps(result, sort_keys=True).encode())
        return result

    def destroy_disconnected_database(self, stage):
        # Stop/remove ONLY this stack's attested containers in the controller
        # BEFORE calling this method. Never terminate sessions to force a drop.
        recovery = self.recovery
        recovery.database = self.pristine
        quoted = recovery.verifiers['literal'](self.target)
        present = recovery.query('SELECT count(*) FROM pg_database WHERE datname=' + quoted + ';', 'postgres').strip()
        if present == '0':
            return {'status': 'PASS', 'databaseAbsent': True, 'dropExecuted': False}
        comment = recovery.query("SELECT coalesce(shobj_description(oid,'pg_database'),'') FROM pg_database WHERE datname=" + quoted + ';', 'postgres').strip()
        connected = recovery.query('SELECT count(*) FROM pg_stat_activity WHERE datname=' + quoted + ';', 'postgres').strip()
        config.assert_owned_database(self.pristine, self.target, comment, self.annotation, connected)
        self.store.put(stage, 'drop-intent.json', json.dumps({'database': self.target, 'annotation': self.annotation,
            'connections': 0, 'ownedDisposableOnly': True}).encode())
        recovery.command(recovery.base + ['psql', '-XqAt', '-v', 'ON_ERROR_STOP=1', '-U', 'supabase_admin', '-d', 'postgres', '-f', '-'],
            input=('DROP DATABASE ' + self.target + ';').encode())
        if recovery.query('SELECT count(*) FROM pg_database WHERE datname=' + quoted + ';', 'postgres').strip() != '0':
            raise RecoveryError('QaDropReadbackMismatch_Abort')
        return {'status': 'PASS', 'databaseAbsent': True, 'dropExecuted': True}
