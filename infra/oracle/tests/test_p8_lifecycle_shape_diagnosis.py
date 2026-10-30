"""Public source / synthetic model tests; no OCI controller or private state."""
import copy
from pathlib import Path
import sys
from types import SimpleNamespace
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import p8_lifecycle_shape_diagnosis as diagnosis


class PublicLifecycleDiagnosisTests(unittest.TestCase):
    def test_actual_controller_retention_function_is_read_without_importing_it(self):
        rows = diagnosis.retention_from_public_source(diagnosis.CONTROLLER.read_text(encoding='utf-8'))
        self.assertEqual([row['timeAmount'] for row in rows], [7, 28])
        self.assertEqual([row['objectNameFilter']['inclusionPrefixes'] for row in rows],
            [['ir35-backups-v1/daily/'], ['ir35-backups-v1/weekly/']])
        self.assertTrue(all(row['action'] == 'DELETE' and row['target'] == 'objects' and row['isEnabled'] for row in rows))

    def test_impure_function_cannot_import_call_read_or_request_anything(self):
        for source in ("def retention_items():\n return open('/private/file').read()\n",
                       "def retention_items():\n return __import__('socket').socket()\n",
                       "def retention_items():\n return scope.SECRET\n"):
            with self.assertRaises(ValueError): diagnosis.retention_from_public_source(source)

    def test_real_shape_difference_is_a_diagnosis_not_a_repair_or_native_pass(self):
        inputs = diagnosis.retention_from_public_source(diagnosis.CONTROLLER.read_text(encoding='utf-8'))
        before = copy.deepcopy(inputs)
        def serializer(rows):
            return [{'name': row.name, 'target': row.target, 'action': row.action,
                'time-amount': row.time_amount, 'time-unit': row.time_unit, 'is-enabled': row.is_enabled,
                'object-name-filter': {'inclusion-prefixes': row.object_name_filter.inclusion_prefixes,
                    'inclusion-patterns': None, 'exclusion-patterns': None}} for row in rows]
        result = diagnosis.compare_cli_rows(inputs, serializer, SimpleNamespace, SimpleNamespace)
        self.assertEqual(result['status'], 'DIAGNOSED_NOT_REPAIRED')
        self.assertFalse(result['currentStrictEquality'])
        self.assertTrue(result['existingControllerWouldFailEquality'])
        self.assertEqual(inputs, before)
        self.assertFalse(result['repairApplied']); self.assertFalse(result['assertionsChanged'])
        self.assertEqual(result['nativeCalls'], 0); self.assertEqual(result['iamWrites'], 0)
        self.assertEqual(result['lifecycleWrites'], 0); self.assertEqual(result['controllerEdits'], 0)


if __name__ == '__main__': unittest.main()
