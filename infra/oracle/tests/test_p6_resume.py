import inspect
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import p6_resume
import p6_worker_build_guest as guest
import p6_mock_receipt_repair_guest as handover
import p6_lifecycle_guest as lifecycle
import p6_health_repair_guest as health


class ResumeTests(unittest.TestCase):
    def test_real_read_only_gates_are_required_and_hash_verified(self):
        result = p6_resume.gates()
        self.assertEqual(result['pidAuditManifestSHA256'],p6_resume.PID_ANCHOR)
        with patch.object(p6_resume,'verified_manifest',return_value='0'*64):
            with self.assertRaisesRegex(RuntimeError,'ActualPIDCorrectedReadOnlyAuditRequired'):p6_resume.gates()

    def test_resume_cannot_mix_with_historical_repairs(self):
        for value in ('true',1,None):
            with self.assertRaisesRegex(RuntimeError,'DistinctOwnerResumeRequired'):guest.run({}, {},owner_resume=value)
        with self.assertRaisesRegex(RuntimeError,'DistinctOwnerResumeRequired'):guest.run({}, {},owner_resume=True,source_repair_two=True)

    def test_journals_and_prior_slots_are_distinct_and_archive_is_exact(self):
        code = inspect.getsource(guest.run)
        self.assertIn("'.env.p6-resume-builds-20261026' if owner_resume",code)
        self.assertIn('historicalBuildSlotsPreserved=True',code)
        self.assertIn('ActualPriorBuildPauseAndPIDPassRequired',code)
        self.assertIn('require_receipt_sources(probe, target)',code)
        controller = inspect.getsource(p6_resume.build)
        self.assertIn("'-c','core.autocrlf=false','archive'",controller)
        self.assertIn('cwd=schema.REPO',controller)
        self.assertIn('destination.open(\'x\'',controller)
        self.assertIn('ResumeBuildThreeFailures_Stop',controller)
        self.assertIn('ResumeBuildAlreadyPassed_NoReplay',controller)

    def test_new_generation_is_explicit_and_paused_from_start_with_no_new_secret(self):
        value = handover.configuration('sha256:'+'a'*64,'b'*40,owner_resume=True)
        worker = value['services']['worker']
        self.assertEqual(worker['container_name'],'ir35-p6-mock-worker-v4')
        self.assertIn('IR35_READ_ONLY=true',worker['entrypoint'])
        self.assertIn('IR35_BUILD_SHA='+'b'*40,worker['entrypoint'])
        self.assertNotIn('environment',worker)
        self.assertEqual(worker['networks'],{'backend':{'aliases':['worker']}})
        self.assertEqual(worker['ports'],['127.0.0.1:8787:8787/tcp'])
        self.assertEqual(worker['restart'],'unless-stopped')

    def test_proxy_names_remain_finite_and_exact_private_target_only(self):
        for name in (health.RESUME_UNIT,health.ROLLBACK_UNIT):
            bodies = health.units('172.30.35.12',unit=name)
            self.assertIn('ListenStream=127.0.0.1:8787',bodies[name+'.socket'])
            self.assertIn('IPAddressAllow=172.30.35.12/32',bodies[name+'.service'])
        for name in ('arbitrary','ir35-p6-health-proxy-r5'):
            with self.assertRaises(RuntimeError):health.units('172.30.35.12',unit=name)
        with self.assertRaises(RuntimeError):health.units('8.8.8.8',unit=health.RESUME_UNIT)

    def test_lifecycle_preserves_all_twelve_original_receipts_and_assertions(self):
        code = inspect.getsource(lifecycle.run)
        self.assertIn('history(data)',code)
        self.assertIn("{'applications':12,'schedules':0,'applyJobs':12}",code)
        self.assertIn('retained-all-twelve-receipt',code)
        self.assertIn("'18-owner-resume-lifecycle' if owner_resume",code)
        self.assertIn("expect_http('reject-employer-url', 'POST', '/mock/applications', invalid, 400)",code)
        self.assertIn("runtime['run'](['docker', 'restart'",code)
        self.assertIn('no-browser-orphans',code)
        self.assertIn('durable-mock-schedules',code)

    def test_rollback_uses_previous_image_without_resuming_processing_or_editing_env(self):
        code = inspect.getsource(handover.paused_rollback)
        self.assertIn("configuration(prior['image'],prior['sourceSHA'],owner_resume=True)",code)
        self.assertIn("path.open('x')",code)
        self.assertIn("observed.get('paused') is not True",code)
        self.assertIn('Original',inspect.getsource(handover.run))
        for forbidden in ('ALTER ROLE','UPDATE ','private_new(',"'--env-file','.env.p6-mock-worker'"):
            self.assertNotIn(forbidden,code)


if __name__ == '__main__':unittest.main()
