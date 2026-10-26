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


if __name__=='__main__':unittest.main()
