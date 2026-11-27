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
        self.assertEqual(security_versions(lock)['next'],'16.4.6')
        for name,version in [('next','16.3.2'),('next','16.4.3'),('eslint-config-next','16.4.3'),
                             ('sharp','0.35.4'),('react','19.2.8'),('next','16.4.3-canary.1'),
                             ('next','16.4.6-canary.1')]:
            value=copy.deepcopy(lock);value['packages']['node_modules/'+name]['version']=version
            with self.assertRaisesRegex(RuntimeError,'PatchedDependencyLockRequired'):security_versions(value)
        lock['packages']['']['dependencies']['next']='^16.4.6'
        with self.assertRaisesRegex(RuntimeError,'ExactPatchedDependencyPinRequired'):security_versions(lock)

    def test_integrity_is_required_for_every_exact_package(self):
        lock=json.loads((Path(__file__).resolve().parents[3]/'package-lock.json').read_text())
        for name in security_versions(lock):
            value=copy.deepcopy(lock);value['packages']['node_modules/'+name]['integrity']='sha256-invalid'
            with self.subTest(package=name),self.assertRaisesRegex(RuntimeError,'PatchedDependencyLockRequired'):
                security_versions(value)

    def test_new_build_metadata_is_exact_and_old_or_canary_builds_are_not_relabelled(self):
        lock=json.loads((Path(__file__).resolve().parents[3]/'package-lock.json').read_text())
        build={'status':'PASS','architecture':'linux/arm64','nonroot':True,
               'image':'sha256:'+'a'*64,'sourceSHA':'b'*40,'securityVersions':security_versions(lock)}
        deployable_build(build)
        for version in ('16.3.2','16.4.3','16.4.3-canary.1','16.4.6-canary.1'):
            value=copy.deepcopy(build);value['securityVersions']['next']=version
            with self.subTest(version=version),self.assertRaisesRegex(RuntimeError,'PatchedNativeBuildRequired'):
                deployable_build(value)

    def test_native_image_probe_requires_the_new_exact_framework_and_keeps_its_sandbox(self):
        from test_p8_images import ImageTests
        guest=ImageTests().guest_module()
        image={'Id':'sha256:'+'c'*64,'Architecture':'arm64','Os':'linux',
               'Config':{'User':'1002:1002'},'Size':1234}
        for version in ('16.4.6','16.3.2','16.4.3','16.4.3-canary.1','16.4.6-canary.1'):
            calls=[]
            def run(arguments):
                calls.append(arguments)
                return json.dumps([image] if arguments[:3]==['docker','image','inspect'] else
                    {'next':version,'react':'19.2.9','react-dom':'19.2.9','sharp':'0.35.5'})
            if version=='16.4.6':
                self.assertEqual(guest.image_probe({'run':run},'synthetic-image','web')['probe']['next'],version)
            else:
                with self.subTest(version=version),self.assertRaisesRegex(RuntimeError,'NativeImagePackageOrEntrypointProbeMismatch'):
                    guest.image_probe({'run':run},'synthetic-image','web')
            self.assertEqual(len(calls),2)
            self.assertIn('--read-only',calls[1]);self.assertIn('--cap-drop',calls[1])
            self.assertEqual(calls[1][calls[1].index('--network')+1],'none')

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
