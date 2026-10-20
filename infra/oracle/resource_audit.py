#!/usr/bin/env python3
"""P1 read-only pre-create inventory. No create/update/delete operation is exposed."""

from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
import json
import os
from pathlib import Path
import re
import resource
import subprocess
import sys

from bootstrap_audit import KEY_DIRECTORY, ocid, rows
from key_ceremony import KeySafetyError, write_new
from security_session import clean_environment, command, ensure_session


REGION = "uk-london-1"
SHAPE = "VM.Standard.A1.Flex"
AD_PATTERN = r"[A-Za-z0-9]{1,20}:UK-LONDON-1-AD-[1-3]"


def number(value):
    if isinstance(value, bool) or not isinstance(value, (int, float, str)):
        raise KeySafetyError("Incomplete numeric resource metadata; no free-tier conclusion.")
    try:
        result = Decimal(str(value))
    except InvalidOperation:
        raise KeySafetyError("Invalid numeric resource metadata; raw values suppressed.") from None
    if not result.is_finite() or result < 0:
        raise KeySafetyError("Invalid numeric resource metadata; raw values suppressed.")
    return result


def safe_name(value):
    if not isinstance(value, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.:-]{0,254}", value):
        raise KeySafetyError("Unexpected resource name; raw values suppressed.")
    return value


