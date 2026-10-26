"""One bounded localhost-only proxy repair; never changes Docker networking."""
import ipaddress
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import time
import urllib.error
import urllib.request

from immutable_artifacts import digest
from p4_recovery_guest import Recovery, RecoveryError
from p6_mock_guest import ROOT, NAME, prerequisites, prepared, check_containment, health
from p6_roles_guest import no_customer_access

UNIT = 'ir35-p6-health-proxy-r1'
UPDATE_UNIT = 'ir35-p6-health-proxy-r2'
RECEIPT_UNIT = 'ir35-p6-health-proxy-r3'
RESUME_UNIT = 'ir35-p6-health-proxy-r4'
ROLLBACK_UNIT = 'ir35-p6-health-proxy-r4-rollback'
PAUSE_REPAIR_UNIT = 'ir35-p6-health-proxy-r4-pause-repair1'
PAUSE_ROLLBACK_UNIT = 'ir35-p6-health-proxy-r4-pause-rollback1'
DRAIN_UNIT = 'ir35-p6-health-proxy-r4-drain23'
DRAIN_ROLLBACK_UNIT = 'ir35-p6-health-proxy-r4-drain23-fallback'
SYSTEMD = Path('/etc/systemd/system')
PROXY = '/usr/lib/systemd/systemd-socket-proxyd'


def units(address, *, unit=UNIT):
    if unit not in (UNIT, UNIT + '-preflight', UPDATE_UNIT, UPDATE_UNIT + '-preflight', RECEIPT_UNIT, RECEIPT_UNIT + '-preflight',
                    RESUME_UNIT,RESUME_UNIT+'-preflight',ROLLBACK_UNIT,ROLLBACK_UNIT+'-preflight',
                    PAUSE_REPAIR_UNIT,PAUSE_REPAIR_UNIT+'-preflight',PAUSE_ROLLBACK_UNIT,PAUSE_ROLLBACK_UNIT+'-preflight',
                    DRAIN_UNIT,DRAIN_UNIT+'-preflight',DRAIN_ROLLBACK_UNIT,DRAIN_ROLLBACK_UNIT+'-preflight'):
        raise RecoveryError('FixedOwnedProxyUnitNameRequired')
    ip = ipaddress.ip_address(address)
    if ip.version != 4 or not any(ip in ipaddress.ip_network(net) for net in ('10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16')):
        raise RecoveryError('ExactPrivateIPv4ProxyTargetRequired')
    socket = f'''[Unit]
Description=IR35 isolated mock worker loopback health r1
RequiresMountsFor=/opt/ir35/data

[Socket]
ListenStream=127.0.0.1:8787
Accept=no
Backlog=64
Service={unit}.service

[Install]
WantedBy=sockets.target
'''
    service = f'''[Unit]
Description=IR35 mock health private bridge proxy r1
Requires={unit}.socket
Requires=docker.service
After={unit}.socket docker.service
RequiresMountsFor=/opt/ir35/data

[Service]
Type=notify
User=ir35
Group=ir35
ExecStart={PROXY} --connections-max=32 {ip}:8787
Restart=on-failure
RestartSec=2
TimeoutStartSec=10
TimeoutStopSec=10
MemoryMax=32M
TasksMax=16
LimitNOFILE=256
NoNewPrivileges=yes
CapabilityBoundingSet=
AmbientCapabilities=
PrivateTmp=yes
PrivateDevices=yes
ProtectSystem=strict
ProtectHome=yes
InaccessiblePaths=/opt/ir35
ProtectKernelTunables=yes
ProtectKernelModules=yes
ProtectKernelLogs=yes
ProtectControlGroups=yes
RestrictSUIDSGID=yes
LockPersonality=yes
MemoryDenyWriteExecute=yes
RestrictAddressFamilies=AF_INET AF_UNIX
IPAddressDeny=any
IPAddressAllow=127.0.0.1/32
IPAddressAllow={ip}/32
StandardOutput=null
StandardError=null
'''
    return {unit + '.socket': socket, unit + '.service': service}


