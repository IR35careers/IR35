from pathlib import Path
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import staging_dns as dns


class DnsTests(unittest.TestCase):
    def test_caa_checks_nonwildcard_issue_critical_and_http01_constraints(self):
        for records in ([], [["0", "issue", "letsencrypt.org"]], [["0", "issuewild", ";"]],
                        [["0", "issue", "letsencrypt.org; validationmethods=http-01"]]):
            self.assertTrue(dns.caa_allows(records))
        for records in ([["0", "issue", ";"]], [["0", "issue", "other.example"]], [["128", "unknown", "x"]],
                        [["0", "issue", "letsencrypt.org; validationmethods=dns-01"]],
                        [["0", "issue", "letsencrypt.org; accounturi=restricted"]]):
            self.assertFalse(dns.caa_allows(records))

    def test_both_resolvers_and_hosts_must_agree_before_pass(self):
        def query(resolver, name, kind):
            return {"status": "NOERROR", "records": [[dns.ADDRESS]] if kind == "A" else []}
        with patch.object(dns, "query", side_effect=query):
            self.assertTrue(dns.observe()[0])
        def stale(resolver, name, kind):
            if resolver == "8.8.8.8" and name == dns.HOSTS[1] and kind == "A":
                return {"status": "NXDOMAIN", "records": []}
            return query(resolver, name, kind)
        with patch.object(dns, "query", side_effect=stale):
            self.assertFalse(dns.observe()[0])

    def test_ancestor_caa_denial_stops_without_certificate_or_dns_writes(self):
        def query(resolver, name, kind):
            return {"status": "NOERROR", "records": [["0", "issue", "other.example"]] if name == "ir35careers.com" and kind == "CAA" else []}
        with patch.object(dns, "query", side_effect=query):
            with self.assertRaisesRegex(RuntimeError, "owner DNS gate"):
                dns.observe()


if __name__ == "__main__":
    unittest.main()
