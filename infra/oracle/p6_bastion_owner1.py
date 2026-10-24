"""25 October ONE owner-approved recovery: preflight is read-only and journalled.

Unlike the previous held controller, this authority explicitly prohibits ANY
Bastion update, including its client allowlist. Never call the old prepare().
"""
from datetime import datetime, timezone
from contextlib import contextmanager
import hashlib
import json
import os
from pathlib import Path
import sys
import subprocess
import time

from bootstrap_audit import KEY_DIRECTORY
from immutable_artifacts import Store
from key_ceremony import KeySafetyError, write_new
import p1_compute
import p1_infrastructure as infra
import p6_bastion as transport
import host_identity_bastion as bastion
import p1_control_plane as control
from resource_audit import ReadOnlyOci
from security_session import ensure_session, private_file, command, clean_environment
from ssh_agent_session import ensure_agent
from visibility import OciError, wait_for_visible

ROOT = KEY_DIRECTORY / 'p6-bastion-owner1-20261025'
PUBLIC = Path(__file__).resolve().parents[2] / 'docs/evidence/p6/bastion-owner1-preflight.json'
SESSION_NAME = 'ir35-p6-owner1-20261025'
TRANSPORT = ROOT / 'transport.json'
HOSTS = ROOT / 'gateway-known-hosts'


def allowed_source(journal, row, current):
    transport.validate_bastion(journal, row, [journal['ownerCIDR']])
    if row['client-cidr-block-allow-list'] != [current]:
        raise KeySafetyError('CurrentOwnerIPNotInExistingBastionAllowlist_NoBastionChangeAuthorized')
    return {'status': 'PASS', 'sourceEntries': 1, 'exactCurrentOwnerSlash32': True,
            'bastionUpdates': 0, 'securityListUpdates': 0, 'iamChanges': 0}


def run_preflight():
    os.umask(0o077)
    # Exclusive fixed owner slot, not a reset of any previous controller/log.
    ROOT.mkdir(mode=0o700)
    store = Store(ROOT)
    stage = store.stage('01-preflight')
    result = {'status': 'FAIL', 'ownerApprovalDate': '2026-10-25', 'scope': 'existing Bastion and VM only',
              'sessionCreates': 0, 'cloudUpdates': 0, 'cloudDeletes': 0, 'workerRestarts': 0,
              'productionChanges': False, 'realAcceptance': False, 'steps': []}
    counter = 0

    def step(name, action, project=lambda _: {'status': 'PASS'}):
        nonlocal counter
        counter += 1
        filename = f'{counter:02d}-{name}'
        store.put(stage, filename + '-intent.json', json.dumps({'operation': name, 'readOnly': True,
                  'atUTC': datetime.now(timezone.utc).isoformat()}).encode())
        try:
            value = action()
            observation = project(value)
            store.put(stage, filename + '-result.json', json.dumps(observation, sort_keys=True).encode())
            result['steps'].append({'step': name, 'status': 'PASS'})
            return value
        except Exception as error:
            code = str(error) if isinstance(error, KeySafetyError) else type(error).__name__
            store.put(stage, filename + '-result.json', json.dumps({'status': 'FAIL', 'code': code}).encode())
            result['steps'].append({'step': name, 'status': 'FAIL', 'code': code})
            raise

    try:
        journal = step('existing-intent', lambda: json.loads(private_file(infra.JOURNAL)))
        if journal['computeReadback']['publicIP'] != '132.145.28.134':
            raise KeySafetyError('OwnerApprovedVMAddressMismatch')
        current = step('current-source', transport.current_cidr,
                       lambda _: {'status': 'PASS', 'independentIPv4Observers': 2, 'rawAddressLogged': False})
        step('security-token', ensure_session)
        def agent_ready():
            value = ensure_agent()
            if not value['keyLoaded']:
                raise KeySafetyError('ExistingSSHAgentKeyNotLoaded_NoAutomaticPrompt')
            return True
        step('existing-agent', agent_ready)
        parent = step('existing-bastion', lambda: infra.invoke(infra.cli_arguments('bastion', 'get',
                      resource_id=infra.identifier(journal, 'bastion'))),
                      lambda value: {'state': value.get('lifecycle-state'), 'sourceEntries': len(value.get('client-cidr-block-allow-list', []))})
        step('unchanged-allowlist', lambda: allowed_source(journal, parent, current), lambda value: value)
        result['network'] = step('unchanged-network', lambda: p1_compute.verify_network(journal), lambda value: value)
        result.update({'status': 'PASS', 'next': 'exact VM/VNIC, free eligibility, single session, strict guest pin; no mutations performed'})
    except Exception as error:
        result['code'] = str(error) if isinstance(error, KeySafetyError) else type(error).__name__
        result['next'] = 'STOP; no retry, no session, no worker restart. Preserve unresolved 23:40 probe.'
    store.put(stage, 'result.json', json.dumps(result, sort_keys=True).encode())
    result['manifestSHA256'] = store.seal(stage)
    result['stage'] = stage.name
    # Public projection only; raw IDs, addresses, profiles and keys are absent.
    with PUBLIC.open('x', encoding='utf-8') as output:
        json.dump(result, output, indent=2)
    return result


