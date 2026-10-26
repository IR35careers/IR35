import copy
import inspect
import json
from pathlib import Path
import sys
import unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import p6_integration_guest as guest
import p6_fixed_ip as controller
import p6_fixed_ip_guest as fixed
from staging_stack import kong_config


class IntegrationTests(unittest.TestCase):
    def test_routes_only_add_existing_protected_realtime_and_deny_admin_without_key_changes(self):
        platform=kong_config('anon-fixture','service-fixture');old=copy.deepcopy(platform)
        old['services']=[row for row in old['services'] if not row['name'].startswith(('realtime-','rt-admin-'))]
        before=copy.deepcopy(old);result=guest.routing_configuration(old,platform)
        self.assertEqual(old,before);self.assertEqual(result['consumers'],old['consumers']);self.assertEqual(result['acls'],old['acls'])
        self.assertEqual(result['services'][:len(old['services'])],old['services'])
        extra=result['services'][len(old['services']):]
        self.assertEqual(len(extra),3)
        self.assertTrue(any(plugin['name']=='key-auth' for plugin in extra[0]['plugins']))
        self.assertTrue(all(row['plugins'][0]['config']['status_code']==403 for row in extra[1:]))
        wrong=copy.deepcopy(platform);wrong['consumers'][0]['keyauth_credentials'][0]['key']='different'
        with self.assertRaises(RuntimeError):guest.routing_configuration(old,wrong)
    def test_only_public_health_flags_override_original_readonly_app_env(self):
        value={'name':'ir35-p5','services':{'web':{'entrypoint':['launcher','/opt/ir35/.env.p5-web','node','web-server.mjs']},
            'kong':{'volumes':['/opt/ir35/.env.p5-kong-config:/run/ir35/.env.kong-config.json:ro']},'auth':{}},
            'networks':{'backend':{'external':True,'name':fixed.NETWORK}}}
        before=copy.deepcopy(value);result=guest.app_configuration(value)
        self.assertEqual(value,before);self.assertEqual(set(result['services']),{'web','kong'})
        self.assertEqual(result['services']['web']['entrypoint'],['launcher','/opt/ir35/.env.p5-web','/usr/bin/env',
            'IR35_WORKER_HEALTH_ENABLED=true','IR35_REALTIME_HEALTH_ENABLED=true','node','web-server.mjs'])
        self.assertNotIn('IR35_READ_ONLY=false',str(result))
        self.assertNotIn('APPLICATION_WORKER_ACCEPT_JOBS=true',str(result))
        self.assertTrue(result['services']['kong']['volumes'][0].endswith(':ro'))
    def test_mock_timer_has_no_secret_arguments_only_loopback_and_validated_operations(self):
        for operation,hour in (('mock_ingest','03'),('mock_automation','04'),('watchdog','05')):
            name,bodies=guest.timer_units(operation,hour)
            service=bodies[name+'.service'];timer=bodies[name+'.timer']
            self.assertIn('User=ir35',service);self.assertIn('IPAddressDeny=any',service)
            self.assertIn('IPAddressAllow=127.0.0.1/32',service)
            self.assertIn('MemoryMax=32M',service);self.assertIn('Persistent=false',timer)
            self.assertNotIn('SECRET=',service);self.assertNotIn('Environment=',service)
        with self.assertRaises(RuntimeError):guest.timer_units('real-apply','03')
    def test_remote_bundle_covers_imports_and_compiles_before_any_vm_action(self):
        code=controller.bundle();compile(code,'<public-bootstrap>','exec')
        self.assertLess(code.index("module=types.ModuleType('p6_mock_receipt_repair_guest')"),code.index("module=types.ModuleType('p6_fixed_ip_guest')"))
        self.assertLess(code.index("module=types.ModuleType('p6_fixed_ip_guest')"),code.index("module=types.ModuleType('p6_integration_guest')"))
    def test_full_gate_never_reports_pass_without_lifecycle_integration_and_fresh_containment(self):
        source=inspect.getsource(fixed.full)
        self.assertLess(source.index("result['lifecycle']=lifecycle"),source.index('integration.prepare'))
        self.assertLess(source.index('integration.verify'),source.index("result['fullContainment']=containment"))
        self.assertLess(source.index("result['fullContainment']['status']!='PASS'"),source.index("result.update(status='PASS',phaseComplete=True"))
        for invariant in ('fixedip-every-owned-schedule-durable','failuresOneAndTwoRechecked','historicalCountersPreserved','rollbackManifestSHA256'):
            self.assertIn(invariant,source)
        self.assertNotIn('while True:',source)


if __name__=='__main__':unittest.main()
