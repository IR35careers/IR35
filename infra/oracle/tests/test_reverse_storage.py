"""73 tiny synthetic files; never reads a customer path or native state."""
import copy
import hashlib
import json
import os
from pathlib import Path
import stat
import sys
import tempfile
import unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from reverse_sync_guest import storage_copy
from p4_recovery_guest import RecoveryError


def locator(bucket,name,version):return '/'.join((bucket,name,version))


@unittest.skipIf(os.name!='posix','POSIX owner/xattr storage fixture')
class ReverseStorageTests(unittest.TestCase):
    def fixture(self,parent):
        root=Path(parent)/'source';root.mkdir(mode=0o700);objects=[]
        for number in range(73):
            body=('synthetic-only café 日本語 '+str(number)).encode()+b'\x00\xff'
            obj={'bucket':'private-synthetic-bucket','name':'contractor-'+str(number)+'.pdf','version':'version-'+str(number),
                 'bytes':str(len(body)),'sha256':hashlib.sha256(body).hexdigest(),
                 'contentType':'application/pdf','cacheControl':'max-age=3600','contentEncoding':'identity'}
            path=root/locator(obj['bucket'],obj['name'],obj['version']);path.parent.mkdir(mode=0o700,parents=True)
            path.write_bytes(body)
            for name,value in (('content-type',obj['contentType']),('cache-control',obj['cacheControl']),('content-encoding',obj['contentEncoding'])):
                os.setxattr(path,'user.supabase.'+name,value.encode())
            path.chmod(0o400);objects.append(obj)
        return root,{'storage':{'privateObjects':objects}}

    def test_full73_byte_xattr_locator_copy_and_manifest_equal_both_hops(self):
        with tempfile.TemporaryDirectory() as temporary:
            source,manifest=self.fixture(temporary)
            one=Path(temporary)/'one';two=Path(temporary)/'two'
            first=storage_copy(source,one,manifest,locator,uid=os.getuid())
            second=storage_copy(one,two,manifest,locator,uid=os.getuid())
            self.assertEqual(first,second);self.assertEqual(first['objects'],73)
            self.assertFalse(first['managedCloudStorageReverseProven'])
            self.assertNotIn('private-synthetic-bucket',json.dumps(first))
            for original in source.rglob('*'):
                if not original.is_file():continue
                destination=two/original.relative_to(source)
                self.assertEqual(original.read_bytes(),destination.read_bytes())
                self.assertEqual(original.stat().st_mtime_ns,destination.stat().st_mtime_ns)
                self.assertEqual(stat.S_IMODE(destination.stat().st_mode),0o400)
                self.assertEqual(destination.stat().st_uid,os.getuid())

    def test_missing_changed_and_unmanifested_source_files_abort(self):
        for mode in ('missing','changed','extra'):
            with self.subTest(mode=mode),tempfile.TemporaryDirectory() as temporary:
                source,manifest=self.fixture(temporary);obj=manifest['storage']['privateObjects'][0]
                file=source/locator(obj['bucket'],obj['name'],obj['version'])
                if mode=='missing':file.unlink()
                elif mode=='changed':file.chmod(0o600);file.write_bytes(b'changed');file.chmod(0o400)
                else:(source/'unmanifested').write_bytes(b'public-fixture')
                with self.assertRaises(RecoveryError):storage_copy(source,Path(temporary)/'target',manifest,locator,uid=os.getuid())

    def test_existing_target_symlink_and_path_escape_are_refused(self):
        with tempfile.TemporaryDirectory() as temporary:
            source,manifest=self.fixture(temporary);existing=Path(temporary)/'existing';existing.mkdir()
            with self.assertRaises(RecoveryError):storage_copy(source,existing,manifest,locator,uid=os.getuid())
            link=Path(temporary)/'link';link.symlink_to(source,target_is_directory=True)
            with self.assertRaises(RecoveryError):storage_copy(link,Path(temporary)/'target',manifest,locator,uid=os.getuid())
            escaped=copy.deepcopy(manifest);escaped['storage']['privateObjects'][0]['name']='../private'
            with self.assertRaises(RecoveryError):storage_copy(source,Path(temporary)/'escaped',escaped,locator,uid=os.getuid())

    def test_same_length_corruption_has_hashed_object_evidence_not_a_raw_name(self):
        with tempfile.TemporaryDirectory() as temporary:
            source,manifest=self.fixture(temporary);obj=manifest['storage']['privateObjects'][0]
            file=source/locator(obj['bucket'],obj['name'],obj['version']);body=file.read_bytes()
            file.chmod(0o600);file.write_bytes(bytes([body[0]^1])+body[1:]);file.chmod(0o400)
            with self.assertRaises(RecoveryError) as error:storage_copy(source,Path(temporary)/'target',manifest,locator,uid=os.getuid())
            report=error.exception.report
            self.assertEqual(report['status'],'FAIL');self.assertNotEqual(report['actualSHA256'],report['expectedSHA256'])
            self.assertNotIn(obj['name'],json.dumps(report));self.assertEqual(len(report['pathHash']),64)

    def test_unmanifested_symlink_directory_and_fifo_fail_before_target_creation(self):
        for kind in ('directory-link','fifo'):
            with self.subTest(kind=kind),tempfile.TemporaryDirectory() as temporary:
                source,manifest=self.fixture(temporary);extra=source/'unmanifested'
                if kind=='directory-link':extra.symlink_to(Path(temporary),target_is_directory=True)
                else:os.mkfifo(extra,0o600)
                target=Path(temporary)/'target'
                with self.assertRaisesRegex(RecoveryError,'ReverseStorageSpecialEntryRefused_Abort'):
                    storage_copy(source,target,manifest,locator,uid=os.getuid())
                self.assertFalse(target.exists())


if __name__=='__main__':unittest.main()