class ReadOnlyOci:
    """Exact operation builders, never a caller-supplied CLI argument array."""

    def __init__(self, profile):
        self.profile = profile
        self.compartments = {ocid(profile["tenancy"], "tenancy")}
        self.domains = set()
        self.namespace = None
        self.buckets = set()
        self.budgets = set()

    def arguments(self, operation, **selectors):
        # Reject unknown fields even if the named operation would not use them.
        if set(selectors) - {"compartment", "ad", "limit", "bucket", "budget", "service"}:
            raise KeySafetyError("Unsupported read selector; no OCI call.")
        compartment = selectors.get("compartment", self.profile["tenancy"])
        if compartment not in self.compartments:
            raise KeySafetyError("Resource read must use an inventoried compartment.")
        common = ["--compartment-id", compartment]
        if operation == "accountTenancy" and not selectors:
            return ["iam", "tenancy", "get", "--tenancy-id", self.profile["tenancy"]]
        if operation == "accountUser" and not selectors:
            return ["iam", "user", "get", "--user-id", self.profile["user"]]
        if operation == "accountRegions" and not selectors:
            return ["iam", "region-subscription", "list", "--tenancy-id", self.profile["tenancy"], "--all"]
        if operation == "accountSubscriptions" and not selectors:
            return ["organizations", "subscription", "list", *common, "--all"]
        if operation == "compartments" and not selectors:
            return ["iam", "compartment", "list", *common, "--compartment-id-in-subtree", "true", "--access-level", "ANY", "--all"]
        if operation == "domains" and not selectors:
            return ["iam", "availability-domain", "list", *common, "--all"]
        if operation == "quotaDefinitions" and set(selectors) == {"service"} and selectors["service"] in ("compute", "block-storage"):
            return ["limits", "definition", "list", *common, "--service-name", selectors["service"], "--all"]
        if operation == "quotaAvailability" and set(selectors) == {"compartment", "ad", "limit"}:
            services = {"standard-a1-core-count": "compute", "standard-a1-memory-count": "compute", "total-storage-gb": "block-storage"}
            ad, limit = selectors["ad"], selectors["limit"]
            if ad not in self.domains or not re.fullmatch(AD_PATTERN, ad) or limit not in services:
                raise KeySafetyError("Quota availability must use known AD, child compartment and documented limit.")
            return ["limits", "resource-availability", "get", *common, "--service-name", services[limit],
                    "--limit-name", limit, "--availability-domain", ad]
        lists = {
            "instances": ["compute", "instance", "list"],
            "volumes": ["bv", "volume", "list"],
            "blockBackups": ["bv", "backup", "list"],
            "bootBackups": ["bv", "boot-volume-backup", "list"],
            "vcns": ["network", "vcn", "list"],
            "quotas": ["limits", "quota", "list"],
        }
        if operation in lists and set(selectors) <= {"compartment"}:
            return [*lists[operation], *common, "--all"]
        if operation in ("bootVolumes", "a1Availability", "shapes"):
            ad = selectors.get("ad")
            if ad not in self.domains or not isinstance(ad, str) or not re.fullmatch(AD_PATTERN, ad):
                raise KeySafetyError("Resource read must use an inventoried London AD.")
            if operation == "bootVolumes" and set(selectors) <= {"compartment", "ad"}:
                return ["bv", "boot-volume", "list", *common, "--availability-domain", ad, "--all"]
            if operation == "shapes" and set(selectors) == {"ad"}:
                return ["compute", "shape", "list", *common, "--availability-domain", ad, "--all"]
            limit = selectors.get("limit")
            if operation == "a1Availability" and set(selectors) == {"ad", "limit"} and limit in ("standard-a1-core-count", "standard-a1-memory-count"):
                return ["limits", "resource-availability", "get", *common, "--service-name", "compute", "--limit-name", limit, "--availability-domain", ad]
        if operation == "images" and not selectors:
            return ["compute", "image", "list", *common, "--operating-system", "Canonical Ubuntu",
                    "--operating-system-version", "24.04", "--shape", SHAPE, "--lifecycle-state", "AVAILABLE", "--all"]
        if operation == "budgets" and not selectors:
            return ["budgets", "budget", "budget", "list", *common, "--target-type", "ALL", "--all"]
        if operation == "budgetAlerts" and set(selectors) == {"budget"} and selectors["budget"] in self.budgets:
            return ["budgets", "budget", "alert-rule", "list", "--budget-id", selectors["budget"], "--all"]
        if operation == "namespace" and not selectors:
            return ["os", "ns", "get", *common]
        if operation in ("buckets", "bucket") and isinstance(self.namespace, str) and re.fullmatch(r"[a-z0-9]{1,63}", self.namespace):
            ns = ["--namespace-name", self.namespace]
            if operation == "buckets" and set(selectors) == {"compartment"}:
                return ["os", "bucket", "list", *common, *ns, "--all"]
            if operation == "bucket" and set(selectors) == {"bucket"} and selectors["bucket"] in self.buckets:
                name = safe_name(selectors["bucket"])
                return ["os", "bucket", "get", *ns, "--bucket-name", name,
                        "--fields", "approximateCount", "--fields", "approximateSize"]
        if operation == "costSummary" and not selectors:
            end = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
            start = end.replace(day=1)
            if start == end:
                # No complete day in the current month; caller records that limit.
                raise KeySafetyError("No complete current-month cost interval; no zero-billing claim.")
            return ["usage-api", "usage-summary", "request-summarized-usages", "--tenant-id", self.profile["tenancy"],
                    "--time-usage-started", start.isoformat(), "--time-usage-ended", end.isoformat(),
                    "--granularity", "DAILY", "--query-type", "COST", "--is-aggregate-by-time", "true"]
        raise KeySafetyError("Operation is outside the fixed P1 read-only inventory scope.")

    def read(self, operation, **selectors):
        args = self.arguments(operation, **selectors)
        fresh = ensure_session()  # Includes single-flight automatic pre-expiry refresh.
        if fresh["tenancy"] != self.profile["tenancy"] or fresh["user"] != self.profile["user"]:
            raise KeySafetyError("Browser identity changed during resource audit; no request.")
        result = subprocess.run(command(args), capture_output=True, text=True, env=clean_environment(), timeout=65, check=False)
        if result.returncode:
            code = re.search(r'"code"\s*:\s*"([A-Za-z][A-Za-z0-9_]{0,63})"', result.stderr)
            status = re.search(r'"status"\s*:\s*(\d{3})', result.stderr)
            message = "OCI read failed: operation=" + operation + "; code=" + (code[1] if code else "CLIError") + "; status=" + (status[1] if status else "unknown") + "; no automatic retry."
            raise KeySafetyError(message)
        if len(result.stdout) > 8_000_000:
            raise KeySafetyError("Resource inventory exceeded its bounded response size.")
        # Pinned OCI CLI 3.95 cli_util.render deliberately emits NOTHING for an
        # empty successful list. Only these --all list commands permit that
        # representation; required objects, cost results and partial JSON do not.
        empty_lists = {"compartments", "domains", "instances", "volumes", "blockBackups", "bootBackups",
                       "vcns", "quotas", "bootVolumes", "images", "budgets", "budgetAlerts", "buckets",
                       "accountRegions", "accountSubscriptions", "shapes", "quotaDefinitions"}
        if result.stdout == "" and operation in empty_lists:
            return []
        try:
            value = json.loads(result.stdout)
        except (ValueError, TypeError):
            raise KeySafetyError("OCI read returned invalid JSON: operation=" + operation + "; raw response suppressed.") from None
        if not isinstance(value, dict) or "data" not in value:
            raise KeySafetyError("OCI read returned incomplete metadata; raw response suppressed.")
        if operation == "costSummary" and value.get("opc-next-page"):
            raise KeySafetyError("Cost report is paginated; stopped rather than reporting partial billing evidence.")
        return value["data"]


