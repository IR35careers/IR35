import inspect
import builtins
import importlib
import json
from pathlib import Path
import sys
import unittest
import types
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import p7_auth_rehearsal as rehearsal
import p7_auth_rehearsal_guest as guest
from offline_bundle_fixture import public_bootstrap
from test_p7_auth_profile import fixture


class AuthRehearsalTests(unittest.TestCase):
    def test_cold_module_import_order_executes_without_repo_import_fallback_or_private_state(self):
        root=Path(rehearsal.__file__).resolve().parent
        controlled={path.stem for path in root.glob('*.py')}
        base_names=('immutable_artifacts','p4_recovery_guest','p6_restart_diagnosis_guest','p6_role_policy')
        base={name:importlib.import_module(name) for name in base_names}
        def execute(names):
            available=dict(base);real_import=builtins.__import__
            def guarded(name,globals=None,locals=None,fromlist=(),level=0):
                if name in controlled:
                    if name not in available:raise ImportError('UnbundledDependency_'+name)
                    return available[name]
                return real_import(name,globals,locals,fromlist,level)
            with public_bootstrap():
                for name in names:
                    module=types.ModuleType(name);module.__dict__['__builtins__']={**vars(builtins),'__import__':guarded}
                    available[name]=module
                    exec(compile((root/(name+'.py')).read_text(),'<public-import-fixture>','exec'),module.__dict__)
            return available
        with self.assertRaisesRegex(ImportError,'UnbundledDependency_p4_auth_probe'):
            execute(('export_auth_settings','p7_auth_profile','p4_mail_probe','p7_auth_rehearsal_guest'))
        actual=execute(rehearsal.AUTH_MODULES)
        self.assertTrue(callable(actual['p7_auth_rehearsal_guest'].run))
    def test_complete_actual_bootstrap_compiles_with_public_only_fixture(self):
        with public_bootstrap():source=rehearsal.program({'fixture':'public only'},fixture())
        compile(source,'<p7-public-fixture>','exec')
        self.assertIn('owner',source)
    def test_link_parser_uses_only_matching_sink_recipient_gateway_type_and_hash(self):
        token='a'*56;recipient='qa+signup@invalid.test'
        message={'To':[{'Address':recipient}],'HTML':'<a href="https://api-staging.ir35careers.com/auth/v1/verify?type=signup&amp;token='+token+'">Confirm</a>'}
        self.assertEqual(guest.parse_link(message,'signup',recipient),token)
        repeated=json.loads(json.dumps(message));repeated['HTML']*=4
        self.assertEqual(guest.parse_link(repeated,'signup',recipient),token)
        metadata=guest.link_metadata(repeated,'signup',recipient)
        self.assertEqual((metadata['matchingAnchorCount'],metadata['uniqueMatchingTokens']),(4,1))
        distinct=json.loads(json.dumps(message));distinct['HTML']+=message['HTML'].replace(token,'b'*56)
        with self.assertRaises(guest.RecoveryError):guest.parse_link(distinct,'signup',recipient)
        for bad in ('https://employer.invalid','https://user:pass@api-staging.ir35careers.com'):
            changed=json.loads(json.dumps(message));changed['HTML']=changed['HTML'].replace('https://api-staging.ir35careers.com',bad)
            with self.assertRaises(guest.RecoveryError):guest.parse_link(changed,'signup',recipient)
        with self.assertRaises(guest.RecoveryError):guest.parse_link(message,'recovery',recipient)
        with self.assertRaises(guest.RecoveryError):guest.parse_link(message,'signup','someone@real.invalid')
    def test_template_listener_has_no_public_port_or_credentials_and_exact_private_file(self):
        source=inspect.getsource(guest.SourceStack)
        self.assertNotIn('--publish',source);self.assertNotIn('network=host',source)
        self.assertIn("'--read-only'",source);self.assertIn("'--log-driver','none'",source)
        self.assertIn("profile.subject_env(subjects)",source)
        self.assertIn("body!=expected.encode()",source)
        self.assertNotIn('console.log',guest.TEMPLATE_SERVER)
    def test_named_password_never_used_and_cleanup_is_in_finally_with_full_containment(self):
        source=inspect.getsource(guest.run)
        self.assertIn('finally:',source);self.assertIn('destroy_clone(',source);self.assertIn('containment(data,runtime',source)
        self.assertIn('queue_clone_denials(recovery,target)',source)
        self.assertIn('clone-before.json',source)
        for forbidden in ('TRUNCATE','UPDATE pg_','ALTER POLICY','DROP ROLE','docker restart','smtp_pass'):
            self.assertNotIn(forbidden,source)
        for name in ('mail_case','signup_case','email_case'):
            self.assertNotIn('getpass',inspect.getsource(getattr(guest,name)))


if __name__=='__main__':unittest.main()
