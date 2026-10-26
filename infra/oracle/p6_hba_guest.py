"""One staging-only reload with exact-file rollback and real login proofs."""
import io
import json
import subprocess
import tarfile
import time

from immutable_artifacts import digest
from p4_recovery_guest import Recovery, RecoveryError
from p6_mock_guest import ROOT, prepared, check_containment
from p6_roles_guest import no_customer_access
from p6_queue_function_scope import audit as function_scope
from p6_queue_hba import ROLES, QUEUE_DATABASE, candidate, verify_parsed
from web_edge_guest import private_env

CONTAINER = 'ir35-staging-db-1'
INFO_SQL = """SELECT jsonb_build_object('hbaFile',current_setting('hba_file'),
 'postmasterStart',pg_postmaster_start_time()::text,'configLoaded',pg_conf_load_time()::text,
 'port',current_setting('port'),'socketDirectories',current_setting('unix_socket_directories'),
 'listenAddresses',current_setting('listen_addresses'),
 'databases',(SELECT jsonb_agg(jsonb_build_object('name',datname,'allowConnections',datallowconn,
 'template',datistemplate) ORDER BY datname) FROM pg_database),
 'queueSessions',(SELECT COALESCE(jsonb_agg(jsonb_build_object('role',usename,'database',datname)), '[]')
 FROM pg_stat_activity WHERE usename IN ('ir35_queue','ir35_queue_producer')));"""
RULE_SQL = """SELECT COALESCE(jsonb_agg(jsonb_build_object('rule_number',rule_number,'line_number',line_number,
 'file_name',file_name,'type',type,'database',database,'user_name',user_name,'address',address,
 'netmask',netmask,'auth_method',auth_method,'options',options,'error',error) ORDER BY rule_number),'[]')
 FROM pg_hba_file_rules;"""


def inspect_only(data, runtime):
    store = prepared(data)
    stage = store.stage('10-hba-owner-inspect')
    recovery = Recovery(data['p4'], runtime)
    result = {'status': 'FAIL', 'mutations': 0, 'functionCalls': 0}
    try:
        information = json.loads(recovery.query(INFO_SQL, 'postgres'))
        body, custody = read_hba(information['hbaFile'])
        rows = json.loads(recovery.query(RULE_SQL, 'postgres'))
        store.put(stage, 'database-info.json', json.dumps(information, sort_keys=True).encode())
        result.update(status='PASS', information=information, originalHbaSHA256=digest(body), custody=custody,
                      originalRuleMethods=sorted(set(row['auth_method'] for row in rows if row.get('auth_method'))),
                      originalParseErrors=sum(bool(row.get('error')) for row in rows))
    except Exception as error:
        result['code'] = str(error) if isinstance(error, RecoveryError) else type(error).__name__
    store.put(stage, 'result.json', json.dumps(result, sort_keys=True).encode())
    return result | {'stage': stage.name, 'manifestSHA256': store.seal(stage)}


def reconcile_inspection(data, runtime):
    # Transport outcome was unknown. Never run inspect again or replace its
    # files just because a local observation/token expired.
    store = prepared(data)
    stage = store.root / '10-hba-owner-inspect'
    if not stage.exists():
        return {'status': 'ABSENT', 'stage': stage.name, 'mutations': 0, 'hbaWrites': 0}
    manifest = stage / 'manifest.json'
    if not manifest.is_file() or manifest.is_symlink():
        raise RecoveryError('PartialHBAInspectionJournal_PreserveAndStop')
    anchor = digest(manifest.read_bytes())
    store.verify(stage.name, anchor)
    result = json.loads((stage / 'result.json').read_bytes())
    return result | {'stage': stage.name, 'manifestSHA256': anchor, 'reconciledThroughPinnedSSH': True}


