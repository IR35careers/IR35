import ast
import inspect
from pathlib import Path
import sys
import unittest
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import p6_context
import p6_inventory_guest


class P6InventoryTests(unittest.TestCase):
    def test_actual_sdk_codes_and_containment_required_not_just_claimed_pass(self):
        import copy
        data={'status':'PASS','containment':{'status':'PASS'},'activation':{'cases':[
            {'case':name,'expectedStatus':status,'actualStatus':status,'passed':True}
            for name,status in [('sdk-missing',401),('sdk-suffix',401),('sdk-valid',200)]]}}
        p6_context.require_sdk(data)
        for index in range(3):
            bad=copy.deepcopy(data);bad['activation']['cases'][index]['actualStatus']=404
            with self.assertRaisesRegex(RuntimeError,'ActualP5SDK'):p6_context.require_sdk(bad)
        bad=copy.deepcopy(data);bad['containment']['status']='FAIL'
        with self.assertRaisesRegex(RuntimeError,'ActualP5SDK'):p6_context.require_sdk(bad)

    def test_wrong_branch_refuses_before_private_recovery_state(self):
        with patch.object(p6_context.subprocess,'check_output',return_value='main\n'),patch.object(p6_context.p4_recovery,'reports') as reports:
            with self.assertRaisesRegex(RuntimeError,'P6BranchRequired'):p6_context.context()
        reports.assert_not_called()

    def test_bundle_compiles_without_executing_any_old_activation(self):
        with patch.object(p6_context.schema,'guest_bundle',return_value=''):
            source=p6_context.bundle()
        compile(source,'p6-readonly-bundle','exec')
        self.assertNotIn('.activate(',source)
        self.assertNotIn('sdk_owner1_guest"].run(',source)

    def test_inventory_sql_is_select_only_and_never_requests_password_value(self):
        tree=ast.parse(inspect.getsource(p6_inventory_guest));queries=[]
        for node in ast.walk(tree):
            if isinstance(node,ast.Call) and isinstance(node.func,ast.Attribute) and node.func.attr=='query':
                queries.append(node)
                self.assertTrue(isinstance(node.args[0],ast.Constant) and node.args[0].value.startswith('SELECT '))
                self.assertFalse(any(kw.arg=='readonly' and isinstance(kw.value,ast.Constant) and kw.value.value is False for kw in node.keywords))
                self.assertNotIn('SELECT rolpassword',node.args[0].value)
                self.assertNotIn('md5(rolpassword)',node.args[0].value)
        self.assertEqual(len(queries),2)


if __name__=='__main__':unittest.main()
