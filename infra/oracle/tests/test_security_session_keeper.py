import builtins
import hashlib
import io
import json
import os
from pathlib import Path
import sys
import tempfile
from types import ModuleType, SimpleNamespace
import unittest
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import security_session as session
import security_session_keeper as keeper


class FakeClock:
    def __init__(self, wall=2000, monotonic=500, stop_after=1, change=None):
        self.wall, self.monotonic = wall, monotonic
        self.stop_after, self.change, self.sleeps = stop_after, change, []

    def sleep(self, seconds):
        self.sleeps.append(seconds)
        if self.change is not None:
            self.change(self, seconds)
        elif len(self.sleeps) >= self.stop_after:
            raise KeyboardInterrupt()
        else:
            self.wall += seconds
            self.monotonic += seconds


class SecuritySessionKeeperTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        os.chmod(self.root, 0o700)
        self.receipt = self.root / "browser.json"
        self.write_receipt()
        self.guard = Mock(return_value={"user": "do-not-log-profile", "token": "do-not-log-token"})
        self.fake = SimpleNamespace(ROOT=self.root, RECEIPT=self.receipt,
            private_directory=session.private_directory, private_file=session.private_file,
            atomic_metadata=session.atomic_metadata, ensure_session=self.guard)
        self.state = self.root / "ir35-session-keeper.json"

    def write_receipt(self, **changes):
        value = {"browserAuthenticatedAt": 1000, "profile": "ir35", "auth": "security_token"}
        value.update(changes)
        self.receipt.write_text(json.dumps(value))
        os.chmod(self.receipt, 0o600)

    def run_clock(self, clock=None):
        clock = clock or FakeClock()
        return keeper.run(self.fake, wall_clock=lambda: clock.wall,
            monotonic_clock=lambda: clock.monotonic, sleep=clock.sleep)

    def test_import_has_no_private_io_authentication_or_subprocess(self):
        source = Path(keeper.__file__).read_text()
        module = ModuleType("keeper_import_fixture")
        real_import = builtins.__import__

        def imports(name, *args, **kwargs):
            if name == "security_session":
                raise AssertionError("Session guard must be imported lazily")
            return real_import(name, *args, **kwargs)

        with patch.object(builtins, "__import__", side_effect=imports), \
                patch.object(os, "open", side_effect=AssertionError("No import I/O")), \
                patch.object(Path, "home", side_effect=AssertionError("No import profile lookup")), \
                patch.object(Path, "read_text", side_effect=AssertionError("No import file read")), \
                patch.object(session.subprocess, "run", side_effect=AssertionError("No import subprocess")):
            exec(compile(source, "keeper_import_fixture.py", "exec"), module.__dict__)
        self.guard.assert_not_called()

    def test_only_existing_routine_guard_is_called_and_lock_is_released(self):
        result = self.run_clock()
        self.assertEqual(result, {"status": "STOPPED", "reason": "OWNER_STOP", "checks": 1})
        self.guard.assert_called_once_with(minimum_seconds=600)
        with keeper.keeper_lock(self.fake):
            pass

    def test_checks_are_no_more_frequent_than_five_minutes(self):
        clock = FakeClock(stop_after=3)
        result = self.run_clock(clock)
        self.assertEqual(clock.sleeps, [300, 300, 300])
        self.assertEqual(result["checks"], 3)
        self.assertEqual(self.guard.call_args_list, [unittest.mock.call(minimum_seconds=600)] * 3)

    def test_early_sleep_return_does_not_duplicate_guard_calls(self):
        def early(clock, seconds):
            if len(clock.sleeps) >= 4:
                raise KeyboardInterrupt()
            step = min(100, seconds)
            clock.wall += step
            clock.monotonic += step
        clock = FakeClock(change=early)
        result = self.run_clock(clock)
        self.assertEqual(clock.sleeps[:3], [300, 200, 100])
        self.assertEqual(result["checks"], 2)

    def test_original_wall_deadline_is_never_extended_by_refresh(self):
        def advance(clock, seconds):
            clock.wall += seconds
            clock.monotonic += seconds
        clock = FakeClock(wall=87390, monotonic=10, change=advance)
        result = self.run_clock(clock)
        self.assertEqual(result["reason"], "BROWSER_SESSION_LIMIT")
        self.assertEqual(clock.sleeps, [10])
        self.guard.assert_called_once_with(minimum_seconds=600)
        state = json.loads(self.state.read_text())
        self.assertEqual(state["deadlineAt"], 87400)
        self.assertEqual(state["browserAuthenticatedAt"], 1000)

    def test_already_expired_browser_never_calls_guard(self):
        self.assertEqual(self.run_clock(FakeClock(wall=87400))["reason"], "BROWSER_SESSION_LIMIT")
        self.guard.assert_not_called()

    def test_monotonic_deadline_caps_a_wall_clock_that_runs_slowly(self):
        def advance(clock, seconds):
            clock.wall += 1
            clock.monotonic += 85400
        result = self.run_clock(FakeClock(change=advance))
        self.assertEqual(result["reason"], "BROWSER_SESSION_LIMIT")
        self.guard.assert_called_once_with(minimum_seconds=600)

    def test_wall_clock_rollback_is_terminal(self):
        def rollback(clock, seconds):
            clock.wall -= 1
            clock.monotonic += seconds
        self.assertEqual(self.run_clock(FakeClock(change=rollback))["reason"], "CLOCK_INVALID")
        self.guard.assert_called_once_with(minimum_seconds=600)

    def test_monotonic_rollback_is_terminal(self):
        def rollback(clock, seconds):
            clock.wall += seconds
            clock.monotonic -= 1
        self.assertEqual(self.run_clock(FakeClock(change=rollback))["reason"], "CLOCK_INVALID")
        self.guard.assert_called_once_with(minimum_seconds=600)

    def test_invalid_clock_never_calls_guard(self):
        for value in (True, float("nan"), float("inf"), -1):
            with self.subTest(value=str(value)):
                self.assertEqual(self.run_clock(FakeClock(wall=value))["reason"], "CLOCK_INVALID")
        self.guard.assert_not_called()

    def test_receipt_change_while_waiting_stops_without_rebinding(self):
        def replace(clock, seconds):
            clock.wall += seconds
            clock.monotonic += seconds
            self.write_receipt(browserAuthenticatedAt=1001)
        original = hashlib.sha256(self.receipt.read_bytes()).hexdigest()
        self.assertEqual(self.run_clock(FakeClock(change=replace))["reason"], "SESSION_RECEIPT_CHANGED")
        self.guard.assert_called_once_with(minimum_seconds=600)
        self.assertEqual(json.loads(self.state.read_text())["receiptSha256"], original)

    def test_identical_bytes_replaced_by_new_receipt_inode_stop(self):
        def replace(clock, seconds):
            replacement = self.root / "replacement"
            session.write_new(replacement, self.receipt.read_bytes())
            os.replace(replacement, self.receipt)
            clock.wall += seconds
            clock.monotonic += seconds
        self.assertEqual(self.run_clock(FakeClock(change=replace))["reason"], "SESSION_RECEIPT_CHANGED")
        self.assertEqual(self.guard.call_count, 1)

    def test_receipt_change_during_guard_stops(self):
        self.guard.side_effect = lambda **kwargs: self.write_receipt(browserAuthenticatedAt=1001)
        self.assertEqual(self.run_clock()["reason"], "SESSION_RECEIPT_CHANGED")
        self.assertEqual(self.guard.call_count, 1)

    def test_failed_refresh_is_redacted_terminal_and_cannot_retry_same_receipt(self):
        self.guard.side_effect = RuntimeError("secret-sentinel https://private.invalid raw-provider-error")
        first = self.run_clock()
        second = self.run_clock()
        self.assertEqual(first, second)
        self.assertEqual(first["reason"], "SESSION_UNAVAILABLE")
        self.assertEqual(self.guard.call_count, 1)
        raw = self.state.read_text()
        for text in ("secret-sentinel", "private.invalid", "raw-provider-error", "do-not-log"):
            self.assertNotIn(text, raw)

    def test_new_owner_receipt_can_start_only_a_new_bounded_run(self):
        self.guard.side_effect = RuntimeError("suppressed")
        self.run_clock()
        self.guard.side_effect = None
        self.write_receipt(browserAuthenticatedAt=1001)
        self.assertEqual(self.run_clock()["reason"], "OWNER_STOP")
        self.assertEqual(self.guard.call_count, 2)
        self.assertEqual(json.loads(self.state.read_text())["deadlineAt"], 87401)

    def test_duplicate_flock_cannot_touch_running_metadata_or_guard(self):
        with keeper.keeper_lock(self.fake):
            self.assertEqual(self.run_clock()["reason"], "KEEPER_ALREADY_RUNNING")
        self.guard.assert_not_called()
        self.assertFalse(self.state.exists())

    def test_lock_permissions_are_owner_only(self):
        self.run_clock()
        self.assertEqual((self.root / "ir35-session-keeper.lock").stat().st_mode & 0o777, 0o600)
        self.assertEqual(self.state.stat().st_mode & 0o777, 0o600)

    def test_unsafe_receipt_fails_closed_without_guard_or_state(self):
        os.chmod(self.receipt, 0o644)
        self.assertEqual(self.run_clock()["reason"], "SESSION_RECEIPT_INVALID")
        self.guard.assert_not_called()
        self.assertFalse(self.state.exists())

    def test_malformed_receipt_fields_are_never_inferred(self):
        for changes in ({"browserAuthenticatedAt": True}, {"browserAuthenticatedAt": float("nan")},
                        {"profile": "other"}, {"auth": "api_key"}):
            with self.subTest(fields=list(changes)):
                self.write_receipt(**changes)
                self.assertEqual(self.run_clock()["reason"], "SESSION_RECEIPT_INVALID")
        self.guard.assert_not_called()

    def test_state_symlink_is_not_followed_or_replaced(self):
        target = self.root / "unrelated"
        session.write_new(target, b"unchanged")
        self.state.symlink_to(target)
        self.assertEqual(self.run_clock()["reason"], "STATE_UNAVAILABLE")
        self.assertTrue(self.state.is_symlink())
        self.assertEqual(target.read_bytes(), b"unchanged")
        self.guard.assert_not_called()

    def test_existing_pending_state_is_preserved_and_stops(self):
        pending = self.root / "ir35-session-keeper.json.pending"
        session.write_new(pending, b"existing-failure")
        self.assertEqual(self.run_clock()["reason"], "STATE_UNAVAILABLE")
        self.assertEqual(pending.read_bytes(), b"existing-failure")
        self.guard.assert_not_called()

    def test_failed_terminal_write_keeps_burned_intent_and_cannot_retry_guard(self):
        self.guard.side_effect = RuntimeError("secret-sentinel")
        writes = []

        def first_only(path, value):
            writes.append(value.copy())
            if len(writes) > 1:
                raise OSError("secret-sentinel")
            session.atomic_metadata(path, value)

        with patch.object(self.fake, "atomic_metadata", side_effect=first_only):
            self.assertEqual(self.run_clock()["reason"], "STATE_UNAVAILABLE")
        self.assertEqual(json.loads(self.state.read_text())["reason"], "CHECKING")
        self.assertEqual(self.run_clock()["reason"], "SESSION_UNAVAILABLE")
        self.assertEqual(self.guard.call_count, 1)
        self.assertEqual(json.loads(self.state.read_text())["status"], "STOPPED")

    def test_receipt_change_during_intent_fsync_stops_before_guard(self):
        def replace(path, value):
            session.atomic_metadata(path, value)
            if value["reason"] == "CHECKING":
                self.write_receipt(browserAuthenticatedAt=1001)
        with patch.object(self.fake, "atomic_metadata", side_effect=replace):
            self.assertEqual(self.run_clock()["reason"], "SESSION_RECEIPT_CHANGED")
        self.guard.assert_not_called()

    def test_slow_intent_fsync_cannot_cross_monotonic_cap_before_guard(self):
        clock = FakeClock()
        def slow(path, value):
            session.atomic_metadata(path, value)
            if value["reason"] == "CHECKING":
                clock.monotonic += 85400
        with patch.object(self.fake, "atomic_metadata", side_effect=slow):
            self.assertEqual(self.run_clock(clock)["reason"], "BROWSER_SESSION_LIMIT")
        self.guard.assert_not_called()

    def test_guard_clock_rollback_is_compared_to_post_fsync_clock(self):
        clock = FakeClock()
        def advance(path, value):
            session.atomic_metadata(path, value)
            if value["reason"] == "CHECKING":
                clock.wall += 100
                clock.monotonic += 100
        def rollback(**kwargs):
            clock.wall -= 50
            clock.monotonic -= 50
        self.guard.side_effect = rollback
        with patch.object(self.fake, "atomic_metadata", side_effect=advance):
            self.assertEqual(self.run_clock(clock)["reason"], "CLOCK_INVALID")
        self.guard.assert_called_once_with(minimum_seconds=600)

    def test_clock_rollback_across_process_restart_does_not_extend_window(self):
        self.run_clock()
        state = json.loads(self.state.read_text())
        state.update(status="RUNNING", reason="CHECKED")
        session.atomic_metadata(self.state, state)
        self.assertEqual(self.run_clock(FakeClock(wall=1999))["reason"], "CLOCK_INVALID")
        self.assertEqual(self.guard.call_count, 1)

    def test_restart_preserves_monotonic_cap_and_five_minute_spacing(self):
        self.run_clock()
        state = json.loads(self.state.read_text())
        state.update(status="RUNNING", reason="CHECKED")
        session.atomic_metadata(self.state, state)
        self.assertEqual(self.run_clock(FakeClock(wall=2100, monotonic=600))["checks"], 1)
        self.assertEqual(self.guard.call_count, 1)
        self.assertEqual(json.loads(self.state.read_text())["monotonicDeadline"], state["monotonicDeadline"])

    def test_forward_wall_jump_on_restart_cannot_bypass_monotonic_spacing(self):
        self.run_clock()
        state = json.loads(self.state.read_text())
        state.update(status="RUNNING", reason="CHECKED")
        session.atomic_metadata(self.state, state)
        clock = FakeClock(wall=2400, monotonic=501)
        self.assertEqual(self.run_clock(clock)["reason"], "OWNER_STOP")
        self.assertEqual(clock.sleeps, [299])
        self.assertEqual(self.guard.call_count, 1)

    def test_main_rejects_arguments_without_loading_session_and_logs_fixed_metadata(self):
        output = io.StringIO()
        with patch.object(keeper, "run") as run, patch.object(sys, "stdout", output):
            self.assertEqual(keeper.main(["--token", "secret-sentinel"]), 1)
        run.assert_not_called()
        self.assertEqual(json.loads(output.getvalue()),
            {"status": "STOPPED", "reason": "ARGUMENTS_INVALID", "checks": 0})


if __name__ == "__main__":
    unittest.main()