def active(items):
    # Unknown/missing lifecycle state is not silently discarded as unused.
    checked = rows(items)
    if any(not isinstance(row.get("lifecycle-state"), str) for row in checked):
        raise KeySafetyError("Resource lifecycle metadata is incomplete.")
    return [row for row in checked if row["lifecycle-state"] not in ("DELETED", "TERMINATED")]


def inventory(client, account):
    require_free_session_gate(account)
    compartments = active(client.read("compartments"))
    for row in compartments:
        client.compartments.add(ocid(row.get("id"), "compartment"))
    domains = rows(client.read("domains"))
    if len(domains) != 3 or any(not isinstance(row.get("name"), str) or not re.fullmatch(AD_PATTERN, row["name"]) for row in domains):
        raise KeySafetyError("Expected three distinct London availability domains.")
    client.domains = {row["name"] for row in domains}
    if len(client.domains) != 3:
        raise KeySafetyError("Duplicate availability domains; inventory is incomplete.")
    totals = {"instances": 0, "bootVolumes": 0, "blockVolumes": 0, "volumeBackups": 0, "vcns": 0,
              "a1Ocpus": Decimal(0), "a1MemoryGB": Decimal(0), "liveVolumeGB": Decimal(0)}
    namespace = client.read("namespace")
    if not isinstance(namespace, str) or not re.fullmatch(r"[a-z0-9]{1,63}", namespace):
        raise KeySafetyError("Unexpected Object Storage namespace metadata.")
    client.namespace = namespace
    bucket_count = 0
    approximate_object_bytes = Decimal(0)
    quota_count = 0
    for compartment in sorted(client.compartments):
        instances = active(client.read("instances", compartment=compartment))
        totals["instances"] += len(instances)
        for instance in instances:
            if not isinstance(instance.get("shape"), str):
                raise KeySafetyError("Instance shape metadata is missing.")
            if instance["shape"] == SHAPE:
                shape = instance.get("shape-config")
                if not isinstance(shape, dict):
                    raise KeySafetyError("A1 shape configuration is incomplete.")
                totals["a1Ocpus"] += number(shape.get("ocpus"))
                totals["a1MemoryGB"] += number(shape.get("memory-in-gbs"))
        blocks = active(client.read("volumes", compartment=compartment))
        totals["blockVolumes"] += len(blocks)
        volumes = list(blocks)
        for ad in sorted(client.domains):
            boots = active(client.read("bootVolumes", compartment=compartment, ad=ad))
            totals["bootVolumes"] += len(boots)
            volumes.extend(boots)
        totals["liveVolumeGB"] += sum((number(row.get("size-in-gbs")) for row in volumes), Decimal(0))
        totals["volumeBackups"] += len(active(client.read("bootBackups", compartment=compartment)))
        totals["volumeBackups"] += len(active(client.read("blockBackups", compartment=compartment)))
        totals["vcns"] += len(active(client.read("vcns", compartment=compartment)))
        quota_count += len(rows(client.read("quotas", compartment=compartment)))
        for bucket in rows(client.read("buckets", compartment=compartment)):
            name = safe_name(bucket.get("name"))
            if name in client.buckets:
                raise KeySafetyError("Duplicate bucket metadata; tenancy inventory is incomplete.")
            client.buckets.add(name)
            metadata = client.read("bucket", bucket=name)
            if not isinstance(metadata, dict):
                raise KeySafetyError("Bucket metadata is incomplete.")
            approximate_object_bytes += number(metadata.get("approximate-size"))
            number(metadata.get("approximate-count"))
            bucket_count += 1
    limits = []
    for ad in sorted(client.domains):
        values = {}
        for short, limit in (("ocpus", "standard-a1-core-count"), ("memoryGB", "standard-a1-memory-count")):
            value = client.read("a1Availability", ad=ad, limit=limit)
            if not isinstance(value, dict):
                raise KeySafetyError("Missing A1 availability response.")
            values[short] = {"used": str(number(value.get("used"))), "available": str(number(value.get("available")))}
        limits.append({"domain": safe_name(ad), **values})
    images = rows(client.read("images"))
    image_names = []
    for row in images:
        name = safe_name(row.get("display-name"))
        if row.get("operating-system") != "Canonical Ubuntu" or row.get("operating-system-version") != "24.04" or row.get("lifecycle-state") != "AVAILABLE":
            raise KeySafetyError("Unexpected platform-image metadata; no compatible image conclusion.")
        if "aarch64" not in name.lower() or not name.startswith("Canonical-Ubuntu-24.04-"):
            raise KeySafetyError("A1 image architecture is not explicitly aarch64; stop for inspection.")
        image_names.append(name)
    if not image_names:
        raise KeySafetyError("No AVAILABLE official Ubuntu24.04 aarch64/A1-compatible image observed.")
    budgets = rows(client.read("budgets"))
    matching_budgets = [row for row in budgets if row.get("display-name") == "ir35careers-free-tier-gbp1"]
    if len(matching_budgets) != 1 or matching_budgets[0].get("lifecycle-state") != "ACTIVE" or number(matching_budgets[0].get("amount")) != 1:
        raise KeySafetyError("Existing GBP1 budget not uniquely verified ACTIVE; do not recreate it.")
    budget_id = ocid(matching_budgets[0].get("id"), "budget")
    client.budgets.add(budget_id)
    alerts = rows(client.read("budgetAlerts", budget=budget_id))
    matching_alerts = [row for row in alerts if row.get("display-name") == "ir35careers-gbp1-actual"]
    if len(matching_alerts) != 1:
        raise KeySafetyError("Existing budget alert not uniquely observed; do not recreate it.")
    alert = matching_alerts[0]
    recipients = alert.get("recipients")
    if (alert.get("lifecycle-state") != "ACTIVE" or alert.get("type") != "ACTUAL" or alert.get("threshold-type") != "PERCENTAGE"
            or number(alert.get("threshold")) != 100 or not isinstance(recipients, str)
            or {value.strip().lower() for value in recipients.split(",")} != {"info@ir35careers.com"}):
        raise KeySafetyError("Existing budget alert properties differ; no setting changed.")
    cost_response = client.read("costSummary")
    if not isinstance(cost_response, dict) or cost_response.get("next-page"):
        raise KeySafetyError("Cost metadata is incomplete/paginated; no zero-billing conclusion.")
    cost_items = rows(cost_response)
    costs = {}
    for item in cost_items:
        currency = item.get("currency")
        if not isinstance(currency, str) or not re.fullmatch(r"[A-Z]{3}", currency):
            raise KeySafetyError("Cost currency is unverified; no zero-billing conclusion.")
        amount = item.get("computed-amount")
        if isinstance(amount, bool) or not isinstance(amount, (int, float, str)):
            raise KeySafetyError("Cost amount is unverified.")
        try:
            amount = Decimal(str(amount))
        except InvalidOperation:
            raise KeySafetyError("Cost amount is invalid; raw response suppressed.") from None
        if not amount.is_finite():
            raise KeySafetyError("Cost amount is not finite.")
        current = costs.setdefault(currency, {"net": Decimal(0), "positive": Decimal(0)})
        current["net"] += amount
        # A credit never hides a positive usage amount in this report.
        current["positive"] += max(amount, Decimal(0))
    # Report numbers/names only, never raw account/resource/instance metadata.
    return {"checkedAt": datetime.now(timezone.utc).isoformat(), "mode": "read-only-resource-inventory",
            "region": REGION, "accountPaymentModel": "FREE_TRIAL", "compartmentsInspected": len(client.compartments),
            "availabilityDomains": limits, "usage": {key: str(value) if isinstance(value, Decimal) else value for key, value in totals.items()},
            "compatiblePlatformImageNames": sorted(image_names), "activeBudget": "ir35careers-free-tier-gbp1",
            "budgetAlertVerified": True, "quotaPolicyCount": quota_count,
            "objectStorage": {"buckets": bucket_count, "approximateBytes": str(approximate_object_bytes), "exactBytesProven": bucket_count == 0},
            "costReport": {"rows": len(cost_items), "amounts": {key: {field: str(value) for field, value in amount.items()} for key, amount in costs.items()},
                           "covers": "current month up to previous UTC midnight", "mayLag": True, "realTimeZeroBillProven": False},
            "infrastructureCreates": 0, "productionChanges": 0,
            "freeTierCreateGate": "NOT_PASSED",
            "remainingGates": ["per-resource Console eligibility, limits, exact byte/request usage and current cost refresh",
                               "guarded whole-stack create/read-back journal"],
            "note": "Trial quota is not free entitlement. Gross Console estimates are not actual bills or proof of free-tier application."}


