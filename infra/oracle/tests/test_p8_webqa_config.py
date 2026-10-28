import copy
import importlib.util
import inspect
import json
from pathlib import Path
import socket
import subprocess
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import p8_webqa_config as config

PRISTINE = 'ir35_p4_20261021t170139z_8be0fc2e'
FIXTURE_PASSWORD = 'fixture-password-not-a-real-secret'


def uri(role, database='postgres'):
    return 'postgresql://' + role + ':' + FIXTURE_PASSWORD + '@db:5432/' + database


def images():
    return {'sourceSHA': config.BUILD_SHA, 'web': 'sha256:' + 'a' * 64, 'worker': 'sha256:' + 'b' * 64}


def pins():
    return {name: {'platform': 'linux/arm64', 'image': config.STORAGE_IMAGE if name == 'storage'
                  else 'fixture/' + name + ':1@sha256:' + 'c' * 64, 'entrypoint': [], 'command': ['fixture-' + name]}
            for name in ('auth', 'rest', 'storage', 'kong', 'smtp')}


def inputs():
    auth = {'GOTRUE_DB_DATABASE_URL': uri('supabase_auth_admin'), 'GOTRUE_SMTP_HOST': 'smtp',
            'GOTRUE_SMTP_PORT': '1025', 'GOTRUE_SMTP_USER': '', 'GOTRUE_SMTP_PASS': '',
            'GOTRUE_SITE_URL': 'https://staging.ir35careers.com',
            'API_EXTERNAL_URL': 'https://api-staging.ir35careers.com', 'GOTRUE_EXTERNAL_EMAIL_ENABLED': 'true',
            'GOTRUE_EXTERNAL_GOOGLE_ENABLED': 'false'}
    base = {'rest': {'PGRST_DB_URI': uri('authenticator')},
            'storage': {'DATABASE_URL': uri('supabase_storage_admin')}, 'kong': {}}
    previous = {'IR35_READ_ONLY': 'true', 'APPLY_RUNNER': 'mock',
                'APPLICATION_WORKER_ACCEPT_JOBS': 'false', 'APPLICATION_WORKER_SECRET': 'd' * 64,
                'STRIPE_SECRET_KEY': 'fixture-provider-do-not-inherit', 'CRON_SECRET': 'fixture-do-not-copy'}
    return [base, auth, {'ANON_KEY': 'fixture-public-anon', 'SERVICE_ROLE_KEY': 'fixture-staging-service'},
            previous, {'PG_BOSS_DATABASE_URL': uri('ir35_queue')},
            {'PG_BOSS_DATABASE_URL': uri('ir35_queue_producer')}, PRISTINE, images(), [{'name': 'last-source-migration'}]]


def native_proof():
    proof = {'status': 'PASS', 'sourceSHA': config.BUILD_SHA, 'runtimeDeployed': False,
             'newOCIResources': 0, 'newSecrets': 0, 'cutover': False,
             'post': {'status': 'PASS', 'originalContainersUnchanged': True, 'fullContainment': {'status': 'PASS'}}}
    for kind in ('web', 'worker'):
        proof[kind] = {'status': 'PASS', 'sourceSHA': config.BUILD_SHA, 'architecture': 'linux/arm64',
                       'nonroot': True, 'runtimeDeployed': False, 'networkNoneProbe': True, 'image': images()[kind]}
    proof['web']['probe'] = {'next': '16.4.3', 'react': '19.2.9', 'react-dom': '19.2.9', 'sharp': '0.35.5'}
    proof['worker']['probe'] = {'exports': ['runWebMockWorker', 'setupWebMockQueue', 'webMockOwnerOptions'],
                              'versions': {'playwright-core': '1.61.0', 'pg-boss': '12.38.0'}, 'importOnly': True}
    return proof