def read_hba(path):
    # Docker archive API: no shell cat/write tricks, no raw file in logs/chat.
    if not isinstance(path, str) or not path.startswith('/') or any(item in path for item in ('..', '\n', '\x00', ':')):
        raise RecoveryError('UnexpectedHBAPath_NoWrite')
    reply = subprocess.run(['docker', 'cp', CONTAINER + ':' + path, '-'], capture_output=True, timeout=20)
    if reply.returncode:
        raise RecoveryError('PrivateHBAArchiveReadFailed')
    with tarfile.open(fileobj=io.BytesIO(reply.stdout), mode='r:*') as archive:
        members = archive.getmembers()
        if len(members) != 1 or not members[0].isfile() or members[0].size > 262144:
            raise RecoveryError('HBAArchiveMustBeOneRegularFile')
        member = members[0]
        if member.name != path.rsplit('/', 1)[1] or member.mode & 0o022:
            raise RecoveryError('HBACustodyUnexpected_NoWrite')
        return archive.extractfile(member).read(), {'uid': member.uid, 'gid': member.gid, 'mode': member.mode}


def replace_hba(path, body, custody):
    # Preserve exact owner/mode. Writes only the already-read regular file, via
    # docker cp's archive API; original bytes remain in a sealed private stage.
    stream = io.BytesIO()
    with tarfile.open(fileobj=stream, mode='w') as archive:
        item = tarfile.TarInfo(path.rsplit('/', 1)[1])
        item.size = len(body)
        item.uid, item.gid, item.mode = custody['uid'], custody['gid'], custody['mode']
        archive.addfile(item, io.BytesIO(body))
    reply = subprocess.run(['docker', 'cp', '-a', '-', CONTAINER + ':' + path.rsplit('/', 1)[0]],
                           input=stream.getvalue(), capture_output=True, timeout=20)
    if reply.returncode:
        raise RecoveryError('PrivateHBAArchiveWriteFailed_RollbackRequired')
    observed, observed_custody = read_hba(path)
    if observed != body or observed_custody != custody:
        raise RecoveryError('HBAFileReadbackMismatch_RollbackRequired')


def reload_and_wait(recovery):
    before = recovery.query('SELECT pg_conf_load_time()::text;', 'postgres').strip()
    if recovery.query('SELECT pg_reload_conf();', 'postgres').strip() != 't':
        raise RecoveryError('HBAReloadNotAcknowledged')
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        if recovery.query('SELECT pg_conf_load_time()::text;', 'postgres').strip() != before:
            return
        time.sleep(0.1)
    raise RecoveryError('HBAReloadNotObserved')


def actual_login(role, database, transport, credentials):
    if role not in ROLES or transport not in ('docker-tcp', 'local', 'ipv4-loopback', 'ipv6-loopback'):
        raise RecoveryError('FixedQueueProbeRequired')
    from p6_queue_hba import database_name
    database_name(database)
    if credentials.get('PGUSER') != role or credentials.get('PGDATABASE') != QUEUE_DATABASE:
        raise RecoveryError('ExistingQueueCredentialIdentityMismatch')
    password = credentials.get('PGPASSWORD', '')
    if len(password) != 64 or any(char not in '0123456789abcdef' for char in password):
        raise RecoveryError('ExistingQueueCredentialShapeMismatch')
    query = 'SELECT current_user || chr(124) || current_database();'
    common = ['psql', '-w', '-XqAt', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=sqlstate',
              '-U', role, '-d', database, '-p', '5432', '-c', query]
    # Secret only in RAM->stdin->short-lived child environment on this VM;
    # never an argument, file, Docker env metadata, stdout or evidence value.
    shell = 'IFS= read -r PGPASSWORD; export PGPASSWORD PGSSLMODE=disable PGCONNECT_TIMEOUT=5; exec "$@"'
    if transport == 'docker-tcp':
        raise RecoveryError('DockerProbeNeedsPinnedImage')
    host = {'local': '/var/run/postgresql', 'ipv4-loopback': '127.0.0.1', 'ipv6-loopback': '::1'}[transport]
    command = ['docker', 'exec', '-i', '--user', '1002:1002', CONTAINER, '/bin/sh', '-c', shell, 'ir35-hba-probe', *common, '-h', host]
    reply = subprocess.run(command, input=(password + '\n').encode(), capture_output=True, timeout=15)
    return reduce_login(reply, role, database, transport)