def require_free_session_gate(report):
    if (report.get("signedTenancyMatch") is not True or report.get("activeUserMatch") is not True
            or report.get("homeRegion") != REGION or report.get("regionStatus") != "READY"
            or report.get("auth") != "security_token"):
        raise KeySafetyError("Live SecurityToken account/home-region gate did not pass.")
    subscriptions = report.get("subscriptions")
    if (not isinstance(subscriptions, list) or not subscriptions
            or any(s.get("state") != "ACTIVE" or s.get("paymentModel") not in ("FREE_TRIAL", "FREE_AND_TRIAL") for s in subscriptions)):
        raise KeySafetyError("Live subscription is not proven ACTIVE Free Trial; no free-tier conclusion.")


def session_account_audit(client):
    tenancy = client.read("accountTenancy")
    user = client.read("accountUser")
    regions = rows(client.read("accountRegions"))
    subscriptions = rows(client.read("accountSubscriptions"))
    if (tenancy.get("id") != client.profile["tenancy"] or str(tenancy.get("name", "")).lower() != "ir35careers"
            or user.get("id") != client.profile["user"] or user.get("lifecycle-state") != "ACTIVE"):
        raise KeySafetyError("Signed browser identity is not the expected ACTIVE owner.")
    if (len(regions) != 1 or regions[0].get("region-name") != REGION
            or regions[0].get("is-home-region") is not True or regions[0].get("status") != "READY"):
        raise KeySafetyError("Signed account is not exclusively READY London home region.")
    result = {"auth": "security_token", "signedTenancyMatch": True, "activeUserMatch": True,
              "homeRegion": REGION, "regionStatus": "READY", "subscriptions": [
                  {"state": row.get("lifecycle-state"), "paymentModel": row.get("payment-model")} for row in subscriptions]}
    require_free_session_gate(result)
    return result


def main():
    try:
        if len(sys.argv) != 1:
            raise KeySafetyError("No arbitrary arguments for the fixed read-only audit.")
        os.umask(0o077)
        resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
        receipt = KEY_DIRECTORY / "resource-audit-status.json"
        if receipt.exists() or receipt.is_symlink():
            raise KeySafetyError("An audit result already exists; inspect it before another run.")
        print("IR35 P1: browser SecurityToken, read-only resource inventory only.", flush=True)
        print("No key generation, infrastructure create, production change, upgrade or cutover.", flush=True)
        client = ReadOnlyOci(ensure_session())
        account = session_account_audit(client)
        report = inventory(client, account)
        write_new(receipt, (json.dumps(report, indent=2) + "\n").encode())
        print("PASS: read-only resource inventory saved. This is NOT approval to create resources.", flush=True)
        return 0
    except (KeyboardInterrupt, EOFError):
        print("STOP: input cancelled; no retry.", file=sys.stderr)
    except KeySafetyError as error:
        print("STOP: " + str(error), file=sys.stderr)
    except Exception:
        print("STOP: resource read failed; raw input/provider output suppressed. No automatic retry.", file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
