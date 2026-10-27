"""Public subprocess fixtures only: NOT real encryption or migration proof."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import backup_stream as backup


class BackupStreamTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.root=Path(self.tmp.name);self.root.chmod(0o700)
        self.recipient=self.root/'public-recipient.txt'
        # Shape fixture; not a real recipient and never used with real age/data.
        self.recipient.write_text('age1'+'q'*58+'\n');self.recipient.chmod(0o600)
        self.fake=self.root/'fake_age.py'
        self.fake.write_text("import sys\nsys.stdout.buffer.write(b'age-encryption.org/v1\\nPUBLIC-FIXTURE-NOT-ENCRYPTION\\n'+sys.stdin.buffer.read())\n")
        self.fix=patch.object(backup,'AGE',(sys.executable,str(self.fake)));self.fix.start();self.addCleanup(self.fix.stop)
    def test_staging_dump_commands_preserve_owners_acls_all_schemas_and_globals(self):
        for part in ('database','queue'):
            args=backup.commands(part,snapshot='00000004-000000B1-1')[0]
            self.assertIn('--snapshot=00000004-000000B1-1',args)
            for forbidden in ('--no-owner','--no-acl','--data-only','--exclude-table'):
                self.assertNotIn(forbidden,args)
        self.assertIn('--globals-only',backup.commands('globals')[0])
        self.assertIn('/opt/ir35/data/p5-storage',backup.commands('storage')[0])
        for part in backup.PARTS:
            for row in backup.commands(part,snapshot='00000004-000000B1-1' if part in ('database','queue')else None):
                self.assertNotIn('/opt/ir35/data/caddy',row)
        with self.assertRaises(ValueError):backup.commands('database',snapshot='postgres://password-sentinel@host/db')
    def test_private_verification_is_stdin_only_and_ciphertext_slot_is_write_once(self):
        destination=self.root/'verification.age'
        result=backup.encrypt_part('verification',self.recipient,destination,uid=os.getuid(),input_bytes=b'PUBLIC-FIXTURE')
        self.assertEqual(result['status'],'PASS');self.assertEqual(result['plaintextFiles'],0)
        self.assertEqual(result['ciphertextSHA256'],hashlib.sha256(destination.read_bytes()).hexdigest())
        self.assertEqual(destination.stat().st_mode&0o777,0o400)
        self.assertTrue(result['childrenReaped'])
        with patch.object(subprocess,'Popen')as spawn:
            with self.assertRaises(FileExistsError):backup.encrypt_part('verification',self.recipient,destination,uid=os.getuid(),input_bytes=b'PUBLIC-FIXTURE')
            spawn.assert_not_called()
    def test_producer_failure_is_not_hidden_by_downstream_success_and_never_prints_stderr(self):
        producer=(sys.executable,'-c',"import sys;sys.stderr.write('password-sentinel');sys.exit(9)")
        with self.assertRaises(backup.BackupPipelineError)as failed:
            backup._encrypt_pipeline('database',(producer,),self.recipient,self.root/'database.age',uid=os.getuid())
        result=failed.exception.report
        self.assertEqual(result['status'],'FAIL');self.assertIn(9,result['exitCodes'])
        self.assertNotIn('password-sentinel',json.dumps(result));self.assertNotIn('password-sentinel',str(failed.exception))
        self.assertTrue(result['childrenReaped']);self.assertTrue((self.root/'database.age').exists())
    def test_timeout_kills_only_owned_process_groups_and_preserves_partial_ciphertext(self):
        producer=(sys.executable,'-c','import time;time.sleep(20)')
        with self.assertRaises(backup.BackupPipelineError)as failed:
            backup._encrypt_pipeline('queue',(producer,),self.recipient,self.root/'queue.age',uid=os.getuid(),timeout=0.1)
        self.assertEqual(failed.exception.report['code'],'BackupPipelineDeadline')
        self.assertTrue(failed.exception.report['childrenReaped'])
    def test_missing_public_key_private_identity_symlink_or_permissive_file_refused_before_spawn(self):
        self.recipient.write_text('AGE-SECRET-KEY-NOT-A-PUBLIC-RECIPIENT')
        with patch.object(subprocess,'Popen')as spawn:
            with self.assertRaises(ValueError):backup.encrypt_part('storage',self.recipient,self.root/'storage.age',uid=os.getuid())
            spawn.assert_not_called()
        self.recipient.write_text('age1'+'q'*58);self.recipient.chmod(0o644)
        with self.assertRaises(ValueError):backup.recipient_file(self.recipient,os.getuid())
        self.recipient.chmod(0o600);link=self.root/'link';link.symlink_to(self.recipient)
        with self.assertRaises(ValueError):backup.recipient_file(link,os.getuid())
    def test_zero_exit_from_premature_consumer_does_not_hide_unconsumed_verification(self):
        self.fake.write_text("import sys\nsys.stdout.buffer.write(b'age-encryption.org/v1\\nPUBLIC-FIXTURE-NOT-ENCRYPTION\\n')\n")
        with self.assertRaises(backup.BackupPipelineError)as failed:
            backup.encrypt_part('verification',self.recipient,self.root/'verification.age',uid=os.getuid(),input_bytes=b'PUBLIC'*200000)
        self.assertEqual(failed.exception.report['code'],'BackupVerificationInputIncomplete')
        self.assertTrue(failed.exception.report['childrenReaped'])
    def test_missing_age_binary_never_leaves_the_started_producer_alive(self):
        producer=(sys.executable,'-c','import time;time.sleep(20)')
        with patch.object(backup,'AGE',('/public-fixture-missing-age',)),self.assertRaises(backup.BackupPipelineError)as failed:
            backup._encrypt_pipeline('database',(producer,),self.recipient,self.root/'database.age',uid=os.getuid())
        self.assertEqual(failed.exception.report['code'],'FileNotFoundError')
        self.assertTrue(failed.exception.report['childrenReaped'])
    def test_zero_exit_invalid_ciphertext_header_is_never_a_success(self):
        self.fake.write_text("import sys\nsys.stdin.buffer.read();sys.stdout.buffer.write(b'PUBLIC-FIXTURE-NOT-AGE')\n")
        with self.assertRaises(backup.BackupPipelineError)as failed:
            backup.encrypt_part('verification',self.recipient,self.root/'verification.age',uid=os.getuid(),input_bytes=b'PUBLIC')
        self.assertEqual(failed.exception.report['code'],'AgeCiphertextHeaderRequired')
    def test_timed_out_grandchild_is_killed_even_after_its_producer_parent_exits_zero(self):
        pidfile=self.root/'public-child-pid'
        # A shell forks the public sleep fixture without two cold Python
        # imports consuming the UNCHANGED 0.2-second pipeline deadline under
        # CI load. The child still inherits both pipes and the producer's
        # process group; its parent exits zero before the cleanup under test.
        script='sleep 20 &\nchild=$!\nprintf "%s" "$child" > "$1"\nexit 0\n'
        producer=('/bin/sh','-c',script,'public-fixture',str(pidfile))
        with self.assertRaises(backup.BackupPipelineError)as failed:
            backup._encrypt_pipeline('queue',(producer,),self.recipient,self.root/'queue.age',uid=os.getuid(),timeout=0.2)
        self.assertEqual(failed.exception.report['code'],'BackupPipelineDeadline')
        self.assertEqual(failed.exception.report['exitCodes'][0],0)
        pid=int(pidfile.read_text());state='unknown'
        for unused in range(100):
            try:state=Path('/proc/'+str(pid)+'/stat').read_text().split()[2]
            except FileNotFoundError:state='gone'
            if state in ('Z','gone'):break
            time.sleep(0.01)
        self.assertIn(state,('Z','gone'))
    def test_ciphertext_budget_includes_completed_fast_pipeline_and_cannot_exceed_owner_cap(self):
        with self.assertRaises(backup.BackupPipelineError)as failed:
            backup.encrypt_part('verification',self.recipient,self.root/'verification.age',uid=os.getuid(),input_bytes=b'PUBLIC',maximum_bytes=1)
        self.assertEqual(failed.exception.report['code'],'BackupCiphertextBudgetExceeded')
        with self.assertRaises(ValueError):
            backup.encrypt_part('verification',self.recipient,self.root/'other.age',uid=os.getuid(),input_bytes=b'PUBLIC',maximum_bytes=backup.MAX_BYTES+1)


if __name__=='__main__':unittest.main()
