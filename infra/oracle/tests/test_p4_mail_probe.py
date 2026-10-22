import ast
import inspect
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import Mock

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import p4_mail_probe as probe
from p4_auth_probe import RecoveryError


class MailProbeTests(unittest.TestCase):
    def message(self,url):return {'To':[{'Address':probe.EMAIL}],'HTML':'<a href="'+url+'">Continue</a>'}
    def test_sink_link_extracts_hash_only_never_follows_redirect(self):
        token='a'*56
        value=self.message('https://api-staging.ir35careers.com/auth/v1/verify?token='+token+'&amp;type=recovery')
        self.assertEqual(probe.sink_token(value,'recovery'),token)
        self.assertNotIn('opener.open',inspect.getsource(probe.sink_token))
    def test_malicious_sink_link_origin_path_recipient_or_type_rejected(self):
        base='https://api-staging.ir35careers.com/auth/v1/verify?token='+'a'*56+'&type=recovery'
        for url in (base.replace('api-staging.ir35careers.com','production.invalid'),base.replace('/auth/v1/verify','/other'),base.replace('type=recovery','type=magiclink'),base.replace('https://','http://')):
            with self.assertRaises(RecoveryError):probe.sink_token(self.message(url),'recovery')
        value=self.message(base);value['To']=[{'Address':'someone-else@invalid.test'}]
        with self.assertRaisesRegex(RecoveryError,'RecipientMismatch'):probe.sink_token(value,'recovery')
        with self.assertRaisesRegex(RecoveryError,'LinkInvalid'):probe.sink_token(self.message(base.replace('a'*56,'a'*64)),'recovery')
    def test_real_password_not_read_new_password_stays_in_memory(self):
        code=inspect.getsource(probe.run)
        self.assertIn('secrets.token_urlsafe(48)',code)
        self.assertNotIn('stdin',code);self.assertNotIn('input(',code)
        self.assertEqual(code.count('stack.login(EMAIL,password)'),1)
        for call in (n for n in ast.walk(ast.parse(code)) if isinstance(n,ast.Call) and isinstance(n.func,ast.Attribute) and n.func.attr in ('put','sink','private_file','write_text','write_bytes')):
            self.assertFalse(any(isinstance(n,ast.Name) and n.id=='password' for n in ast.walk(call)))
    def test_sink_ephemeral_internal_only_and_no_relay_config(self):
        code=inspect.getsource(probe.MailStack.start)
        self.assertIn('--read-only',code);self.assertIn('--tmpfs',code);self.assertIn('/tmp/mailpit.db',code)
        self.assertNotIn('MP_SMTP_RELAY',code);self.assertNotIn('--publish',code)
    def test_destroy_refuses_pristine_or_unrelated_database_before_sql(self):
        recovery=Mock();recovery.payload={'mailAttempt':1}
        for target in ('postgres','production','ir35_p4_20261021t120000z_12345678','ir35_p4_20261021t120000z_12345678_named'):
            with self.assertRaisesRegex(RecoveryError,'DropTargetRefused'):
                probe.drop_fixture(recovery,target,Path('11-mail-1'),'ir35_p4_20261021t120000z_12345678')
        recovery.query.assert_not_called();recovery.command.assert_not_called()
    def test_destroy_requires_exact_owner_annotation_and_no_connections(self):
        recovery=Mock();recovery.payload={'mailAttempt':1};recovery.run_id='p4_20261021T120000Z_12345678'
        target='ir35_p4_20261021t120000z_12345678_mail1';pristine=target.removesuffix('_mail1')
        recovery.query.return_value='wrong'
        with self.assertRaisesRegex(RecoveryError,'OwnershipMismatch'):probe.drop_fixture(recovery,target,Path('11-mail-1'),pristine)
        recovery.command.assert_not_called()
        recovery.query.side_effect=['ir35-p4-mail:'+recovery.run_id+':11-mail-1','1']
        with self.assertRaisesRegex(RecoveryError,'ActiveConnections'):probe.drop_fixture(recovery,target,Path('11-mail-1'),pristine)
        recovery.command.assert_not_called()
    def test_drop_capability_only_in_explicit_disposable_mail_bundle(self):
        import p4_recovery
        from unittest.mock import patch
        with patch.object(p4_recovery.schema,'guest_bundle',return_value=''):
            self.assertNotIn('DROP DATABASE',p4_recovery.guest('verify',{}))
            self.assertIn('DROP DATABASE',p4_recovery.guest('mail-1',{}))
    def test_all_row_hash_and_identity_parity_values_not_published(self):
        self.assertIn('md5(encrypted_password)',probe.AUTH_HASH_SQL)
        self.assertIn('to_jsonb(u)',probe.ACCOUNT_SQL);self.assertIn('to_jsonb(i)',probe.ACCOUNT_SQL)
        code=inspect.getsource(probe.run)
        self.assertIn('hashValuesPrinted',code)
        self.assertIn("hashes=None;account=None",code)
        self.assertIn('OldSessionsNotRevoked_Abort',code)
        self.assertIn('OldRefreshStillAccepted_Abort',code)
        self.assertIn('pristine-after.json',code)
        self.assertIn('sharedEmailCooldownRespected',code)
        self.assertNotIn('UPDATE auth.users',code)
        self.assertNotIn('GOTRUE_SMTP_MAX_FREQUENCY',code)


if __name__=='__main__':unittest.main()
