import inspect
from pathlib import Path
import sys
import unittest
from unittest.mock import Mock,patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import p6_schedule_repair as controller
import p6_schedule_repair_guest as guest


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


if __name__=='__main__':unittest.main()
