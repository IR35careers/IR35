"""Explicit P6 Bastion recovery; no security-list, firewall or IAM mutation.

The gateway's historical pin is continuity-only, not an authenticated Oracle
key. The INNER SSH connection always authenticates the original OCI-verified
guest key, with no agent forwarding, passwords, or host-key enrollment.
"""
from contextlib import contextmanager
from datetime import datetime
import hashlib
import ipaddress
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import time
import urllib.request

from bootstrap_audit import KEY_DIRECTORY, CLI
from key_ceremony import KeySafetyError, write_new
import host_identity_bastion as bastion
import host_identity_repair as repair
import p1_infrastructure as infra
import p1_control_plane as control
import p1_compute
from resource_audit import ReadOnlyOci
from security_session import atomic_metadata, ensure_session, private_file
from ssh_agent_session import ensure_agent
from visibility import wait_for_visible

STATE = KEY_DIRECTORY / 'p6-bastion-recovery-1.json'
HOSTS = KEY_DIRECTORY / 'p6-bastion-gateway-known-hosts'
NAME = 'ir35-p6-staging-recovery-1'
ALIAS = 'ir35-london-bastion-continuity'
HOLD = Path(__file__).resolve().parents[2] / 'docs/evidence/p6/bastion-recovery-stop.json'


def current_cidr():
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    observed = []
    for url in ('https://api4.ipify.org', 'https://checkip.amazonaws.com'):
        with opener.open(url, timeout=15) as response:
            address = ipaddress.IPv4Address(response.read(80).decode().strip())
        if not address.is_global:
            raise KeySafetyError('Public owner IPv4 required; no source widening.')
        observed.append(str(address) + '/32')
    if observed[0] != observed[1]:
        raise KeySafetyError('Independent owner IPv4 observations disagree.')
    return observed[0]


def validate_bastion(journal, row, permitted):
    normalized = json.loads(json.dumps(row))
    # The ONE approved operational change is the client /32 allowlist. All
    # original parent/subnet/type/tags/TTL/endpoint constraints remain exact.
    normalized['client-cidr-block-allow-list'] = [journal['ownerCIDR']]
    infra.verify('bastion', journal['created']['bastion'], normalized)
    if (row.get('lifecycle-state') != 'ACTIVE'
            or row.get('client-cidr-block-allow-list') not in ([value] for value in permitted)
            or row.get('private-endpoint-ip-address', '') + '/32' != journal['bastionCIDR']):
        raise KeySafetyError('Bastion identity/source differs; no broad access.')


def continuity_key(row):
    old = json.loads(private_file(repair.STATE))
    entry = old['bastionVerification']
    if not entry.get('deleted') or not entry.get('gatewayTrustMethod'):
        raise KeySafetyError('Historical Bastion identity/cleanup proof required.')
    path = KEY_DIRECTORY / ('bastion-host-' + hashlib.sha256(entry['id'].encode()).hexdigest()[:24])
    lines = private_file(path).splitlines()
    if len(lines) != 1 or not lines[0].startswith('ir35-bastion-' + entry['id'] + ' '):
        raise KeySafetyError('Historical gateway continuity pin missing or changed.')
    key = bastion.gateway_key(lines[0].split(' ', 1)[1])
    supplied = row.get('bastion-public-host-key-info')
    if supplied and bastion.gateway_key(supplied) != key:
        raise KeySafetyError('Signed gateway key differs from historical pin; no replacement.')
    return ALIAS + ' ' + key + '\n'


def update_args(identifier, cidr):
    if infra.source_cidr(cidr) != cidr:
        raise KeySafetyError('Exact current owner /32 required.')
    return ['bastion', 'bastion', 'update', '--bastion-id', identifier,
            '--client-cidr-list', json.dumps([cidr]), '--force']


def prove_parser_rejection():
    # Reproduce the old failure with PUBLIC FIXTURES only. Click rejects the
    # unknown option before authentication or HTTP; never replay a cloud write.
    result = subprocess.run([str(CLI), 'bastion', 'bastion', 'update', '--bastion-id', 'fixture',
                             '--client-cidr-block-allow-list', '["8.8.8.8/32"]', '--force'],
                            capture_output=True, text=True, timeout=30, check=False)
    diagnostic = result.stdout + result.stderr
    if (result.returncode != 2 or "Error: No such option '--client-cidr-block-allow-list'." not in diagnostic
            or "Did you mean '--client-cidr-list'?" not in diagnostic):
        raise KeySafetyError('Old failure not proven to be pre-HTTP parser rejection.')
    return {'status': 'PASS', 'oldOptionRejectedBeforeHTTP': True, 'exitCode': 2,
            'correctOption': '--client-cidr-list'}


