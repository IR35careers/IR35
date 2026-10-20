"""Bounded post-create reads only; never retries a mutation or a real error."""
import re
import time
import json
from contextvars import ContextVar

from key_ceremony import KeySafetyError

_READ_DEADLINE = ContextVar("oci_visibility_deadline", default=None)


def service_error_detail(stderr, error):
    """Only structured service diagnostics; never headers, signed args or body."""
    match = re.search(r'"message"\s*:\s*("(?:[^"\\]|\\.)*")', stderr)
    message = json.loads(match[1]) if match else "Provider message unavailable"
    message = re.sub(r"-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?(?:-----END [^-]*PRIVATE KEY-----|$)", "[REDACTED PRIVATE KEY]", message)
    message = re.sub(r"(?i)\bBearer\s+[^\s,;]+", "Bearer [REDACTED]", message)
    message = re.sub(r"\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+", "[REDACTED JWT]", message)
    message = re.sub(r"(?i)([\"']?(?:password|passphrase|secret|token|authorization|api[_ -]?key|client[_ -]?secret)[\"']?\s*[:=]\s*)(\"(?:\\.|[^\"\\])*\"|'[^']*'|[^\s,;]+)", r"\1[REDACTED]", message)
    message = re.sub(r"([a-z][a-z0-9+.-]*://)[^\s/@:]+:[^\s/@]+@", r"\1[REDACTED]@", message, flags=re.I)
    return {"code": error.code, "status": error.status, "message": message[:8000]}


def call_timeout(maximum=65):
    """Bound every nested CLI call to the enclosing visibility deadline."""
    value = _READ_DEADLINE.get()
    if value is None:
        return maximum
    deadline, clock = value
    remaining = deadline - clock()
    if remaining <= 0:
        raise KeySafetyError("Visibility read deadline reached; no second create.")
    return min(maximum, remaining)


class OciError(KeySafetyError):
    def __init__(self, operation, code, status):
        # Never retain raw provider messages, request payloads or credentials.
        self.code = code if re.fullmatch(r"[A-Za-z][A-Za-z0-9_]{0,63}", code or "") else "CLIError"
        self.status = status if type(status) is int and 100 <= status <= 599 else None
        super().__init__("OCI operation failed: operation=" + operation + "; code=" + self.code
                         + "; status=" + str(self.status or "unknown") + "; raw response suppressed.")

    @classmethod
    def from_stderr(cls, operation, stderr):
        code = re.search(r'"code"\s*:\s*"([A-Za-z][A-Za-z0-9_]{0,63})"', stderr)
        status = re.search(r'"status"\s*:\s*(\d{3})', stderr)
        return cls(operation, code[1] if code else "CLIError", int(status[1]) if status else None)

    def not_visible(self):
        # A conflicting 401/500 must not be hidden by a misleading code string.
        return self.status == 404 or (self.status is None and self.code == "NotAuthorizedOrNotFound")


def wait_for_visible(read, *, label, record=lambda event: None, timeout=600,
                     clock=time.monotonic, sleep=time.sleep):
    """read returns None while absent/pending; validates identity before returning.

    Only this post-create/reconciliation window exempts404 from failure stops.
    Each sleep <=60s; timeout includes read duration. No create callback exists.
    """
    if not 0 < timeout <= 600 or not re.fullmatch(r"[A-Za-z0-9_.:-]{1,80}", label):
        raise KeySafetyError("Invalid bounded visibility wait specification.")
    start = clock()
    delay = 5
    attempt = 0
    while True:
        if attempt and clock() - start >= timeout:
            record({"resource": label, "attempt": attempt, "elapsedSeconds": round(clock() - start, 3), "result": "TIMEOUT"})
            raise KeySafetyError("Visibility timeout for " + label + " within10minutes; no second create permitted.")
        attempt += 1
        code, status = "PendingVisibility", None
        token = _READ_DEADLINE.set((start + timeout, clock))
        try:
            result = read()
        except OciError as error:
            if not error.not_visible():
                raise
            result, code, status = None, error.code, error.status
        finally:
            _READ_DEADLINE.reset(token)
        elapsed = max(0, clock() - start)
        if result is not None and elapsed <= timeout:
            record({"resource": label, "attempt": attempt, "elapsedSeconds": round(elapsed, 3), "result": "VISIBLE"})
            return result
        if elapsed >= timeout:
            record({"resource": label, "attempt": attempt, "elapsedSeconds": round(elapsed, 3), "result": "TIMEOUT"})
            raise KeySafetyError("Visibility timeout for " + label + " within10minutes; no second create permitted.")
        pause = min(delay, timeout - elapsed)
        record({"resource": label, "attempt": attempt, "elapsedSeconds": round(elapsed, 3),
                "result": "NOT_YET_VISIBLE", "code": code, "status": status, "nextDelaySeconds": pause})
        print("WAIT: " + label + " not yet visible; next read in " + str(pause) + "s; no create retry.", flush=True)
        sleep(pause)
        delay = min(delay * 2, 60)
