import copy
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import cloud_baseline


class CloudBaselineTests(unittest.TestCase):
    def test_actual_native_proof_and_each_fail_closed_condition(self):
        root=cloud_baseline.REPO
        manifest=json.loads((root/'supabase/baseline/cloud-20261021.json').read_text())
        evidence=json.loads((root/'docs/evidence/oracle-p3-owner-fidelity.json').read_text())
        cloud_baseline.validate(manifest,evidence)
        for field,value in (('roleAttributesMatch',False),('unexplainedDifferences',[{'object':'policy:unexpected'}]),('status','FAIL')):
            changed=copy.deepcopy(evidence)
            changed['gates']['ir35_baseline_proof_20261021'][field]=value
            with self.assertRaises(ValueError):cloud_baseline.validate(manifest,changed)
        changed=copy.deepcopy(evidence)
        changed['gates']['ir35_baseline_proof_20261021']['extensions']['conditions']['ddlCapabilities']=False
        with self.assertRaises(ValueError):cloud_baseline.validate(manifest,changed)
        changed=copy.deepcopy(evidence)
        changed['gates']['ir35_baseline_proof_20261021']['extensions']['conditions']={}
        with self.assertRaises(ValueError):cloud_baseline.validate(manifest,changed)
        changed=copy.deepcopy(evidence)
        changed['gates']['ir35_baseline_proof_20261021']['appRolePrivileges']['morePermissive']=[{'object':'unexpected'}]
        with self.assertRaises(ValueError):cloud_baseline.validate(manifest,changed)

    def test_default_entrypoint_cannot_connect(self):
        with patch.object(sys,'argv',['cloud_baseline.py']),patch.object(cloud_baseline.owner_parity,'install_verified_baselines') as remote:
            with self.assertRaises(ValueError):cloud_baseline.main()
            remote.assert_not_called()


if __name__=='__main__':unittest.main()
