import copy
import hashlib
from pathlib import Path
import sys
import unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import fidelity_gate
import p6_role_policy as policy


def fixtures():
    source={'checkedAt':'source','encoding':'UTF8','collation':{'provider':'i'},'schemas':['public'],
            'objects':[{'kind':'role','name':'postgres','hash':'a'*32,'value':{'source':'untouched'}}]}
    target=copy.deepcopy(source)
    for name in policy.APPROVED_ROLES:target['objects'].append({'kind':'role','name':name,'hash':hashlib.md5(name.encode()).hexdigest(),'value':policy.expected_role(name)})
    source_expiry={'postgres':{'hash':'source-unchanged','configured':False,'finite':False}}
    target_expiry=copy.deepcopy(source_expiry)
    for name in policy.APPROVED_ROLES:target_expiry[name]={'hash':hashlib.md5(b'NULL').hexdigest(),'configured':False,'finite':False}
    return source,target,{'status':'PASS'},{'status':'PASS','sourceEntries':552,'targetEntries':552},source_expiry,target_expiry


class P6RolePolicyTests(unittest.TestCase):
    def compare(self,args):return policy.compare(*args,fidelity_gate.compare)

    def test_records_two_additions_without_hiding_raw_diff_or_mutating_inputs(self):
        args=fixtures();before=copy.deepcopy(args);result=self.compare(args)
        self.assertEqual(result['status'],'PASS_WITH_APPROVED_P6_ADDITIONS')
        self.assertEqual(len(result['approvedP6Additions']),2);self.assertEqual(result['unexplainedDifferences'],[])
        self.assertEqual(result['baselineCatalogResult']['status'],'FAIL')
        self.assertEqual(len(result['baselineCatalogResult']['unexplainedDifferences']),2)
        self.assertEqual(args,before);self.assertTrue(result['baseline552Unchanged'])

    def test_never_permits_privileged_or_loosely_matching_roles(self):
        for field,value in [('superuser',True),('inherit',True),('createRole',True),('createDB',True),('login',False),
                            ('replication',True),('bypassRLS',True),('connectionLimit',-1),('config',['search_path=public'])]:
            args=fixtures();args[1]['objects'][1]['value'][field]=value
            self.assertEqual(self.compare(args)['status'],'FAIL',field)

    def test_source_changes_membership_grants_and_third_roles_still_fail(self):
        for kind in ('role','role-membership','grant','policy','table'):
            args=fixtures();args[1]['objects'].append({'kind':kind,'name':'unexpected','hash':'b'*32,'value':{}})
            self.assertEqual(self.compare(args)['status'],'FAIL',kind)
        args=fixtures();args[1]['objects'][0]['hash']='b'*32
        self.assertFalse(self.compare(args)['sourceRolesUnchanged']);self.assertEqual(self.compare(args)['status'],'FAIL')

    def test_does_not_change_or_relax_552_effective_privilege_checks(self):
        for field,value in [('status','FAIL'),('sourceEntries',551),('targetEntries',553)]:
            args=fixtures();args[3][field]=value
            self.assertEqual(self.compare(args)['status'],'FAIL')

    def test_all_existing_expiry_and_both_new_null_expiries_are_required(self):
        args=fixtures();args[5]['postgres']['hash']='changed'
        self.assertEqual(self.compare(args)['status'],'FAIL')
        args=fixtures();args[5]['ir35_queue']['configured']=True
        self.assertEqual(self.compare(args)['status'],'FAIL')
        args=fixtures();args[1]['objects'].pop();args[5].pop('ir35_queue_producer')
        self.assertEqual(self.compare(args)['status'],'FAIL')


if __name__=='__main__':unittest.main()
