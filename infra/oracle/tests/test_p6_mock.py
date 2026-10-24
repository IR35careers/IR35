import ast
import inspect
from pathlib import Path
import sys
import unittest
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import p6_mock_guest as mock


def config():
    return {'APPLY_RUNNER':'mock','IR35_STAGING':'true','APPLICATION_WORKER_ACCEPT_JOBS':'false',
      'APPLICATION_WORKER_CONCURRENCY':'1','IR35_READ_ONLY':'false','IR35_SCHEDULER_ENABLED':'false',
      'IR35CAREERS_APP_URL':'https://staging.ir35careers.com','QUEUE_DB_ALLOWED_HOSTS':'db','PORT':'8787',
      'APPLICATION_WORKER_SECRET':'a'*64,'IR35_BUILD_SHA':'b'*40}


class P6MockTests(unittest.TestCase):
    def test_missing_password_negative_control_has_no_secret_arguments_or_interactive_prompt(self):
        class Reply:
            returncode=2;stdout=b'';stderr=b'fe_sendauth: no password supplied'
        with patch.object(mock.subprocess,'run',return_value=Reply()) as run:
            result=mock.password_required('image','ir35_queue',Path('/opt/ir35/.env.p6-queue-owner'))
        self.assertTrue(result['passwordRequired']);self.assertFalse(result['unexpectedUnauthenticatedLogin'])
        args=run.call_args.args[0];self.assertIn('-w',args)
        self.assertIn('PGPASSWORD',args);self.assertFalse(any('PGPASSWORD=' in word for word in args))
        Reply.returncode=0;Reply.stderr=b''
        with patch.object(mock.subprocess,'run',return_value=Reply()):self.assertTrue(mock.password_required('image','ir35_queue',Path('/opt/ir35/.env.p6-queue-owner'))['unexpectedUnauthenticatedLogin'])

    def test_compose_is_native_nonroot_private_and_memory_bounded_without_secret_values(self):
        value=mock.compose('sha256:'+'a'*64);worker=value['services']['worker']
        self.assertEqual(worker['ports'],['127.0.0.1:8787:8787/tcp'])
        self.assertEqual(worker['mem_limit'],'2560m');self.assertEqual(worker['user'],'1002:1002')
        self.assertTrue(worker['read_only']);self.assertEqual(worker['restart'],'unless-stopped')
        self.assertEqual(worker['cap_drop'],['ALL']);self.assertEqual(worker['logging'],{'driver':'none'})
        self.assertEqual(value['networks'],{'backend':{'external':True,'name':'ir35-staging_backend'}})
        self.assertNotIn('environment',worker);self.assertNotIn('env_file',worker)
        self.assertFalse(any('docker.sock' in item for item in worker['volumes']))
        with self.assertRaisesRegex(RuntimeError,'ImmutableWorkerImageRequired'):mock.compose('floating:latest')

    def test_mock_environment_never_switches_real_acceptance_or_exposes_customer_services(self):
        mock.validate_config(config())
        for key,value in [('APPLY_RUNNER','oracle'),('APPLICATION_WORKER_ACCEPT_JOBS','true'),('APPLICATION_WORKER_CONCURRENCY','2'),
                          ('IR35_STAGING','false'),('IR35_SCHEDULER_ENABLED','true'),('IR35CAREERS_APP_URL','https://www.ir35careers.com')]:
            with self.assertRaises(RuntimeError,msg=key):mock.validate_config(config()|{key:value})
        for key in ('SUPABASE_SECRET_KEY','NEXT_PUBLIC_SUPABASE_URL','STRIPE_SECRET_KEY','POSTMARK_SERVER_TOKEN','GOOGLE_CLIENT_SECRET','OPENAI_API_KEY','RESEND_API_KEY'):
            with self.assertRaisesRegex(RuntimeError,'MockDirectDataOrProviderCredentialsRefused'):mock.validate_config(config()|{key:'public-fixture'})

    def test_env_creation_is_exclusive_and_only_the_two_fixed_private_paths(self):
        with self.assertRaisesRegex(RuntimeError,'FixedP6MockEnvPathRequired'):mock.private_new(Path('/tmp/unsafe'),b'fixture')
        with patch.object(mock.os,'open',side_effect=FileExistsError) as create:
            with self.assertRaises(FileExistsError):mock.private_new(Path('/opt/ir35/.env.p6-mock-worker'),b'fixture')
        self.assertTrue(create.call_args.args[1]&mock.os.O_EXCL);self.assertTrue(create.call_args.args[1]&mock.os.O_NOFOLLOW)
        self.assertEqual(create.call_args.args[2],0o600)

    def test_laptop_controller_requires_an_explicit_operation_before_private_context(self):
        import p6_mock
        with patch.object(p6_mock.sys,'argv',['p6_mock.py']),patch.object(p6_mock.p6_context,'context') as context:
            with self.assertRaisesRegex(RuntimeError,'ExplicitP6MockOperationRequired'):p6_mock.main()
        context.assert_not_called()

    def test_no_source_sql_mutation_or_old_activation_in_setup_start_helpers(self):
        tree=ast.parse(inspect.getsource(mock));queries=[]
        for node in ast.walk(tree):
            if isinstance(node,ast.Call) and isinstance(node.func,ast.Attribute) and node.func.attr=='query':
                self.assertIsInstance(node.args[0],ast.Constant)
                self.assertTrue(node.args[0].value.startswith('SELECT '));queries.append(node)
        self.assertEqual(len(queries),2)
        self.assertNotIn('sdk_owner1_guest.activate',inspect.getsource(mock))
        self.assertNotIn('systemctl enable',inspect.getsource(mock))


if __name__=='__main__':unittest.main()
