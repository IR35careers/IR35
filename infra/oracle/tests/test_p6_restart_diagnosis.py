import inspect
import json
from pathlib import Path
import sys
import time
import unittest
from tempfile import TemporaryDirectory
from unittest.mock import Mock,patch

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import p6_restart_diagnosis as controller
import p6_restart_diagnosis_guest as guest
import p6_hba_guest as hba
from p6_audit_log import AuditFailure


class RestartDiagnosisTests(unittest.TestCase):
    def test_kong_requires_sealed_bytes_and_exact_upstreams_including_original_jwks(self):
        services=[{'name':name,'url':url,'routes':[{'paths':['/test']}]} for name,url in guest.KONG_UPSTREAMS.items()]
        body=json.dumps({'services':services}).encode()
        with patch.object(guest,'KONG_SHA256',guest.digest(body)):
            result=guest.sealed_kong_routes(body)
            self.assertIn('http://ir35-p5-auth:9999/.well-known/jwks.json',[row['upstream'] for row in result])
            with self.assertRaisesRegex(RuntimeError,'SealedP5KongConfigurationMismatch'):guest.sealed_kong_routes(body+b' ')
        for target in ('http://outside.invalid/','http://secret:password@ir35-p5-auth:9999/','http://ir35-p5-auth:9999/?force=true'):
            services[0]['url']=target;changed=json.dumps({'services':services}).encode()
            with patch.object(guest,'KONG_SHA256',guest.digest(changed)):
                with self.assertRaisesRegex(RuntimeError,'ExactSealedP5KongUpstreamsRequired'):guest.sealed_kong_routes(changed)

    def test_docker_health_projection_keeps_times_exit_and_hash_not_output(self):
        item={'Name':'/candidate','Image':'sha256:x','Created':'now','HostConfig':{'RestartPolicy':{'Name':'unless-stopped'}},
            'State':{'Health':{'Status':'unhealthy','Log':[{'Start':'a','End':'b','ExitCode':1,'Output':'private diagnostic'}]}},
            'RestartCount':0,'NetworkSettings':{'Networks':{}}}
        result=guest.projected_container(item)
        self.assertNotIn('private diagnostic',json.dumps(result))
        self.assertEqual(result['healthObservations'][0]['ExitCode'],1)
        self.assertEqual(result['healthObservations'][0]['outputSHA256'],guest.digest(b'private diagnostic'))

    def test_remote_bootstrap_bundles_required_audit_dependency_before_collector(self):
        self.assertEqual(controller.MODULES[0],'p6_audit_log')
        self.assertLess(controller.MODULES.index('p6_audit_log'),controller.MODULES.index('p6_restart_diagnosis_guest'))
        source=inspect.getsource(guest)
        self.assertIn('from p6_audit_log import',source)
        main=inspect.getsource(controller.main)
        self.assertIn('verified_manifest(first)',main)
        self.assertIn('ExactFirstCollectionBootstrapFailureRequired',main)
        self.assertIn('previousCollectionManifestSHA256',main)
    def test_no_mutating_command_is_accepted(self):
        for command in (['docker','start',guest.FAILED],['docker','restart',guest.FAILED],['docker','run','image'],
                        ['systemctl','restart',guest.FINAL_UNIT+'.service'],['docker','compose','up','-d'],
                        ['docker','exec',guest.ROLLBACK,'sh','-c','touch /tmp/change']):
            with self.assertRaises(AuditFailure):guest.read_command(command)

    def test_projected_container_never_contains_env_mounts_labels_or_raw_error(self):
        source=inspect.getsource(guest.projected_container)
        for forbidden in ("['Config']","['Mounts']","['Labels']"):self.assertNotIn(forbidden,source)
        for required in ('StartedAt','RestartCount','ExitCode','OOMKilled','restartPolicy'):self.assertIn(required,source)

    def test_event_projection_drops_raw_attributes_and_admits_only_bounded_past_calls(self):
        event={'Action':'die','time':1,'Actor':{'Attributes':{'name':guest.FAILED,'exitCode':'0','secret':'never-log-this'}}}
        self.assertNotIn('never-log-this',json.dumps(guest.projected_events(json.dumps(event))))
        command=['docker','events','--filter','type=container','--filter','container='+guest.FAILED,'--since',str(time.time()-600),'--until',str(time.time()-1),'--format','{{json .}}']
        self.assertEqual(guest.read_command(command),'bounded-container-events')
        for value in ('nan','inf',str(time.time()+3600)):
            wrong=command.copy();wrong[9]=value
            with self.assertRaises(AuditFailure):guest.read_command(wrong)

    def test_actual_socket_login_arguments_are_exactly_allowed_without_logging_password(self):
        reply=Mock(returncode=2,stderr=b'pg_hba.conf rejects connection',stdout=b'')
        credentials={'PGUSER':'ir35_queue','PGDATABASE':'postgres','PGPASSWORD':'a'*64}
        with patch.object(hba.subprocess,'run',return_value=reply) as execute:
            hba.actual_login('ir35_queue','ir35_p5_app','local',credentials)
        call=execute.call_args
        self.assertEqual(guest.read_command(call.args[0],call.kwargs['input'],{'ir35_p5_app'}),'private-socket-read-only-login')
        changed=call.args[0].copy();changed[24]='DELETE FROM public.jobs;'
        with self.assertRaises(AuditFailure):guest.read_command(changed,call.kwargs['input'],{'ir35_p5_app'})
        native=Mock(return_value=reply);trace=guest.ReadOnlyTrace(native,{'ir35_p5_app'})
        trace(call.args[0],input=call.kwargs['input'])
        self.assertNotIn('a'*64,json.dumps(trace.observations))

    def test_bridge_probe_is_private_fixed_readonly_and_never_creates_container(self):
        command=['docker','exec','-i','--user','1002:1002',guest.ROLLBACK,'node','--input-type=module','-e',guest.BRIDGE_PROBE]
        body=json.dumps({'role':'ir35_queue','database':'postgres','password':'a'*64}).encode()
        self.assertEqual(guest.read_command(command,body,{'postgres'}),'private-bridge-read-only-login')
        with self.assertRaises(AuditFailure):guest.read_command(command,body,{'other'})
        self.assertIn('default_transaction_read_only=on',guest.BRIDGE_PROBE)
        self.assertNotIn('password',guest.BRIDGE_PROBE.split('console.log',1)[1])

    def test_no_implicit_execution_and_local_write_once_evidence(self):
        with patch.object(controller.sys,'argv',['script']),patch.object(controller,'payload') as context:
            with self.assertRaises(AuditFailure):controller.main()
        context.assert_not_called()
        code=inspect.getsource(controller)
        self.assertIn('root.exists()',code);self.assertIn('RestartDiagnosisRecorded_NoReplay',code)
        self.assertIn('journal.step',code);self.assertIn('journal.seal',code)
        self.assertNotIn('.run_runtime(',code);self.assertNotIn('.build(',code)

    def test_private_health_rejects_metadata_and_public_hosts_before_network(self):
        for address in ('169.254.169.254','8.8.8.8','0.0.0.0','::1'):
            with patch.object(guest.urllib.request,'build_opener') as opener:
                with self.assertRaises(RuntimeError):guest.private_health(address)
            opener.assert_not_called()

    def test_every_ledger_row_and_timestamp_source_are_preserved_and_unknown_payload_fails(self):
        with TemporaryDirectory() as temporary:
            root=Path(temporary);expected={};intents={};apps=[];jobs=[]
            uid=lambda i:f'{i:08x}-0000-4000-8000-000000000000'
            for number in range(1,35):
                identifier=uid(number);orphan=number in (23,34)
                events=[{'state':'queued'}]+([{'state':'failed'}] if orphan else [{'state':'running'},{'state':'submitting'},{'state':'submitted'}])
                error='runner_timeout' if orphan else None;status='failed' if orphan else 'submitted'
                receipt={'applicationId':identifier,'state':status,'errorCode':error,'receiptConfirmed':not orphan,'updatedAt':'2026-10-26T08:00:00+00:00','events':events}
                expected[identifier]=receipt
                intent={'kind':'staging_mock_application','applicationId':identifier,'actorEmail':'anvesh.mannuru+ir35test@gmail.com','scenario':'success','requestedAt':'2026-10-26T07:00:00.000Z'}
                intents[identifier]=intent
                apps.append({'id':identifier,'state':status,'error_code':error,'receipt_confirmed':not orphan,'updated_at':receipt['updatedAt'],'events':events,
                    'actor_email':intent['actorEmail'],'requested_at':intent['requestedAt'],'scenario':'success'})
                if not orphan:jobs.append({'id':identifier,'name':'ir35-staging-mock-apply','state':'completed','data':intent,'retry_count':0,'created_on':'2026-10-26T07:00:00+00:00','started_on':'2026-10-26T07:00:01+00:00'})
            proofs=[]
            for name,low,high in (('original',1,4),('previous',5,12),('second',13,23),('final',24,34)):
                folder=root/name;folder.mkdir();artifacts=[]
                for number in range(low,high+1):
                    filename=f'{number:03d}-'+('orphan-queued-intent' if number in (23,34) else 'publication-intent')+'.json'
                    (folder/filename).write_text(json.dumps(intents[uid(number)]));artifacts.append({'name':filename})
                proofs.append({'stage':name,'manifestSHA256':'a'*64,'manifest':{'artifacts':artifacts}})
            schedule_intents=[];schedules=[]
            for number,operation in enumerate(('mock_ingest','mock_ingest','mock_automation','watchdog'),35):
                intent={'kind':'staging_mock_schedule','operation':operation,'requestedAt':f'2026-10-26T07:00:{number}.000Z'}
                schedule_intents.append(intent)
                jobs.append({'id':uid(number),'name':'ir35-staging-mock-schedule','state':'completed','data':intent,'singleton_key':None if number==35 else operation,
                    'retry_count':0,'created_on':'2026-10-26T07:00:00+00:00','started_on':'2026-10-26T07:00:01+00:00'})
                schedules.append({'id':uid(number),'operation':operation,'completed_at':'2026-10-26T07:00:02+00:00'})
            rows={'applications':apps,'jobs':jobs,'schedules':schedules,'heartbeat':[{'id':'staging_mock_worker','active':0,'build_sha':'b'*40,'seen_at':'2026-10-26T08:00:00+00:00'}]}
            store=Mock(root=root);store.verify.side_effect=lambda stage,anchor:next(v['manifest'] for v in proofs if v['stage']==stage)
            data=dict(zip(('failureLifecycle','currentFailure','scheduleFailure','finalFailure'),proofs));data['rollbackBuild']={'sourceSHA':'b'*40};data['p4']={}
            recovery=Mock();recovery.query.side_effect=lambda *args:json.dumps(rows)
            with patch.object(guest,'history',return_value=(store,expected,schedule_intents,{})),patch.object(guest,'Recovery',return_value=recovery):
                observed=guest.queue_ledger(data,{})
                self.assertEqual(observed['status'],'PASS');self.assertEqual(len(observed['rows']),74)
                self.assertEqual(observed['rowCounts'],{'applications':34,'jobs':36,'schedules':4,'heartbeat':1})
                self.assertTrue(all(row['created_at'] is None for row in observed['rows'] if row['kind']!='queue_job'))
                self.assertEqual(sum(row['kind']=='queue_job' for row in observed['rows']),36)
                jobs[0]['data']=jobs[0]['data']|{'employerURL':'https://forbidden.invalid'}
                self.assertEqual(guest.queue_ledger(data,{})['status'],'FAIL')


if __name__=='__main__':unittest.main()
