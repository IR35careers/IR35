import inspect
from pathlib import Path
import sys
import unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import p8_staging_readonly as load
from offline_bundle_fixture import public_bootstrap


class P8ReadonlyTests(unittest.TestCase):
    def test_p95_is_nearest_rank_and_incomplete_samples_are_rejected(self):
        self.assertEqual(load.percentile95(list(range(1,201))),190)
        for values in ([],[-1],[None]):
            with self.assertRaises(RuntimeError):load.percentile95(values)
    def test_memory_guard_never_relaxes_os_headroom_container_limit_or_oom(self):
        row={'availableBytes':2*1024**3,'containers':[{'rssBytes':100,'limitBytes':101,'oomKilled':False}]}
        self.assertTrue(load.memory_checks([row]))
        for sample in ({**row,'availableBytes':row['availableBytes']-1},
                {**row,'containers':[]},
                {**row,'containers':[{'rssBytes':102,'limitBytes':101,'oomKilled':False}]},
                {**row,'containers':[{'rssBytes':100,'limitBytes':0,'oomKilled':False}]},
                {**row,'containers':[{'rssBytes':100,'limitBytes':101,'oomKilled':True}]}):
            with self.assertRaises(RuntimeError):load.memory_checks([sample])
    def test_complete_program_compiles_with_public_fixture_and_no_native_calls(self):
        with public_bootstrap():source=load.program({'public':'fixture'})
        compile(source,'<offline-p8>','exec')
        # Every request is GET; no new service, queue/auth grant or cloud access.
        code=inspect.getsource(load.program)
        for forbidden in ('docker run','docker restart','systemctl start','CREATE DATABASE','POST','ensure_session(','/auth/v1/token','oci '):
            self.assertNotIn(forbidden,code)
        for proof in ('Barrier(50','max_workers=50','len(observations)!=200','containment(data,runtime','MemAvailable:','VmRSS:'):
            self.assertIn(proof,code)


if __name__=='__main__':unittest.main()
