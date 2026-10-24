import inspect
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import patch,Mock,MagicMock
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import p6_port_probe_guest as probe


class P6PortProbeTests(unittest.TestCase):
    def test_only_the_retained_stopped_failed_health_gate_can_open_diagnosis(self):
        store=Mock()
        for failed in ({},{'status':'PASS'},{'status':'FAIL','code':'ActualDataMismatch','containment':{'status':'PASS'},'stoppedAfterFailure':True}):
            with patch.object(probe,'prerequisites'),patch.object(probe,'prepared',return_value=store):
                with self.assertRaises(RuntimeError):probe.run({'failedStart':failed},{})
        store.stage.assert_not_called()

    def test_diagnosis_never_starts_original_worker_or_mounts_credentials(self):
        code=inspect.getsource(probe)
        self.assertNotIn("'docker','start',NAME",code)
        self.assertNotIn("'--volume'",code);self.assertNotIn("'--env-file'",code);self.assertNotIn("'--env'",code)
        self.assertIn("'127.0.0.1:18788:18788'",code)
        self.assertIn("'ir35-staging_backend'",code)
        self.assertIn("'--read-only'",code);self.assertIn("'1002:1002'",code)
        self.assertIn("item['Mounts']",code)
        self.assertNotIn('prune',code)

    def test_http_diagnostic_refuses_proxy_configuration_and_does_not_log_body(self):
        response=Mock();response.status=200;response.read.return_value=b'{"fixture":true}'
        opener=MagicMock();opener.open.return_value.__enter__.return_value=response
        with patch.object(probe.urllib.request,'build_opener',return_value=opener),patch.object(probe.urllib.request,'ProxyHandler') as proxy:
            self.assertEqual(probe.fetch('http://172.18.0.2:18788/'),{'status':200,'marker':True})
        proxy.assert_called_once_with({})


if __name__=='__main__':unittest.main()
