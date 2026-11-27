# Read-only repair preflight — zero requests

The first invocation of the26November read-only repair stopped **before authentication, journal creation or any OCI request** because its whole-source binding detected two approved keeper changes after the cost-focused snapshot. The proposed repair01 slot remained absent and unused.

Only `security_session_keeper.py` and its new test differed. Those exact final bytes have an independent29-test fake-only PASS, seal `75c79b56b8ec05517391d9c98d04f2bd81c9e0f22a01a01073ceed9f05f0bf2a`; existing `security_session.py` and every cost/runtime/eligibility source still matched the78-test cost snapshot.

The wrapper now requires **both** unchanged cost-focus sources and the exact independently reviewed keeper hashes/proof for those two files. Arbitrary source changes still fail before requests. No cost validator, IAM scope, assertion, timeout, old evidence, native allowance or credential was changed by this diagnostic. This is not a full canonical-CI or native migration PASS.
