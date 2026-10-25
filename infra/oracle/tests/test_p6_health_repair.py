import inspect
import io
import json
import pathlib
import subprocess
import sys
import tempfile
import unittest
from contextlib import ExitStack, nullcontext
from unittest.mock import Mock, patch

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
import p6_health_repair_guest as repair
from p4_recovery_guest import RecoveryError


class HealthProxyRepairTests(unittest.TestCase):
    def test_native_validation_failure_cannot_start_worker_or_install_units(self):
        self._failure(preflight=True)

    def test_failed_health_stops_owned_worker_and_disables_only_its_proxy(self):
        self._failure(preflight=False)

    def _failure(self, *, preflight):
        image = 'sha256:' + 'a' * 64
        item = {'Image': image, 'Config': {'User': '1002:1002'}, 'State': {'Status': 'exited'}, 'RestartCount': 0,
                'HostConfig': {'Memory': 2560 * 1024 * 1024, 'ReadonlyRootfs': True, 'LogConfig': {'Type': 'none'},
                    'RestartPolicy': {'Name': 'unless-stopped'}, 'PortBindings': {'8787/tcp': [{'HostIp': '127.0.0.1', 'HostPort': '8787'}]}},
                'NetworkSettings': {'Networks': {'ir35-staging_backend': {'IPAddress': '172.19.0.9'}}}}
        network = {'Name': 'ir35-staging_backend', 'Internal': True, 'IPAM': {'Config': [{'Subnet': '172.19.0.0/16'}]}}
        data = {'p4': {}, 'workerBuild': {'image': image}, 'failedStart': {'stage': '06-mock-start', 'manifestSHA256': 'a' * 64,
            'status': 'FAIL', 'code': 'NativeMockHealthMismatch', 'stoppedAfterFailure': True},
            'networkDiagnosis': {'stage': '07-network-diagnose', 'manifestSHA256': 'b' * 64, 'status': 'PASS',
                'directBridge': {'status': 200, 'marker': True}, 'requestedLoopback': {'status': 0, 'marker': False},
                'actualPublishedMapping': None, 'probeRemoved': True, 'containment': {'status': 'PASS'}}}
        commands = []
        def run(args):
            commands.append(args)
            if args[:2] == ['docker', 'inspect']:
                return json.dumps([item])
            if args[:3] == ['docker', 'network', 'inspect']:
                return json.dumps([network])
            return ''
        original_read = pathlib.Path.read_text
        def read(path, *args, **kwargs):
            return 'MemAvailable: 9000000 kB\n' if str(path) == '/proc/meminfo' else original_read(path, *args, **kwargs)
        with tempfile.TemporaryDirectory() as temporary, ExitStack() as stack:
            root = pathlib.Path(temporary)
            units = root / 'systemd'
            units.mkdir()
            store = Mock()
            store.stage.return_value = root / '08-mock-health-repair-one'
            store.seal.return_value = 'c' * 64
            store.sink.side_effect = lambda *args: nullcontext(io.BytesIO())
            stack.enter_context(patch.object(repair, 'SYSTEMD', units))
            stack.enter_context(patch.object(repair, 'PROXY', '/bin/true'))
            stack.enter_context(patch.object(repair, 'prerequisites'))
            stack.enter_context(patch.object(repair, 'prepared', return_value=store))
            contained = stack.enter_context(patch.object(repair, 'check_containment', return_value={'status': 'PASS'}))
            stack.enter_context(patch.object(pathlib.Path, 'read_text', read))
            stack.enter_context(patch.object(repair, 'health', return_value={'ok': False}))
            stack.enter_context(patch.object(repair.time, 'monotonic', side_effect=[0, 0, 91]))
            stack.enter_context(patch.object(repair.time, 'sleep'))
            native = stack.enter_context(patch.object(repair.subprocess, 'run', return_value=subprocess.CompletedProcess([], 1 if preflight else 0, '', '')))
            result = repair.run(data, {'run': run})
            self.assertEqual(result['status'], 'FAIL')
            self.assertEqual(contained.call_count, 2)
            if preflight:
                self.assertEqual(result['code'], 'HealthProxyPreflightValidationFailed_NoServiceChange')
                self.assertEqual(result['workerStarts'], 0)
                self.assertEqual(list(units.iterdir()), [])
                self.assertNotIn(['docker', 'start', repair.NAME], commands)
            else:
                self.assertEqual(result['code'], 'NativeMockHealthRepairMismatch')
                self.assertEqual(result['workerStarts'], 1)
                self.assertTrue(result['stoppedAfterFailure'])
                self.assertTrue(result['proxyDisabledAfterFailure'])
                calls = [call.args[0] for call in native.call_args_list]
                self.assertIn(['docker', 'stop', '--time', '30', repair.NAME], calls)
                self.assertIn(['systemctl', 'disable', '--now', repair.UNIT + '.socket'], calls)

    def test_proxy_is_loopback_only_nonroot_restricted_and_has_no_secrets(self):
        units = repair.units('172.19.0.9')
        socket = units[repair.UNIT + '.socket']
        service = units[repair.UNIT + '.service']
        self.assertIn('ListenStream=127.0.0.1:8787', socket)
        self.assertNotIn('ListenStream=0.0.0.0', socket)
        self.assertNotIn('After=docker.service', socket)  # No sockets.target/basic.target cycle.
        self.assertIn('Requires=docker.service', service)
        for value in ('User=ir35', 'Group=ir35', 'NoNewPrivileges=yes', 'ProtectSystem=strict',
                      'InaccessiblePaths=/opt/ir35',
                      'IPAddressDeny=any', 'IPAddressAllow=127.0.0.1/32', 'IPAddressAllow=172.19.0.9/32',
                      'MemoryMax=32M', 'RestrictAddressFamilies=AF_INET AF_UNIX', 'StandardOutput=null', 'StandardError=null'):
            self.assertIn(value, service)
        for forbidden in ('Environment=', 'docker.sock', 'SUPABASE', 'PGPASSWORD', 'APPLICATION_WORKER_SECRET'):
            self.assertNotIn(forbidden, service + socket)

    def test_public_loopback_unix_ipv6_and_hostname_targets_are_rejected(self):
        for address in ('8.8.8.8', '127.0.0.1', '0.0.0.0', '::1', 'worker', '169.254.1.1'):
            with self.assertRaises((ValueError, RecoveryError)):
                repair.units(address)

    def test_listener_checks_local_address_not_the_wildcard_peer(self):
        repair.require_loopback_listener('LISTEN 0 4096 127.0.0.1:8787 0.0.0.0:*')
        for output in ('', 'LISTEN 0 4096 0.0.0.0:8787 0.0.0.0:*', 'LISTEN 0 4096 [::]:8787 [::]:*',
                       'LISTEN 0 4096 127.0.0.1:8787 0.0.0.0:*\nLISTEN 0 4096 10.0.0.1:8787 0.0.0.0:*'):
            with self.assertRaises(RecoveryError):
                repair.require_loopback_listener(output)

    def test_unit_write_is_exclusive_and_cannot_overwrite_or_use_other_names(self):
        with tempfile.TemporaryDirectory() as temporary, patch.object(repair, 'SYSTEMD', pathlib.Path(temporary)):
            path = repair.SYSTEMD / (repair.UNIT + '.socket')
            repair.write_unit(path, 'original')
            with self.assertRaises(FileExistsError):
                repair.write_unit(path, 'replacement')
            self.assertEqual(path.read_text(), 'original')
            self.assertEqual(path.stat().st_mode & 0o777, 0o644)
            with self.assertRaises(RecoveryError):
                repair.write_unit(repair.SYSTEMD / 'ssh.service', 'forbidden')

    def test_controller_preserves_network_and_restarts_owned_worker_only_once(self):
        source = inspect.getsource(repair.run)
        self.assertEqual(source.count("['docker', 'start', NAME]"), 1)
        for forbidden in ("['docker', 'network', 'connect'", "['docker', 'run'", "['docker', 'rm'", 'iptables', 'ufw', 'write_text('):
            self.assertNotIn(forbidden, source)
        self.assertIn('check_containment(data, runtime, store, stage, \'post\')', source)
        self.assertIn('rollback()', source)


if __name__ == '__main__':
    unittest.main()
