from pathlib import Path
import sys
import unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from p5_readonly_guest import Page,csp_checks,sitemap_checks


class RuntimeReadOnlyTests(unittest.TestCase):
    def test_html_extracts_only_live_dom_links_and_local_build_assets(self):
        page=Page(b'<h1>Contracts</h1><a href="/jobs/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa">x</a><script nonce="public-fixture" src="/_next/static/chunks/local.js"></script><link rel="stylesheet" href="/_next/static/css/local.css"><script src="https://external.invalid/a.js"></script>')
        self.assertEqual(page.h1s,1);self.assertEqual(len(page.jobs),1);self.assertEqual(len(page.assets),2)
        self.assertEqual(page.nonces,['public-fixture'])

    def test_csp_checks_do_not_return_nonce_or_html(self):
        checks=csp_checks({'content-security-policy':"script-src 'nonce-public-fixture' 'strict-dynamic'; frame-ancestors 'none'; object-src 'none'"},b'<h1>x</h1><script nonce="public-fixture"></script>')
        self.assertTrue(all(checks.values()));self.assertTrue(all(type(value)is bool for value in checks.values()))
        self.assertFalse(csp_checks({},b'<h1>x</h1>')['noncePresentAndApplied'])

    def test_sitemap_rejects_duplicates_and_private_pages(self):
        xml=b'<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://www.ir35careers.com/dashboard</loc></url><url><loc>https://www.ir35careers.com/dashboard</loc></url></urlset>'
        checks=sitemap_checks(xml)
        self.assertFalse(checks['uniqueURLs']);self.assertFalse(checks['noPrivatePages'])


if __name__=='__main__':unittest.main()
