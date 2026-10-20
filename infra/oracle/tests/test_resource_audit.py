import json
import os
from pathlib import Path
import subprocess
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import resource_audit as audit
from key_ceremony import KeySafetyError

PROFILE = {"tenancy": "ocid1.tenancy.oc1..controlledfixture01", "user": "ocid1.user.oc1..controlledfixture01",
           "region": "uk-london-1", "fingerprint": "00:" * 15 + "00", "key_file": "/mock/encrypted.pem"}
COMPARTMENT = "ocid1.compartment.oc1..controlledfixture01"
BUDGET = "ocid1.budget.oc1..controlledfixture01"
DOMAINS = ["mock:UK-LONDON-1-AD-" + str(index) for index in (1, 2, 3)]
ACCOUNT = {"checkedAt": "2026-10-20T00:00:00+00:00", "signedTenancyMatch": True, "activeUserMatch": True,
           "auth": "security_token",
           "homeRegion": "uk-london-1", "regionStatus": "READY", "registeredApiKeys": 3,
           "newPublicKeyRegistered": True, "newPublicKeyState": "ACTIVE", "oldPublicKeyStillRegistered": True,
           "newKeyEncryptedRoundTrip": True, "subscriptions": [{"state": "ACTIVE", "paymentModel": "FREE_TRIAL"}]}


class FixtureClient:
    def __init__(self, overrides=None):
        self.compartments = {PROFILE["tenancy"]}
        self.domains = set()
        self.buckets = set()
        self.budgets = set()
        self.calls = []
        self.overrides = overrides or {}

    def read(self, operation, **selectors):
        self.calls.append((operation, selectors))
        if operation in self.overrides:
            value = self.overrides[operation]
            return value(selectors) if callable(value) else value
        values = {
            "compartments": [{"id": COMPARTMENT, "lifecycle-state": "ACTIVE", "description": "secret-sentinel"}],
            "domains": [{"name": name} for name in DOMAINS],
            "namespace": "controlledfixture",
            "instances": [], "volumes": [], "bootVolumes": [], "bootBackups": [], "blockBackups": [],
            "vcns": [], "quotas": [], "buckets": [], "a1Availability": {"available": 41, "used": 0},
            "images": [{"display-name": "Canonical-Ubuntu-24.04-aarch64-2026.09.18-0", "operating-system": "Canonical Ubuntu",
                        "operating-system-version": "24.04", "lifecycle-state": "AVAILABLE", "metadata": "secret-sentinel"}],
            "budgets": [{"id": BUDGET, "display-name": "ir35careers-free-tier-gbp1", "lifecycle-state": "ACTIVE", "amount": 1,
                         "description": "secret-sentinel"}],
            "budgetAlerts": [{"display-name": "ir35careers-gbp1-actual", "lifecycle-state": "ACTIVE", "type": "ACTUAL",
                              "threshold-type": "PERCENTAGE", "threshold": 100, "recipients": "info@ir35careers.com"}],
            "costSummary": {"items": []},
        }
        return values[operation]


