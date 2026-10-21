from pathlib import Path
import sys
import unittest

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import owner_parity
import extension_security
import fidelity_gate
import copy


class OwnerParityTests(unittest.TestCase):
    def test_installer_compiles_and_never_retries_the_owner_probe(self):
        guest=owner_parity.baseline_guest('a'*64)
        compile(guest,'baseline-installer','exec')
        self.assertNotIn('EXTENSION_MODULE',guest)
        self.assertNotIn('FIDELITY_MODULE',guest)
        self.assertNotIn('CREATE EXTENSION',guest)
        self.assertNotIn('VALID UNTIL',guest)
        self.assertIn("prior.get('status')!='RESTORED'",guest)
        self.assertIn("tables!='0'",guest)
        self.assertIn("if gate['status']=='FAIL'",guest)
        self.assertIn('--single-transaction',guest)
        self.assertNotIn('--no-owner',guest)
        self.assertNotIn('--no-acl',guest)

    def test_usage_audit_is_required_and_probe_is_single_direct_owner_rollback(self):
        self.assertLess(owner_parity.EXPIRY_PROBE.index('usage=role_usage()'),owner_parity.EXPIRY_PROBE.index('ALTER ROLE'))
        self.assertIn('VALID UNTIL',owner_parity.EXPIRY_PROBE)
        self.assertNotIn('PASSWORD',owner_parity.EXPIRY_PROBE)
        self.assertNotIn('SET ROLE',owner_parity.EXPIRY_PROBE.replace('# Direct owner connection, NOT SET ROLE and no extra privilege grants.',''))
        self.assertIn("'-U','postgres'",owner_parity.EXPIRY_PROBE)
        self.assertIn("record['extensionAttempts']=1",owner_parity.EXPIRY_PROBE)
        self.assertIn('Owner attempt already journalled',owner_parity.EXPIRY_PROBE)
        self.assertIn('ROLLBACK;',owner_parity.EXPIRY_PROBE)
        self.assertIn("remaining!=['plpgsql']",owner_parity.EXPIRY_PROBE)
        compile(owner_parity.BASE+owner_parity.EXPIRY_PROBE,'owner-guard','exec')

    def test_exceptions_never_cover_type_grants_ddl_or_versions(self):
        value={'version':1,'extensions':[{'name':name,'version':version,'owner':'supabase_admin','schema':'extensions'} for name,version in extension_security.EXTENSIONS.items()],
               'objects':[{'kind':kind,'name':'extensions.fixture','hash':'a'*32} for kind in ('schema','function','relation','type')],
               'members':[{'extension':'pgcrypto','class':'pg_proc','identity':'extensions.fixture()'}],
               'capabilities':[{'kind':'function','name':'extensions.fixture()','role':role,'value':{'ownerInherited':False}} for role in ('anon','authenticated','service_role')]}
        self.assertEqual(extension_security.compare(value,value)['status'],'PASS')
        import copy
        for field in ('objects','capabilities','extensions'):
            changed=copy.deepcopy(value)
            if field=='objects':changed[field][-1]['hash']='b'*32
            elif field=='capabilities':changed[field][0]['value']['ownerInherited']=True
            else:changed[field][0]['version']='unapproved'
            self.assertEqual(extension_security.compare(value,changed)['status'],'FAIL')

    def test_only_owner_fields_on_the_three_extensions_are_exceptions(self):
        source={'checkedAt':'source','encoding':'UTF8','collation':{'provider':'i'},'schemas':['extensions'],
          'objects':[{'kind':'extension','name':name,'hash':'a'*32,'value':{'owner':'postgres','schema':'extensions','version':version}}
            for name,version in extension_security.EXTENSIONS.items()]}
        target=copy.deepcopy(source)
        for obj in target['objects']:
            obj['hash']='b'*32;obj['value']['owner']='supabase_admin'
        conditions={'status':'PASS'};privileges={'status':'PASS'}
        result=fidelity_gate.compare(source,target,conditions,privileges,True)
        self.assertEqual(result['status'],'PASS_WITH_OWNER_APPROVED_EXCEPTIONS')
        self.assertEqual(len(result['exceptions']),3)
        self.assertFalse(result['fullDataVerification'])
        for field in ('version','schema','owner'):
            changed=copy.deepcopy(target)
            changed['objects'][0]['value'][field]='unapproved'
            self.assertEqual(fidelity_gate.compare(source,changed,conditions,privileges,True)['status'],'FAIL')
        for condition,privilege,expiry in (({'status':'FAIL'},privileges,True),(conditions,{'status':'FAIL'},True),(conditions,privileges,False)):
            self.assertEqual(fidelity_gate.compare(source,target,condition,privilege,expiry)['status'],'FAIL')
        for kind in ('grant','role','function','policy','table','default-acl','type'):
            changed=copy.deepcopy(target)
            changed['objects'].append({'kind':kind,'name':'unexpected','hash':'c'*32,'value':{}})
            self.assertEqual(fidelity_gate.compare(source,changed,conditions,privileges,True)['status'],'FAIL')
        changed=copy.deepcopy(target);changed['schemas'].append('extra')
        self.assertEqual(fidelity_gate.compare(source,changed,conditions,privileges,True)['status'],'FAIL')
        changed=copy.deepcopy(target);changed['objects'].append(changed['objects'][0])
        with self.assertRaises(ValueError):fidelity_gate.compare(source,changed,conditions,privileges,True)


if __name__=='__main__':unittest.main()
