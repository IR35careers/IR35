from pathlib import Path
import sys
import unittest
import json
from unittest.mock import patch

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import storage_compat as compat


class CompatTests(unittest.TestCase):
    def test_restore_is_new_snapshot_bound_atomic_and_cannot_replay_or_change_roles(self):
        with patch.object(compat.schema,'guest_bundle',return_value=''):
            source=compat.restore_guest({'archiveSHA256':'a'*64,'sourceBundleSHA256':'b'*64})
        compile(source,'isolated-compatible-restore','exec')
        self.assertIn(compat.NAME,source)
        self.assertIn('config/p4-storage-compat.json',source)
        self.assertIn('already journalled',source)
        self.assertIn('Frozen archive hash mismatch',source)
        self.assertIn('Frozen source bundle hash mismatch',source)
        self.assertIn('--single-transaction',source)
        self.assertIn('--exit-on-error',source)
        self.assertIn('TABLES_VERIFIED',source)
        self.assertNotIn('ALTER ROLE "cli_login_postgres"',source)
        self.assertNotIn('DROP DATABASE',source)
        self.assertNotIn("'.env.p4-cycle'+str(cycle)+'-restore.log'",source)

    def test_storage_api_uses_new_namespace_and_immutable_pin_no_history_repair(self):
        image={'image':{'image':'supabase/storage-api:v1.80.2@sha256:'+'a'*64}}
        with patch.object(compat.schema,'guest_bundle',return_value=''):
            source=compat.api_guest(image,{'tables':[]})
        compile(source,'isolated-compatible-api','exec')
        self.assertIn('config/p4-storage-compat.json',source)
        self.assertNotIn('config/p4-rehearsal.json',source)
        self.assertIn('ir35-p4-compatible-storage-',source)
        self.assertIn('data/storage-compat',source)
        self.assertIn('Frozen source bundle changed',source)
        self.assertIn('default_transaction_read_only=on',source)
        self.assertIn("DB_ALLOW_MIGRATION_REFRESH='false'",source)
        self.assertNotIn('UPDATE storage.migrations',source)
        self.assertNotIn('DROP DATABASE',source)

    def test_template_drift_refuses_before_remote_execution(self):
        with self.assertRaises(ValueError):compat.replace_once('same same','same','new')
        with self.assertRaises(ValueError):compat.replace_once('other','same','new')

    def test_report_pass_label_cannot_bypass_actual_migration_hashes(self):
        rows=[{'id':0,'name':'initial','hash':'a'*40}]
        image={'migrationFixtureVerified':True,'image':{'image':'fixture'}}
        fixture={'status':'PASS','altered':[],'missing':[],'pending':[],
                 'image':image['image'],'archiveSHA256':'a'*64,
                 'migrations':[{'id':0,'name':'initial','hash':'b'*40}]}
        exported={'archiveSHA256':'a'*64,'migrations':rows}
        def read(path,*args,**kwargs):
            if path==compat.storage_release.PIN:return json.dumps(image)
            if path==compat.storage_release.FIXTURE_REPORT:return json.dumps(fixture)
            if path==compat.storage_release.SOURCE_REPORT:return json.dumps(exported)
            raise AssertionError('Unexpected path')
        with patch.object(compat,'check_reference_integrity'),patch.object(Path,'read_text',read):
            with self.assertRaisesRegex(ValueError,'do not match'):compat.gates()

    def test_integrity_hold_refuses_before_image_or_remote_work(self):
        with patch.object(Path,'exists',return_value=True),patch.object(compat.schema,'run_guest') as remote:
            with self.assertRaisesRegex(ValueError,'Source reference integrity hold'):compat.gates()
        remote.assert_not_called()


if __name__=='__main__':unittest.main()
