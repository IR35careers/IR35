#!/usr/bin/env python3
"""Bounded exec-session keeper; import performs no private I/O or authentication.

Start manually only after a fresh owner browser login. The sole credential
operation is the existing SecurityToken guard. No daemon, scheduler or fallback.
"""

from contextlib import contextmanager
import fcntl
import hashlib
import json
import math
import os
import stat
import sys
import time

INTERVAL = 300
HORIZON = 86400
CODES = frozenset(("CHECKING", "CHECKED", "BROWSER_SESSION_LIMIT", "SESSION_RECEIPT_CHANGED",
                   "SESSION_RECEIPT_INVALID", "SESSION_UNAVAILABLE", "CLOCK_INVALID",
                   "STATE_UNAVAILABLE", "KEEPER_ALREADY_RUNNING", "OWNER_STOP", "ARGUMENTS_INVALID"))


class KeeperStop(Exception):
    def __init__(self, code):
        self.code = code if code in CODES else "STATE_UNAVAILABLE"
        super().__init__(self.code)


def number(value):
    return type(value) in (int, float) and 0 <= value < 10**12 and math.isfinite(value)


def clocks(wall_clock, monotonic_clock):
    wall, monotonic = wall_clock(), monotonic_clock()
    if not number(wall) or not number(monotonic):
        raise KeeperStop("CLOCK_INVALID")
    return wall, monotonic


def receipt_binding(session):
    try:
        before = session.RECEIPT.lstat()
        raw = session.private_file(session.RECEIPT)
        after = session.RECEIPT.lstat()
        fields = lambda value: (value.st_dev, value.st_ino, value.st_size, value.st_mtime_ns, value.st_ctime_ns)
        value = json.loads(raw)
        if (fields(before) != fields(after) or set(value) != {"browserAuthenticatedAt", "profile", "auth"}
                or not number(value["browserAuthenticatedAt"]) or value["profile"] != "ir35"
                or value["auth"] != "security_token"):
            raise ValueError()
        return value["browserAuthenticatedAt"], hashlib.sha256(raw.encode()).hexdigest(), fields(after)
    except BaseException:
        raise KeeperStop("SESSION_RECEIPT_INVALID") from None


