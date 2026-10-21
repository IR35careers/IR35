import json
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import acl_repair as repair


def catalog(config=None,extra=False):
    role={'login':True,'inherit':True,'createDB':False,'bypassRLS':False,'superuser':False,'createRole':False,
          'replication':False,'connectionLimit':-1,'config':config}
    result={'objects':[{'kind':'role','name':'fixture','value':role}]}
    if extra:result['objects'].append({'kind':'role','name':'supabase_functions_admin','value':role})
    return result


class AclRepairTests(unittest.TestCase):
    def test_unchanged_passwords_and_list_gucs_are_preserved(self):
        sql=repair.role_sql(catalog(['search_path="$user", public, auth']),catalog(),[])
        self.assertIn('pg_catalog.set_config',sql)
        self.assertIn('SET "search_path" FROM CURRENT',sql)
        self.assertNotIn('PASSWORD',sql)
        self.assertNotIn('SUPERUSER',sql)
        self.assertEqual(repair.role_sql(catalog(),catalog(),[]),'')

    def test_extra_bootstrap_role_requires_zero_dependencies(self):
        self.assertEqual(repair.role_sql(catalog(),catalog(extra=True),[]),'DROP ROLE "supabase_functions_admin";')
        with self.assertRaises(ValueError):
            repair.role_sql(catalog(),catalog(extra=True),[{'database':'postgres','dependency':'o'}])
        target=catalog(extra=True);target['objects'][-1]['name']='unexpected_admin'
        with self.assertRaises(ValueError):repair.role_sql(catalog(),target,[])

    def test_memberships_include_grantor_and_all_three_options(self):
        source=catalog();target=catalog()
        source['objects'].append({'kind':'role-membership','name':'postgres:fixture:supabase_admin',
                                  'value':{'set':True,'inherit':False,'admin':False}})
        sql=repair.role_sql(source,target,[])
        self.assertIn('WITH ADMIN FALSE, INHERIT FALSE, SET TRUE GRANTED BY "supabase_admin"',sql)

    def test_restore_cannot_skip_acls_owners_errors_or_colliding_database(self):
        self.assertNotIn('--no-owner',repair.MUTATION)
        self.assertNotIn('--no-acl',repair.MUTATION)
        self.assertIn("'--single-transaction','--exit-on-error'",repair.MUTATION)
        self.assertIn('Unowned database collision',repair.MUTATION)
        self.assertIn('Repair already journalled',repair.MUTATION)
        self.assertIn('os.O_EXCL|os.O_NOFOLLOW',repair.MUTATION)
        self.assertIn('os.fchown(fd,1002,1002)',repair.MUTATION)
        self.assertIn('fullLogSHA256',repair.MUTATION)
        self.assertNotIn('UPDATE pg_',repair.MUTATION)
        self.assertNotIn('REASSIGN OWNED',repair.MUTATION)
        module=Path(repair.__file__).read_text().split('GUEST =',1)[0]
        module=module[module.index('def identifier'):]
        mutation='\n'.join(' '+line if line else '' for line in repair.MUTATION.splitlines())
        compile(repair.GUEST.replace('MODULE',module).replace('OPERATION',repr('restore')).replace(' MUTATION',mutation),'guarded-repair','exec')

    def test_failed_gate_refuses_before_ssh_or_mutation(self):
        with patch.object(sys,'argv',['acl_repair.py','restore']),patch.object(repair.schema,'guest_bundle') as bundle:
            with self.assertRaisesRegex(ValueError,'ACL fidelity failed'):
                repair.main()
            bundle.assert_not_called()


if __name__=='__main__':unittest.main()
