"""Offline launcher failures must leave complete write-once evidence."""
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import run_hermetic_suite as harness


class HermeticCaptureTests(unittest.TestCase):
    def capture(self, home, response=None, error=None):
        result={'status':'FAIL'}
        with patch.object(harness.subprocess,'run',return_value=response,side_effect=error) as child:
            output=harness.capture_suite(Path('/public-fixture'),home,result)
        self.assertEqual(child.call_args.kwargs['timeout'],180)
        self.assertEqual(child.call_args.kwargs['env'],
            {'HOME':home,'PATH':'/usr/bin:/bin','LANG':'C.UTF-8','PYTHONNOUSERSITE':'1'})
        self.assertEqual(child.call_args.args[0],
            [sys.executable,'-m','unittest','discover','-s','infra/oracle/tests','-v'])
        return result,output

    def test_success_still_requires_actual_test_summary_and_empty_private_home(self):
        with tempfile.TemporaryDirectory() as home:
            reply=subprocess.CompletedProcess([],0,b'fixture stdout',b'Ran 2 tests in 0.01s\nOK\n')
            result,output=self.capture(home,reply)
            self.assertEqual(result['status'],'PASS')
            self.assertEqual(result['tests'],2)
            self.assertEqual(output,(reply.stdout,reply.stderr))
            reply.stderr=b'not a test summary'
            self.assertEqual(self.capture(home,reply)[0]['status'],'FAIL')
            (Path(home)/'.ir35').mkdir()
            reply.stderr=b'Ran 2 tests in 0.01s\nOK\n'
            self.assertEqual(self.capture(home,reply)[0]['status'],'FAIL')

    def test_failed_child_keeps_all_fixture_output_and_fails(self):
        with tempfile.TemporaryDirectory() as home:
            reply=subprocess.CompletedProcess([],1,b'fixture stdout',b'Ran 2 tests in 0.01s\nFAILED\n')
            result,output=self.capture(home,reply)
            self.assertEqual(result['status'],'FAIL')
            self.assertEqual(result['exitCode'],1)
            self.assertEqual(output,(reply.stdout,reply.stderr))

    def test_timeout_keeps_partial_output_without_relaxing_timeout_or_marking_pass(self):
        with tempfile.TemporaryDirectory() as home:
            error=subprocess.TimeoutExpired(['fixture'],180,output=b'partial out',stderr=b'partial err')
            result,output=self.capture(home,error=error)
            self.assertEqual(result['status'],'FAIL')
            self.assertEqual(result['failureCode'],'Unchanged180SecondSuiteTimeout')
            self.assertIsNone(result['exitCode'])
            self.assertEqual(output,(b'partial out',b'partial err'))

    def test_launch_exception_records_category_never_raw_message(self):
        with tempfile.TemporaryDirectory() as home:
            result,output=self.capture(home,error=OSError('private-sentinel-not-for-evidence'))
            self.assertEqual(result['status'],'FAIL')
            self.assertEqual(result['failureCode'],'HermeticChildLaunchFailed')
            self.assertEqual(result['exceptionType'],'OSError')
            self.assertNotIn('private-sentinel',str(result)+str(output))

    def test_artifact_creation_still_refuses_overwrite(self):
        with tempfile.TemporaryDirectory() as home:
            path=Path(home)/'result.json'
            harness.put(path,b'original failure')
            with self.assertRaises(FileExistsError):harness.put(path,b'replacement')
            self.assertEqual(path.read_bytes(),b'original failure')

    def test_source_binding_changes_when_public_helper_changes(self):
        with tempfile.TemporaryDirectory() as home:
            repo=Path(home)
            folder=repo/'infra/oracle'
            folder.mkdir(parents=True)
            source=folder/'fixture.py'
            source.write_text('value=1\n')
            before=harness.python_sources(repo)
            self.assertEqual(set(before),{'infra/oracle/fixture.py'})
            source.write_text('value=2\n')
            self.assertNotEqual(before,harness.python_sources(repo))


if __name__=='__main__':unittest.main()
