import contextlib
import io
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from visibility import OciError, wait_for_visible, call_timeout
from key_ceremony import KeySafetyError


class VisibilityTests(unittest.TestCase):
    def setUp(self):
        self.elapsed = 0
        self.delays = []
        self.events = []
    def sleep(self, delay):
        self.delays.append(delay)
        self.elapsed += delay
    def wait(self, read):
        with contextlib.redirect_stdout(io.StringIO()):
            return wait_for_visible(read, label="fixture", clock=lambda: self.elapsed,
                                    sleep=self.sleep, record=self.events.append)
    def test_404_then_success_and_redacted_evidence(self):
        calls = []
        def read():
            calls.append(1)
            if len(calls) < 5:
                raise OciError("get", "NotAuthorizedOrNotFound", 404)
            return "visible"
        self.assertEqual(self.wait(read), "visible")
        self.assertEqual(self.delays, [5, 10, 20, 40])
        self.assertEqual(self.events[-1]["result"], "VISIBLE")
        self.assertTrue(all(row["status"] == 404 for row in self.events[:-1]))
    def test_timeout_at_600_seconds_and_delay_capped_at_60(self):
        def absent():
            raise OciError("get", "NotAuthorizedOrNotFound", 404)
        with self.assertRaisesRegex(KeySafetyError, "Visibility timeout"):
            self.wait(absent)
        self.assertEqual(self.elapsed, 600)
        self.assertEqual(self.delays[:5], [5, 10, 20, 40, 60])
        self.assertLessEqual(max(self.delays), 60)
        self.assertEqual(self.events[-1]["result"], "TIMEOUT")
    def test_401_and_500_fail_immediately_even_with_not_found_code(self):
        for status in (401, 500):
            with self.subTest(status=status):
                def failed():
                    raise OciError("get", "NotAuthorizedOrNotFound", status)
                with self.assertRaises(OciError):
                    self.wait(failed)
        self.assertEqual(self.delays, [])
        self.assertEqual(self.events, [])
    def test_code_without_http_status_and_empty_list_poll(self):
        values = iter([OciError("get", "NotAuthorizedOrNotFound", None), None, {"id": "fixture"}])
        def read():
            value = next(values)
            if isinstance(value, Exception):
                raise value
            return value
        self.assertEqual(self.wait(read), {"id": "fixture"})
        self.assertEqual(self.delays, [5, 10])
    def test_raw_provider_secret_is_not_retained_or_printed(self):
        secret = "sentinel-private-material"
        error = OciError.from_stderr("get", '{"code":"NotAuthorizedOrNotFound","status":404,"message":"' + secret + '"}')
        self.assertNotIn(secret, str(error))
        self.assertNotIn(secret, repr(error.__dict__))
    def test_never_retries_untyped_or_malformed_errors(self):
        for error in (KeySafetyError("bad identity"), TimeoutError(), OciError("get", "CLIError", None)):
            with self.subTest(error=type(error).__name__):
                def failed():
                    raise error
                with self.assertRaises(type(error)):
                    self.wait(failed)
        self.assertEqual(self.delays, [])

    def test_nested_cli_timeout_is_clamped_to_remaining_deadline(self):
        def read():
            self.elapsed = 590
            self.assertEqual(call_timeout(), 10)
            return "visible"
        self.assertEqual(self.wait(read), "visible")
        self.assertEqual(call_timeout(), 65)


if __name__ == "__main__":
    unittest.main()
