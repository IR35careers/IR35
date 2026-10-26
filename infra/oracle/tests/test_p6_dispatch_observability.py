import hashlib
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import Mock,patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import p6_dispatch_observability as observer
import p6_schedule_dispatch as dispatcher


class ObservabilityTests(unittest.TestCase):
    def test_vendor_errors_and_values_are_never_saved(self):
        dummy='a'*64
        for raw in (dummy,json.dumps({'secret':dummy}),'command error '+dummy):
            result=observer.safe_message(raw)
            self.assertNotIn(dummy,json.dumps(result));self.assertEqual(result['message']['length'],len(raw))
            self.assertEqual(result['message']['sha256Prefix'],hashlib.sha256(raw.encode()).hexdigest()[:12])
        safe=dispatcher.error_event(RuntimeError(dummy),'decode-or-dispatch')
        self.assertEqual(observer.safe_message(json.dumps(safe))['diagnostic'],safe)
        safe['password']=dummy
        self.assertNotIn('diagnostic',observer.safe_message(json.dumps(safe)))
    def test_failed_start_is_recorded_with_redacted_stderr_before_raise_and_never_retried(self):
        dummy='b'*64
        start=Mock(returncode=1,stdout=b'',stderr=('failure '+dummy).encode())
        state=Mock(returncode=0,stdout=b'Result=exit-code\nExecMainStatus=1\nExecMainCode=1\nInvocationID=cccccccccccccccccccccccccccccccc\n')
        message=json.dumps({'MESSAGE':json.dumps(dispatcher.error_event(RuntimeError(dummy),'decode-or-dispatch'))}).encode()
        journal=Mock(returncode=0,stdout=message,stderr=b'')
        store=Mock()
        with patch.object(observer.subprocess,'run',side_effect=[start,state,journal]) as execute:
            with self.assertRaises(RuntimeError):observer.dispatch_once('ir35-p6-mock-watchdog-decoder2.service',{},store,Path('/fixture'),'one')
        self.assertEqual(sum(call.args[0][:2]==['systemctl','start'] for call in execute.call_args_list),1)
        self.assertEqual(execute.call_count,3)
        artifact=json.loads(store.put.call_args.args[2]);self.assertEqual(artifact['status'],'FAIL')
        self.assertNotIn(dummy,json.dumps(artifact));self.assertEqual(artifact['service']['ExecMainStatus'],'1')
    def test_arbitrary_units_rejected_before_any_command(self):
        with patch.object(observer.subprocess,'run') as execute:
            with self.assertRaises(RuntimeError):observer.dispatch_once('anything.service',{},Mock(),Path('/fixture'),'one')
        execute.assert_not_called()


if __name__=='__main__':unittest.main()
