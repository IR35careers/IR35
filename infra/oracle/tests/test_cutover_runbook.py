"""Documentation safety contracts, NOT an end-to-end cutover rehearsal."""
from pathlib import Path
import unittest


class CutoverRunbookTests(unittest.TestCase):
    root=Path(__file__).resolve().parents[3]
    def test_runbook_does_not_claim_unimplemented_rollback_or_missing_proofs(self):
        text=(self.root/'docs/cutover.md').read_text(encoding='utf-8')
        for required in ('DRAFT / NO-GO / PREPARATION ONLY','Exact **YES CUTOVER** is absent',
                'P9\'s real staging dry-run is NOT complete','scripts/reverse-sync.sh` is absent',
                'There is no working one-command production rollback to claim now','No cloud write is authorised'):
            self.assertIn(required,text)
    def test_all_four_dns_hosts_full_writer_freeze_and_verification_remain_required(self):
        text=(self.root/'docs/cutover.md').read_text(encoding='utf-8')
        for name in ('@','www','api','admin'):
            self.assertIn('| `'+name+'` | A |132.145.28.134|300|',text)
        for required in ('old tabs/SDKs','GoTrue/PostgREST/Storage/Realtime','2min','WAL','deletion ledger',
                '552','73','ordered','MD5','last_value/is_called','14days','48h','<30min','<15min'):
            self.assertIn(required,text)
    def test_manual_google_plan_preserves_cloud_rollback_and_admin_origin(self):
        text=(self.root/'docs/oracle-oauth-redirect-plan.md').read_text(encoding='utf-8')
        for required in ('https://admin.ir35careers.com','https://api.ir35careers.com/auth/v1/callback',
                'https://api-staging.ir35careers.com/auth/v1/callback','https://kxcbgflleqnjzjbkevwd.supabase.co/auth/v1/callback',
                'not a claim of a real Google login','hashed-nonce'):
            # Markdown emphasis is presentation only.
            self.assertIn(required,text.replace('**',''))

    def test_fresh_scoped_proofs_never_replace_upgrade_backup_or_release_gates(self):
        text=(self.root/'docs/cutover.md').read_text(encoding='utf-8')
        for required in ('10columns/10functions absent','separately owned upgraded-clone QA',
                '148stagingGETall200','0volume backups','laggingGBP0','0alarms',
                'ALL11hosted checks passed on exact source6c3c372','not deployed',
                'No025 migration on pristine/P5/cloud','NOT another action requested now'):
            self.assertIn(required,text)
        gates=(self.root/'docs/oracle-owner-runtime-gates.md').read_text(encoding='utf-8')
        self.assertIn('ONLY two decisions',gates)
        self.assertIn('No age-key/IAM approval is inferred from Signed in',gates)
        self.assertIn('managed Cloud Storage zero-loss reverse-path gap',gates)

    def test_postgres_1711_checklist_is_exact_prep_only_and_has_a_local_plan(self):
        text=(self.root/'docs/cutover.md').read_text(encoding='utf-8')
        plan=(self.root/'docs/oracle-postgres-minor-upgrade-plan.md').read_text(encoding='utf-8')
        expected=[line for line in plan.splitlines() if line.startswith('- [ ] ')]
        section=text.split('### 4a. PostgreSQL 17.11 readiness',1)[1].split('## 5.',1)[0]
        actual=[line for line in section.splitlines() if line.startswith('- [ ] ')]
        self.assertEqual(len(expected),5)
        self.assertEqual(actual,expected)
        for required in ('No17.11 image has been selected or pulled',
                'no database update has occurred','These boxes remain unchecked',
                '(oracle-postgres-minor-upgrade-plan.md)'):
            self.assertIn(required,section)
        for required in ('UNSELECTED / UNVERIFIED','170011','No image was pulled',
                'No automatic `ALTER EXTENSION UPDATE`','62','552','73',
                'password manager or on a USB drive','YES CUTOVER'):
            self.assertIn(required,plan)


if __name__=='__main__':unittest.main()
