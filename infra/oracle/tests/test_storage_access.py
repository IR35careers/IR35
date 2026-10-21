from pathlib import Path
import sys
import unittest

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import storage_access as access
import auth_compat


class AccessTests(unittest.TestCase):
    def test_path_hash_preserves_exact_unicode_without_raw_path(self):
        self.assertEqual(len(access.path_hash('cvs','café.pdf')),64)
        self.assertNotEqual(access.path_hash('cvs','café.pdf'),access.path_hash('cvs','cafe\u0301.pdf'))
        self.assertNotEqual(access.path_hash('cvs','a/b'),access.path_hash('cvs/a','b'))

    def test_policy_digest_is_stable_and_covers_all_storage_definitions(self):
        fixture={'objects':[{'kind':'policy','name':'storage.objects.owner','hash':'a','value':'not public'},
                            {'kind':'rls','name':'storage.objects','hash':'b'},
                            {'kind':'role','name':'postgres','hash':'ignored'}]}
        result=access.storage_security(fixture)
        self.assertEqual(len(result),2)
        self.assertNotIn('value',result[0])
        self.assertEqual(access.digest(result),access.digest(access.storage_security({'objects':list(reversed(fixture['objects']))})))
        fixture['objects'][0]['hash']='changed'
        self.assertNotEqual(access.digest(result),access.digest(access.storage_security(fixture)))

    def test_auth_probe_is_metadata_only_and_explains_pinned_platform_seeds(self):
        compile(auth_compat.GUEST,'readonly-auth-probe','exec')
        self.assertIn('BEGIN READ ONLY',auth_compat.GUEST)
        self.assertIn('BOOTSTRAP_HASH',auth_compat.GUEST)
        self.assertIn('len(platform_versions)!=7',auth_compat.GUEST)
        self.assertIn('unexplained',auth_compat.GUEST)
        for forbidden in ('ALTER ROLE','UPDATE auth.','DELETE FROM','pg_restore','ignore-health'):
            self.assertNotIn(forbidden,auth_compat.GUEST)


if __name__=='__main__':unittest.main()
