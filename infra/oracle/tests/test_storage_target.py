from pathlib import Path
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import storage_target as storage


class TargetTests(unittest.TestCase):
    def test_paths_preserve_exact_unicode_and_version_without_traversal(self):
        version='12345678-1234-1234-1234-123456789012'
        path=storage.backend_path('cvs','folder/café.pdf',version)
        self.assertEqual(path,'ir35-staging/ir35-staging/cvs/folder/café.pdf/'+version)
        self.assertEqual(storage.backend_path('cvs','cafe\u0301.pdf',None),'ir35-staging/ir35-staging/cvs/cafe\u0301.pdf')
        for value in ('../bad','a/../bad','/bad','a\\b','a\x00b'):
            with self.assertRaises(ValueError):storage.backend_path('cvs',value,version)
        with self.assertRaises(ValueError):storage.backend_path('cvs','safe','-'*36)
        with self.assertRaises(ValueError):storage.backend_path('cvs','safe',123)

    def test_compiled_api_is_internal_read_only_frozen_and_has_no_secret_arguments(self):
        with patch.object(storage.schema,'guest_bundle',return_value=''):
            guest=storage.guest(1,[])
        compile(guest,'private-storage-target','exec')
        self.assertIn('default_transaction_read_only=on',guest)
        self.assertIn("DB_ALLOW_MIGRATION_REFRESH='false'",guest)
        self.assertIn("DB_INSTALL_ROLES='false'",guest)
        self.assertIn("network_info.get('Internal') is not True",guest)
        self.assertIn("'--log-driver','none'",guest)
        self.assertIn('STORAGE_BYTES_VERIFIED',guest)
        self.assertIn('Storage API byte mismatch',guest)
        self.assertNotIn("'--publish'",guest)
        self.assertNotIn('TRUNCATE TABLE',guest)
        self.assertNotIn('DROP DATABASE',guest)


if __name__=='__main__':unittest.main()