@contextmanager
def keeper_lock(session):
    descriptor, acquired = None, False
    try:
        session.private_directory(session.ROOT)
        path = session.ROOT / "ir35-session-keeper.lock"
        descriptor = os.open(path, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
        info = os.fstat(descriptor)
        if (not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid()
                or stat.S_IMODE(info.st_mode) != 0o600 or info.st_nlink != 1):
            raise KeeperStop("STATE_UNAVAILABLE")
        session.private_file(path)
        current = path.lstat()
        if (info.st_dev, info.st_ino) != (current.st_dev, current.st_ino):
            raise KeeperStop("STATE_UNAVAILABLE")
        try:
            fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise KeeperStop("KEEPER_ALREADY_RUNNING") from None
        acquired = True
        yield
    except KeeperStop:
        raise
    except BaseException:
        raise KeeperStop("STATE_UNAVAILABLE") from None
    finally:
        if descriptor is not None:
            try:
                if acquired:
                    fcntl.flock(descriptor, fcntl.LOCK_UN)
            finally:
                os.close(descriptor)


def previous_state(session, path):
    try:
        if not path.exists() and not path.is_symlink():
            return None
        value = json.loads(session.private_file(path))
        expected = {"version", "pid", "status", "reason", "receiptSha256", "browserAuthenticatedAt",
                    "deadlineAt", "monotonicDeadline", "lastObservedAt", "lastMonotonicAt",
                    "lastCheckedAt", "checks"}
        if (set(value) != expected or type(value["version"]) is not int or value["version"] != 1
                or value["status"] not in ("RUNNING", "STOPPED") or value["reason"] not in CODES
                or type(value["pid"]) is not int or value["pid"] <= 0
                or type(value["checks"]) is not int or value["checks"] < 0
                or not isinstance(value["receiptSha256"], str) or len(value["receiptSha256"]) != 64
                or any(c not in "0123456789abcdef" for c in value["receiptSha256"])
                or any(not number(value[key]) for key in ("browserAuthenticatedAt", "deadlineAt",
                    "monotonicDeadline", "lastObservedAt", "lastMonotonicAt", "lastCheckedAt"))):
            raise ValueError()
        return value
    except BaseException:
        raise KeeperStop("STATE_UNAVAILABLE") from None


def store(session, path, value):
    try:
        if path.exists() or path.is_symlink():
            session.private_file(path)
        session.atomic_metadata(path, value)
        session.private_file(path)
    except BaseException:
        raise KeeperStop("STATE_UNAVAILABLE") from None


def run_locked(session, wall_clock, monotonic_clock, sleep):
    state, path = None, session.ROOT / "ir35-session-keeper.json"
    try:
        wall, monotonic = clocks(wall_clock, monotonic_clock)
        binding = receipt_binding(session)
        started, receipt_sha, _ = binding
        deadline = started + HORIZON
        if wall < started:
            raise KeeperStop("CLOCK_INVALID")
        previous = previous_state(session, path)
        same = previous is not None and previous["receiptSha256"] == receipt_sha
        if same and previous["status"] == "STOPPED":
            return {key: previous[key] for key in ("status", "reason", "checks")}
        if same and previous["reason"] == "CHECKING":
            # A killed/failed writer cannot prove whether refresh happened.
            # Burn that receipt's keeper attempt rather than calling it again.
            previous.update(status="STOPPED", reason="SESSION_UNAVAILABLE")
            store(session, path, previous)
            return {key: previous[key] for key in ("status", "reason", "checks")}
        mono_deadline = monotonic + max(0, deadline - wall)
        if same:
            if (wall < previous["lastObservedAt"] or monotonic < previous["lastMonotonicAt"]
                    or previous["browserAuthenticatedAt"] != started or previous["deadlineAt"] != deadline):
                raise KeeperStop("CLOCK_INVALID")
            mono_deadline = min(mono_deadline, previous["monotonicDeadline"])
        state = {"version": 1, "pid": os.getpid(), "status": "RUNNING", "reason": "CHECKED",
                 "receiptSha256": receipt_sha, "browserAuthenticatedAt": started, "deadlineAt": deadline,
                 "monotonicDeadline": mono_deadline, "lastObservedAt": wall, "lastMonotonicAt": monotonic,
                 "lastCheckedAt": previous["lastCheckedAt"] if same else 0,
                 "checks": previous["checks"] if same else 0}
        next_check = max(monotonic, previous["lastMonotonicAt"] + INTERVAL) if same else monotonic
        while True:
            wall, monotonic = clocks(wall_clock, monotonic_clock)
            if wall < state["lastObservedAt"] or monotonic < state["lastMonotonicAt"]:
                raise KeeperStop("CLOCK_INVALID")
            state.update(lastObservedAt=wall, lastMonotonicAt=monotonic)
            if receipt_binding(session) != binding:
                raise KeeperStop("SESSION_RECEIPT_CHANGED")
            if wall >= deadline or monotonic >= mono_deadline:
                raise KeeperStop("BROWSER_SESSION_LIMIT")
            if monotonic < next_check:
                sleep(min(next_check - monotonic, deadline - wall, mono_deadline - monotonic))
                continue
            # Durable in-flight intent is mandatory BEFORE the credential guard.
            # `checks` counts completed guards, not OCI requests or refreshes.
            state.update(reason="CHECKING", lastCheckedAt=wall)
            store(session, path, state)
            if receipt_binding(session) != binding:
                raise KeeperStop("SESSION_RECEIPT_CHANGED")
            before_wall, before_mono = clocks(wall_clock, monotonic_clock)
            if before_wall < wall or before_mono < monotonic:
                raise KeeperStop("CLOCK_INVALID")
            state.update(lastObservedAt=before_wall, lastMonotonicAt=before_mono)
            if before_wall >= deadline or before_mono >= mono_deadline:
                raise KeeperStop("BROWSER_SESSION_LIMIT")
            try:
                session.ensure_session(minimum_seconds=600)
            except BaseException:
                raise KeeperStop("SESSION_UNAVAILABLE") from None
            state.update(checks=state["checks"] + 1, reason="CHECKED")
            if receipt_binding(session) != binding:
                raise KeeperStop("SESSION_RECEIPT_CHANGED")
            after_wall, after_mono = clocks(wall_clock, monotonic_clock)
            if after_wall < before_wall or after_mono < before_mono:
                raise KeeperStop("CLOCK_INVALID")
            state.update(lastObservedAt=after_wall, lastMonotonicAt=after_mono)
            if after_wall >= deadline or after_mono >= mono_deadline:
                raise KeeperStop("BROWSER_SESSION_LIMIT")
            store(session, path, state)
            next_check = after_mono + INTERVAL
    except KeyboardInterrupt:
        reason = "OWNER_STOP"
    except KeeperStop as error:
        reason = error.code
    except BaseException:
        reason = "STATE_UNAVAILABLE"
    if state is not None and reason != "STATE_UNAVAILABLE":
        state.update(status="STOPPED", reason=reason)
        try:
            store(session, path, state)
        except KeeperStop:
            reason = "STATE_UNAVAILABLE"
    return {"status": "STOPPED", "reason": reason, "checks": state["checks"] if state else 0}


def run(session=None, *, wall_clock=time.time, monotonic_clock=time.monotonic, sleep=time.sleep):
    try:
        if session is None:
            import security_session as session  # Deliberately lazy; never authenticate.
        with keeper_lock(session):
            return run_locked(session, wall_clock, monotonic_clock, sleep)
    except KeeperStop as error:
        return {"status": "STOPPED", "reason": error.code, "checks": 0}
    except BaseException:
        return {"status": "STOPPED", "reason": "STATE_UNAVAILABLE", "checks": 0}


def main(argv=None):
    if (sys.argv[1:] if argv is None else argv) != ["run"]:
        result = {"status": "STOPPED", "reason": "ARGUMENTS_INVALID", "checks": 0}
    else:
        result = run()
    print(json.dumps(result), flush=True)  # Fixed metadata only, never exception text.
    return 0 if result["reason"] in ("BROWSER_SESSION_LIMIT", "OWNER_STOP") else 1


if __name__ == "__main__":
    raise SystemExit(main())