def prepare(*, repair_cli=False):
    if HOLD.exists():
        raise KeySafetyError('Three recorded helper failures: live recovery held for owner review; no reset or replay.')
    os.umask(0o077)
    ensure_session()
    if not ensure_agent()['keyLoaded']:
        raise KeySafetyError('Existing SSH key not loaded; no repeated prompt.')
    journal = json.loads(private_file(infra.JOURNAL))
    p1_compute.verify_network(journal)  # Original /32-only SL/NSG unchanged.
    cidr = current_cidr()
    get = infra.cli_arguments('bastion', 'get', resource_id=infra.identifier(journal, 'bastion'))
    parent = infra.invoke(get)
    if STATE.exists():
        state = json.loads(private_file(STATE))
        if state.get('ownerCIDR') != cidr or state.get('bastionId') != parent['id']:
            raise KeySafetyError('Recovery identity changed; reconcile, never replay.')
    else:
        validate_bastion(journal, parent, [journal['ownerCIDR']])
        state = {'ownerCIDR': cidr, 'bastionId': parent['id'], 'createdAt': time.time()}
        write_new(STATE, json.dumps(state).encode())
    validate_bastion(journal, parent, [journal['ownerCIDR'], cidr])
    if parent['client-cidr-block-allow-list'] != [cidr]:
        if state.get('allowlistUpdateRequested'):
            if (not repair_cli or state.get('cliRepairRequested')
                    or parent['client-cidr-block-allow-list'] != [journal['ownerCIDR']]):
                raise KeySafetyError('Bastion update outcome unresolved; no blind replay.')
            state['cliParserDiagnosis'] = prove_parser_rejection()
            state['cliRepairRequested'] = True
        state['allowlistUpdateRequested'] = True
        atomic_metadata(STATE, state)
        infra.invoke(update_args(parent['id'], cidr))
    def visible():
        row = infra.invoke(get)
        if row.get('lifecycle-state') == 'UPDATING':
            return None
        validate_bastion(journal, row, [journal['ownerCIDR'], cidr])
        return row if row['client-cidr-block-allow-list'] == [cidr] else None
    parent = wait_for_visible(visible, label='p6-bastion-exact-client32')
    state['allowlistVerified'] = True
    atomic_metadata(STATE, state)
    child = json.loads(private_file(control.JOURNAL))['created']['compartment']['id']
    instance = infra.identifier(journal, 'instance')
    attached = infra.invoke(['compute', 'vnic-attachment', 'list', '--compartment-id', child, '--instance-id', instance, '--all'])
    attached = [row for row in attached if row.get('lifecycle-state') == 'ATTACHED' and row.get('instance-id') == instance]
    if len(attached) != 1:
        raise KeySafetyError('Exactly one existing VM VNIC required.')
    vnic = infra.invoke(['network', 'vnic', 'get', '--vnic-id', attached[0]['vnic-id']])
    if vnic.get('public-ip') != journal['computeReadback']['publicIP'] or vnic.get('subnet-id') != infra.identifier(journal, 'subnet'):
        raise KeySafetyError('Existing VM VNIC mismatch.')
    spec = bastion.payload(parent['id'], instance, vnic['private-ip'], private_file(KEY_DIRECTORY / 'ssh_ed25519.pub').strip())
    spec['displayName'] = NAME
    listed = infra.invoke(['bastion', 'session', 'list', '--bastion-id', parent['id'], '--all'])
    matches = [row for row in listed if row.get('display-name') == NAME]
    if len(matches) > 1:
        raise KeySafetyError('Duplicate recovery sessions; no create.')
    if matches:
        row = infra.invoke(['bastion', 'session', 'get', '--session-id', matches[0]['id']])
        identifier = bastion.verify_session(spec, row)
        if state.get('sessionId') not in (None, identifier):
            raise KeySafetyError('Recovery session identity differs.')
        state['sessionId'] = identifier
    elif not state.get('createRequested'):
        client = ReadOnlyOci(ensure_session())
        state['eligibility'] = infra.fresh_eligibility(client, journal, journal['created']['instance']['spec']['availabilityDomain'])
        state['createRequested'] = True
        atomic_metadata(STATE, state)
        print('CREATE CHECK: free Bastion only, existing A1 2OCPU/12GB/150GB, exact VM private22, TTL1800, one owner /32; no IAM/SL/NSG/firewall/production changes.', flush=True)
        row = infra.invoke(bastion.create_args(spec))
        state['sessionId'] = bastion.verify_session(spec, row)
    if not state.get('sessionId'):
        raise KeySafetyError('Unknown create outcome; reconcile without creating again.')
    state['spec'] = spec
    atomic_metadata(STATE, state)
    def active():
        row = infra.invoke(['bastion', 'session', 'get', '--session-id', state['sessionId']])
        bastion.verify_session(spec, row)
        if row['lifecycle-state'] == 'CREATING':
            return None
        if row['lifecycle-state'] != 'ACTIVE':
            raise KeySafetyError('Recovery session not ACTIVE; no replay.')
        return row
    row = wait_for_visible(active, label='p6-bastion-session')
    if bastion.GATEWAY not in json.dumps(row.get('ssh-metadata', {})):
        raise KeySafetyError('Unexpected signed gateway metadata.')
    line = continuity_key(row)
    if HOSTS.exists():
        if private_file(HOSTS) != line:
            raise KeySafetyError('Gateway continuity key changed; never overwrite.')
    else:
        write_new(HOSTS, line.encode())
    created = datetime.fromisoformat(row['time-created'].replace('Z', '+00:00')).timestamp()
    state.update(ready=True, expiresAt=created + spec['sessionTtlInSeconds'], gatewayPinSHA256=hashlib.sha256(line.encode()).hexdigest(),
                 trust='historical gateway continuity only; inner guest authenticated by original OCI pin')
    atomic_metadata(STATE, state)
    return {'status': 'PASS', 'auth': 'security_token', 'clientIPv4Entries': 1, 'publicSSHUnchanged': True,
            'bastionPrivateSSHUnchanged': True, 'iamChanges': 0, 'sessionTTL': 1800, 'targetPort': 22,
            'gatewayStrictContinuity': True, 'guestOriginalPinRequired': True, 'eligibility': state['eligibility']}


