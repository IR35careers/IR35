import copy
import sys
from pathlib import Path
import unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from p6_fixed_ip_guest import network_plan,ADDRESS,NETWORK
from p6_fixed_ip_guest import fixed_configuration,NAME,verify_fixed_endpoint
from p6_health_repair_guest import FIXED_UNIT,units
from p6_lifecycle_guest import run as lifecycle
import inspect
from unittest.mock import Mock,patch


class FixedIPTests(unittest.TestCase):
    def test_compose_pins_address_existing_network_and_keeps_global_guard(self):
        value=fixed_configuration('sha256:'+'a'*64,'b'*40)
        worker=value['services']['worker']
        self.assertEqual(worker['networks']['backend']['ipv4_address'],ADDRESS)
        self.assertEqual(value['networks'],{'backend':{'external':True,'name':NETWORK}})
        self.assertEqual(worker['restart'],'unless-stopped');self.assertTrue(worker['read_only'])
        self.assertIn('IR35_MOCK_START_PAUSED=true',worker['entrypoint'])
        self.assertNotIn('IR35_READ_ONLY=false',worker['entrypoint'])
        self.assertEqual(worker['container_name'],NAME)
        rollback=fixed_configuration('sha256:'+'c'*64,'d'*40,rollback=True)
        self.assertIn('IR35_READ_ONLY=true',rollback['services']['worker']['entrypoint'])
        self.assertEqual(rollback['services']['worker']['networks']['backend']['ipv4_address'],'172.18.0.241')
        proxy=units(ADDRESS,unit=FIXED_UNIT)
        self.assertIn('IPAddressAllow='+ADDRESS+'/32',proxy[FIXED_UNIT+'.service'])
    def test_postrestart_requires_same_pinned_address_direct_and_local_build(self):
        item={'Name':'/'+NAME,'NetworkSettings':{'Networks':{NETWORK:{'IPAddress':ADDRESS,'IPAMConfig':{'IPv4Address':ADDRESS}}}}}
        health={'ok':True,'browserReady':True,'databaseReady':True,'mode':'staging-mock-only','realAcceptance':False,
            'paused':True,'active':0,'buildSHA':'a'*40}
        control=Mock();control.request.return_value=(200,health)
        with patch('p6_fixed_ip_guest.private_health',return_value={'status':200,**health}):
            self.assertEqual(verify_fixed_endpoint(item,{'sourceSHA':'a'*40},control)['status'],'PASS')
            with self.assertRaises(RuntimeError):verify_fixed_endpoint(item,{'sourceSHA':'b'*40},control)
            changed=copy.deepcopy(item);changed['NetworkSettings']['Networks'][NETWORK]['IPAddress']='172.18.0.17'
            with self.assertRaises(RuntimeError):verify_fixed_endpoint(changed,{'sourceSHA':'a'*40},control)
    def test_single_new_lifecycle_preserves_legacy_assertions_and_stricter_owned_schedule_gate(self):
        source=inspect.getsource(lifecycle)
        for unchanged in ('NativeMockRestartHealthDeadline','time.monotonic() + 90','retained-all-twelve-counts',
                          'retained-all-twenty-three-counts','durable-after-restart','concurrent-browser-exclusion','phaseComplete=False'):
            self.assertIn(unchanged,source)
        self.assertIn('retained-all-thirty-four-counts',source)
        self.assertIn('fixedip-every-owned-schedule-durable',source)
        self.assertIn('ownerFixedIPLifecycleAttempt=1',source)
    def network(self):
        return {'Name':NETWORK,'Id':'existing','Internal':True,'Driver':'bridge',
            'IPAM':{'Config':[{'Subnet':'172.18.0.0/16','Gateway':'172.18.0.1'}]},
            'Containers':{'other':{'IPv4Address':'172.18.0.16/16'}}}
    def test_existing_internal_subnet_supports_explicit_unallocated_address(self):
        value=self.network();before=copy.deepcopy(value)
        self.assertEqual(network_plan(value)['ipv4_address'],ADDRESS)
        self.assertEqual(value,before)
        self.assertEqual(network_plan(value)['newNetworks'],0)
    def test_conflict_external_network_gateway_or_public_ip_fails_without_changes(self):
        for change in ('conflict','external','gateway','subnet'):
            value=self.network()
            if change=='conflict':value['Containers']['collision']={'IPv4Address':ADDRESS+'/16'}
            if change=='external':value['Internal']=False
            if change=='gateway':value['IPAM']['Config'][0]['Gateway']=ADDRESS
            if change=='subnet':value['IPAM']['Config'][0]['Subnet']='10.0.0.0/24'
            before=copy.deepcopy(value)
            with self.assertRaises(RuntimeError):network_plan(value)
            self.assertEqual(value,before)
        for address in ('8.8.8.8','169.254.169.254','172.18.0.0','172.18.255.255','::1'):
            with self.assertRaises(RuntimeError):network_plan(self.network(),address)


if __name__=='__main__':unittest.main()
