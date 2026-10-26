from pathlib import Path
import unittest


class LauncherCheckoutTests(unittest.TestCase):
    def test_launcher_uses_reviewed_checkout_not_stale_p1_copy(self):
        source=(Path(__file__).resolve().parents[1]/'open-security-session.ps1').read_text(encoding='utf-8')
        self.assertIn("Join-Path $PSScriptRoot 'security_session.py'",source)
        self.assertIn('$start.ArgumentList.Add($argument)',source)
        self.assertNotIn('/p1-tooling/',source)
        self.assertIn('if ($ValidateOnly)',source)
        self.assertIn('no duplicate login opened',source)
        self.assertIn("$uri.Host -ne 'login.uk-london-1.oraclecloud.com'",source)
        self.assertIn('# All other child output suppressed',source)
        self.assertLess(source.index('if ($ValidateOnly)'),source.index('$process.Start()'))


if __name__=='__main__':unittest.main()
