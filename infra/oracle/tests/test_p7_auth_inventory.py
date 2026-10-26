import inspect
import json
from pathlib import Path
import sys
import unittest
from tempfile import TemporaryDirectory
from unittest.mock import Mock,patch
from contextlib import redirect_stdout
from io import StringIO
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import p7_auth_inventory as inventory
import p6_context
import p6_resume
from offline_bundle_fixture import public_bootstrap


class AuthInventoryTests(unittest.TestCase):
    def test_payload_binding_never_rewrites_database_identifiers_or_inserted_strings(self):
        program="\ndata=DATA\nkey='GOTRUE_DB_DATABASE_URL'\n"
        value={'fixture':'DATA / DATABASE / GOTRUE_DB_DATABASE_URL'}
        generated=inventory.bind_data(program,value);namespace={}
        exec(compile(generated,'<public-fixture>','exec'),namespace)
        self.assertEqual(namespace['data'],value);self.assertEqual(namespace['key'],'GOTRUE_DB_DATABASE_URL')
        with self.assertRaisesRegex(RuntimeError,'SingleExplicit'):inventory.bind_data(program+program,value)
    def test_actual_complete_inventory_program_compiles_offline_before_remote_call(self):
        journal=Mock();journal.seal.return_value='a'*64
        journal.step.side_effect=lambda number,name,action:action()
        def remote(code,timeout):
            compile(code,'<actual-inventory-public-fixture>','exec')
            self.assertIn("config.get('GOTRUE_DB_DATABASE_URL','')",code)
            self.assertIn("'GET','/supabase/auth/v1/settings'",code)
            return {'status':'PASS','ownerGate':'G3'}
        with public_bootstrap(),patch.object(inventory,'context',return_value={'fixture':'DATABASE'}),\
                patch.object(inventory,'phase_journal',return_value=journal),patch.object(Path,'exists',return_value=False),\
                patch.object(inventory.schema,'run_guest',side_effect=remote) as dispatch,\
                patch.object(sys,'argv',['inventory','--read-only']),redirect_stdout(StringIO()):
            inventory.main()
        dispatch.assert_called_once()
    def test_absent_phase_parent_created_before_exclusive_journal_and_duplicate_write_refused(self):
        with TemporaryDirectory() as temporary:
            repo=Path(temporary);(repo/'docs/evidence').mkdir(parents=True)
            self.assertFalse((repo/'docs/evidence/p7').exists())
            journal=inventory.phase_journal(repo)
            self.assertTrue(journal.root.is_dir())
            journal.put('first.json',{'status':'FAIL','retained':True})
            before=(journal.root/'first.json').read_bytes()
            with self.assertRaises(FileExistsError):journal.put('first.json',{'status':'PASS'})
            self.assertEqual((journal.root/'first.json').read_bytes(),before)
    def test_existing_failed_slot_is_never_overwritten_or_reused(self):
        with TemporaryDirectory() as temporary:
            repo=Path(temporary);slot=repo/'docs/evidence/p7/auth-inventory-01';slot.mkdir(parents=True)
            failed=slot/'failure.json';failed.write_bytes(b'{"status":"FAIL"}')
            before=failed.read_bytes()
            with self.assertRaisesRegex(RuntimeError,'AlreadyRecorded_NoOverwrite'):inventory.phase_journal(repo)
            self.assertEqual(failed.read_bytes(),before);self.assertEqual(list(slot.iterdir()),[failed])
    def test_phase_parent_symlink_or_file_fails_before_any_slot(self):
        with TemporaryDirectory() as temporary:
            repo=Path(temporary);evidence=repo/'docs/evidence';evidence.mkdir(parents=True)
            parent=evidence/'p7';parent.write_bytes(b'not-directory')
            with self.assertRaisesRegex(RuntimeError,'ControlledP7EvidenceParentRequired'):inventory.phase_journal(repo)
            self.assertEqual(parent.read_bytes(),b'not-directory')
        with TemporaryDirectory() as temporary:
            repo=Path(temporary);evidence=repo/'docs/evidence';evidence.mkdir(parents=True)
            other=repo/'other';other.mkdir();(evidence/'p7').symlink_to(other,target_is_directory=True)
            with self.assertRaisesRegex(RuntimeError,'ControlledP7EvidenceParentRequired'):inventory.phase_journal(repo)
            self.assertEqual(list(other.iterdir()),[])
    def test_projection_never_emits_values_or_invents_source_parity(self):
        private='never-publish-this-private-fixture'
        config={key:private for key in ('GOTRUE_JWT_SECRET','GOTRUE_SMTP_PASS','GOTRUE_EXTERNAL_GOOGLE_SECRET',
            'GOTRUE_MAILER_TEMPLATES_CONFIRMATION','GOTRUE_MAILER_SUBJECTS_CONFIRMATION')}
        result=inventory.project(config,{'external':{'email':True},'mailer_autoconfirm':False})
        self.assertNotIn(private,json.dumps(result));self.assertFalse(result['sourceParityProven'])
        self.assertTrue(result['templates']['CONFIRMATION']['templateConfigured'])
        self.assertFalse(result['smtpSink']);self.assertFalse(result['googleEnabled'])
    def test_readonly_inventory_cannot_dispatch_send_mail_or_configure_provider(self):
        source=inspect.getsource(inventory.main)
        for forbidden in ('/token?','/recover','/otp','systemctl','docker restart','write_text','put_file'):
            self.assertNotIn(forbidden,source)
        self.assertIn("'GET','/supabase/auth/v1/settings'",source)
        self.assertIn('containment(data,runtime',source)
        self.assertIn("'ownerGate':'G3'",source)
    def test_shared_evidence_readers_do_not_weaken_original_mutation_branch_guard(self):
        source=inspect.getsource(p6_context.context)
        self.assertIn('codex/oracle-migration-p6',source)
        self.assertIn('CommittedCleanP6SourceRequired',source)
        self.assertLess(source.index('P6BranchRequired'),source.index('return read_evidence()'))
        reader=inspect.getsource(p6_resume.evidence_context)
        self.assertNotIn('run_guest',reader);self.assertNotIn('subprocess.run',reader)


if __name__=='__main__':unittest.main()
