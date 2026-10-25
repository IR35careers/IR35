"""Pure, fail-closed storage reconciliation. Not an OCI executor or billing proof."""
from datetime import datetime, timezone
from decimal import Decimal

from key_ceremony import KeySafetyError
from resource_audit import number


def reconcile(report, *, add_live_gb=0, add_volume_backups=0, add_object_bytes=0,
              tier="Standard", now=None):
    if report.get("region") != "uk-london-1" or report.get("accountPaymentModel") != "FREE_TRIAL":
        raise KeySafetyError("Storage requires verified London home-region Free Trial evidence.")
    try:
        checked = datetime.fromisoformat(report["checkedAt"])
        age = ((now or datetime.now(timezone.utc)) - checked).total_seconds()
        if checked.tzinfo is None or not 0 <= age <= 300:
            raise ValueError()
    except (KeyError, TypeError, ValueError):
        raise KeySafetyError("Storage inventory must be complete and no older than five minutes.") from None
    usage = report.get("usage", {})
    objects = report.get("objectStorage", {})
    if objects.get("exactBytesProven") is not True:
        raise KeySafetyError("Approximate Object Storage metadata is not exact byte evidence.")
    live = number(usage.get("liveVolumeGB")) + number(add_live_gb)
    backups = number(usage.get("volumeBackups")) + number(add_volume_backups)
    # Only the historical proven-empty path can use its old zero-valued field.
    # A non-empty bucket needs the new exact enumeration, never a renamed estimate.
    if 'exactBytes' in objects:
        if type(objects['exactBytes']) is not int or objects['exactBytes'] < 0:
            raise KeySafetyError('Exact integer Object Storage byte count required.')
        object_bytes = number(objects['exactBytes']) + number(add_object_bytes)
    elif number(objects.get('approximateBytes')) == 0 and objects.get('buckets', 0) == 0:
        object_bytes = number(add_object_bytes)
    else:
        raise KeySafetyError('Non-empty buckets require exact paginated Object Storage bytes.')
    if live > 150 or backups > 5 or backups != int(backups) or object_bytes > 8_000_000_000:
        raise KeySafetyError("Storage proposal exceeds owner cap: live150GB, five backups, object8GB.")
    if tier != "Standard":
        raise KeySafetyError("Only Standard Object Storage is approved, including during the trial.")
    costs = report.get("costReport", {})
    if not isinstance(costs.get("amounts"), dict) or costs.get("mayLag") is not True:
        raise KeySafetyError("Current lag-aware cost evidence is missing.")
    for values in costs["amounts"].values():
        if number(values.get("positive")) != Decimal(0):
            raise KeySafetyError("Positive reported cost requires reconciliation; credits do not hide charges.")
    return {"storageEnvelope": "PASS", "proposedLiveVolumeGB": str(live), "freeLiveAllowanceGB": 200,
            "remainingOwnerLiveGB": str(150-live), "proposedVolumeBackups": int(backups), "freeBackupCount": 5,
            "proposedObjectBytes": str(object_bytes), "ownerObjectByteCap": 8_000_000_000,
            "trialStandardFreeGB": 10, "postTrialCombinedFreeGB": 20, "tier": "Standard",
            "realTimeZeroBillProven": False, "createAuthorised": False,
            "remainingGate": "Fresh per-resource eligibility and durable create/read-back journal"}