def require_loopback_listener(output):
    rows = [line.split() for line in output.splitlines() if line.strip()]
    if len(rows) != 1 or len(rows[0]) < 5 or rows[0][3] != '127.0.0.1:8787':
        raise RecoveryError('HealthProxyMustListenOnlyOnIPv4Loopback')


def write_unit(path, body, *, unit=UNIT):
    if unit not in (UNIT, UPDATE_UNIT, RECEIPT_UNIT, RESUME_UNIT, ROLLBACK_UNIT,PAUSE_REPAIR_UNIT,PAUSE_ROLLBACK_UNIT,DRAIN_UNIT,DRAIN_ROLLBACK_UNIT) or path.parent != SYSTEMD or path.name not in (unit + '.socket', unit + '.service'):
        raise RecoveryError('OnlyOwnedHealthProxyUnitsMayBeCreated')
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o644)
    os.fchmod(fd, 0o644)  # Native harness umask077 must not hide this public unit.
    with os.fdopen(fd, 'wb') as output:
        output.write(body.encode())
        output.flush()
        os.fsync(output.fileno())


def validate_proxy(runtime, bodies, *, unit=UNIT):
    units('10.0.0.1', unit=unit)  # Restricts the unit name before any read.
    require_loopback_listener(runtime['run'](['ss', '-H', '-ltn', 'sport = :8787']))
    for name, body in bodies.items():
        path = SYSTEMD / name
        if path.is_symlink() or path.read_bytes() != body.encode() or path.stat().st_uid != 0 or stat.S_IMODE(path.stat().st_mode) != 0o644:
            raise RecoveryError('ProxyUnitReadbackMismatch')
    settings = dict(line.split('=', 1) for line in runtime['run'](['systemctl', 'show', unit + '.service',
        '--property=User', '--property=Group', '--property=NoNewPrivileges', '--property=DropInPaths',
        '--property=FragmentPath', '--property=MainPID', '--property=MemoryMax', '--property=ActiveState']).splitlines())
    expected = {'User': 'ir35', 'Group': 'ir35', 'NoNewPrivileges': 'yes', 'DropInPaths': '',
                'FragmentPath': str(SYSTEMD / (unit + '.service')), 'MemoryMax': str(32 * 1024 * 1024), 'ActiveState': 'active'}
    if any(settings.get(name) != value for name, value in expected.items()) or int(settings.get('MainPID', '0')) <= 0:
        raise RecoveryError('LoadedProxySandboxDoesNotMatchOwnedUnit')


def isolation(item, image, network):
    host = item['HostConfig']
    if (item['Image'] != image or item['Config'].get('User') != '1002:1002'
            or host['Memory'] != 2560 * 1024 * 1024 or not host['ReadonlyRootfs']
            or host['LogConfig']['Type'] != 'none' or host['RestartPolicy']['Name'] != 'unless-stopped'
            or host.get('PortBindings') != {'8787/tcp': [{'HostIp': '127.0.0.1', 'HostPort': '8787'}]}
            or set(item['NetworkSettings']['Networks']) != {'ir35-staging_backend'}
            or network.get('Internal') is not True or network.get('Name') != 'ir35-staging_backend'
            or item['RestartCount'] != 0):
        raise RecoveryError('MockWorkerIsolationMustRemainUnchanged')
    address = item['NetworkSettings']['Networks']['ir35-staging_backend']['IPAddress']
    units(address)
    if not any(ipaddress.ip_address(address) in ipaddress.ip_network(row['Subnet']) for row in network['IPAM']['Config'] if row.get('Subnet')):
        raise RecoveryError('WorkerIPOutsideVerifiedInternalNetwork')
    return address


