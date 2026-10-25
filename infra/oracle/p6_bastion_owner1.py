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


def work_bundle(*, after_exact=False, token_reopen=False, after_close=False):
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
    if after_exact is True:
        data['ownerSessionAfterExact'] = True
    if token_reopen is True:
        data['ownerTokenReopen'] = True
        data['ownerContainmentAfterClose'] = after_close
    script = p6_worker_build.bundle()
    for name in ('p6_roles_guest', 'p6_mock_guest', 'p6_port_probe_guest', 'p6_bastion_owner1_guest'):
        code = (schema.REPO / 'infra/oracle' / (name + '.py')).read_text()
        script += 'module=types.ModuleType(' + repr(name) + ');sys.modules[' + repr(name) + ']=module\nexec(' + repr(code) + ',module.__dict__)\n'
    script += 'result=sys.modules["p6_bastion_owner1_guest"].run(' + repr(data) + ',runtime)\nprint(json.dumps(result))\n'
    return script


def require_unused_after_exact(previous, proof):
    if (previous.get('status') != 'FAIL' or previous.get('sessionCreates') != 0 or previous.get('sessionClosed') is not True
            or previous.get('code') != 'Approximate Object Storage metadata is not exact byte evidence.'
            or previous.get('workerRestarts') != 0 or previous.get('bastionUpdates') != 0 or previous.get('networkChanges') != 0):
        raise KeySafetyError('OnlyProvenUnusedSessionMayReopenAfterExactAudit')
    if (proof.get('status') != 'PASS' or proof.get('exactBytesProven') is not True or proof.get('bucketListingStable') is not True
            or type(proof.get('exactBytes')) is not int or not 0 <= proof['exactBytes'] <= 8_000_000_000
            or proof.get('standardOnly') is not True or proof.get('stableCompletePasses') != 2):
        raise KeySafetyError('CompleteExactStoragePassRequired_NoEligibilityWaiver')


def require_token_window(profile, *, now=None):
    remaining = profile.get('expiresAt', 0) - (time.time() if now is None else now)
    if remaining < 2700:
        raise KeySafetyError('TokenBelow45Minutes_StopBeforeRecovery')
    return {'status': 'PASS', 'tokenSecondsRemaining': int(remaining), 'minimumSecondsRequired': 2700}


def require_auth_only_reopening(previous):
    if (previous.get('status') != 'FAIL' or previous.get('sessionCreates') != 0
            or previous.get('sessionClosed') is not True or previous.get('workerRestarts') != 0
            or previous.get('bastionUpdates') != 0 or previous.get('iamChanges') != 0
            or previous.get('networkChanges') != 0 or previous.get('productionChanges') is not False
            or previous.get('code') != 'G2: security-token refresh failed; browser sign-in required. Raw output suppressed.'):
        raise KeySafetyError('ExactZeroCreateAuthFailureRequired_NoOtherReopening')


