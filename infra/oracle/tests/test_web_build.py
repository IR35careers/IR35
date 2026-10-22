import io
import json
import sys
import tarfile
import unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from web_build_guest import safe_members,public_build_env


def archive(name,kind=tarfile.REGTYPE):
    body=io.BytesIO()
    with tarfile.open(fileobj=body,mode='w') as writer:
        item=tarfile.TarInfo(name);item.type=kind;item.size=0;writer.addfile(item)
    body.seek(0);return tarfile.open(fileobj=body,mode='r:')


class WebBuildTests(unittest.TestCase):
    def test_exclusive_archive_boundary(self):
        for name,kind in [('../escape',tarfile.REGTYPE),('/absolute',tarfile.REGTYPE),('.env',tarfile.REGTYPE),('a/.vercel/project.json',tarfile.REGTYPE),('link',tarfile.SYMTYPE)]:
            with archive(name,kind) as value:
                with self.assertRaises(RuntimeError):safe_members(value)
        with archive('.env.example') as value:self.assertEqual(len(safe_members(value)),1)

    def test_build_receives_only_fresh_public_settings_not_service_or_provider_secrets(self):
        import base64
        payload=base64.urlsafe_b64encode(json.dumps({'role':'anon'}).encode()).decode().rstrip('=')
        result=public_build_env({'ANON_KEY':'header.'+payload+'.signature','SERVICE_ROLE_KEY':'never-copy','SMTP_PASS':'never-copy'})
        self.assertEqual(set(result),{'NEXT_PUBLIC_SUPABASE_URL','NEXT_PUBLIC_SUPABASE_ANON_KEY'})
        self.assertNotIn('never-copy',str(result))
        with self.assertRaises(RuntimeError):public_build_env({'ANON_KEY':'bad'})


if __name__=='__main__':unittest.main()
