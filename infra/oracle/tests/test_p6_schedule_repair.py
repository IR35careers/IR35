import inspect
from pathlib import Path
import sys
import unittest
from unittest.mock import Mock,patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import p6_schedule_repair as controller
import p6_schedule_repair_guest as guest
import p6_schedule_drain_guest as drain_guest


class ScheduleRepairTests(unittest.TestCase):
    def test_diagnosis_can_only_read_and_never_restarts_or_republishes(self):
        source=inspect.getsource(guest)
        for forbidden in ('UPDATE ','INSERT ','DELETE ','ALTER ',"'docker','start'",'private_new(',"'POST'"):
            self.assertNotIn(forbidden,source)
        self.assertIn('vmWrites',source)
        self.assertIn('queuePolicyChanges',source)
        self.assertIn('read',inspect.getsource(controller))

    def test_unknown_command_and_repeated_diagnosis_refuse_before_context(self):
        with patch.object(controller.sys,'argv',['script']),patch.object(controller,'data') as context:
            with self.assertRaisesRegex(RuntimeError,'ExplicitReadOnlyScheduleDiagnosisRequired'):controller.main()
        context.assert_not_called()

    def test_actual_failure_rollback_and_all_prior_passing_cases_are_required(self):
        source=inspect.getsource(guest.retained)
        self.assertIn('anchored_result(store',source)
        self.assertIn('ExactScheduleFailureAndRollbackRequired',source)
        self.assertIn("not all(row.get('passed') is True",source)
        self.assertIn('len(new)!=11',source)
        self.assertIn("{'status':202,'value':{'mock':True,'queued':False}}",source)

    def test_no_unknown_queue_residue_or_changed_original_receipt_is_accepted(self):
        source=inspect.getsource(guest.observe)
        self.assertIn('len(applications)==23',source)
        self.assertIn('row==expected',source)
        self.assertIn('len(apply)==22',source)
        self.assertIn('len(commands)==1',source)
        self.assertIn('len(jobs)==23',source)
        self.assertIn('RetainedScheduleDataOrSecurityMismatch_Abort',source)
        self.assertIn('singletonKey',source)

    def test_drain_refuses_changed_pending_intent_before_stage_or_mutation(self):
        store=Mock();run=Mock()
        data={'pauseHandover':{'status':'PASS','containerName':'ir35-p6-mock-worker-v5'},
              'scheduleDiagnosis':{'observation':{'ledgerSHA256':'original'}}}
        for observation in ({'ledgerSHA256':'changed','pendingScheduleJobs':1}, {'ledgerSHA256':'original','pendingScheduleJobs':0}):
            with patch.object(drain_guest,'prepared',return_value=store),patch.object(drain_guest,'anchored_result'),patch.object(drain_guest,'observe',return_value=(observation,{})):
                with self.assertRaisesRegex(RuntimeError,'PendingScheduleChangedBeforeDrain_Abort'):drain_guest.drain(data,{'run':run})
        store.stage.assert_not_called();run.assert_not_called()

    def test_drain_is_one_owned_command_without_new_publications_or_catalog_edits(self):
        source=inspect.getsource(drain_guest.drain)
        self.assertIn('23-owner-schedule-intent-drain',source)
        self.assertIn('newPublicationsAllowed',source)
        self.assertIn("'peakActive')==0",source)
        self.assertIn('zero-application-processing',source)
        self.assertIn("'postBoundary'",source)
        self.assertIn("check_containment(data,runtime,store,stage,'post')",source)
        for forbidden in ('INSERT ','UPDATE ','DELETE ','ALTER ','GRANT ','REVOKE ','/mock/schedule','/mock/applications'):
            self.assertNotIn(forbidden,source)


if __name__=='__main__':unittest.main()
