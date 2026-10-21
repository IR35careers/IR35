import json
from pathlib import Path
import sys
import unittest

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import acl_diagnosis
import effective_privileges


class AclDiagnosisTests(unittest.TestCase):
    def test_ownership_is_not_misreported_as_changed_function_body(self):
        a = {"kind":"function","name":"extensions.fixture()","hash":"a"*32,
             "value":{"owner":"postgres","definitionHash":"c"*32,"config":["password=private-sentinel"]}}
        b = dict(a,hash="b"*32,value=dict(a["value"],owner="supabase_admin"))
        result=acl_diagnosis.diagnose({"checkedAt":"fixture","objects":[a]},{"checkedAt":"fixture","objects":[b]})
        self.assertEqual(result["rows"][0]["changedFields"],["owner"])
        self.assertNotIn("private-sentinel",json.dumps(result))
        self.assertEqual(result["ownerDifferences"],["function:extensions.fixture()"])

    def test_all_differences_are_accounted_and_no_duplicate_overwrite(self):
        fixture={"kind":"grant","name":"default:postgres:public:r:postgres:anon:SELECT","hash":"a"*32,"value":{"grantee":"anon"}}
        result=acl_diagnosis.diagnose({"checkedAt":"fixture","objects":[fixture]},{"checkedAt":"fixture","objects":[]})
        self.assertEqual(result["categories"],{"default-privileges":1})
        self.assertEqual(result["differences"],sum(result["categories"].values()))
        with self.assertRaises(ValueError):
            acl_diagnosis.diagnose({"checkedAt":"fixture","objects":[fixture,fixture]},{"checkedAt":"fixture","objects":[]})

    def test_any_increased_function_or_table_access_stops(self):
        for kind,privilege in (("table","SELECT"),("function","EXECUTE")):
            source={"version":1,"checkedAt":"fixture","roles":list(effective_privileges.ROLES),"entries":[
                {"kind":kind,"name":"public.fixture","role":role,"privileges":{privilege:False}} for role in effective_privileges.ROLES]}
            self.assertEqual(effective_privileges.compare(source,source)["status"],"PASS")
            target=json.loads(json.dumps(source));target["entries"][0]["privileges"][privilege]=True
            result=effective_privileges.compare(source,target)
            self.assertTrue(result["repairMustStop"])
            self.assertEqual(len(result["morePermissive"]),1)
            self.assertEqual(result["status"],"FAIL")

    def test_missing_object_role_or_empty_matrix_cannot_pass(self):
        fixture={"version":1,"checkedAt":"fixture","roles":list(effective_privileges.ROLES),"entries":[]}
        with self.assertRaises(ValueError):
            effective_privileges.compare(fixture,fixture)
        fixture["entries"]=[{"kind":"table","name":"public.fixture","role":"anon","privileges":{"SELECT":False}}]
        with self.assertRaises(ValueError):
            effective_privileges.compare(fixture,fixture)


if __name__=="__main__":
    unittest.main()