def execute(*, after_exact=False, token_reopen=False):
    import cloud_schema as schema
    proof = json.loads(PUBLIC.read_text())
    store = Store(ROOT)
    store.verify(proof['stage'], proof['manifestSHA256'])
    if proof.get('status') != 'PASS':
        raise KeySafetyError('PassingOwnerPreflightRequired_NoRetry')
    exact = None
    if after_exact:
        import exact_storage_audit
        previous = json.loads((PUBLIC.parent / 'bastion-owner1-session.json').read_text())
        store.verify(previous['stage'], previous['manifestSHA256'])
        exact = exact_storage_audit.latest_pass()
        require_unused_after_exact(previous, exact)
    if token_reopen:
        if not after_exact:
            raise KeySafetyError('ExactAuditRequiredForTokenReopening')
        auth_failure = json.loads((PUBLIC.parent / 'bastion-owner1-session-after-exact.json').read_text())
        store.verify(auth_failure['stage'], auth_failure['manifestSHA256'])
        require_auth_only_reopening(auth_failure)
    script = work_bundle(after_exact=after_exact, **({'token_reopen': True} if token_reopen else {}))  # Refuses dirty source.
    closed_script = work_bundle(after_exact=True, token_reopen=True, after_close=True) if token_reopen else None
    stage = store.stage('05-owner-token-reopen' if token_reopen else ('04-session-after-exact' if after_exact else '02-session'))
    result = {'status': 'FAIL', 'sessionCreates': 0, 'bastionUpdates': 0, 'iamChanges': 0, 'networkChanges': 0,
              'workerRestarts': 0, 'productionChanges': False, 'realAcceptance': False, 'steps': []}
    if exact:
        result['exactAuditManifestSHA256'] = exact['manifestSHA256']
        result['previousFailureManifestSHA256'] = previous['manifestSHA256']
    session = None
    spec = None
    counter = 0
    create_requested = False
    auth_failed = False

    def step(name, action, project=lambda _: {'status': 'PASS'}):
        nonlocal counter, auth_failed
        counter += 1
        filename = f'{counter:02d}-{name}'
        store.put(stage, filename + '-intent.json', json.dumps({'operation': name, 'atUTC': datetime.now(timezone.utc).isoformat()}).encode())
        try:
            if token_reopen:
                # Synchronous boundary: do not begin another operation while
                # refresh is needed. ensure_session makes one refresh, never
                # uses an API key, and raises immediately if refresh fails.
                ensure_session()
            value = action()
            store.put(stage, filename + '-result.json', json.dumps(project(value), sort_keys=True).encode())
            result['steps'].append({'step': name, 'status': 'PASS'})
            return value
        except Exception as error:
            code = str(error) if isinstance(error, KeySafetyError) else type(error).__name__
            if code.startswith('G2:'):
                auth_failed = True
            store.put(stage, filename + '-result.json', json.dumps({'status': 'FAIL', 'code': code}).encode())
            result['steps'].append({'step': name, 'status': 'FAIL', 'code': code})
            raise

    def get_session():
        row = infra.invoke(['bastion', 'session', 'get', '--session-id', session])
        bastion.verify_session(spec, row)
        return row

    try:
        if token_reopen:
            result['tokenWindow'] = step('fresh-token-45-minutes', lambda: require_token_window(ensure_session()), lambda value: value)
            def agent_ready():
                if not ensure_agent()['keyLoaded']:
                    raise KeySafetyError('ExistingSSHAgentKeyNotLoaded_NoAutomaticPrompt')
                return {'status': 'PASS', 'existingKeyLoaded': True, 'passphraseRequested': False}
            result['sshAgent'] = step('existing-agent', agent_ready, lambda value: value)
        journal = step('existing-intent', lambda: json.loads(private_file(infra.JOURNAL)))
        if token_reopen:
            child_id = json.loads(private_file(control.JOURNAL))['created']['compartment']['id']
            def compartment_ready():
                value = infra.invoke(['iam', 'compartment', 'get', '--compartment-id', child_id])
                if value.get('name') != 'ir35' or value.get('lifecycle-state') != 'ACTIVE':
                    raise KeySafetyError('ReadOnlyCompartmentNotActive')
                return {'status': 'PASS', 'name': 'ir35', 'state': 'ACTIVE', 'mutations': 0}
            result['compartmentAuthentication'] = step('read-only-compartment-auth', compartment_ready, lambda value: value)
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
        if HOSTS.exists():
            if private_file(HOSTS) != line:
                raise KeySafetyError('ExistingGatewayPinChanged_NoReplacement')
        else:
            write_new(HOSTS, line.encode())
        sessions = step('existing-sessions', lambda: infra.invoke(['bastion', 'session', 'list', '--bastion-id', parent['id'], '--all']))
        if any(row.get('display-name') == SESSION_NAME for row in sessions):
            raise KeySafetyError('OwnerSessionIntentAlreadyExists_NoCreateOrRetry')
        exact_options = {'exact_storage': exact_storage_audit.eligibility_counter} if after_exact else {}
        result['eligibility'] = step('fresh-free-eligibility', lambda: infra.fresh_eligibility(ReadOnlyOci(ensure_session()), journal,
                                     journal['created']['instance']['spec']['availabilityDomain'], **exact_options), lambda value: value)
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
        with (PUBLIC.parent / ('bastion-owner1-reconcile-token-reopen.json' if token_reopen else ('bastion-owner1-reconcile-after-exact.json' if after_exact else 'bastion-owner1-reconcile.json'))).open('x', encoding='utf-8') as output:
            json.dump(work, output, indent=2)
        result['work'] = work
        if work['status'] != 'PASS' or work.get('containment', {}).get('status') != 'PASS':
            raise KeySafetyError('OwnerRecoveryWorkFailed_NoRetry')
        result['status'] = 'PASS'
    except Exception as error:
        result['code'] = str(error) if isinstance(error, KeySafetyError) else type(error).__name__
    finally:
        try:
            if auth_failed:
                # No second refresh in cleanup. The only possible session is
                # short-lived (1800s); report it honestly if auth prevents close.
                result['sessionClosed'] = not create_requested
                if create_requested:
                    result['cleanupCode'] = 'AuthRefreshFailed_NoRetry_SessionTTL1800'
            elif create_requested and session is None and spec:
                found = step('unknown-create-readback-only', lambda: infra.invoke(['bastion', 'session', 'list', '--bastion-id', spec['bastionId'], '--all']))
                matches = [row for row in found if row.get('display-name') == SESSION_NAME]
                if len(matches) == 1:
                    row = infra.invoke(['bastion', 'session', 'get', '--session-id', matches[0]['id']])
                    session = bastion.verify_session(spec, row)
                    result['sessionCreates'] = 1
                else:
                    result['sessionCreateOutcome'] = 'UNKNOWN; no duplicate create; TTL1800'
            if session and not auth_failed:
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
            elif not auth_failed:
                result['sessionClosed'] = not create_requested
        except Exception as error:
            result.update(status='FAIL', cleanupCode=('AuthRefreshFailed_NoRetry_SessionTTL1800' if auth_failed
                          else (str(error) if isinstance(error, KeySafetyError) else type(error).__name__)), sessionClosed=False)
    if token_reopen and result.get('status') == 'PASS' and result.get('sessionClosed') is True:
        try:
            # The session is already independently DELETED. Reverify the
            # original owner /32, then use only original pinned direct SSH for
            # the expressly requested post-close READ-ONLY containment.
            def same_source():
                if transport.current_cidr() != journal['ownerCIDR']:
                    raise KeySafetyError('PostCloseOwnerSourceChanged_NoSecondSessionOrRuleChange')
                return {'status': 'PASS', 'originalOwnerSlash32': True}
            step('post-close-owner-source', same_source, lambda value: value)
            prior_transport = os.environ.get('IR35_SSH_TRANSPORT')
            os.environ['IR35_SSH_TRANSPORT'] = 'direct'
            try:
                post = step('post-close-full-containment', lambda: schema.run_guest(closed_script, timeout=600), lambda value: value)
            finally:
                if prior_transport is None:
                    os.environ.pop('IR35_SSH_TRANSPORT', None)
                else:
                    os.environ['IR35_SSH_TRANSPORT'] = prior_transport
            result['postCloseContainment'] = post
            if post.get('status') != 'PASS' or post.get('containment', {}).get('status') != 'PASS':
                raise KeySafetyError('PostCloseFullContainmentFailed_NoRetry')
        except Exception as error:
            result.update(status='FAIL', code=str(error) if isinstance(error, KeySafetyError) else type(error).__name__)
    store.put(stage, 'result.json', json.dumps(result, sort_keys=True).encode())
    result.update(stage=stage.name, manifestSHA256=store.seal(stage))
    with (PUBLIC.parent / ('bastion-owner1-session-token-reopen.json' if token_reopen else ('bastion-owner1-session-after-exact.json' if after_exact else 'bastion-owner1-session.json'))).open('x', encoding='utf-8') as output:
        json.dump(result, output, indent=2)
    return result


