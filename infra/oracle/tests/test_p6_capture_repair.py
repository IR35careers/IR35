import copy
import inspect
import json
from pathlib import Path
import sys
import unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import p6_capture_repair as controller
import p6_capture_repair_guest as guest


class CaptureRepairTests(unittest.TestCase):
    def test_known_job_can_only_complete_without_any_other_row_change(self):
        jobs=[{'id':str(n),'state':'completed','retry_count':0} for n in range(49)]
        jobs.append({'id':guest.PENDING,'state':'created','retry_count':0})
        before={'jobs':jobs,'applications':[{'state':'submitted'}],'schedules':7}
        after=copy.deepcopy(before);after['jobs'][-1]['state']='completed';after['schedules']=8
        self.assertEqual(guest.drained_exact(before,after)['status'],'PASS')
        for change in ('republish','delete','other-row','app','extra-receipt','retry'):
            wrong=copy.deepcopy(after)
            if change=='republish':wrong['jobs'][-1]['id']='replacement'
            if change=='delete':wrong['jobs'].pop(0)
            if change=='other-row':wrong['jobs'][0]['state']='active'
            if change=='app':wrong['applications'][0]['state']='failed'
            if change=='extra-receipt':wrong['schedules']=9
            if change=='retry':wrong['jobs'][-1]['retry_count']=1
            self.assertEqual(guest.drained_exact(before,wrong)['status'],'FAIL',change)
    def test_drain_never_publishes_or_starts_systemctl_dispatch_and_restores_in_finally(self):
        source=inspect.getsource(guest.drain)
        self.assertNotIn('/mock/schedule',source);self.assertNotIn('dispatch_once',source)
        self.assertNotIn("'systemctl','start'",source)
        self.assertIn('finally:',source);self.assertIn('restored_equal(before,after)',source)
        self.assertIn('containment(data,runtime',source)
    def test_complete_public_remote_bundle_compiles_without_execution(self):
        compile(controller.bundle(),'<capture-public-bootstrap>','exec')


if __name__=='__main__':unittest.main()