def run(data, runtime):
    prerequisites(data, runtime)
    store = prepared(data)
    failed, diagnosis = data['failedStart'], data['networkDiagnosis']
    store.verify(failed['stage'], failed['manifestSHA256'])
    store.verify(diagnosis['stage'], diagnosis['manifestSHA256'])
    if (failed.get('status') != 'FAIL' or failed.get('code') != 'NativeMockHealthMismatch'
            or failed.get('stoppedAfterFailure') is not True or diagnosis.get('status') != 'PASS'
            or diagnosis.get('directBridge') != {'status': 200, 'marker': True}
            or diagnosis.get('requestedLoopback') != {'status': 0, 'marker': False}
            or diagnosis.get('actualPublishedMapping') is not None or diagnosis.get('probeRemoved') is not True
            or diagnosis.get('containment', {}).get('status') != 'PASS'):
        raise RecoveryError('ExactPrivatePortDiagnosisAndStoppedFailureRequired')
    stage = store.stage('08-mock-health-repair-one')
    result = {'status': 'FAIL', 'repairAttempt': 1, 'workerStarts': 0, 'networkChanges': 0,
              'customerWrites': 0, 'secretChanges': 0, 'productionChanges': False, 'realAcceptance': False}
    created = []
    started = False
    def rollback():
        if created:
            with store.sink(stage, 'rollback-proxy.log') as log:
                result['proxyDisabledAfterFailure'] = subprocess.run(['systemctl', 'disable', '--now', UNIT + '.socket'],
                    stdout=log, stderr=log, timeout=25).returncode == 0
                subprocess.run(['systemctl', 'stop', UNIT + '.service'], stdout=log, stderr=log, timeout=20)
        if started:
            with store.sink(stage, 'stop-owned-worker.log') as log:
                result['stoppedAfterFailure'] = subprocess.run(['docker', 'stop', '--time', '30', NAME],
                    stdout=log, stderr=log, timeout=45).returncode == 0
    try:
        result['preContainment'] = check_containment(data, runtime, store, stage, 'pre')
        if not Path(PROXY).is_file() or not os.access(PROXY, os.X_OK):
            raise RecoveryError('InstalledSystemdSocketProxyRequired_NoNewPackage')
        if any((SYSTEMD / name).exists() or (SYSTEMD / name).is_symlink() for name in units('10.0.0.1')):
            raise RecoveryError('ProxyUnitAlreadyExists_NoOverwriteOrReplay')
        if runtime['run'](['ss', '-H', '-ltn', 'sport = :8787']).strip():
            raise RecoveryError('LoopbackHealthPortAlreadyInUse')
        preview = units('10.0.0.1', unit=UNIT + '-preflight')
        for name, body in preview.items():
            store.put(stage, name, body.encode())
        # Validate the sandbox and dependencies on the actual host before any
        # worker start or system unit installation. This never binds a socket.
        with store.sink(stage, 'preflight-systemd-verify.log') as log:
            if subprocess.run(['systemd-analyze', 'verify', *[str(stage / name) for name in preview]], stdout=log, stderr=log, timeout=20).returncode:
                raise RecoveryError('HealthProxyPreflightValidationFailed_NoServiceChange')
        original = json.loads(runtime['run'](['docker', 'inspect', NAME]))[0]
        if original['State']['Status'] != 'exited' or original['Image'] != data['workerBuild']['image']:
            raise RecoveryError('OriginalOwnedFailedWorkerMustBeStopped')
        available = int(re.search(r'^MemAvailable:\s+(\d+)', Path('/proc/meminfo').read_text(), re.M)[1])
        if available < 3_500_000:
            raise RecoveryError('MockStartupMemoryHeadroomInsufficient')
        store.put(stage, 'intent.json', json.dumps({'worker': NAME, 'image': data['workerBuild']['image'],
            'startsAllowed': 1, 'repairAttempt': 1, 'listener': '127.0.0.1:8787',
            'newNetworkOrEgress': False, 'newSecrets': False, 'diagnosisSHA256': diagnosis['manifestSHA256']}).encode())
        started = True
        runtime['run'](['docker', 'start', NAME])
        result['workerStarts'] = 1
        item = json.loads(runtime['run'](['docker', 'inspect', NAME]))[0]
        network = json.loads(runtime['run'](['docker', 'network', 'inspect', 'ir35-staging_backend']))[0]
        address = isolation(item, data['workerBuild']['image'], network)
        bodies = units(address)
        for name, body in bodies.items():
            write_unit(SYSTEMD / name, body)
            created.append(name)
            store.put(stage, name, body.encode())
        result['unitSHA256'] = {name: digest(body.encode()) for name, body in bodies.items()}
        with store.sink(stage, 'systemd-verify.log') as log:
            if subprocess.run(['systemd-analyze', 'verify', *[str(SYSTEMD / name) for name in bodies]], stdout=log, stderr=log, timeout=20).returncode:
                raise RecoveryError('HealthProxyUnitValidationFailed_PrivateLog')
        runtime['run'](['systemctl', 'daemon-reload'])
        runtime['run'](['systemctl', 'enable', '--now', UNIT + '.socket'])
        observed = None
        deadline = time.monotonic() + 90
        while time.monotonic() < deadline:
            try:
                observed = health()
                if observed.get('ok') is True:
                    break
            except (urllib.error.URLError, TimeoutError, ConnectionError):
                pass
            time.sleep(2)
        if (not observed or any(observed.get(key) is not True for key in ('ok', 'browserReady', 'databaseReady'))
                or observed.get('mode') != 'staging-mock-only' or observed.get('realAcceptance') is not False
                or observed.get('buildSHA') != data['workerBuild']['sourceSHA']):
            raise RecoveryError('NativeMockHealthRepairMismatch')
        validate_proxy(runtime, bodies)
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        try:
            opener.open(urllib.request.Request('http://127.0.0.1:8787/mock/applications', data=b'{}', method='POST'), timeout=5)
            raise RecoveryError('UnauthenticatedMockControlUnexpectedlyAllowed')
        except urllib.error.HTTPError as error:
            if error.code != 401:
                raise RecoveryError('MockHMACBoundaryMismatch')
        current = json.loads(runtime['run'](['docker', 'inspect', NAME]))[0]
        if isolation(current, data['workerBuild']['image'], network) != address or current['State']['Running'] is not True:
            raise RecoveryError('MockRuntimeChangedDuringRepair')
        available = int(re.search(r'^MemAvailable:\s+(\d+)', Path('/proc/meminfo').read_text(), re.M)[1])
        if available < 2 * 1024 * 1024:
            raise RecoveryError('MockOSHeadroomBelowTwoGiB')
        result['queueRoleCustomerAccess'] = no_customer_access(Recovery(data['p4'], runtime))
        result.update(status='PASS', health=observed, loopbackOnly=True, workerNetworkStillInternal=True,
                      noNewEgress=True, unauthenticatedControlStatus=401, hostMemoryAvailableKiB=available,
                      proxyMemoryLimitBytes=32 * 1024 * 1024, workerMemoryLimitBytes=2560 * 1024 * 1024,
                      originalEnvironmentUnchanged=True, restart='unless-stopped')
    except Exception as error:
        result['code'] = str(error) if isinstance(error, RecoveryError) else type(error).__name__
        rollback()
    try:
        result['containment'] = check_containment(data, runtime, store, stage, 'post')
    except Exception as error:
        if result['status'] == 'PASS':
            rollback()
        result.update(status='FAIL', containmentError=str(error) if isinstance(error, RecoveryError) else type(error).__name__)
    store.put(stage, 'result.json', json.dumps(result, sort_keys=True).encode())
    return result | {'stage': stage.name, 'manifestSHA256': store.seal(stage)}
