import inspect
from pathlib import Path
import sys
import unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import p8_memory_diagnosis as diagnosis
from offline_bundle_fixture import public_bootstrap


class MemoryDiagnosisTests(unittest.TestCase):
    def test_exact_counters_reject_missing_duplicate_negative_and_malformed(self):
        self.assertEqual(diagnosis.counters('anon 10\nignored 99\nfile 20',{'anon','file'}),{'anon':10,'file':20})
        for value in ('anon 1','anon -1\nfile 2','anon 1\nfile unknown','anon 1\nfile 2\nanon 1'):
            with self.assertRaises(RuntimeError):diagnosis.counters(value,{'anon','file'})
    def test_complete_diagnosis_compiles_without_owner_state_or_network(self):
        with public_bootstrap():source=diagnosis.program({'public':'fixture'})
        compile(source,'<diagnosis-fixture>','exec')
        for forbidden in ('write_text','docker restart','systemctl start','CREATE DATABASE','tls_request(','ensure_session('):
            self.assertNotIn(forbidden,inspect.getsource(diagnosis.program))
        for required in ('memory.current','memory.peak','memory.events','smaps_rollup','containment(data,runtime'):
            self.assertIn(required,source)


if __name__=='__main__':unittest.main()
