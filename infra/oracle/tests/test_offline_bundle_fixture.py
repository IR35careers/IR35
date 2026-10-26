import inspect
from pathlib import Path
import socket
import subprocess
import sys
import unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import cloud_schema as schema
from offline_bundle_fixture import public_bootstrap,OfflineBootstrapViolation,PUBLIC_BOOTSTRAP


class OfflineFixtureTests(unittest.TestCase):
    def test_private_state_network_processes_and_source_writes_are_explicit_failures(self):
        with public_bootstrap():
            for action in (
                lambda:schema.private_file(schema.STATE),
                lambda:(Path.home()/'.ir35'/'not-a-real-key').read_text(),
                lambda:socket.create_connection(('example.invalid',443)),
                lambda:socket.socket(),
                lambda:socket.getaddrinfo('example.invalid',443),
                lambda:subprocess.run(['not-an-executed-program']),
                lambda:(schema.REPO/'not-a-written-file').open('w'),
            ):
                with self.assertRaises(OfflineBootstrapViolation):action()
            self.assertIn('def guest_bundle',(schema.REPO/'infra/oracle/cloud_schema.py').read_text())
    def test_fixture_is_nonsecret_and_live_custody_function_restored(self):
        live=schema.guest_bundle
        with public_bootstrap():
            self.assertEqual(schema.guest_bundle(rehearsal=True),PUBLIC_BOOTSTRAP)
            self.assertNotIn('PRIVATE',PUBLIC_BOOTSTRAP)
        self.assertIs(schema.guest_bundle,live)
        source=inspect.getsource(live)
        self.assertIn('private_file(STATE)',source)
        self.assertIn('private_file(infra.JOURNAL)',source)
        self.assertIn('VerifiedSchemaExportRequired',source)


if __name__=='__main__':unittest.main()
