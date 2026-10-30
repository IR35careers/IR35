import ast
from pathlib import Path
import sys
import unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import p8_owner_readonly as audit
from key_ceremony import KeySafetyError


class OwnerReadOnlyTests(unittest.TestCase):
    def test_guest_compiles_and_has_only_fixed_inspect_and_version_commands(self):
        ast.parse(audit.GUEST)
        self.assertIn("['docker','inspect',name]",audit.GUEST)
        self.assertIn("['docker','exec',name,'caddy','version']",audit.GUEST)
        for forbidden in ('reload','restart','stop','recreate','read_env','os.environ','shell=True','write_text','write_bytes'):
            self.assertNotIn(forbidden,audit.GUEST)

    def test_absent_service_is_reported_without_supplying_grants(self):
        result=audit.lifecycle_projection([{'lifecycle-state':'ACTIVE','statements':['Allow group Administrators to manage all-resources in tenancy']}])
        self.assertEqual(result['status'],'ABSENT_IN_ROOT_AND_CHILD_LISTS')
        self.assertFalse(result['effectiveLifecycleAccessProven'])
        self.assertFalse(result['newGrantApproved'])
        self.assertEqual(result['iamChanges'],0)

    def test_service_candidate_is_not_an_effective_access_pass(self):
        result=audit.lifecycle_projection([{'lifecycle-state':'ACTIVE','statements':['Allow service objectstorage-uk-london-1 to manage object-family in compartment ir35']}])
        self.assertEqual(result['status'],'REQUIRES_SCOPE_REVIEW')
        self.assertEqual(result['possibleObjectStorageServiceStatements'],1)
        self.assertFalse(result['effectiveLifecycleAccessProven'])

    def test_incomplete_statements_are_rejected(self):
        for rows in (None,[None],[{'lifecycle-state':'ACTIVE'}],[{'lifecycle-state':'ACTIVE','statements':'not-a-list'}]):
            with self.assertRaises(KeySafetyError):audit.lifecycle_projection(rows)


if __name__=='__main__':unittest.main()