class QaConfigurationTests(unittest.TestCase):
    def test_raw_subject_support_requires_existing_compatible_compose_never_an_upgrade(self):
        self.assertEqual(config.require_compose('v2.30.0\n'), '2.30.0')
        self.assertEqual(config.require_compose('5.0.1'), '5.0.1')
        for version in ('v2.29.9', '1.30.0', 'latest', None):
            with self.assertRaises(config.ConfigError): config.require_compose(version)

    def test_raw_source_subjects_cannot_be_interpolated_stripped_or_extended(self):
        subjects = {'GOTRUE_MAILER_SUBJECTS_CONFIRMATION': "You're invited: $literal ${NAME} # text"}
        self.assertEqual(config.subjects_preserved({'services': {'auth': {'environment': subjects.copy()}}}, subjects)['fields'], 1)
        for actual in ({}, {'GOTRUE_MAILER_SUBJECTS_CONFIRMATION': "You're invited: # text"}, subjects | {'OTHER': 'fixture'}):
            with self.assertRaisesRegex(config.ConfigError, 'ExactSourceSubjects'):
                config.subjects_preserved({'services': {'auth': {'environment': actual}}}, subjects)

    def test_import_and_pure_plan_cannot_touch_private_state_or_network_or_spawn(self):
        spec = importlib.util.spec_from_file_location('qa_cold_fixture', Path(config.__file__))
        module = importlib.util.module_from_spec(spec)
        denied = AssertionError('Unexpected private state, network or process')
        with patch.object(Path, 'read_text', side_effect=denied), patch.object(Path, 'read_bytes', side_effect=denied), \
                patch.object(socket, 'socket', side_effect=denied), patch.object(subprocess, 'Popen', side_effect=denied):
            spec.loader.exec_module(module)
            self.assertEqual(module.image_pair(native_proof()), images())
            self.assertEqual(set(module.compose(images(), pins())['services']), set(config.SERVICES))

    def test_only_new_owned_database_can_be_removed_after_disconnect(self):
        target = config.database_name(PRISTINE)
        self.assertNotIn('_p8_upgrade01', target)
        comment = 'ir35-p8-webqa01:' + config.BUILD_SHA + ':' + 'e' * 64
        config.assert_owned_database(PRISTINE, target, comment, comment, '0')
        for actual, observed, expected, connections in [
            (PRISTINE, comment, comment, '0'), ('ir35_p5_app', comment, comment, '0'),
            (target, 'other-owner', comment, '0'), (target, comment, 'other-owner', '0'),
            (target, comment, comment, '1')]:
            with self.assertRaises(config.ConfigError):
                config.assert_owned_database(PRISTINE, actual, observed, expected, connections)

    def test_names_and_environment_paths_are_fixed_not_caller_selected(self):
        self.assertEqual(config.container_name('kong'), 'ir35-p8-webqa01-kong')
        self.assertEqual(config.container_name('templates'), config.TEMPLATE_HOST)
        for bad in ('../web', 'db', 'caddy', 'auth\n'):
            with self.assertRaises(config.ConfigError): config.container_name(bad)
            with self.assertRaises(config.ConfigError): config.environment_path(bad)

    def test_native_source_package_and_post_containment_must_all_match(self):
        self.assertEqual(config.image_pair(native_proof()), images())
        for key, value in [('status', 'FAIL'), ('sourceSHA', 'f' * 40), ('runtimeDeployed', True), ('newSecrets', 1)]:
            proof = native_proof(); proof[key] = value
            with self.assertRaises(config.ConfigError): config.image_pair(proof)
        for kind in ('web', 'worker'):
            for key, value in [('architecture', 'linux/amd64'), ('nonroot', False), ('networkNoneProbe', False),
                               ('sourceSHA', 'f' * 40), ('image', 'floating:latest'), ('probe', {})]:
                proof = native_proof(); proof[kind][key] = value
                with self.assertRaises(config.ConfigError): config.image_pair(proof)

    def test_actual_sealed_public_native_result_is_compatible_not_a_second_build(self):
        root = Path(config.__file__).resolve().parents[2]
        proof = json.loads((root / 'docs/evidence/p8/native-webmock-images-01/native-result.json').read_bytes())
        value = config.image_pair(proof)
        self.assertEqual(value['sourceSHA'], config.BUILD_SHA)
        self.assertEqual(value['web'], 'sha256:a0bfd695b40349c444297d86dfb5afe7d0fdde7c0aa84378ec1a791a299eff39')
        self.assertEqual(value['worker'], 'sha256:86e5c87ae8c4cac8ea372c52596fb7b156d320cebe3585182cb50689d1530ea0')

    def test_private_database_host_role_port_and_original_path_are_exact(self):
        target = config.database_name(PRISTINE)
        self.assertTrue(config.private_database_uri(uri('authenticator'), target, 'authenticator').endswith('/' + target))
        for value in (uri('authenticator').replace('@db:', '@production.example:'),
                      uri('authenticator').replace(':5432/', ':6543/'), uri('postgres'),
                      uri('authenticator', 'ir35_p5_app'), uri('authenticator') + '?host=production.example',
                      uri('authenticator') + '\n'):
            with self.assertRaises(config.ConfigError) as error:
                config.private_database_uri(value, target, 'authenticator')
            self.assertNotIn(FIXTURE_PASSWORD, str(error.exception))
            self.assertNotIn('production.example', str(error.exception))

    def test_queue_credentials_stay_queue_only_and_cannot_be_swapped(self):
        value = config.environments(*inputs())
        self.assertEqual(value['web']['PG_BOSS_DATABASE_URL'], uri('ir35_queue_producer'))
        self.assertEqual(value['worker']['PG_BOSS_DATABASE_URL'], uri('ir35_queue'))
        self.assertTrue(value['web']['PG_BOSS_DATABASE_URL'].endswith('/postgres'))
        swapped = inputs(); swapped[4], swapped[5] = swapped[5], swapped[4]
        with self.assertRaises(config.ConfigError): config.environments(*swapped)

    def test_derived_environments_are_independent_and_do_not_inherit_provider_or_owner_secrets(self):
        arguments = inputs(); before = copy.deepcopy(arguments); value = config.environments(*arguments)
        self.assertEqual(arguments, before)
        worker = value['worker']; web = value['web']
        for forbidden in ('SUPABASE_SECRET_KEY', 'SERVICE_ROLE_KEY', 'JWT_SECRET', 'NEXT_PUBLIC_SUPABASE_ANON_KEY',
                          'PG_BOSS_PRODUCER_DATABASE_URL', 'STRIPE_SECRET_KEY', 'CRON_SECRET'):
            self.assertNotIn(forbidden, worker)
        for env in (web, worker):
            self.assertEqual(env['APPLY_RUNNER'], 'mock'); self.assertEqual(env['APPLICATION_WORKER_ACCEPT_JOBS'], 'false')
            self.assertEqual(env['APPLICATION_WORKER_CONCURRENCY'], '1')
            self.assertEqual(env['APPLICATION_WORKER_SECRET'], before[3]['APPLICATION_WORKER_SECRET'])
            self.assertNotIn('STRIPE_SECRET_KEY', env); self.assertNotIn('CRON_SECRET', env)
        self.assertEqual(web['SUPABASE_INTERNAL_URL'], 'http://ir35-p8-webqa01-kong:8000')
        self.assertEqual(worker['IR35_MOCK_WEB_INTERNAL_VHOST'], 'staging.ir35careers.com')
        self.assertEqual(worker['IR35_MOCK_WEB_INTERNAL_HOST'], 'ir35-p8-webqa01-web')

    def test_named_mock_job_ids_are_six_valid_unique_identifiers_with_no_employer_payload(self):
        import uuid
        value = config.environments(*inputs())['worker']
        self.assertEqual(len(set(config.JOBS)), 6)
        self.assertTrue(all(str(uuid.UUID(item)) == item for item in config.JOBS))
        self.assertEqual(value['IR35_MOCK_WEB_JOB_IDS'], ','.join(config.JOBS))
        self.assertFalse(any('employer' in key.lower() or 'email' in key.lower() for key in value))

    def test_source_mapped_auth_keeps_private_sink_and_disables_external_providers(self):
        value = config.environments(*inputs())
        self.assertEqual(value['auth']['GOTRUE_SMTP_HOST'], 'ir35-p8-webqa01-smtp')
        for key, bad in [('GOTRUE_SMTP_HOST', 'smtp.real.example'), ('GOTRUE_SMTP_PORT', '587'),
                         ('GOTRUE_SMTP_PASS', 'fixture-never-copy'), ('GOTRUE_EXTERNAL_GOOGLE_ENABLED', 'true'),
                         ('GOTRUE_EXTERNAL_GOOGLE_SECRET', 'fixture-never-copy')]:
            arguments = inputs(); arguments[1][key] = bad
            with self.assertRaises(config.ConfigError) as error: config.environments(*arguments)
            self.assertNotIn(bad, str(error.exception))

    def test_storage_keeps_exact_migration_history_and_no_background_lifecycle(self):
        value = config.environments(*inputs())['storage']
        self.assertEqual(value['DB_MIGRATIONS_FREEZE_AT'], 'last-source-migration')
        for key in ('DB_ALLOW_MIGRATION_REFRESH', 'DB_INSTALL_ROLES', 'PG_QUEUE_ENABLE', 'PG_QUEUE_WORKERS_ENABLE', 'STORAGE_LIFECYCLE_ENABLED'):
            self.assertEqual(value[key], 'false')
        self.assertEqual(value['POSTGREST_URL'], 'http://ir35-p8-webqa01-rest:3000')
        bad = pins(); bad['storage']['image'] = 'supabase/storage-api:newer@sha256:' + 'f' * 64
        with self.assertRaises(config.ConfigError): config.compose(images(), bad)

    def test_gateway_preserves_consumers_and_acl_plugins_and_uses_only_own_backend(self):
        from staging_stack import kong_config
        original = kong_config('fixture-public-anon', 'fixture-staging-service')
        before = copy.deepcopy(original); actual = config.gateway(original)
        self.assertEqual(original, before)
        for key in ('consumers', 'acls', '_format_version', '_transform'):
            self.assertEqual(original[key], actual[key])
        self.assertEqual(len(actual['services']), 7)
        for service in actual['services']:
            previous = next(item for item in original['services'] if item['name'] == service['name'])
            self.assertEqual(service['plugins'], previous['plugins'])
            self.assertEqual(service['routes'], previous['routes'])
            self.assertTrue(service['url'].startswith('http://ir35-p8-webqa01-'))
            self.assertNotIn('ir35-p5-', service['url'])
        for mutation in ('old-upstream', 'unknown-admin', 'duplicate', 'missing'):
            value = copy.deepcopy(original)
            if mutation == 'old-upstream': value['services'][0]['url'] = 'http://ir35-p5-auth:9999/'
            if mutation == 'unknown-admin': value['services'].append({'name': 'studio-admin'})
            if mutation == 'duplicate': value['services'].append(copy.deepcopy(value['services'][0]))
            if mutation == 'missing': value['services'].pop()
            with self.assertRaises(config.ConfigError): config.gateway(value)

    def test_compose_is_private_unprivileged_limited_and_has_no_publication_or_shared_alias(self):
        value = config.compose(images(), pins())
        self.assertEqual(value['networks'], {'backend': {'external': True, 'name': 'ir35-staging_backend'}})
        self.assertEqual(value['name'], config.PROJECT)
        for name, service in value['services'].items():
            self.assertEqual(service['container_name'], config.container_name(name))
            self.assertEqual(service['user'], '1002:1002'); self.assertTrue(service['read_only'])
            self.assertEqual(service['restart'], 'no'); self.assertEqual(service['logging'], {'driver': 'none'})
            self.assertEqual(service['mem_limit'], str(config.LIMITS[name]) + 'm')
            self.assertEqual(service['networks'], ['backend']); self.assertEqual(service['cap_drop'], ['ALL'])
            for forbidden in ('ports', 'privileged', 'network_mode', 'build', 'env_file'):
                if name == 'auth' and forbidden == 'env_file': continue
                self.assertNotIn(forbidden, service)
            self.assertNotIn('/var/run/docker.sock', json.dumps(service))
            self.assertNotIn('/opt/ir35/data/caddy', json.dumps(service))
        self.assertEqual(value['services']['worker']['profiles'], ['mock-worker'])
        self.assertIn('services/application-worker/mock-web-main.ts', value['services']['worker']['command'])
        self.assertNotIn('mock-main.ts', ' '.join(value['services']['worker']['command']))
        self.assertEqual(value['services']['auth']['command'], ['auth', 'serve'])
        self.assertEqual(value['services']['auth']['env_file'], [{'path': config.environment_path('subjects'), 'required': True, 'format': 'raw'}])

    def test_plan_does_not_run_setup_create_roles_restart_or_write_private_files(self):
        source = inspect.getsource(config)
        for forbidden in ('subprocess.', 'os.open(', 'write_text(', 'write_bytes(', 'CREATE ROLE', 'ALTER ROLE',
                          'CREATE DATABASE', 'setupWebMockQueue(', 'runWebMockWorker(', 'print('):
            self.assertNotIn(forbidden, source)