@contextmanager
def tunnel(agent, guest):
    with transport.tunnel(agent, guest, state_path=TRANSPORT, hosts_path=HOSTS) as port:
        yield port


def work_bundle():
    import cloud_schema as schema
    import p6_worker_build
    import p6_context
    data = p6_context.context()  # Committed clean branch, actual P4/P5 proof.
    for key, filename in [('p6Inventory', 'p6-inventory.json'), ('rolePreflight', 'p6-role-preflight.json'),
                          ('roleInstall', 'p6-role-install.json')]:
        data[key] = json.loads((schema.REPO / 'docs/evidence' / filename).read_text())
    directory = schema.REPO / 'docs/evidence/p6'
    data['workerBuild'] = json.loads(sorted(directory.glob('worker-build-*.json'))[-1].read_text())
    data['mockPrepare'] = json.loads((directory / 'mock-prepare.json').read_text())
    data['failedStart'] = json.loads((directory / 'mock-start.json').read_text())
    script = p6_worker_build.bundle()
    for name in ('p6_roles_guest', 'p6_mock_guest', 'p6_port_probe_guest', 'p6_bastion_owner1_guest'):
        code = (schema.REPO / 'infra/oracle' / (name + '.py')).read_text()
        script += 'module=types.ModuleType(' + repr(name) + ');sys.modules[' + repr(name) + ']=module\nexec(' + repr(code) + ',module.__dict__)\n'
    script += 'result=sys.modules["p6_bastion_owner1_guest"].run(' + repr(data) + ',runtime)\nprint(json.dumps(result))\n'
    return script


