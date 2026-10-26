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
        start=Mock(returncode=1);start.poll.return_value=1;start.communicate.return_value=(b'',('failure '+dummy).encode())
        state=Mock(returncode=0,stdout=b'Result=exit-code\nExecMainStatus=1\nExecMainCode=1\nInvocationID=cccccccccccccccccccccccccccccccc\n')
        message=json.dumps({'MESSAGE':json.dumps(dispatcher.error_event(RuntimeError(dummy),'decode-or-dispatch'))}).encode()
        journal=Mock(returncode=0,stdout=message,stderr=b'')
        store=Mock()
        with patch.object(observer.subprocess,'Popen',return_value=start) as launch,patch.object(observer.subprocess,'run',side_effect=[state,journal]) as execute:
            with self.assertRaises(RuntimeError):observer.dispatch_once('ir35-p6-mock-watchdog-decoder2.service',{},store,Path('/fixture'),'one')
        launch.assert_called_once();self.assertEqual(launch.call_args.args[0][:2],['systemctl','start'])
        self.assertEqual(execute.call_count,2)
        artifact=json.loads(store.put.call_args.args[2]);self.assertEqual(artifact['status'],'FAIL')
        self.assertNotIn(dummy,json.dumps(artifact));self.assertEqual(artifact['service']['ExecMainStatus'],'1')
    def test_arbitrary_units_rejected_before_any_command(self):
        with patch.object(observer.subprocess,'run') as execute,patch.object(observer.subprocess,'Popen') as launch:
            with self.assertRaises(RuntimeError):observer.dispatch_once('anything.service',{},Mock(),Path('/fixture'),'one')
        execute.assert_not_called()
        launch.assert_not_called()
    def test_fast_oneshot_with_cleared_invocation_uses_bounded_unit_journal(self):
        start=Mock(returncode=0);start.poll.return_value=0;start.communicate.return_value=(b'',b'')
        state=Mock(returncode=0,stdout=b'Result=success\nExecMainStatus=0\nExecMainCode=1\nInvocationID=\n')
        journal=Mock(returncode=0,stdout=b'{"MESSAGE":"Finished mock service"}',stderr=b'')
        store=Mock()
        with patch.object(observer.subprocess,'Popen',return_value=start) as launch,patch.object(observer.subprocess,'run',side_effect=[state,journal]) as execute:
            result=observer.dispatch_once('ir35-p6-mock-watchdog-decoder3.service',{},store,Path('/fixture'),'one')
        self.assertEqual(result['status'],'PASS');self.assertFalse(result['invocationCaptured'])
        self.assertEqual(result['journalScope'],'unit-and-window');launch.assert_called_once()
        command=execute.call_args.args[0]
        self.assertEqual(command[command.index('-u')+1],'ir35-p6-mock-watchdog-decoder3.service')
        self.assertEqual(command[command.index('--since')+1],result['windowStart'])
        self.assertEqual(command[command.index('--until')+1],result['windowEnd'])
    def test_active_invocation_is_preserved_after_unit_exits(self):
        start=Mock(returncode=0);start.poll.return_value=None;start.communicate.return_value=(b'',b'')
        active=Mock(returncode=0,stdout=b'InvocationID=cccccccccccccccccccccccccccccccc\n')
        state=Mock(returncode=0,stdout=b'Result=success\nExecMainStatus=0\nInvocationID=\n')
        journal=Mock(returncode=0,stdout=b'',stderr=b'')
        with patch.object(observer.subprocess,'Popen',return_value=start),patch.object(observer.subprocess,'run',side_effect=[active,state,journal]) as execute:
            result=observer.dispatch_once('ir35-p6-mock-watchdog-decoder3.service',{},Mock(),Path('/fixture'),'one')
        self.assertEqual(result['status'],'PASS');self.assertTrue(result['invocationCaptured'])
        self.assertIn('_SYSTEMD_INVOCATION_ID='+'c'*32,execute.call_args.args[0])
    def test_missing_journal_proof_still_fails_and_seals(self):
        start=Mock(returncode=0);start.poll.return_value=0;start.communicate.return_value=(b'',b'')
        state=Mock(returncode=0,stdout=b'Result=success\nExecMainStatus=0\nInvocationID=\n')
        journal=Mock(returncode=1,stdout=b'',stderr=b'read failed')
        store=Mock()
        with patch.object(observer.subprocess,'Popen',return_value=start),patch.object(observer.subprocess,'run',side_effect=[state,journal]):
            with self.assertRaises(RuntimeError):observer.dispatch_once('ir35-p6-mock-watchdog-decoder3.service',{},store,Path('/fixture'),'one')
        artifact=json.loads(store.put.call_args.args[2]);self.assertEqual(artifact['status'],'FAIL')
        self.assertEqual(artifact['journalReadExitCode'],1)
    def test_launch_failure_is_sealed_without_raw_error(self):
        store=Mock()
        with patch.object(observer.subprocess,'Popen',side_effect=OSError('private-value')):
            with self.assertRaises(RuntimeError):observer.dispatch_once('ir35-p6-mock-watchdog-decoder3.service',{},store,Path('/fixture'),'one')
        artifact=json.loads(store.put.call_args.args[2]);self.assertEqual(artifact['status'],'FAIL')
        self.assertNotIn('private-value',json.dumps(artifact))


if __name__=='__main__':unittest.main()