def containment_after_stop():
    """Requested safety verification only, NOT another recovery attempt.

    Current direct owner /32 was independently verified. There are no OCI
    calls, sessions, worker operations, secret/config changes or probe replay.
    """
    import cloud_schema as schema
    failed = json.loads((PUBLIC.parent / 'bastion-owner1-session.json').read_text())
    store = Store(ROOT)
    store.verify(failed['stage'], failed['manifestSHA256'])
    if (failed.get('status') != 'FAIL' or failed.get('sessionCreates') != 0 or failed.get('workerRestarts') != 0
            or failed.get('sessionClosed') is not True or failed.get('cloudUpdates', 0) != 0):
        raise KeySafetyError('ExactStoppedNoSessionStateRequired_NoWorkaroundOrRetry')
    if os.environ.get('IR35_SSH_TRANSPORT', 'direct') != 'direct':
        raise KeySafetyError('OnlyExistingPinnedDirectSSHForReadOnlyContainment')
    script = work_bundle()
    stage = store.stage('03-readonly-containment')
    result = {'status': 'FAIL', 'purpose': 'owner-requested containment after stopped attempt, not a recovery retry',
              'ociCalls': 0, 'sessionCreates': 0, 'workerRestarts': 0, 'probeCreates': 0, 'secretChanges': 0, 'productionChanges': False}
    store.put(stage, 'intent.json', json.dumps(result | {'operation': 'one pinned direct SSH read-only reconciliation and full containment'}).encode())
    try:
        work = schema.run_guest(script, timeout=600)
        store.put(stage, 'observation.json', json.dumps(work, sort_keys=True).encode())
        result['work'] = work
        if work.get('status') != 'PASS' or work.get('containment', {}).get('status') != 'PASS':
            raise KeySafetyError('PostStopContainmentOrProbeMismatch_NoRetry')
        result['status'] = 'PASS'
    except Exception as error:
        result['code'] = str(error) if isinstance(error, KeySafetyError) else type(error).__name__
    store.put(stage, 'result.json', json.dumps(result, sort_keys=True).encode())
    result.update(stage=stage.name, manifestSHA256=store.seal(stage))
    with (PUBLIC.parent / 'bastion-owner1-post-stop-containment.json').open('x', encoding='utf-8') as output:
        json.dump(result, output, indent=2)
    return result


if __name__ == '__main__':
    try:
        if sys.argv[1:] not in (['--preflight'], ['--execute'], ['--execute-after-exact-audit'], ['--execute-owner-token-reopen'], ['--containment-after-stop']):
            raise KeySafetyError('ExplicitReadOnlyOwnerPreflightRequired')
        if sys.argv[1:] == ['--execute-owner-token-reopen']:
            result = execute(after_exact=True, token_reopen=True)
        else:
            result = run_preflight() if sys.argv[1:] == ['--preflight'] else (execute(after_exact=sys.argv[1:] == ['--execute-after-exact-audit']) if sys.argv[1:] in (['--execute'], ['--execute-after-exact-audit']) else containment_after_stop())
        print(json.dumps(result))
        raise SystemExit(0 if result['status'] == 'PASS' else 1)
    except Exception as error:
        print(json.dumps({'status': 'STOP', 'code': str(error) if isinstance(error, KeySafetyError) else type(error).__name__}))
        raise SystemExit(1)