@contextmanager
def tunnel(agent, guest):
    state = json.loads(private_file(STATE))
    line = private_file(HOSTS)
    if (not state.get('ready') or state['expiresAt'] - time.time() < 30
            or hashlib.sha256(line.encode()).hexdigest() != state['gatewayPinSHA256']
            or state['spec']['targetResourceDetails']['targetResourceId'] != guest['instanceId']):
        raise KeySafetyError('Bastion recovery receipt expired or mismatched; no fallback.')
    spec = state['spec']
    # Recheck the authenticated API target, state and TTL before each tunnel.
    row = infra.invoke(['bastion', 'session', 'get', '--session-id', state['sessionId']])
    bastion.verify_session(spec, row)
    if row['lifecycle-state'] != 'ACTIVE':
        raise KeySafetyError('Bastion recovery session inactive; no fallback.')
    with socket.socket() as listener:
        listener.bind(('127.0.0.1', 0))
        port = listener.getsockname()[1]
    options = bastion.ssh_options(agent, HOSTS, ALIAS)
    target = spec['targetResourceDetails']['targetResourcePrivateIpAddress']
    args = ['ssh', '-F', '/dev/null', *[v for option in options for v in ('-o', option)], '-i', str(KEY_DIRECTORY / 'ssh_ed25519'),
            '-N', '-T', '-L', '127.0.0.1:' + str(port) + ':' + target + ':22', '-p', '22', state['sessionId'] + '@' + bastion.GATEWAY]
    env = {key: os.environ[key] for key in ('PATH', 'HOME', 'LANG') if key in os.environ}
    env['SSH_AUTH_SOCK'] = agent['socket']
    process = subprocess.Popen(args, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, env=env)
    try:
        deadline = time.monotonic() + 15
        while True:
            if process.poll() is not None:
                raise KeySafetyError('Strict Bastion gateway connection failed; no TOFU or retry.')
            try:
                with socket.create_connection(('127.0.0.1', port), timeout=1):
                    break
            except OSError:
                if time.monotonic() >= deadline:
                    raise KeySafetyError('Bastion tunnel not ready; no blind retry.')
                time.sleep(0.25)
        yield port
    finally:
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=5)


if __name__ == '__main__':
    try:
        if sys.argv[1:] == ['--check-parser']:
            print(json.dumps(prove_parser_rejection()))
            raise SystemExit(0)
        if sys.argv[1:] not in (['--prepare'], ['--prepare', '--repair-cli-1']):
            raise KeySafetyError('Explicit Bastion preparation required.')
        print(json.dumps(prepare(repair_cli='--repair-cli-1' in sys.argv)))
    except Exception as error:
        print(json.dumps({'status': 'STOP', 'code': str(error) if isinstance(error, KeySafetyError) else type(error).__name__}))
        raise SystemExit(1)