def docker_login(image, role, database, credentials):
    from p6_queue_hba import database_name
    database_name(database)
    if role not in ROLES or credentials.get('PGUSER') != role or credentials.get('PGDATABASE') != QUEUE_DATABASE:
        raise RecoveryError('ExistingQueueCredentialIdentityMismatch')
    password = credentials.get('PGPASSWORD', '')
    if len(password) != 64 or any(char not in '0123456789abcdef' for char in password):
        raise RecoveryError('ExistingQueueCredentialShapeMismatch')
    shell = 'IFS= read -r PGPASSWORD; export PGPASSWORD PGSSLMODE=disable PGCONNECT_TIMEOUT=5; exec "$@"'
    command = ['docker', 'run', '--rm', '-i', '--network', 'ir35-staging_backend', '--read-only', '--user', '1002:1002',
               '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true', '--log-driver', 'none',
               '--memory', '128m', '--pids-limit', '32', '--entrypoint', '/bin/sh', image,
               '-c', shell, 'ir35-hba-probe', 'psql', '-w', '-XqAt', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=sqlstate',
               '-h', 'db', '-p', '5432', '-U', role, '-d', database, '-c', 'SELECT current_user || chr(124) || current_database();']
    reply = subprocess.run(command, input=(password + '\n').encode(), capture_output=True, timeout=20)
    return reduce_login(reply, role, database, 'docker-tcp')


def reduce_login(reply, role, database, transport):
    denied = reply.returncode != 0 and b'pg_hba.conf rejects connection' in reply.stderr
    connected = reply.returncode == 0 and reply.stdout.strip() == (role + '|' + database).encode()
    return {'role': role, 'database': database, 'transport': transport, 'exitCode': reply.returncode,
            'explicitHBAReject': denied, 'connectedAsExpected': connected,
            'passed': connected if database == QUEUE_DATABASE else denied,
            'applicationFunctionCalled': False}


