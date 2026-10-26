import copy
from pathlib import Path
import sys
import unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from p8_staging_readonly import kernel_memory_checks,memory_checks


class KernelMemoryTests(unittest.TestCase):
    def sample(self):
        return {'availableBytes':2*1024**3,'containers':[{'limitBytes':128,'kernelLimitBytes':128,'chargedBytes':110,
            'kernelPeakBytes':128,'rssBytes':146,'oomKilled':False,'oomEvents':0,'oomKillEvents':0}]}
    def test_old_rss_guard_still_fails_but_different_kernel_measurement_is_not_relabelled(self):
        row=self.sample()
        with self.assertRaises(RuntimeError):memory_checks([row])
        self.assertTrue(kernel_memory_checks([row]))
        self.assertEqual(row['containers'][0]['rssBytes'],146)
    def test_every_budget_oom_and_unknown_counter_invariant_is_enforced(self):
        for key,value in (('limitBytes',0),('kernelLimitBytes',256),('chargedBytes',129),('kernelPeakBytes',129),
                          ('oomKilled',True),('oomEvents',1),('oomKillEvents',1),('chargedBytes',None),('rssBytes',-1)):
            row=copy.deepcopy(self.sample());row['containers'][0][key]=value
            with self.subTest(key=key),self.assertRaises(RuntimeError):kernel_memory_checks([row])
        with self.assertRaises(RuntimeError):kernel_memory_checks([{**self.sample(),'availableBytes':2*1024**3-1}])
        with self.assertRaises(RuntimeError):kernel_memory_checks([])


if __name__=='__main__':unittest.main()
