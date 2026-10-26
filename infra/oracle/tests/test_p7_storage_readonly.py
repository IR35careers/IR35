import inspect
from pathlib import Path
import sys
import unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import p7_storage_readonly as storage
from offline_bundle_fixture import public_bootstrap


class StorageReadonlyTests(unittest.TestCase):
    def test_signed_locator_cannot_escape_existing_api_origin(self):
        self.assertEqual(storage.signed_relative('/object/sign/cvs/fixture?token=fixture'),'/object/sign/cvs/fixture?token=fixture')
        for value in ('https://employer.invalid/object/sign/x?token=x','//employer.invalid/object/sign/x?token=x','/other?token=x','/object/sign/x',None):
            with self.assertRaises(RuntimeError):storage.signed_relative(value)
    def test_actual_complete_program_compiles_without_private_state(self):
        with public_bootstrap():code=storage.program({'fixture':'public only'})
        compile(code,'<public-storage>','exec')
    def test_readonly_audit_never_creates_services_or_objects_and_keeps_full_hash_and_rls_guards(self):
        code=inspect.getsource(storage.program)
        for forbidden in ('docker run','docker restart','CREATE DATABASE','ALTER POLICY','write_text','/auth/v1/token'):
            self.assertNotIn(forbidden,code)
        for required in ('StorageSignedByteMismatch_Abort','PrivateStorageRLSMismatch_Abort','NamedStorageOwnerRLSMismatch_Abort','containment(data,runtime'):
            self.assertIn(required,code)


if __name__=='__main__':unittest.main()
