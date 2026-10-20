from datetime import datetime, timezone
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from key_ceremony import KeySafetyError
from storage_budget import reconcile

NOW = datetime(2026, 10, 20, 12, 0, tzinfo=timezone.utc)


def fixture():
    return {"checkedAt": NOW.isoformat(), "region": "uk-london-1", "accountPaymentModel": "FREE_TRIAL",
            "usage": {"liveVolumeGB": 0, "volumeBackups": 0},
            "objectStorage": {"exactBytesProven": True, "approximateBytes": 0},
            "costReport": {"amounts": {}, "mayLag": True}}


class StorageBudgetTests(unittest.TestCase):
    def test_separate_live_backup_and_standard_trial_allowances(self):
        result = reconcile(fixture(), add_live_gb=150, add_volume_backups=5, add_object_bytes=8_000_000_000, now=NOW)
        self.assertEqual(result["storageEnvelope"], "PASS")
        self.assertEqual(result["freeLiveAllowanceGB"], 200)
        self.assertEqual(result["trialStandardFreeGB"], 10)
        self.assertFalse(result["realTimeZeroBillProven"])
        self.assertFalse(result["createAuthorised"])

    def test_aggregates_existing_allocations_not_just_new_proposal(self):
        report = fixture()
        report["usage"] = {"liveVolumeGB": 50, "volumeBackups": 5}
        for proposal in ({"add_live_gb": 101}, {"add_volume_backups": 1}, {"add_object_bytes": 8_000_000_001}):
            with self.assertRaises(KeySafetyError):
                reconcile(report, now=NOW, **proposal)

    def test_tiers_missing_stale_or_approximate_evidence_fail_closed(self):
        for tier in ("Archive", "InfrequentAccess", "AutoTiering", "standard"):
            with self.assertRaises(KeySafetyError):
                reconcile(fixture(), tier=tier, now=NOW)
        for values in ({"checkedAt": "2026-10-20T11:54:59+00:00"}, {"checkedAt": "2026-10-20T12:00:01+00:00"},
                       {"checkedAt": "2026-10-20T12:00:00"}, {"objectStorage": {"exactBytesProven": False}},
                       {"usage": {}}, {"costReport": {}}, {"region": "other"}):
            with self.assertRaises(KeySafetyError):
                reconcile({**fixture(), **values}, now=NOW)

    def test_positive_usage_is_not_cancelled_out_by_credit(self):
        report = fixture()
        report["costReport"]["amounts"] = {"GBP": {"positive": "1.60", "net": "0"}}
        with self.assertRaises(KeySafetyError):
            reconcile(report, now=NOW)
        for invalid in (True, -1, "NaN", "Infinity", None):
            with self.assertRaises(KeySafetyError):
                reconcile(fixture(), add_live_gb=invalid, now=NOW)
