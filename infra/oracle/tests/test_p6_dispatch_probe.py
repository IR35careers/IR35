import copy
from pathlib import Path
import sys
import unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import p6_dispatch_probe_guest as probe
from p6_fixed_ip_guest import fixed_configuration


class ProbePreparationTests(unittest.TestCase):
    def test_restore_hashes_and_operational_state_must_match_even_when_stop_start_time_changes(self):
        before={'container':'retained','containerID':'same-id','image':'same-image','dockerConfigSHA256':'a',
            'dockerEnvSHA256':'b','hostConfigSHA256':'c','protectedFilesSHA256':{'file':'d'},
            'operationalState':{'Running':True,'paused':True,'realAcceptance':False},'lifecycleTimestamps':{'StartedAt':'before'}}
        after=copy.deepcopy(before);after['lifecycleTimestamps']={'StartedAt':'after'}
        self.assertEqual(probe.restored_equal(before,after)['status'],'PASS')
        for key,value in (('dockerEnvSHA256','changed'),('containerID','different'),('operationalState',{'Running':False})):
            wrong=copy.deepcopy(after);wrong[key]=value
            self.assertEqual(probe.restored_equal(before,wrong)['status'],'FAIL')
    def test_proposed_probe_reuses_pinned_image_endpoint_and_never_enables_real_acceptance(self):
        original=fixed_configuration('sha256:'+'a'*64,'b'*40,rollback=True)
        before=copy.deepcopy(original);value=probe.configuration('sha256:'+'a'*64,'b'*40)
        self.assertEqual(original,before)
        self.assertEqual(value['services']['worker']['image'],original['services']['worker']['image'])
        self.assertEqual(value['services']['worker']['networks']['backend']['ipv4_address'],'172.18.0.241')
        self.assertIn('IR35_MOCK_START_PAUSED=true',value['services']['worker']['entrypoint'])
        self.assertNotIn('APPLICATION_WORKER_ACCEPT_JOBS=true',str(value))
        self.assertNotIn('environment',value['services']['worker'])
    def test_one_shot_unit_uses_existing_rollback_proxy_and_sanitised_journal(self):
        unit=probe.unit_text()
        self.assertIn('ir35-p6-health-proxy-fixedip-owner1-rollback.socket',unit)
        self.assertIn('StandardError=journal',unit)
        self.assertIn('IPAddressDeny=any',unit);self.assertIn('IPAddressAllow=127.0.0.1/32',unit)
        self.assertIn('TimeoutStartSec=30',unit);self.assertIn('MemoryMax=32M',unit)
        self.assertNotIn('[Timer]',unit)
        self.assertNotIn('Environment=',unit)


if __name__=='__main__':unittest.main()