class ResourceAuditTests(unittest.TestCase):
    def client(self):
        client = audit.ReadOnlyOci(PROFILE)
        self.session = patch.object(audit, "ensure_session", return_value=PROFILE)
        self.session.start()
        self.addCleanup(self.session.stop)
        client.domains.update(DOMAINS)
        client.compartments.add(COMPARTMENT)
        client.namespace = "controlledfixture"
        client.buckets.add("controlled-bucket")
        client.budgets.add(BUDGET)
        return client

    def test_scope_has_no_mutating_or_generic_command_escape(self):
        client = self.client()
        with patch.object(audit.subprocess, "run") as run:
            for operation in ("create", "launch", "update", "delete", "raw-request", "run", "iam user create"):
                with self.assertRaises(KeySafetyError):
                    client.read(operation)
            for operation, selectors in (("instances", {"compartment": "--debug"}),
                                         ("instances", {"endpoint": "mock.invalid"}),
                                         ("bootVolumes", {"ad": "mock:OTHER-AD-1"}),
                                         ("a1Availability", {"ad": DOMAINS[0], "limit": "--debug"}),
                                         ("bucket", {"bucket": "unknown-bucket"}),
                                         ("budgetAlerts", {"budget": "ocid1.budget.oc1..unknownfixture01"})):
                with self.assertRaises(KeySafetyError):
                    client.read(operation, **selectors)
            run.assert_not_called()

    def test_verified_cli_names_and_complete_pagination_flags(self):
        client = self.client()
        self.assertEqual(client.arguments("budgets")[:5], ["budgets", "budget", "budget", "list", "--compartment-id"])
        self.assertIn("ALL", client.arguments("budgets"))
        self.assertEqual(client.arguments("budgetAlerts", budget=BUDGET)[:4], ["budgets", "budget", "alert-rule", "list"])
        for operation in ("compartments", "domains", "instances", "volumes", "bootBackups", "blockBackups", "vcns", "quotas", "images", "budgets"):
            self.assertIn("--all", client.arguments(operation))
        self.assertIn("--all", client.arguments("bootVolumes", compartment=COMPARTMENT, ad=DOMAINS[0]))
        self.assertIn("--all", client.arguments("buckets", compartment=COMPARTMENT))
        self.assertIn("--fields", client.arguments("bucket", bucket="controlled-bucket"))

    def test_cli_no_retry_bounded_redacted_security_token_only(self):
        client = self.client()
        secret = "mock-credential-never-write"
        result = subprocess.CompletedProcess([], 0, '{"data":[]}', "")
        with patch.dict(os.environ, {"OCI_CLI_DEBUG": "true"}), patch.object(audit.subprocess, "run", return_value=result) as run:
            self.assertEqual(client.read("instances"), [])
            args, options = run.call_args
            self.assertNotIn(secret, " ".join(args[0]))
            self.assertIn("--no-retry", args[0])
            self.assertIn("security_token", args[0])
            self.assertEqual(args[0][args[0].index("--profile") + 1], "ir35")
            self.assertEqual(options["timeout"], 65)
            self.assertEqual({key for key in options["env"] if key.startswith("OCI_")}, set())
        result = subprocess.CompletedProcess([], 1, secret, '{"code":"NotAuthenticated","status":401,"message":"' + secret + '"}')
        with patch.object(audit.subprocess, "run", return_value=result):
            with self.assertRaises(KeySafetyError) as error:
                client.read("instances")
            self.assertIn("operation=instances; code=NotAuthenticated; status=401", str(error.exception))
            self.assertNotIn(secret, str(error.exception))

    def test_partial_or_invalid_provider_data_never_becomes_an_empty_inventory(self):
        client = self.client()
        for stdout in ('{"message":"secret-sentinel"}', 'secret-sentinel', '{"data":{"items":[]},"opc-next-page":"next"}'):
            with patch.object(audit.subprocess, "run", return_value=subprocess.CompletedProcess([], 0, stdout, "")):
                with self.assertRaises(KeySafetyError) as error:
                    client.read("costSummary")
                self.assertNotIn("secret-sentinel", str(error.exception))
        with patch.object(audit.subprocess, "run", return_value=subprocess.CompletedProcess([], 0, "", "")):
            self.assertEqual(client.read("instances"), [])
            for operation in ("namespace", "costSummary", "a1Availability"):
                with self.assertRaises(KeySafetyError):
                    client.read(operation)
        for bad in (True, None, "NaN", "Infinity", -1, {"secret": "sentinel"}):
            with self.assertRaises(KeySafetyError):
                audit.number(bad)

    def test_all_compartments_and_ads_counted_without_provider_metadata_leak(self):
        fixture = FixtureClient()
        report = audit.inventory(fixture, ACCOUNT)
        self.assertEqual(report["compartmentsInspected"], 2)
        self.assertEqual(len([call for call in fixture.calls if call[0] == "bootVolumes"]), 6)
        for operation in ("instances", "volumes", "bootBackups", "blockBackups", "vcns", "quotas", "buckets"):
            self.assertEqual(len([call for call in fixture.calls if call[0] == operation]), 2)
        self.assertEqual(len([call for call in fixture.calls if call[0] == "a1Availability"]), 6)
        self.assertEqual(report["freeTierCreateGate"], "NOT_PASSED")
        self.assertFalse(report["costReport"]["realTimeZeroBillProven"])
        self.assertNotIn("secret-sentinel", json.dumps(report))
        self.assertNotIn("ocid1", json.dumps(report))
        self.assertEqual(report["infrastructureCreates"], 0)

    def test_nonterminated_allocations_count_even_stopped_or_terminating(self):
        fixture = FixtureClient({"instances": lambda selectors: [{"lifecycle-state": "STOPPED", "shape": audit.SHAPE,
                                  "shape-config": {"ocpus": 1, "memory-in-gbs": 6}}] if selectors["compartment"] == COMPARTMENT else [],
                                 "volumes": lambda selectors: [{"lifecycle-state": "TERMINATING", "size-in-gbs": 100}]
                                 if selectors["compartment"] == COMPARTMENT else []})
        report = audit.inventory(fixture, ACCOUNT)
        self.assertEqual(report["usage"]["instances"], 1)
        self.assertEqual(report["usage"]["a1Ocpus"], "1")
        self.assertEqual(report["usage"]["a1MemoryGB"], "6")
        self.assertEqual(report["usage"]["liveVolumeGB"], "100")

    def test_incomplete_lifecycle_architecture_account_or_budget_is_hard_stop(self):
        for overrides in ({"instances": [{}]}, {"images": []}, {"budgets": []}, {"budgetAlerts": []},
                          {"domains": [{"name": DOMAINS[0]}] * 3}, {"volumes": [{"lifecycle-state": "AVAILABLE"}]},
                          {"costSummary": {"items": [], "next-page": "next"}}):
            with self.assertRaises(KeySafetyError):
                audit.inventory(FixtureClient(overrides), ACCOUNT)
        for patch_values in ({"auth": "api_key"}, {"homeRegion": "other"}, {"subscriptions": []}):
            fixture = FixtureClient()
            with self.assertRaises(KeySafetyError):
                audit.inventory(fixture, {**ACCOUNT, **patch_values})
            self.assertEqual(fixture.calls, [])

    def test_credits_do_not_hide_positive_cost_and_buckets_remain_approximate(self):
        fixture = FixtureClient({"costSummary": {"items": [{"currency": "GBP", "computed-amount": "1.60"},
                                                            {"currency": "GBP", "computed-amount": "-1.60"}]},
                                 "buckets": lambda selectors: [{"name": "private-bucket-not-for-public-report"}]
                                 if selectors["compartment"] == COMPARTMENT else [],
                                 "bucket": {"approximate-size": 1234, "approximate-count": 2, "metadata": "secret-sentinel"}})
        report = audit.inventory(fixture, ACCOUNT)
        self.assertEqual(report["costReport"]["amounts"]["GBP"], {"net": "0.00", "positive": "1.60"})
        self.assertFalse(report["objectStorage"]["exactBytesProven"])
        self.assertNotIn("private-bucket-not-for-public-report", json.dumps(report))
        self.assertNotIn("secret-sentinel", json.dumps(report))


if __name__ == "__main__":
    unittest.main()
