import ast
from pathlib import Path
import sys
import unittest
from tempfile import TemporaryDirectory
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import p6_worker_build
import p6_worker_build_guest as guest


class P6WorkerBuildTests(unittest.TestCase):
    def test_last_build_requires_both_exact_native_probe_source_hashes(self):
        with TemporaryDirectory() as temporary:
            target = Path(temporary)
            folder = target / 'services/application-worker'
            folder.mkdir(parents=True)
            for name in ('mock-browser.ts', 'mock-ats.ts'):
                (folder / name).write_bytes(b'public fixture source')
            proof = {'publicSourceSHA256': {name: guest.digest(b'public fixture source') for name in ('mock-browser.ts', 'mock-ats.ts')}}
            guest.require_receipt_sources(proof, target)
            (folder / 'mock-browser.ts').write_bytes(b'changed after browser verification')
            with self.assertRaisesRegex(RuntimeError, 'ThirdBuildSourceMustMatchNativeSixScenarioProbe'):
                guest.require_receipt_sources(proof, target)
            with self.assertRaisesRegex(RuntimeError, 'ThirdBuildSourceMustMatchNativeSixScenarioProbe'):
                guest.require_receipt_sources({'publicSourceSHA256': {}}, target)

    def test_source_bundle_compiles_and_does_not_execute_prior_controllers(self):
        with patch.object(p6_worker_build.p6_context.schema,'guest_bundle',return_value=''):
            code=p6_worker_build.bundle()
        compile(code,'p6-build-only','exec')
        self.assertNotIn('.activate(',code)
        self.assertNotIn('p6_roles_guest"].install(',code)

    def test_attempts_are_bounded_before_remote_private_state_or_creation(self):
        for attempt in (0,4,'1'):
            with patch.object(guest,'Store') as store:
                with self.assertRaisesRegex(RuntimeError,'BoundedP6SourceBuildRequired'):guest.run({'sourceSHA':'a'*40,'attempt':attempt},{})
            store.assert_not_called()

    def test_build_recipe_has_no_credentials_and_keeps_the_verified_native_browser_pin(self):
        root=Path(__file__).resolve().parents[3]
        recipe=(root/'services/application-worker/Dockerfile.mock').read_text()
        original=(root/'services/application-worker/Dockerfile').read_text()
        self.assertEqual(recipe.splitlines()[0],original.splitlines()[0])
        self.assertIn('USER 1002:1002',recipe);self.assertIn('npm ci --ignore-scripts',recipe)
        self.assertNotIn('.env',recipe);self.assertNotIn('ACCEPT_JOBS=true',recipe)
        text=Path(guest.__file__).read_text();ast.parse(text)
        self.assertIn("'--network','none'",text);self.assertIn("'serviceChanges':0",text)
        self.assertNotIn('docker push',text);self.assertNotIn("'--env-file'",text)


if __name__=='__main__':unittest.main()
