import copy
import inspect
import json
from pathlib import Path
import sys
import unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import p6_capture_repair as controller
import p6_capture_repair_guest as guest
import p6_integration_guest as integration
import p6_lifecycle_guest as lifecycle


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
    def test_new_full_allowance_never_replays_used_stages_or_isolated_dispatch(self):
        source=inspect.getsource(guest.full)
        self.assertEqual(source.count('lifecycle(data,runtime'),1)
        self.assertNotIn('dispatch_once',source)
        self.assertNotIn('drain(data',source)
        self.assertIn("stage('35-owner-capture-one-full-p6')",source)
        self.assertIn("stage('38-owner-capture-app-realtime-schedules')",source)
        self.assertIn("stage('39-owner-capture-failure-rollback')",source)
        self.assertLess(source.index('integration.verify'),source.index("result['fullContainment']=containment"))
        self.assertIn('restore_worker(data,runtime)',source)
        self.assertIn('integration.restore(data,runtime',source)
    def test_new_full_baseline_is_45_exact_receipts_with_drained_job_not_old_assertion_edits(self):
        source=inspect.getsource(lifecycle.run)
        self.assertIn("{'applications':45,'schedules':8,'applyJobs':42}",source)
        self.assertIn("{'applications':34,'schedules':data['fixedScheduleRowsBefore'],'applyJobs':32}",source)
        self.assertIn('NativeMockRestartHealthDeadline',source)
        self.assertIn('time.monotonic() + 90',source)
        self.assertIn('fixedip-every-owned-schedule-durable',source)
        self.assertIn('durable-after-restart',source)
    def test_new_timer_uses_fixed_dispatcher_and_sealed_journal_capture_without_secret_args(self):
        for operation in ('mock_ingest','mock_automation','watchdog'):
            name,bodies=integration.timer_units(operation,'03',capture_repair=True)
            self.assertTrue(name.endswith('-decoder3'))
            service=bodies[name+'.service']
            self.assertIn('p6-mock-schedule-capture3.py '+operation,service)
            self.assertIn('StandardError=journal',service)
            self.assertIn('IPAddressDeny=any',service)
            self.assertIn('IPAddressAllow=127.0.0.1/32',service)
            self.assertNotIn('SECRET=',service);self.assertNotIn('Environment=',service)
        verify=inspect.getsource(integration.verify)
        self.assertIn("dispatch_once(name+'.service'",verify)
    def test_restore_keeps_original_container_and_never_recreates_or_retargets(self):
        source=inspect.getsource(guest.restore_worker)
        self.assertIn("['docker','start',ROLLBACK_NAME]",source)
        self.assertNotIn('launch(',source);self.assertNotIn('install_proxy(',source)
        self.assertNotIn('docker network',source)


if __name__=='__main__':unittest.main()