def run(data, runtime):
    store = prepared(data)
    failure = data['scopeFailure']
    store.verify(failure['stage'], failure['manifestSHA256'])
    if (failure.get('code') != 'QueueRoleDefinerAccessOutsideQueueSchema_SecurityStop'
            or failure.get('newWorkerStarts') != 0 or failure.get('containment', {}).get('status') != 'PASS'):
        raise RecoveryError('ExactSecurityStopAndContainmentRequired')
    stage = store.stage('10-owner-queue-hba-boundary')
    recovery = Recovery(data['p4'], runtime)
    result = {'status': 'FAIL', 'roleWrites': 0, 'grantWrites': 0, 'customerWrites': 0, 'passwordChanges': 0,
              'postgresRestarts': 0, 'workerStarts': 0, 'ociNetworkChanges': 0, 'productionChanges': False,
              'realAcceptance': False, 'functionCalls': 0, 'baseline552Changed': False}
    changed = False
    original = custody = path = None
    try:
        result['preContainment'] = check_containment(data, runtime, store, stage, 'pre')
        result['rawFunctionScopeBefore'] = function_scope(recovery)
        if result['rawFunctionScopeBefore'] != failure['queueFunctionScope']:
            raise RecoveryError('RawFunctionFindingChanged_NoHBAWrite')
        information = json.loads(recovery.query(INFO_SQL, 'postgres'))
        store.put(stage, 'database-inventory.json', json.dumps(information, sort_keys=True).encode())
        if information['port'] != '5432' or information['socketDirectories'] != '/var/run/postgresql':
            raise RecoveryError('UnexpectedStagingSocketOrPort_NoHBAWrite')
        if any(row['database'] != QUEUE_DATABASE for row in information['queueSessions']):
            raise RecoveryError('ExistingAppQueueSessions_NoTerminationApproved')
        container = json.loads(runtime['run'](['docker', 'inspect', CONTAINER]))[0]
        if container['HostConfig']['LogConfig']['Type'] != 'none' or container['HostConfig'].get('PortBindings'):
            raise RecoveryError('PrivateUnloggedDatabaseRequired')
        path = information['hbaFile']
        original, custody = read_hba(path)
        store.put(stage, 'pg_hba.original.conf', original)
        result['backup'] = {'path': str(stage / 'pg_hba.original.conf'), 'sha256': digest(original),
                            'mode': '400', 'owner': 'ir35', 'originalPath': path, 'originalCustody': custody}
        names = [row['name'] for row in information['databases']]
        body = candidate(original, names)
        original_rows = json.loads(recovery.query(RULE_SQL, 'postgres'))
        if any(row.get('error') for row in original_rows):
            raise RecoveryError('OriginalHBAParseErrors_NoWrite')
        store.put(stage, 'pg_hba.candidate.conf', body)
        store.put(stage, 'intent.json', json.dumps({'ownerApproved': True, 'database': QUEUE_DATABASE,
            'roles': list(ROLES), 'originalSHA256': digest(original), 'candidateSHA256': digest(body),
            'reloadOnly': True, 'restoreOnAnyFailure': True, 'functionInvocation': False}, sort_keys=True).encode())
        changed = True  # Roll back even an ambiguous docker cp acknowledgement.
        replace_hba(path, body, custody)
        rows = json.loads(recovery.query(RULE_SQL, 'postgres'))
        result['ruleOrdering'] = verify_parsed(rows, names)
        store.put(stage, 'parsed-rules.json', json.dumps(rows, sort_keys=True).encode())
        reload_and_wait(recovery)
        result['reloaded'] = True
        checks = []
        for role, suffix in zip(ROLES, ('owner', 'producer')):
            credentials = private_env(ROOT / ('.env.p6-queue-' + suffix))
            for row in information['databases']:
                if not row['allowConnections']:
                    continue  # Recorded/rejected explicitly; server itself disallows login.
                for transport in ('docker-tcp', 'local', 'ipv4-loopback', 'ipv6-loopback'):
                    observed = (docker_login(container['Image'], role, row['name'], credentials)
                                if transport == 'docker-tcp' else actual_login(role, row['name'], transport, credentials))
                    checks.append(observed)
                    # Record EACH result before asserting. Credentials/SQL/raw errors never leave RAM.
                    store.put(stage, 'login-' + str(len(checks)).zfill(3) + '.json', json.dumps(observed, sort_keys=True).encode())
                    if not observed['passed']:
                        raise RecoveryError('QueueActualLoginBoundaryMismatch_RestoreAndStop')
            credentials.clear()
        after = json.loads(recovery.query(INFO_SQL, 'postgres'))
        if after['databases'] != information['databases'] or after['postmasterStart'] != information['postmasterStart']:
            raise RecoveryError('DatabaseInventoryOrPostmasterChanged_RestoreAndStop')
        result['rawFunctionScopeAfter'] = function_scope(recovery)
        if result['rawFunctionScopeAfter'] != result['rawFunctionScopeBefore']:
            raise RecoveryError('RawFunctionFindingChanged_RestoreAndStop')
        result['queueRoleCustomerAccess'] = no_customer_access(recovery)
        result['containment'] = check_containment(data, runtime, store, stage, 'post')
        current, current_custody = read_hba(path)
        if current != body or current_custody != custody:
            raise RecoveryError('FinalHBAReadbackMismatch_RestoreAndStop')
        result.update(status='PASS', candidateSHA256=digest(body), loginChecks=checks,
            inaccessibleApplicationFunctions=True, rawFunctionFindingRetained=True,
            queueDatabase=QUEUE_DATABASE, postmasterStartUnchanged=True,
            databasesWithConnections=[row['name'] for row in information['databases'] if row['allowConnections']],
            disabledDatabaseRules=[row['name'] for row in information['databases'] if not row['allowConnections']],
            queueOnlyConnectionBoundary='PASS', applicationDataMustNeverBeRestoredIntoQueueDatabase=True)
    except Exception as error:
        result['code'] = str(error) if isinstance(error, (RecoveryError, ValueError)) else type(error).__name__
        if changed:
            try:
                replace_hba(path, original, custody)
                reload_and_wait(recovery)
                result['rollback'] = {'status': 'PASS', 'restoredSHA256': digest(original), 'reloaded': True}
            except Exception as rollback_error:
                result['rollback'] = {'status': 'FAIL', 'code': str(rollback_error) if isinstance(rollback_error, RecoveryError) else type(rollback_error).__name__}
        try:
            result['failureContainment'] = check_containment(data, runtime, store, stage, 'failure')
        except Exception as containment_error:
            result['failureContainment'] = {'status': 'FAIL', 'code': type(containment_error).__name__}
    store.put(stage, 'result.json', json.dumps(result, sort_keys=True).encode())
    return result | {'stage': stage.name, 'manifestSHA256': store.seal(stage)}
