import copy
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from urllib.parse import urlsplit,parse_qs
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import web_fixture_guest as fixture
import web_fixture as controller
from p4_recovery_guest import RecoveryError


def components():
    return {'auth':{'GOTRUE_DB_DATABASE_URL':'postgresql://mock:fixture-only@db:5432/postgres',
                    'GOTRUE_SMTP_HOST':'smtp','GOTRUE_SMTP_PORT':'1025'},
            'rest':{'PGRST_DB_URI':'postgresql://mock:fixture-only@db:5432/postgres'},
            'storage':{'DATABASE_URL':'postgresql://mock:fixture-only@db:5432/postgres'},'kong':{}}


class WebFixtureTests(unittest.TestCase):
    def test_guest_namespaces_are_separate_and_default_dryrun_has_no_ssh(self):
        with patch.object(controller.schema,'guest_bundle',return_value=''):
            source=controller.guest({'fixture':'compile-only'})
        compile(source,'p5-fixture-bundle','exec')
        self.assertIn('module.__dict__',source)
        self.assertIn('verification_namespace',source)
        self.assertNotIn('p4_mail_probe',source)
        self.assertNotIn('DROP DATABASE',source)
        with patch.object(sys,'argv',['web_fixture.py','--dry-run']),patch.object(controller.schema,'run_guest') as remote,patch('builtins.print'):
            controller.main()
        remote.assert_not_called()

    def test_copy_keeps_caller_namespace_and_pristine_database_config_unchanged(self):
        original=components();before=copy.deepcopy(original)
        result=fixture.fixture_components({'component_env':lambda _:original},{},{'storageMigrations':[{'name':'fixture-last'}]})
        self.assertEqual(original,before)
        for service,key in [('auth','GOTRUE_DB_DATABASE_URL'),('rest','PGRST_DB_URI'),('storage','DATABASE_URL')]:
            uri=urlsplit(result[service][key])
            self.assertEqual(uri.hostname,'db');self.assertEqual(uri.port,5432)
            self.assertEqual(uri.path,'/'+fixture.TARGET)
            self.assertEqual(parse_qs(uri.query)['options'],['-c default_transaction_read_only=on'])
        self.assertEqual(result['storage']['DB_ALLOW_MIGRATION_REFRESH'],'false')
        self.assertEqual(result['storage']['DB_MIGRATIONS_FREEZE_AT'],'fixture-last')

    def test_nonprivate_database_or_real_smtp_is_refused(self):
        for scenario in ('database','mail'):
            value=components()
            if scenario=='database':value['auth']['GOTRUE_DB_DATABASE_URL']='postgresql://mock:fixture-only@public.invalid:5432/postgres'
            else:value['auth']['GOTRUE_SMTP_HOST']='real-mail.invalid'
            with self.assertRaises(RecoveryError):fixture.fixture_components({'component_env':lambda _:value},{},{'storageMigrations':[{'name':'fixture-last'}]})

    def test_app_env_preserves_mock_standby_and_disables_all_schedulers(self):
        env=fixture.app_env({'ANON_KEY':'fixture-public','SERVICE_ROLE_KEY':'fixture-private'},'a'*40,{'run':lambda _: 'fixture-random'})
        for key,value in {'APPLY_RUNNER':'mock','IR35_STAGING':'true','IR35_READ_ONLY':'true','APPLICATION_WORKER_ACCEPT_JOBS':'false',
                          'APPLICATION_WORKER_ENABLED':'false','APPLICATION_SUBMISSION_ENABLED':'false','IR35_SCHEDULER_ENABLED':'false',
                          'IR35_REALTIME_HEALTH_ENABLED':'false','IR35_WORKER_HEALTH_ENABLED':'false'}.items():self.assertEqual(env[key],value)
        self.assertFalse(any(key.startswith(('STRIPE','RESEND','OPENAI','OPENROUTER')) for key in env))
        self.assertNotIn('NEXT_PUBLIC_SUPABASE_SECRET_KEY',env)

    def test_private_file_cannot_escape_or_overwrite_existing_artifact(self):
        with tempfile.TemporaryDirectory() as directory,patch.object(fixture,'ROOT',Path(directory)):
            root=Path(directory);path=root/'.env.p5-web';path.write_bytes(b'original')
            with self.assertRaises(FileExistsError):fixture.private_new(path,b'replacement')
            self.assertEqual(path.read_bytes(),b'original')
            with self.assertRaises(RecoveryError):fixture.private_new(root/'elsewhere',b'no')


if __name__=='__main__':unittest.main()
