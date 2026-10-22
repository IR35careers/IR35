import json
import os
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from immutable_artifacts import Store,ArtifactError


class ArtifactTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name);os.chmod(self.root,0o700);self.store=Store(self.root)
    def tearDown(self):
        for directory in self.root.iterdir():
            if directory.is_dir():os.chmod(directory,0o700)
        self.temp.cleanup()
    def test_every_helper_put_refuses_existing_file_even_if_writable(self):
        stage=self.store.stage('01-source');self.store.put(stage,'dump.bin',b'original')
        os.chmod(stage/'dump.bin',0o600)
        with self.assertRaises(FileExistsError):self.store.put(stage,'dump.bin',b'overwrite')
        self.assertEqual((stage/'dump.bin').read_bytes(),b'original')
    def test_seal_verify_and_no_second_stage_or_manifest(self):
        stage=self.store.stage('01-source');self.store.put(stage,'reference.json',b'{}');anchor=self.store.seal(stage)
        self.assertEqual(self.store.verify(stage.name,anchor)['artifacts'][0]['name'],'reference.json')
        with self.assertRaises(FileExistsError):self.store.stage('01-source')
        with self.assertRaises((ArtifactError,FileExistsError,PermissionError)):self.store.seal(stage)
    def test_tampering_extra_file_and_link_fail(self):
        stage=self.store.stage('01-source');self.store.put(stage,'dump.bin',b'original');anchor=self.store.seal(stage)
        os.chmod(stage/'dump.bin',0o600);(stage/'dump.bin').write_bytes(b'changed');os.chmod(stage/'dump.bin',0o400)
        with self.assertRaisesRegex(ArtifactError,'hash mismatch'):self.store.verify(stage.name,anchor)
    def test_manifest_cannot_point_outside_or_skip_unknown_files(self):
        with self.assertRaisesRegex(ArtifactError,'Fixed stage'):self.store.verify('../elsewhere','0'*64)
        stage=self.store.stage('01-source');self.store.put(stage,'dump.bin',b'original');anchor=self.store.seal(stage)
        os.chmod(stage,0o700);(stage/'extra').write_bytes(b'extra');os.chmod(stage,0o500)
        with self.assertRaisesRegex(ArtifactError,'Unmanifested'):self.store.verify(stage.name,anchor)
    def test_namespace_cannot_redirect_artifact_destination(self):
        stage=self.store.stage('01-source');namespace={'path':self.root/'some-source'}
        exec("path='unrelated';record={'status':'failure'}",namespace)
        self.store.put(stage,'failure.json',json.dumps(namespace['record']).encode())
        self.assertFalse((self.root/'some-source').exists())
        with self.assertRaisesRegex(ArtifactError,'filename'):self.store.put(stage,'../source',b'bad')


if __name__=='__main__':unittest.main()
