from datetime import datetime,timedelta,timezone
from pathlib import Path
import sys
import unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from backup_retention import plan,PARTS,OWNER_CAP


class RetentionTests(unittest.TestCase):
    now=datetime(2026,10,26,12,tzinfo=timezone.utc)
    def generation(self,days):
        return {'id':(self.now-timedelta(days=days)).strftime('%Y%m%dT%H%M%SZ'),'complete':True,'restoreVerified':True,
            'parts':{name:{'bytes':10,'ageEncrypted':True,'sha256Verified':True,'standardTier':True} for name in PARTS}}
    def test_seven_daily_four_weekly_are_sets_not_duplicate_uploads(self):
        generations=[self.generation(day) for day in range(40)]
        result=plan(generations,observed_total_bytes=2000,new_encrypted_bytes=50,now=self.now)
        self.assertEqual((result['dailyAvailable'],result['weeklyAvailable']),(7,4))
        self.assertTrue(set(self.generation(day)['id'] for day in range(7))<=set(result['keep']))
        self.assertLessEqual(len(result['keep']),11)
        self.assertFalse(set(result['keep'])&set(result['eligibleForPruneAfterRevalidation']))
        self.assertEqual(result['objectWrites'],0)
    def test_overlap_cannot_prune_first_or_use_estimates(self):
        for total,incoming in ((OWNER_CAP,1),(True,0),(None,0),(-1,0),(0,1.5)):
            with self.assertRaises(ValueError):plan([],observed_total_bytes=total,new_encrypted_bytes=incoming,now=self.now)
    def test_partial_unencrypted_wrong_tier_or_unverified_backup_blocks_all_pruning(self):
        for field in ('complete','restoreVerified'):
            row=self.generation(0);row[field]=False
            with self.assertRaises(ValueError):plan([row],observed_total_bytes=50,new_encrypted_bytes=0,now=self.now)
        for field in ('ageEncrypted','sha256Verified','standardTier'):
            row=self.generation(0);row['parts']['database'][field]=False
            with self.assertRaises(ValueError):plan([row],observed_total_bytes=50,new_encrypted_bytes=0,now=self.now)
    def test_missing_queue_part_duplicate_generation_and_inconsistent_inventory_stop(self):
        row=self.generation(0);del row['parts']['queue']
        for rows,total in (([row],50),([self.generation(0)]*2,100),([self.generation(0)],49)):
            with self.assertRaises(ValueError):plan(rows,observed_total_bytes=total,new_encrypted_bytes=0,now=self.now)


if __name__=='__main__':unittest.main()
