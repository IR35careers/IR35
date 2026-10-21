import inspect
import ast
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import Mock,patch
import subprocess

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import p4_auth_probe as probe
import auth_redaction as safe


class ProbeTests(unittest.TestCase):
    def test_detach_cli_timeout_is_bounded_and_does_not_signal_container(self):
        process=Mock();process.wait.side_effect=[subprocess.TimeoutExpired('docker attach',2),0]
        worker=Mock();worker.is_alive.return_value=False
        result=probe.detach_observer(process,worker)
        process.terminate.assert_called_once();process.kill.assert_called_once()
        self.assertEqual(result,{'cliKillRequired':True,'containerSignalsProxied':False})
        self.assertIn("'--sig-proxy=false'",inspect.getsource(probe.PrivateStack.observe))
    def test_synthetic_and_owner_credentials_use_the_identical_boundary(self):
        path,body=probe.password_request('synthetic@invalid.test','test-fixture-only')
        self.assertEqual(path,'/auth/v1/token?grant_type=password')
        self.assertEqual(sorted(body),['email','password'])
        method=inspect.getsource(probe.PrivateStack.login)
        self.assertIn('password_request(email,password)',method)
        self.assertNotIn('raw(',method)
    def test_owner_attempt_single_use_before_post_and_no_retry(self):
        code=inspect.getsource(probe.named_login)
        self.assertLess(code.index("store.stage('10-named-login')"),code.index('stack.login('))
        self.assertEqual(code.count('stack.login('),1)
        self.assertNotIn('for attempt',code)
        self.assertIn('NamedPasswordGrantDenied_StopNoRetry',code)
        self.assertIn('pristine-post-login-fidelity.json',code)
        status=inspect.getsource(probe.named_status)
        self.assertIn('NamedAttemptAlreadyReserved_NeverReplay',status)
    def test_readiness_requires_actual_synthetic_proofs_and_retained_history(self):
        code=inspect.getsource(probe.require_synthetic)
        for check in ('passwordLogin','sessionRefresh','syntheticUserDeleted','pristineDatabaseUnchanged','crossOwnerDenied','anonymousDenied','OriginalPasswordAttemptHistoryMismatch'):
            self.assertIn(check,code)
        prepare=inspect.getsource(probe.named_ready)
        self.assertIn('stack.resume()',prepare)
        self.assertNotIn('stack.login(',prepare)
    def test_stable_owned_dns_for_restart_not_stale_container_ip(self):
        code=inspect.getsource(probe.PrivateStack.start)
        self.assertIn('self.upstream(service,port)',code)
        self.assertNotIn('self.address(service,port)',code)
    def test_correct_request_id_config_and_case_insensitive_response_header(self):
        self.assertIn('GOTRUE_API_REQUEST_ID_HEADER',inspect.getsource(probe.PrivateStack.start))
        rid='00000000-0000-0000-0000-000000000012'
        self.assertEqual(safe.response_diagnostic(400,b'{}',{'X-Request-Id':rid},rid)['requestId'],rid)
    def test_preserves_strict_native_launcher_flat_path_without_moving_host_secrets(self):
        value=probe.launcher_path('p4_20261021T120000Z_12345678','07-storage-api-repair-1','rest')
        self.assertRegex(value,r'^/opt/ir35/\.env\.[a-z0-9-]+$')
        method=inspect.getsource(probe.PrivateStack.start_service)
        self.assertIn('container_env,*pin',method)
        self.assertNotIn("pin['image'],str(env)",method)
    def test_password_even_equal_to_a_known_error_is_redacted(self):
        value={'msg':'Invalid login credentials','access':'private-fixture'}
        result=safe.redact_known_secrets(value,['Invalid login credentials','private-fixture'])
        self.assertNotIn('Invalid login credentials',json.dumps(result));self.assertNotIn('private-fixture',json.dumps(result))
    def test_synthetic_password_ram_only_and_identity_checked_cleanup(self):
        code=inspect.getsource(probe.synthetic)
        self.assertIn('secrets.token_urlsafe',code)
        self.assertIn('SyntheticCleanupIdentityMismatch',code)
        self.assertIn("method='DELETE'",code)
        self.assertIn('pristine-post-test-fidelity.json',code)
        # Admin creation necessarily sends it in RAM. No artifact writer may receive it.
        for call in (n for n in ast.walk(ast.parse(code)) if isinstance(n,ast.Call) and isinstance(n.func,ast.Attribute) and n.func.attr in ('put','sink','private_file','write_text','write_bytes')):
            self.assertFalse(any(isinstance(n,ast.Name) and n.id=='password' for n in ast.walk(call)))
        self.assertNotIn('UPDATE auth.users',code)
    def test_storage_frozen_without_ignore_force_or_schema_writes(self):
        code=inspect.getsource(probe.storage_api)
        self.assertIn('default_transaction_read_only=on',code)
        self.assertIn("DB_ALLOW_MIGRATION_REFRESH='false'",code)
        self.assertIn('post-api-fidelity.json',code)
        self.assertNotIn('SKIP_MIGRATIONS',code)


if __name__=='__main__':unittest.main()
