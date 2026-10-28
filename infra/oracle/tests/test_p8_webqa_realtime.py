import copy
from pathlib import Path
import sys
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import p8_webqa_config as config
import p8_webqa_realtime as rt
from staging_stack import kong_config

PRISTINE = 'ir35_p4_20261021t170139z_8be0fc2e'


def source():
    return {'DB_HOST': 'db', 'DB_PORT': '5432', 'DB_USER': 'supabase_admin', 'DB_NAME': 'postgres',
            **{key: 'fixture-only-not-a-credential' for key in ('DB_PASSWORD', 'DB_ENC_KEY', 'API_JWT_SECRET',
                'SECRET_KEY_BASE', 'METRICS_JWT_SECRET', 'HEALTHCHECK_ANON_KEY')}, 'ENABLE_ERL_CRASH_DUMP': 'false',
            'AWS_ACCESS_KEY_ID': 'fixture-must-not-be-inherited'}


class OwnedRealtimePlanTests(unittest.TestCase):
    def test_seed_metadata_and_cdc_are_bound_to_owned_clone_not_operational_or_original_app(self):
        base = source(); before = copy.deepcopy(base)
        value = rt.environment(base, PRISTINE)
        self.assertEqual(base, before)
        self.assertEqual(value['DB_NAME'], config.database_name(PRISTINE))
        self.assertEqual(value['SELF_HOST_TENANT_NAME'], config.PROJECT)
        self.assertEqual(value['SLOT_NAME_SUFFIX'], 'p8_webqa01')
        self.assertEqual(value['RUN_JANITOR'], 'false'); self.assertEqual(value['DB_POOL_SIZE'], '2')
        self.assertNotIn('AWS_ACCESS_KEY_ID', value)
        self.assertFalse(any('SELF_HOST_TENANT_DB_' in key for key in value))

    def test_public_or_original_database_overrides_and_secret_dump_hooks_reject(self):
        for key, value in (('DB_HOST', 'cloud.invalid'), ('DB_NAME', 'ir35_p5_app'), ('DB_USER', 'postgres'),
                           ('DB_PASSWORD', 'bad\nvalue'), ('GENERATE_CLUSTER_CERTS', 'true'), ('ENABLE_ERL_CRASH_DUMP', 'true')):
            with self.assertRaises(config.ConfigError): rt.environment(source() | {key: value}, PRISTINE)
        with self.assertRaises(config.ConfigError): rt.environment(source(), 'postgres')

    def test_owned_gateway_preserves_auth_plugins_and_selects_unique_tenant_host_only(self):
        original = kong_config('fixture-anon', 'fixture-service'); owned = config.gateway(original)
        value = rt.gateway(owned, original)
        self.assertEqual(len(owned['services']), 7); self.assertEqual(len(value['services']), 10)
        for key in ('consumers', 'acls'): self.assertEqual(value[key], original[key])
        ws = next(row for row in value['services'] if row['name'] == 'realtime-v1-ws')
        self.assertEqual(ws['url'], 'http://' + rt.ALIAS + ':4000/socket')
        self.assertEqual(ws['plugins'], next(row for row in original['services'] if row['name'] == ws['name'])['plugins'])
        self.assertEqual(rt.ALIAS.split('.')[0], config.PROJECT)
        for row in value['services']:
            if row['name'].startswith('rt-admin-'):
                self.assertEqual(row['plugins'][0]['config']['status_code'], 403)

    def test_duplicate_routes_host_preservation_and_weakened_admin_rules_refuse(self):
        original = kong_config('fixture-anon', 'fixture-service'); owned = config.gateway(original)
        with self.assertRaises(config.ConfigError): rt.gateway(rt.gateway(owned, original), original)
        for change in ('host', 'admin'):
            altered = copy.deepcopy(original)
            row = next(row for row in altered['services'] if row['name'] == ('realtime-v1-ws' if change == 'host' else 'rt-admin-tenants'))
            if change == 'host': row['routes'][0]['preserve_host'] = True
            else: row['plugins'][0]['config']['status_code'] = 200
            with self.assertRaises(config.ConfigError): rt.gateway(owned, altered)

    def test_exact_arm_pin_private_alias_no_ports_or_original_global_alias(self):
        pin = {'platform': 'linux/arm64', 'image': rt.PIN,
               'entrypoint': ['/usr/bin/tini', '-s', '-g', '--', '/app/run.sh'], 'command': ['/app/bin/server']}
        value = rt.compose_service(pin)
        self.assertEqual(value['mem_limit'], '256m'); self.assertEqual(value['user'], '1002:1002')
        self.assertEqual(value['networks'], {'backend': {'aliases': [rt.ALIAS]}})
        self.assertEqual(value['logging'], {'driver': 'none'}); self.assertTrue(value['read_only'])
        self.assertEqual(value['restart'], 'no'); self.assertNotIn('ports', value)
        self.assertNotIn('realtime-dev.supabase-realtime', str(value))
        for key, bad in (('platform', 'linux/amd64'), ('image', 'supabase/realtime:latest'), ('entrypoint', ['sh', '-c'])):
            with self.assertRaises(config.ConfigError): rt.compose_service(pin | {key: bad})
        plan = {'name': config.PROJECT, 'services': {}, 'networks': {'backend': {'external': True, 'name': config.NETWORK}}}
        result = rt.add_to_compose(plan, pin)
        self.assertEqual(plan['services'], {})
        with self.assertRaises(config.ConfigError): rt.add_to_compose(result, pin)
