"""Optional public-fixture TMPDIR never changes the default test gate."""
from contextlib import redirect_stdout
import hashlib
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import run_hermetic_suite as harness


class HermeticTmpdirTests(unittest.TestCase):
    def run_capture(self, home, fixture=None, response=None, error=None):
        result={'status':'FAIL'}
        if response is None:response=subprocess.CompletedProcess([],0,b'public output',b'Ran 2 tests in 0.01s\nOK\n')
        with patch.dict(os.environ,{'PRIVATE_SENTINEL':'never-forward-this'},clear=False), \
                patch.object(harness.subprocess,'run',return_value=response,side_effect=error) as child:
            output=harness.capture_suite(Path('/public-fixture'),home,result,fixture_temp_dir=fixture)
        return result,output,child

    def test_default_environment_argv_and_deadline_are_exactly_unchanged(self):
        with tempfile.TemporaryDirectory() as home:
            result,_output,child=self.run_capture(home)
            self.assertEqual(result['status'],'PASS')
            self.assertEqual(child.call_args.kwargs['env'],
                {'HOME':home,'PATH':'/usr/bin:/bin','LANG':'C.UTF-8','PYTHONNOUSERSITE':'1'})
            self.assertEqual(child.call_args.args[0],
                [sys.executable,'-m','unittest','discover','-s','infra/oracle/tests','-v'])
            self.assertEqual(child.call_args.kwargs['timeout'],180)

    def test_optional_tmpdir_adds_only_one_cleared_environment_name(self):
        with tempfile.TemporaryDirectory() as home,tempfile.TemporaryDirectory() as fixture:
            result,_output,child=self.run_capture(home,fixture)
            self.assertEqual(result['status'],'PASS')
            self.assertEqual(child.call_args.kwargs['env'],
                {'HOME':home,'PATH':'/usr/bin:/bin','LANG':'C.UTF-8','PYTHONNOUSERSITE':'1','TMPDIR':fixture})
            self.assertEqual(child.call_args.kwargs['timeout'],180)
            self.assertEqual(child.call_args.args[0],
                [sys.executable,'-m','unittest','discover','-s','infra/oracle/tests','-v'])
            self.assertFalse((Path(home)/'.ir35').exists())
            self.assertEqual(list(Path(fixture).iterdir()),[])

    def test_relative_missing_file_nonempty_and_overpermissive_fixture_fail_before_child(self):
        with tempfile.TemporaryDirectory() as home,tempfile.TemporaryDirectory() as fixture:
            base=Path(fixture)
            file=base/'file'
            file.write_text('public fixture')
            empty=base/'empty'
            empty.mkdir(mode=0o700)
            unsafe=base/'unsafe'
            unsafe.mkdir(mode=0o755)
            unsafe.chmod(0o755)
            for value in ('relative-fixture',str(base/'missing'),str(file),str(base),str(unsafe)):
                with self.subTest(kind=Path(value).name):
                    result,output,child=self.run_capture(home,value)
                    self.assertEqual(result['status'],'FAIL')
                    self.assertEqual(result['failureCode'],'HermeticChildLaunchFailed')
                    child.assert_not_called()
                    self.assertEqual(output,(b'',b''))
                    self.assertNotIn(str(base),str(result))

    def test_symlink_and_symlinked_parent_fail_closed(self):
        with tempfile.TemporaryDirectory() as home,tempfile.TemporaryDirectory() as fixture:
            target=Path(fixture)/'target'
            target.mkdir(mode=0o700)
            nested=target/'nested'
            nested.mkdir(mode=0o700)
            link=Path(fixture)/'link'
            link.symlink_to(target,target_is_directory=True)
            for value in (str(link),str(link/'nested')):
                result,_output,child=self.run_capture(home,value)
                self.assertEqual(result['status'],'FAIL')
                child.assert_not_called()

    def test_another_owner_is_rejected_without_a_process(self):
        with tempfile.TemporaryDirectory() as home,tempfile.TemporaryDirectory() as fixture:
            with patch.object(harness.os,'geteuid',return_value=Path(fixture).stat().st_uid+1):
                result,_output,child=self.run_capture(home,fixture)
            self.assertEqual(result['status'],'FAIL')
            child.assert_not_called()

    def test_optional_tmpdir_retains_timeout_partial_logs_and_failure(self):
        with tempfile.TemporaryDirectory() as home,tempfile.TemporaryDirectory() as fixture:
            failure=subprocess.TimeoutExpired(['public fixture'],180,output=b'partial out',stderr=b'partial err')
            result,output,child=self.run_capture(home,fixture,error=failure)
            self.assertEqual(result['status'],'FAIL')
            self.assertEqual(result['failureCode'],'Unchanged180SecondSuiteTimeout')
            self.assertEqual(output,(b'partial out',b'partial err'))
            self.assertEqual(child.call_args.kwargs['timeout'],180)

    def test_private_home_or_missing_summary_can_never_pass_with_tmpdir(self):
        with tempfile.TemporaryDirectory() as home,tempfile.TemporaryDirectory() as fixture:
            (Path(home)/'.ir35').mkdir()
            self.assertEqual(self.run_capture(home,fixture)[0]['status'],'FAIL')
        with tempfile.TemporaryDirectory() as home,tempfile.TemporaryDirectory() as fixture:
            reply=subprocess.CompletedProcess([],0,b'',b'no test summary')
            self.assertEqual(self.run_capture(home,fixture,response=reply)[0]['status'],'FAIL')

    def test_tmpfs_wrapper_records_empty_owned_fixtures_and_no_mocked_fsync(self):
        original_temporary=tempfile.TemporaryDirectory
        with original_temporary() as public_root:
            root=Path(public_root)
            actual_directories=[]
            def public_temp(**kwargs):
                self.assertEqual(kwargs['dir'],'/dev/shm')
                directory=original_temporary(prefix=kwargs['prefix'],dir=public_root)
                actual_directories.append(Path(directory.name))
                return directory
            result={'status':'FAIL'}
            reply=subprocess.CompletedProcess([],0,b'public output',b'Ran 2 tests in 0.01s\nOK\n')
            with patch.object(harness,'tmpfs_metadata',return_value={'fixtureFilesystem':'tmpfs','fixtureFreeBytesBefore':1024**3}), \
                    patch.object(harness.tempfile,'TemporaryDirectory',side_effect=public_temp), \
                    patch.object(harness.subprocess,'run',return_value=reply) as child:
                stdout,stderr=harness.capture_tmpfs_suite(root,root,result)
            intent=json.loads((root/'intent.json').read_bytes())
            self.assertEqual(result['status'],'PASS')
            self.assertTrue(intent['freshHomeEmpty'])
            self.assertTrue(intent['fixtureEmptyBefore'])
            self.assertEqual(intent['environmentNames'],['HOME','PATH','LANG','PYTHONNOUSERSITE','TMPDIR'])
            self.assertEqual(intent['deadlineSeconds'],180)
            self.assertFalse(intent['fsyncMocked'])
            self.assertFalse(intent['privateStateCopied'])
            self.assertFalse(intent['assertionsChanged'])
            self.assertEqual(intent['testsRemoved'],0)
            self.assertEqual(result['fixtureRemainingEntries'],0)
            self.assertFalse(result['fullReleasePassClaimed'])
            self.assertFalse(result['productionDurabilityClaimed'])
            self.assertEqual(child.call_args.kwargs['timeout'],180)
            self.assertEqual((stdout,stderr),(reply.stdout,reply.stderr))
            self.assertEqual(len(actual_directories),2)
            self.assertTrue(all(not directory.exists() for directory in actual_directories))
            with self.assertRaises(FileExistsError):harness.put(root/'intent.json',b'replacement')

    def test_preparation_failure_records_category_without_raw_path_or_exception(self):
        with tempfile.TemporaryDirectory() as public_root:
            result={'status':'FAIL'}
            with patch.object(harness,'tmpfs_metadata',side_effect=OSError('private-sentinel-never-record')), \
                    patch.object(harness.subprocess,'run') as child:
                output=harness.capture_tmpfs_suite(Path(public_root),Path(public_root),result)
            self.assertEqual(result['status'],'FAIL')
            self.assertEqual(result['failureCode'],'HermeticTmpfsPreparationFailed')
            self.assertEqual(result['exceptionType'],'OSError')
            self.assertEqual(output,(b'',b''))
            self.assertNotIn('private-sentinel',str(result))
            child.assert_not_called()

    def test_sealed_predecessor_checks_every_artifact_and_refuses_overwrite(self):
        with tempfile.TemporaryDirectory() as public_root:
            repo=Path(public_root)
            root=repo/'docs/evidence/public-fixture'
            root.mkdir(parents=True)
            body=b'{"status":"FAIL"}\n'
            harness.put(root/'result.json',body)
            manifest={'version':1,'artifacts':[{'name':'result.json','sha256':hashlib.sha256(body).hexdigest()}]}
            encoded=json.dumps(manifest).encode()
            harness.put(root/'manifest.json',encoded)
            digest=hashlib.sha256(encoded).hexdigest()
            self.assertEqual(harness.sealed_predecessor(repo,'public-fixture',digest)[1],{'status':'FAIL'})
            with self.assertRaisesRegex(RuntimeError,'OriginalHermeticEvidenceRequired'):
                harness.sealed_predecessor(repo,'public-fixture','0'*64)
            harness.put(root/'extra.log',b'public extra')
            with self.assertRaisesRegex(RuntimeError,'OriginalHermeticArtifactSetChanged'):
                harness.sealed_predecessor(repo,'public-fixture',digest)
            with self.assertRaises(FileExistsError):harness.put(root/'result.json',b'overwrite')

    def test_fixed_slot_refuses_replay_before_capture(self):
        with tempfile.TemporaryDirectory() as public_root:
            repo=Path(public_root)
            script=repo/'infra/oracle/run_hermetic_suite.py'
            root=repo/'docs/evidence'/harness.TMPFS_SLOT
            root.mkdir(parents=True)
            harness.put(root/'original-failure.log',b'preserve')
            with patch.object(harness,'__file__',str(script)), \
                    patch.object(harness.sys,'argv',[str(script),harness.TMPFS_SLOT]), \
                    patch.object(harness,'verify_tmpfs_predecessors') as verify, \
                    patch.object(harness,'capture_tmpfs_suite') as capture, redirect_stdout(io.StringIO()):
                with self.assertRaises(FileExistsError):harness.main()
            verify.assert_called_once_with(repo)
            capture.assert_not_called()
            self.assertEqual((root/'original-failure.log').read_bytes(),b'preserve')


if __name__=='__main__':unittest.main()
