import copy
import json
from pathlib import Path
import sys
import time
import unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from p4_recovery_guest import RecoveryError
import staging_stack
import web_edge_guest as edge
import web_stack


class WebEdgeTests(unittest.TestCase):
    def test_caddy_only_override_keeps_original_services_keys_and_ports(self):
        pins=json.loads((Path(__file__).resolve().parents[1]/'staging-images.json').read_text())['images']
        original=staging_stack.compose(pins);before=copy.deepcopy(original)
        result=edge.edge_compose(original)
        self.assertEqual(original,before)
        for name,service in original['services'].items():
            if name!='caddy':self.assertEqual(result['services'][name],service)
        self.assertEqual(result['services']['caddy']['ports'],['80:80/tcp','443:443/tcp'])
        self.assertIn('/opt/ir35/data/caddy:/data',result['services']['caddy']['volumes'])
        self.assertEqual(result['services']['caddy']['entrypoint'][1],'/opt/ir35/.env.p5-caddy')

    def test_basic_must_precede_authorization_removal_in_literal_route(self):
        value=web_stack.caddyfile(staging_stack.CADDYFILE)
        self.assertIn('handle {\n            route {\n                basic_auth',value)
        self.assertLess(value.index('basic_auth'),value.index('request_header @basic -Authorization'))

    def test_dns_requires_fresh_exact_four_staging_resolver_results(self):
        proof={'status':'PASS','checkedAtUnix':time.time(),'dnsWrites':0,'observations':[
            {'resolver':resolver,'host':host,'a':{'status':'NOERROR','records':[['132.145.28.134']]},'aaaa':{'status':'NOERROR','records':[]},'caaReady':True}
            for resolver in ('1.1.1.1','8.8.8.8') for host in ('staging.ir35careers.com','api-staging.ir35careers.com')]}
        edge.require_dns(proof)
        for key,value in [('checkedAtUnix',time.time()-301),('dnsWrites',1),('observations',proof['observations'][:3])]:
            with self.assertRaises(RecoveryError):edge.require_dns(proof|{key:value})


if __name__=='__main__':unittest.main()