def execute():
    import cloud_schema as schema
    proof = json.loads(PUBLIC.read_text())
    store = Store(ROOT)
    store.verify(proof['stage'], proof['manifestSHA256'])
    if proof.get('status') != 'PASS':
        raise KeySafetyError('PassingOwnerPreflightRequired_NoRetry')
    script = work_bundle()  # Before any cloud mutation, refuses dirty source.
    stage = store.stage('02-session')  # Exclusive owner slot, never reused.
    result = {'status': 'FAIL', 'sessionCreates': 0, 'bastionUpdates': 0, 'iamChanges': 0, 'networkChanges': 0,
              'workerRestarts': 0, 'productionChanges': False, 'realAcceptance': False, 'steps': []}
    session = None
    spec = None
    counter = 0
    create_requested = False

    def step(name, action, project=lambda _: {'status': 'PASS'}):
        nonlocal counter
        counter += 1
        filename = f'{counter:02d}-{name}'
        store.put(stage, filename + '-intent.json', json.dumps({'operation': name, 'atUTC': datetime.now(timezone.utc).isoformat()}).encode())
        try:
            value = action()
            store.put(stage, filename + '-result.json', json.dumps(project(value), sort_keys=True).encode())
            result['steps'].append({'step': name, 'status': 'PASS'})
            return value
        except Exception as error:
            code = str(error) if isinstance(error, KeySafetyError) else type(error).__name__
            store.put(stage, filename + '-result.json', json.dumps({'status': 'FAIL', 'code': code}).encode())
            result['steps'].append({'step': name, 'status': 'FAIL', 'code': code})
            raise

    def get_session():
        row = infra.invoke(['bastion', 'session', 'get', '--session-id', session])
        bastion.verify_session(spec, row)
        return row

    try:
        journal = step('existing-intent', lambda: json.loads(private_file(infra.JOURNAL)))
        current = step('current-source', transport.current_cidr)
        parent = step('existing-bastion', lambda: infra.invoke(infra.cli_arguments('bastion', 'get',
                      resource_id=infra.identifier(journal, 'bastion'))))
        step('unchanged-source', lambda: allowed_source(journal, parent, current), lambda value: value)
        result['network'] = step('unchanged-network', lambda: p1_compute.verify_network(journal), lambda value: value)
        child = json.loads(private_file(control.JOURNAL))['created']['compartment']['id']
        instance = step('existing-vm', lambda: infra.invoke(['compute', 'instance', 'get', '--instance-id', infra.identifier(journal, 'instance')]))
        if (instance.get('lifecycle-state') != 'RUNNING' or instance.get('shape') != 'VM.Standard.A1.Flex'
                or instance.get('shape-config', {}).get('ocpus') != 2 or instance.get('shape-config', {}).get('memory-in-gbs') != 12):
            raise KeySafetyError('ExistingA1InstanceEnvelopeMismatch')
        attached = step('existing-vnic-attachment', lambda: infra.invoke(['compute', 'vnic-attachment', 'list', '--compartment-id', child,
                         '--instance-id', instance['id'], '--all']))
        attached = [row for row in attached if row.get('lifecycle-state') == 'ATTACHED' and row.get('instance-id') == instance['id']]
        if len(attached) != 1:
            raise KeySafetyError('SingleExistingVNICRequired')
        vnic = step('existing-vnic', lambda: infra.invoke(['network', 'vnic', 'get', '--vnic-id', attached[0]['vnic-id']]))
        if vnic.get('public-ip') != '132.145.28.134' or vnic.get('subnet-id') != infra.identifier(journal, 'subnet'):
            raise KeySafetyError('ApprovedVMAddressOrSubnetMismatch')
        spec = bastion.payload(parent['id'], instance['id'], vnic['private-ip'], private_file(KEY_DIRECTORY / 'ssh_ed25519.pub').strip())
        spec['displayName'] = SESSION_NAME
        line = step('gateway-continuity', lambda: transport.continuity_key({}))
        write_new(HOSTS, line.encode())
        sessions = step('existing-sessions', lambda: infra.invoke(['bastion', 'session', 'list', '--bastion-id', parent['id'], '--all']))
        if any(row.get('display-name') == SESSION_NAME for row in sessions):
            raise KeySafetyError('OwnerSessionIntentAlreadyExists_NoCreateOrRetry')
        result['eligibility'] = step('fresh-free-eligibility', lambda: infra.fresh_eligibility(ReadOnlyOci(ensure_session()), journal,
                                     journal['created']['instance']['spec']['availabilityDomain']), lambda value: value)
        store.put(stage, 'session-spec-hash.json', json.dumps({'sha256': hashlib.sha256(json.dumps(spec, sort_keys=True).encode()).hexdigest(),
                  'targetPort': 22, 'existingVMOnly': True, 'ttlSeconds': 1800, 'createsAllowed': 1}).encode())
        print('CREATE CHECK: ONE free Bastion session, TTL1800, existing A1 2OCPU/12GB/150GB only, approved VM private22; no Bastion/IAM/network/secret/production changes.', flush=True)
        create_requested = True
        row = step('single-session-create', lambda: infra.invoke(bastion.create_args(spec)))
        session = bastion.verify_session(spec, row)
        result['sessionCreates'] = 1
        def active():
            value = get_session()
            if value['lifecycle-state'] == 'CREATING':
                return None
            if value['lifecycle-state'] != 'ACTIVE':
                raise KeySafetyError('SingleBastionSessionNotActive_NoRetry')
            return value
        row = step('session-readback', lambda: wait_for_visible(active, label='p6-owner1-active'))
        if bastion.GATEWAY not in json.dumps(row.get('ssh-metadata', {})):
            raise KeySafetyError('SignedGatewayMetadataMismatch')
        if transport.continuity_key(row) != line:
            raise KeySafetyError('GatewayContinuityMismatch')
        expires = datetime.fromisoformat(row['time-created'].replace('Z', '+00:00')).timestamp() + 1800
        write_new(TRANSPORT, json.dumps({'ready': True, 'expiresAt': expires, 'spec': spec, 'sessionId': session,
                  'gatewayPinSHA256': hashlib.sha256(line.encode()).hexdigest()}).encode())
        previous = os.environ.get('IR35_SSH_TRANSPORT')
        os.environ['IR35_SSH_TRANSPORT'] = 'bastion-owner1'
        try:
            work = step('probe-reconcile-full-containment', lambda: schema.run_guest(script, timeout=600), lambda value: value)
        finally:
            if previous is None:
                os.environ.pop('IR35_SSH_TRANSPORT', None)
            else:
                os.environ['IR35_SSH_TRANSPORT'] = previous
        with (PUBLIC.parent / 'bastion-owner1-reconcile.json').open('x', encoding='utf-8') as output:
            json.dump(work, output, indent=2)
        result['work'] = work
        if work['status'] != 'PASS' or work.get('containment', {}).get('status') != 'PASS':
            raise KeySafetyError('OwnerRecoveryWorkFailed_NoRetry')
        result['status'] = 'PASS'
    except Exception as error:
        result['code'] = str(error) if isinstance(error, KeySafetyError) else type(error).__name__
    finally:
        try:
            if create_requested and session is None and spec:
                found = step('unknown-create-readback-only', lambda: infra.invoke(['bastion', 'session', 'list', '--bastion-id', spec['bastionId'], '--all']))
                matches = [row for row in found if row.get('display-name') == SESSION_NAME]
                if len(matches) == 1:
                    row = infra.invoke(['bastion', 'session', 'get', '--session-id', matches[0]['id']])
                    session = bastion.verify_session(spec, row)
                    result['sessionCreates'] = 1
                else:
                    result['sessionCreateOutcome'] = 'UNKNOWN; no duplicate create; TTL1800'
            if session:
                def close_once():
                    row = get_session()
                    if row['lifecycle-state'] != 'DELETED':
                        deleted = subprocess.run(command(['bastion', 'session', 'delete', '--session-id', session, '--force']),
                                   capture_output=True, text=True, timeout=65, env=clean_environment(), check=False)
                        if deleted.returncode:
                            raise OciError.from_stderr('owner1-session-close', deleted.stdout + deleted.stderr)
                    def absent():
                        try:
                            return True if get_session()['lifecycle-state'] == 'DELETED' else None
                        except OciError as error:
                            if error.status == 404:
                                return True
                            raise
                    return wait_for_visible(absent, label='p6-owner1-closed')
                step('single-session-close', close_once)
                result['sessionClosed'] = True
            else:
                result['sessionClosed'] = not create_requested
        except Exception as error:
            result.update(status='FAIL', cleanupCode=str(error) if isinstance(error, KeySafetyError) else type(error).__name__, sessionClosed=False)
    store.put(stage, 'result.json', json.dumps(result, sort_keys=True).encode())
    result.update(stage=stage.name, manifestSHA256=store.seal(stage))
    with (PUBLIC.parent / 'bastion-owner1-session.json').open('x', encoding='utf-8') as output:
        json.dump(result, output, indent=2)
    return result


if __name__ == '__main__':
    try:
        if sys.argv[1:] not in (['--preflight'], ['--execute']):
            raise KeySafetyError('ExplicitReadOnlyOwnerPreflightRequired')
        result = run_preflight() if sys.argv[1:] == ['--preflight'] else execute()
        print(json.dumps(result))
        raise SystemExit(0 if result['status'] == 'PASS' else 1)
    except Exception as error:
        print(json.dumps({'status': 'STOP', 'code': str(error) if isinstance(error, KeySafetyError) else type(error).__name__}))
        raise SystemExit(1)
