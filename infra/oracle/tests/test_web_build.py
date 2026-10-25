import io
import json
import sys
import tarfile
import unittest
import tempfile
import subprocess
from unittest.mock import patch
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from web_build_guest import safe_members,public_build_env
import web_build
from web_build import git_command


def archive(name,kind=tarfile.REGTYPE):
    body=io.BytesIO()
    with tarfile.open(fileobj=body,mode='w') as writer:
        item=tarfile.TarInfo(name);item.type=kind;item.size=0;writer.addfile(item)
    body.seek(0);return tarfile.open(fileobj=body,mode='r:')


class WebBuildTests(unittest.TestCase):
    def test_dirty_source_refuses_before_ssh_or_build(self):
        with tempfile.TemporaryDirectory() as directory,patch.object(web_build.schema,'REPO',Path(directory)),patch.object(web_build.subprocess,'check_output',return_value=' M package-lock.json\n'),patch.object(web_build.schema,'run_guest') as remote:
            with self.assertRaisesRegex(RuntimeError,'CommittedCleanSourceRequired'):web_build.build()
            remote.assert_not_called()

    def test_windows_worktree_pointer_is_mapped_without_rewriting_it(self):
        with tempfile.TemporaryDirectory() as directory:
            repo=Path(directory);pointer=repo/'.git'
            body='gitdir: C:/approved/project/.git/worktrees/staging\n';pointer.write_text(body)
            command=git_command(repo)
            self.assertIn('--git-dir=/mnt/c/approved/project/.git/worktrees/staging',command)
            self.assertIn('--work-tree='+str(repo),command)
            self.assertEqual(pointer.read_text(),body)
            self.assertIn('core.autocrlf=true',command)
            self.assertEqual(command[1:3], ['-C', str(repo)])

    def test_archive_from_nested_infra_directory_still_contains_repository_root(self):
        repo = Path(__file__).resolve().parents[3]
        body = subprocess.check_output(git_command(repo) + ['archive', '--format=tar', 'HEAD'], cwd=repo / 'infra/oracle')
        with tarfile.open(fileobj=io.BytesIO(body), mode='r:') as snapshot:
            names = set(snapshot.getnames())
        self.assertIn('package.json', names)
        self.assertIn('services/application-worker/Dockerfile.mock', names)
        self.assertIn('services/application-worker/mock-browser.ts', names)

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
