import copy
import sys
from pathlib import Path
import unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from p6_fixed_ip_guest import network_plan,ADDRESS,NETWORK


class FixedIPTests(unittest.TestCase):
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
