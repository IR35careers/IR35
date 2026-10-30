import ast
from pathlib import Path
import sys
import unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import p8_backup_iam_owner as owner
import p8_backup_policy as scope
from key_ceremony import KeySafetyError


class ApprovedBackupIamTests(unittest.TestCase):
    def test_service_only_exact_compartment_and_bucket_four_necessary_permissions(self):
        first,second=owner.service_statements()
        self.assertIn('objectstorage-uk-london-1',first)
        self.assertIn("request.permission='BUCKET_INSPECT'",first)
        self.assertNotIn('target.bucket.name',first)
        self.assertIn("target.bucket.name='ir35-backups'",second)
        for text in (first,second):
            self.assertIn('in compartment id '+scope.COMPARTMENT,text)
            for forbidden in ('in tenancy','OBJECT_OVERWRITE','BUCKET_UPDATE','KEY_','OBJECT_UPDATE_TIER','OBJECT_VERSION_DELETE'):
                self.assertNotIn(forbidden,text)
        self.assertEqual((first+second).count('request.permission='),4)

    def test_vm_stays_exact_three_permissions_no_delete(self):
        self.assertEqual(scope.policy_statement().count('request.permission='),3)
        self.assertNotIn('DELETE',scope.policy_statement())
        self.assertEqual(scope.matching_rule(),"instance.id = '"+scope.INSTANCE+"'")

    def test_lifecycle_only_two_owned_prefixes_delete_never_tier_or_replication(self):
        rows=owner.retention_items()
        self.assertEqual([row['timeAmount'] for row in rows],[7,28])
        self.assertEqual([row['objectNameFilter']['inclusionPrefixes'] for row in rows],[[scope.PREFIX+'/daily/'],[scope.PREFIX+'/weekly/']])
        self.assertTrue(all(row['action']=='DELETE' and row['target']=='objects' and row['isEnabled'] for row in rows))

    def test_existing_same_resource_reused_without_create(self):
        calls=[]
        class Api:
            ids=set()
            def call(self,operation,**kwargs):
                calls.append(operation)
                return [{'id':scope.INSTANCE,'name':'existing'}] if operation=='groups' else {'id':scope.INSTANCE,'name':'existing'}
        from unittest.mock import patch
        with patch.object(owner,'ocid',side_effect=lambda value,kind:value):
            value=owner.one_resource(Api(),'groups','existing','NEVER','dynamicgroup',lambda row:row,lambda name:self.fail('No free/create gate needed'))
        self.assertFalse(value['created']);self.assertEqual(calls,['groups','get-group'])

    def test_no_unbounded_generic_cli_or_import_action(self):
        tree=ast.parse(Path(owner.__file__).read_text())
        self.assertIsNotNone(tree)
        text=Path(owner.__file__).read_text()
        for forbidden in ('shell=True','session authenticate','--force','"compute", "instance", "launch"'):
            self.assertNotIn(forbidden,text)

    def test_exact_inventory_bucket_get_does_not_depend_on_observed_projection(self):
        calls=[]
        class Reads:
            buckets={scope.BUCKET}
            observed=[]
            def read(self,operation,**selectors):
                calls.append((operation,selectors))
                return {'name':scope.BUCKET}
        self.assertEqual(owner.authenticated_bucket(Reads()),{'name':scope.BUCKET})
        self.assertEqual(calls,[('bucket',{'bucket':scope.BUCKET})])
        Reads.buckets=set()
        with self.assertRaisesRegex(KeySafetyError,'InventoriedBackupBucketRequired'):
            owner.authenticated_bucket(Reads())
        self.assertEqual(len(calls),1)

    def test_exact_counter_scope_is_name_compartment_pairs_not_list_summaries(self):
        class Reads:
            compartments={'compartment-b','compartment-a'}
            def read(self,operation,**selectors):
                self_operation=operation
                if self_operation!='buckets':raise AssertionError('Read-only bucket list required')
                return [{'name':'bucket-'+selectors['compartment'],'approximate-size':999}]
        self.assertEqual(owner.exact_bucket_scope(Reads()),
            [('bucket-compartment-a','compartment-a'),('bucket-compartment-b','compartment-b')])

    def test_bucket_read_explicitly_requests_optional_auto_tiering_without_coercion(self):
        tenancy='ocid1.tenancy.oc1..controlledfixture01'
        reads=owner.OwnerReads({'tenancy':tenancy},None)
        reads.namespace='fixturepublicns';reads.buckets={scope.BUCKET}
        args=reads.arguments('bucket',bucket=scope.BUCKET)
        fields=[args[index+1] for index,value in enumerate(args) if value=='--fields']
        self.assertEqual(fields,['approximateCount','approximateSize','autoTiering'])
        row={'name':scope.BUCKET,'compartment-id':scope.COMPARTMENT,'storage-tier':'Standard',
            'public-access-type':'NoPublicAccess','versioning':'Disabled','auto-tiering':None,'is-read-only':False,
            'replication-enabled':False,'kms-key-id':None}
        with self.assertRaises(scope.BackupScopeError):owner.safe_bucket(row)
        self.assertEqual(owner.safe_bucket(row|{'auto-tiering':'Disabled'})['status'],'PASS')


if __name__=='__main__':unittest.main()
