import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import Mock,patch

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import p4_recovery as recovery
import p4_recovery_guest as guest
from immutable_artifacts import Store


class RecoveryTests(unittest.TestCase):
    def test_module_namespaces_are_isolated_not_concatenated_task_globals(self):
        with patch.object(recovery.schema,'guest_bundle',return_value=''):
            code=recovery.guest('verify',{'runId':'p4_20261021T120000Z_12345678'})
        compile(code,'isolated-recovery','exec')
        self.assertIn('module.__dict__',code);self.assertIn('verification_namespace',code)
        self.assertNotIn('source=json.loads(bundle.read_text())',code)
        self.assertNotIn('DROP DATABASE',code)
    def test_fixed_destination_and_no_production_or_default_database_restore(self):
        runtime={'read_env':lambda:{'APPLY_RUNNER':'mock'},'verifiers':{}}
        obj=guest.Recovery({'runId':'p4_20261021T120000Z_12345678','sql':{}},runtime)
        self.assertEqual(obj.database,'ir35_p4_20261021t120000z_12345678')
        with self.assertRaisesRegex(guest.RecoveryError,'DestinationDatabaseRefused'):obj.query('SELECT 1','production')
        with self.assertRaisesRegex(guest.RecoveryError,'PriorManifest'):obj.verify_previous()
    def test_local_generated_evidence_cannot_overwrite_a_prior_report(self):
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)
            with patch.object(recovery.schema,'REPO',path),patch.object(recovery,'report_directory',return_value=path),patch.object(recovery,'state',return_value={'runId':'public-fixture'}),patch('builtins.print'):
                recovery.publish('verify',{'status':'FAIL'})
                with self.assertRaises(FileExistsError):recovery.publish('verify',{'status':'PASS'})
            self.assertEqual(json.loads((path/'verify.json').read_text())['status'],'FAIL')
    def test_owner_stdin_is_not_read_before_actual_status_gate(self):
        import sys
        stream=Mock()
        with patch.object(sys,'argv',['p4_recovery.py','--named-stdin-secret']),patch.object(sys,'stdin',stream),patch.object(recovery,'remote',return_value={'status':'FAIL'}) as remote:
            with self.assertRaisesRegex(ValueError,'no secret read'):recovery.main()
        stream.read.assert_not_called();remote.assert_called_once_with('named-status')
    def test_restore_public_projection_excludes_private_catalog_and_keeps_counts(self):
        original={'status':'RESTORED','normalization':{'ownerRepairs':51,'aclObjectsReplayed':2,'catalog':{'objects':[{'private':'not-for-Git'}]}}}
        public=recovery.public_result('restore',original)
        self.assertEqual(public['normalization'],{'ownerRepairs':51,'aclObjectsReplayed':2})
        self.assertNotIn('not-for-Git',json.dumps(public))
        self.assertIn('catalog',original['normalization'])
    def test_unpublished_verbose_report_move_preserves_bytes_before_redacted_summary(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);reports=root/'reports';private=root/'private';reports.mkdir();private.mkdir(mode=0o700)
            run='p4_20261021T120000Z_12345678'
            value={'runId':run,'stage':'02-restore','status':'RESTORED','normalization':{'ownerRepairs':51,'aclObjectsReplayed':2,'catalog':{'private':'not-for-Git'}}}
            body=json.dumps(value).encode();origin=reports/'restore.json';origin.write_bytes(body)
            with patch.object(recovery,'STATE_DIRECTORY',private),patch.object(recovery,'report_directory',return_value=reports),patch.object(recovery,'state',return_value={'runId':run}),patch('builtins.print'):
                recovery.contain_local_projection()
                with self.assertRaises(FileNotFoundError):recovery.contain_local_projection()
            archived=private/(run+'-unpublished-restore.json')
            self.assertEqual(archived.read_bytes(),body);self.assertEqual(archived.stat().st_mode&0o777,0o400)
            self.assertFalse(origin.exists());self.assertNotIn('not-for-Git',(reports/'restore-summary.json').read_text())
    def test_runtime_artifacts_checked_at_each_step_not_only_while_services_run(self):
        import inspect
        self.assertIn('check_runtime_files(name,runtime)',inspect.getsource(guest.Recovery.verify_previous))
        code=inspect.getsource(guest.Recovery.check_runtime_files)
        for check in ('st_nlink','0o600','sha256','UnmanifestedRuntimeArtifact'):self.assertIn(check,code)
    def test_revised_signoff_requires_every_gate_and_disposable_cleanup(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);obj=guest.Recovery.__new__(guest.Recovery);obj.run_root=root
            obj.payload={'anchors':{'08-synthetic-2':'fixture','11-mail-3':'fixture','07-storage-api-repair-1':'fixture'}}
            flags={'ownerRead':True,'crossOwnerDenied':True,'anonymousDenied':True}
            mail={'status':'PASS','authParity':{'everyPasswordMD5Matches':True,'usersChecked':147,'namedUserAllFieldsMatch':True,'namedIdentityAllFieldsMatch':True},
              'recovery':dict.fromkeys(('requestAccepted','sinkLinkExchanged','newRandomPasswordRAMOnly','passwordLogin','sessionRefresh','sessionUserVerified'),True)|{'rls':flags},
              'magicLink':dict.fromkeys(('requestAccepted','sinkLinkExchanged','sessionUserVerified'),True),
              'sessionRevocation':dict.fromkeys(('priorSessionRowsRemoved','oldRefreshDenied','currentRecoverySessionRetained'),True),
              'sinkRAMOnly':True,'realMailboxRequests':0,'disposableDatabaseDestroyed':True,'disposableContainersRemoved':4,'pristineDatabaseUnchanged':True,'realPasswordAttempts':0}
            values={'08-synthetic-2':dict.fromkeys(('passwordLogin','sessionRefresh','syntheticUserDeleted','pristineDatabaseUnchanged'),True)|{'status':'PASS','rls':flags},
              '11-mail-3':mail,'07-storage-api-repair-1':{'status':'PASS','fullPostAPIFidelity':'PASS','objectCount':73,'signedURLChecks':73}}
            for name,value in values.items():
                (root/name).mkdir();(root/name/'result.json').write_text(json.dumps(value))
            obj.verify_previous=Mock();obj.store=Mock(return_value=Mock());obj.seal=lambda store,stage,result:result
            obj.source=Mock(return_value={'storage':{'privateObjects':[{}]*73}})
            obj.check_database=Mock(return_value={'status':'PASS','tables':[{'name':'auth.users','rows':'147'}],
              'schema':{'exceptions':[{}]*3,'unexplainedDifferences':[]},'privileges':{'sourceEntries':552}})
            self.assertEqual(obj.revised_signoff()['status'],'PASS')
            for key in ('disposableDatabaseDestroyed','pristineDatabaseUnchanged'):
                bad=mail|{key:False};(root/'11-mail-3/result.json').write_text(json.dumps(bad))
                self.assertEqual(obj.revised_signoff()['status'],'FAIL')
    def test_write_once_log_is_closed_readonly_and_never_reopened(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);os.chmod(root,0o700);store=Store(root);stage=store.stage('02-restore')
            with store.sink(stage,'restore.log') as log:log.write(b'fixture log')
            self.assertEqual((stage/'restore.log').stat().st_mode&0o777,0o400)
            with self.assertRaises(FileExistsError):
                with store.sink(stage,'restore.log'):pass
            anchor=store.seal(stage);store.verify(stage.name,anchor);os.chmod(stage,0o700)
    def test_readonly_source_protocol_is_snapshot_bound_and_keeps_old_hold(self):
        code=Path(recovery.__file__).read_text()
        self.assertIn('pg_current_wal_lsn()',code)
        self.assertIn('snapshot.snapshot',code)
        self.assertIn('source sequence',code.lower())
        # Only the explicit byte-verified private archive move may unlink the
        # unpublished local projection. Capture/publication never remove files.
        import inspect
        self.assertNotIn('unlink(',inspect.getsource(recovery.capture))
        self.assertNotIn('unlink(',inspect.getsource(recovery.publish))
        self.assertEqual(code.count('unlink('),1)
        module=Path(guest.__file__).read_text()
        self.assertIn('os.link(origin,target,follow_symlinks=False)',module)
        self.assertIn('origin.unlink()',module)
        self.assertNotIn('os.replace(',module)
        self.assertNotIn('UPDATE auth.users',module)


if __name__=='__main__':unittest.main()
