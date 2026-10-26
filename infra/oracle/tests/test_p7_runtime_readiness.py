import copy
import inspect
from pathlib import Path
import sys
import unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import p7_runtime_readiness as readiness
from offline_bundle_fixture import public_bootstrap


class RuntimeReadinessTests(unittest.TestCase):
    def row(self):
        path='/opt/ir35/.env.p5-auth'
        return {'Config':{'Entrypoint':['/run/ir35/env-exec'],'Cmd':[path,'gotrue'],'Env':[]},
            'State':{'Running':True},'Mounts':[{'Source':path,'Destination':path,'RW':False}]}
    def test_runtime_file_proof_does_not_confuse_docker_image_environment(self):
        row=self.row();self.assertTrue(readiness.private_auth_launcher(row))
        row['Config']['Env']=['GOTRUE_SMTP_HOST=not-effective-image-default']
        self.assertTrue(readiness.private_auth_launcher(row))
    def test_missing_wrong_or_writable_mount_or_launcher_fails_closed(self):
        for change in ('missing','source','destination','writable','launcher','stopped'):
            row=self.row()
            if change=='missing':row['Mounts']=[]
            elif change in ('source','destination'):row['Mounts'][0][change.title()]='/wrong'
            elif change=='writable':row['Mounts'][0]['RW']=True
            elif change=='launcher':row['Config']['Entrypoint']=['wrong']
            else:row['State']['Running']=False
            self.assertFalse(readiness.private_auth_launcher(row))
    def test_complete_bundle_compiles_offline_and_contains_no_new_auth_or_write_operation(self):
        with public_bootstrap():code=readiness.program({'fixture':'public-only'})
        compile(code,'<readiness-fixture>','exec')
        source=inspect.getsource(readiness.program)
        for forbidden in ('/auth/v1/token','/recover','/otp','docker restart','write_text','put_file'):
            self.assertNotIn(forbidden,source)
        self.assertIn('containment(data,runtime',source)
        self.assertIn("private_env(ROOT/'.env.p5-auth')",source)


if __name__=='__main__':unittest.main()
