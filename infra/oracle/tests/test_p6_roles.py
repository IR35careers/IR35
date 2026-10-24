import json
from pathlib import Path
import sys
import unittest
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import p6_containment
import p6_roles_guest as roles


def preflight():
    proof={'administrator':'supabase_admin','existingSuperuser':True,'rolesAbsent':True,'schemaOwner':'postgres','queueObjects':0,
           'appSchemas':['auth','public','storage'],'logging':{'statement':'none','errorStatement':'panic','pgaudit':'none'}}
    return proof,{'HostConfig':{'LogConfig':{'Type':'none'},'PortBindings':None}}


class P6RolesTests(unittest.TestCase):
    def test_preflight_requires_existing_superuser_empty_schema_no_roles_and_safe_logging(self):
        roles.require_preflight(*preflight())
        for key,value in [('administrator','ir35_queue'),('existingSuperuser',False),('rolesAbsent',False),('schemaOwner','anon'),('queueObjects',1),('appSchemas',['public'])]:
            args=preflight();args[0][key]=value
            with self.assertRaises(RuntimeError,msg=key):roles.require_preflight(*args)
        for key,value in [('statement','all'),('errorStatement','error'),('pgaudit','role')]:
            args=preflight();args[0]['logging'][key]=value
            with self.assertRaises(RuntimeError,msg=key):roles.require_preflight(*args)
        for key,value in [('LogConfig',{'Type':'json-file'}),('PortBindings',{'5432/tcp':[{}]})]:
            args=preflight();args[1]['HostConfig'][key]=value
            with self.assertRaises(RuntimeError,msg=key):roles.require_preflight(*args)

    def test_only_two_minimal_roles_no_source_alter_or_membership_or_catalog_edits(self):
        sql=roles.role_sql({'ir35_queue':'a'*64,'ir35_queue_producer':'b'*64})
        self.assertEqual(sql.count('CREATE ROLE '),2)
        self.assertNotIn('ALTER ROLE',sql);self.assertNotIn('GRANT ir35',sql)
        self.assertNotIn('UPDATE pg_',sql);self.assertNotIn('DELETE ',sql)
        self.assertEqual(sql.count('NOINHERIT LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS'),2)
        self.assertIn("SET LOCAL pg_stat_statements.track='none'",sql)
        self.assertIn("SET LOCAL log_min_error_statement='panic'",sql)
        self.assertIn('has_any_column_privilege',sql);self.assertIn('pg_auth_members',sql)
        for name in ('auth','public','storage'):self.assertIn("'"+name+"'",sql)
        for wrong in ({},{'ir35_queue':"'injection",'ir35_queue_producer':'b'*64}):
            with self.assertRaisesRegex(RuntimeError,'MemoryGeneratedCredentialsRequired'):roles.role_sql(wrong)

    def test_credentials_cannot_be_written_to_other_locations_or_overwritten(self):
        with self.assertRaisesRegex(RuntimeError,'FixedP6CredentialPathRequired'):roles.private_new(Path('/tmp/leak'),b'not-secret')
        with patch.object(roles.os,'open',side_effect=FileExistsError) as create:
            with self.assertRaises(FileExistsError):roles.private_new(Path('/opt/ir35/.env.p6-queue-owner'),b'not-secret')
        self.assertTrue(create.call_args.args[1]&roles.os.O_EXCL)
        self.assertTrue(create.call_args.args[1]&roles.os.O_NOFOLLOW)
        self.assertEqual(create.call_args.args[2],0o600)

    def test_real_tcp_probe_has_no_credential_args_and_accepts_only_permission_denial(self):
        class Reply:
            returncode=3;stdout=b'';stderr=b'ERROR:  42501\n'
        with patch.object(roles.subprocess,'run',return_value=Reply()) as run:
            result=roles.probe({},'sha256:'+'a'*64,'ir35_queue',Path('/opt/ir35/.env.p6-queue-owner'),'SELECT * FROM auth.users LIMIT 0;')
        self.assertTrue(result['denied42501']);args=run.call_args.args[0]
        self.assertNotIn('--env',args);self.assertNotIn('--env-file',args);self.assertNotIn('--publish',args)
        self.assertIn('ir35-staging_backend',args);self.assertIn('--log-driver',args)
        for error in (b'ERROR:  25006\n',b'FATAL:  28P01\n'):
            Reply.stderr=error
            with patch.object(roles.subprocess,'run',return_value=Reply()):self.assertFalse(roles.probe({},'image','ir35_queue',Path('/opt/ir35/.env.p6-queue-owner'),'SELECT 1;')['denied42501'])

    def test_containment_copies_verifier_not_global_runtime_and_preserves_raw_inputs(self):
        source={'roleExpiry':{'postgres':'source-only'}}
        baseline=lambda *args: {'status':'RAW_FAIL','unexplainedDifferences':['two roles']}
        runtime={'verifiers':{'fidelity_compare':baseline}}
        class Recovery:
            sql={'expiry':'expiry'}
            def __init__(self,*args):pass
            def source(self):return source
            def query(self,*args):return json.dumps({'postgres':'source-only','ir35_queue':'addition'})
        seen=[]
        def full_fidelity(data,scoped):
            seen.append(scoped['verifiers']['fidelity_compare']('source','target','conditions','552baseline',False))
            schema={'status':'PASS_WITH_APPROVED_P6_ADDITIONS','baseline552Unchanged':True,'sourceRolesUnchanged':True,
                    'sourceRoleExpiryUnchanged':True,'approvedP6Additions':['a','b']}
            return {'status':'PASS'},{'schema':schema},{'schema':schema}
        with patch.object(p6_containment,'Recovery',Recovery),patch.object(p6_containment,'baseline_fidelity',side_effect=full_fidelity),patch.object(p6_containment.p6_role_policy,'compare',return_value={'raw':'unchanged'}) as policy:
            result,_,_=p6_containment.fidelity({'p4':{}},runtime)
        self.assertEqual(result['status'],'PASS');self.assertEqual(seen,[{'raw':'unchanged'}])
        self.assertIs(runtime['verifiers']['fidelity_compare'],baseline)
        self.assertEqual(policy.call_args.args[:4],('source','target','conditions','552baseline'))
        self.assertIs(policy.call_args.args[-1],baseline)


if __name__=='__main__':unittest.main()
