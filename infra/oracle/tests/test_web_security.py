import copy
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from web_security import security_versions,deployable_build
from web_build_guest import verify_history
from immutable_artifacts import Store
import web_fixture_guest


class WebSecurityTests(unittest.TestCase):
    def test_exact_patched_lock_required(self):
        lock=json.loads((Path(__file__).resolve().parents[3]/'package-lock.json').read_text())
        self.assertEqual(security_versions(lock)['next'],'16.4.3')
        for name,version in [('next','16.3.2'),('sharp','0.35.4'),('react','19.2.8'),('next','16.4.3-canary.1')]:
            value=copy.deepcopy(lock);value['packages']['node_modules/'+name]['version']=version
            with self.assertRaisesRegex(RuntimeError,'PatchedDependencyLockRequired'):security_versions(value)
        lock['packages']['']['dependencies']['next']='^16.4.3'
        with self.assertRaisesRegex(RuntimeError,'ExactPatchedDependencyPinRequired'):security_versions(lock)

    def test_historical_build_pass_cannot_reach_database(self):
        build=json.loads((Path(__file__).resolve().parents[3]/'docs/evidence/p5/build-2.json').read_text())
        with patch.object(web_fixture_guest,'Recovery') as recovery:
            with self.assertRaisesRegex(RuntimeError,'PatchedNativeBuildRequired'):web_fixture_guest.prepare({'build':build},{})
            recovery.assert_not_called()

    def test_history_preserves_failed_and_passed_artifacts_but_allows_new_patched_source(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);root.chmod(0o700);store=Store(root);anchors={};previous=None
            for index,status in [(1,'FAIL'),(2,'PASS')]:
                stage=store.stage(f'{index:02d}-build')
                store.put(stage,'result.json',json.dumps({'attempt':index,'status':status,'sourceSHA':str(index)*40}).encode())
                previous=store.seal(stage,previous=previous);anchors[stage.name]=previous
            verify_history(store,anchors,'3'*40)
            with self.assertRaisesRegex(RuntimeError,'BuildAlreadyPassed_NoReplay'):verify_history(store,anchors,'2'*40)
            with self.assertRaisesRegex(RuntimeError,'BuildHistoryUnanchoredStage'):verify_history(store,{'01-build':anchors['01-build']},'3'*40)


if __name__=='__main__':unittest.main()
