"""Private partial-start cleanup regression; only fake Docker/SQL/files.

The frozen public stop() assertions remain unchanged in their original module.
"""
import copy
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import p8_webqa_runtime_guest as guest
import test_p8_webqa_runtime_guest as fixtures

FOREIGN = '9' * 64


class ForeignStartCleanupTests(unittest.TestCase):
    setUp = fixtures.RuntimeTests.setUp
    io = fixtures.RuntimeTests.io
    fake_reads = fixtures.RuntimeTests.fake_reads

    def assert_terminal_proof(self, expected_removed):
        result = self.fixture.store.records['runtime-foreign-cleanup-result.json']
        self.assertEqual(result['status'], 'HARD_STOP')
        self.assertEqual(result['code'], 'CLEANUP_FOREIGN_REMAINS')
        self.assertEqual(result['provenOwnedRemoved'], expected_removed)
        self.assertEqual(result['foreignIdsRemaining'], 1)
        self.assertEqual(result['foreignObjectsChanged'], 0)
        self.assertTrue(result['knownBaselineContainersUnchanged'])
        self.assertFalse(result['fullInventoryUnchanged'])
        self.assertFalse(result['phaseComplete'])
        self.assertEqual(self.docker.rows[fixtures.ORIGINAL], self.docker.original)
        self.assertNotIn(FOREIGN, self.runtime.owned)
        self.assertNotIn('runtime-started.json', self.fixture.store.records)
        for arguments in self.docker.mutations:
            if arguments[0] in ('stop', 'rm'):
                self.assertNotIn(FOREIGN, arguments)
                self.assertNotIn(fixtures.ORIGINAL, arguments)
                self.assertNotIn('-f', arguments); self.assertNotIn('-v', arguments)
        return result

    def test_partial_create_foreign_name_replacement_keeps_foreign_and_removes_other_proven_ids(self):
        foreign_before = {}
        def replace_new(row, service):
            if service != 'rest': return
            del self.docker.rows[row['Id']]
            replacement = copy.deepcopy(row)
            replacement['Id'] = FOREIGN
            replacement['Config']['Labels']['ir35.qa-run'] = 'foreign'
            self.docker.rows[FOREIGN] = replacement
            foreign_before.update(copy.deepcopy(replacement))
        self.docker.create_fault = replace_new
        with self.io(), self.assertRaisesRegex(guest.RuntimeErrorSafe, 'CLEANUP_FOREIGN_REMAINS.*HardStop'):
            self.runtime.start(Path('owned-stage'))
        self.assert_terminal_proof(2)
        self.assertEqual(set(self.docker.rows), {fixtures.ORIGINAL, FOREIGN})
        self.assertEqual(self.docker.rows[FOREIGN], foreign_before)
        self.assertEqual(sum(row[0] == 'create' for row in self.docker.mutations), 3)
        self.assertFalse(any(row[0] == 'start' for row in self.docker.mutations))

    def test_early_foreign_row_does_not_hide_other_valid_run_ids_from_cleanup(self):
        foreign_before = {}
        def replace_prior(row, service):
            if service != 'rest': return
            prior = next(identifier for identifier, name in self.runtime.owned.items() if name == 'templates')
            replacement = self.docker.rows.pop(prior)
            replacement['Id'] = FOREIGN
            replacement['Config']['Labels']['ir35.qa-run'] = 'foreign'
            original = self.docker.rows.pop(fixtures.ORIGINAL)
            other = dict(self.docker.rows)
            self.docker.rows = {fixtures.ORIGINAL: original, FOREIGN: replacement, **other}
            foreign_before.update(copy.deepcopy(replacement))
        self.docker.create_fault = replace_prior
        with self.io(), self.assertRaisesRegex(guest.RuntimeErrorSafe, 'CLEANUP_FOREIGN_REMAINS.*HardStop'):
            self.runtime.start(Path('owned-stage'))
        self.assert_terminal_proof(2)
        self.assertEqual(set(self.docker.rows), {fixtures.ORIGINAL, FOREIGN})
        self.assertEqual(self.docker.rows[FOREIGN], foreign_before)

    def test_start_phase_collision_stops_running_owned_peers_but_not_foreign(self):
        original_call = self.docker.__call__
        foreign_before = {}
        def collide(arguments, **kwargs):
            result = original_call(arguments, **kwargs)
            args = arguments[len(guest.DOCKER):]
            if args[0] == 'start' and self.runtime.owned[args[1]] == 'web':
                identifier = next(key for key, name in self.runtime.owned.items() if name == 'caddy')
                replacement = self.docker.rows.pop(identifier)
                replacement['Id'] = FOREIGN
                replacement['Config']['Labels']['ir35.qa-run'] = 'foreign'
                self.docker.rows[FOREIGN] = replacement
                foreign_before.update(copy.deepcopy(replacement))
            return result
        with self.io(), patch.object(guest.subprocess, 'run', side_effect=collide), \
                self.assertRaisesRegex(guest.RuntimeErrorSafe, 'CLEANUP_FOREIGN_REMAINS.*HardStop'):
            self.runtime.start(Path('owned-stage'))
        self.assert_terminal_proof(9)
        self.assertEqual(set(self.docker.rows), {fixtures.ORIGINAL, FOREIGN})
        self.assertEqual(self.docker.rows[FOREIGN], foreign_before)
        self.assertTrue(any(row[0] == 'stop' for row in self.docker.mutations))


if __name__ == '__main__': unittest.main()
