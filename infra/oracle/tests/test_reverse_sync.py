"""Public synthetic fixtures only. No native staging, secrets or network."""
from contextlib import redirect_stdout
import copy
import hashlib
from io import StringIO
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import reverse_sync as reverse
from data_fingerprint import identifier
from offline_bundle_fixture import public_bootstrap

RUN='reverse_20261030T010203Z_abcdef12'


def hashed(key,row,count=1):
    return {'keyHash':hashlib.sha256(key.encode()).hexdigest(),'rowHash':hashlib.sha256(row.encode()).hexdigest(),'count':count}


def proof():
    names=['auth.users','auth.identities','auth.mfa_factors']+['public.fixture_'+str(i) for i in range(59)]
    return {'status':'PASS','tables':[{'name':name,'rows':'0','md5':'a'*32} for name in names],
        'sequenceChecks':2,'authTableChecks':3,'passwordHashBytesCoveredByWholeTableFingerprints':True,'dataDifferences':[],
        'privileges':{'status':'PASS','sourceEntries':552,'targetEntries':552},
        'schema':{'baseline552Unchanged':True,'unexplainedDifferences':[],'sourceRolesUnchanged':True,
            'sourceRoleExpiryUnchanged':True,'additionExpiryVerified':True,'exceptions':[],
            'approvedP6Additions':[{'name':'ir35_queue'},{'name':'ir35_queue_producer'}],
            'baselineCatalogResult':{'sourceCheckedAt':'one','targetCheckedAt':'two','objectsHash':'b'*32}},
        'transport':{'status':'PASS'},'extensionChecks':{'status':'PASS'}}


def storage():return {'status':'PASS','objects':73,'bytes':85,'manifestSHA256':'a'*64}


class ReverseScopeTests(unittest.TestCase):
    def test_default_dry_run_reads_no_private_state_or_subprocess(self):
        with patch('subprocess.run',side_effect=AssertionError('No subprocess')),patch('pathlib.Path.open',side_effect=AssertionError('No files')):
            output=StringIO()
            with redirect_stdout(output):self.assertEqual(reverse.main(['--dry-run']),0)
        result=json.loads(output.getvalue())
        self.assertEqual(result['status'],'DRY_RUN');self.assertEqual(result['writes'],0)
        self.assertFalse(result['privateStateRead']);self.assertFalse(result['productionTargetSupported'])
        self.assertFalse(result['managedCloudStorageReverseProven']);self.assertFalse(result['phaseComplete'])

    def test_run_scope_rejects_urls_secrets_invalid_dates_and_traversal(self):
        for value in ('https://api.ir35careers.com','postgresql://user:private-value@db/postgres',
            RUN+'/../x','reverse_20261330T010203Z_abcdef12',RUN.upper(),None):
            with self.assertRaises(reverse.ReverseSyncError) as error:reverse.scope(value)
            self.assertNotIn('private-value',str(error.exception))

    def test_target_is_exact_new_disposable_and_never_cloud_or_production(self):
        names=reverse.scope(RUN)
        commands=reverse.database_commands(RUN,names['sourceDatabase'],names['targetDatabase'])
        self.assertIn('--format=custom',commands[0]);self.assertIn('--single-transaction',commands[1]);self.assertIn('--exit-on-error',commands[1])
        for args in commands:
            for forbidden in ('--no-owner','--no-acl','--clean','--if-exists','--disable-triggers','--role','--password'):
                self.assertNotIn(forbidden,args)
        for destination in ('postgres','ir35_p5_app','kxcbgflleqnjzjbkevwd.supabase.co','api.ir35careers.com','https://api-staging.ir35careers.com',names['sourceDatabase']):
            with self.assertRaises(reverse.ReverseSyncError):reverse.database_commands(RUN,names['sourceDatabase'],destination)

    def test_unknown_cli_flags_cannot_supply_production_or_credentials(self):
        for args in (['--execute','YES CUTOVER'],['--rehearse'],['--dry-run',RUN,'--target=cloud']):
            with self.assertRaises(reverse.ReverseSyncError):reverse.main(args)

    @unittest.skipIf(os.name!='posix','Reviewed shell entrypoint is Linux only')
    def test_shell_dry_run_and_syntax(self):
        path=Path(__file__).resolve().parents[3]/'scripts/reverse-sync.sh'
        self.assertEqual(subprocess.run(['bash','-n',str(path)],capture_output=True).returncode,0)
        reply=subprocess.run(['bash',str(path),'--dry-run',RUN],capture_output=True,timeout=10)
        self.assertEqual(reply.returncode,0,reply.stderr.decode())
        self.assertEqual(json.loads(reply.stdout)['runId'],RUN)


class ReverseLedgerTests(unittest.TestCase):
    def test_primary_key_ledger_records_insert_update_delete(self):
        before=[hashed('same','old'),hashed('deleted','gone')]
        after=[hashed('same','new'),hashed('inserted','new-row')]
        result=reverse.row_delta(before,after,has_primary_key=True)
        self.assertEqual((len(result['inserted']),len(result['updated']),len(result['deleted'])),(1,1,1))
        self.assertEqual(result['beforeRows'],2);self.assertEqual(result['afterRows'],2)
        self.assertNotIn('new-row',json.dumps(result))

    def test_no_primary_key_preserves_duplicate_multiplicities_as_delete_insert(self):
        before=[hashed('a','a',3),hashed('b','b',1)]
        after=[hashed('a','a',1),hashed('c','c',2)]
        result=reverse.row_delta(before,after,has_primary_key=False)
        self.assertEqual(sum(row['count'] for row in result['deleted']),3)
        self.assertEqual(sum(row['count'] for row in result['inserted']),2)
        self.assertEqual(result['updated'],[])
        self.assertEqual((result['beforeRows'],result['afterRows']),(4,3))

    def test_ambiguous_duplicate_pk_and_malformed_metadata_refused(self):
        for rows,pk in (([hashed('key','a'),hashed('key','b')],True),([hashed('key','a',2)],True),
            ([hashed('x','y')],False),([{'keyHash':'raw-customer-id','rowHash':'x','count':1}],True)):
            with self.assertRaises(reverse.ReverseSyncError):reverse.row_delta(rows,rows,has_primary_key=pk)

    def test_sql_is_read_only_hashes_original_length_framed_text_and_pk(self):
        table={'schema':'auth','name':'users','columns':['id','encrypted_password'],'primaryKey':['id']}
        sql=reverse.ledger_sql(table,identifier)
        self.assertTrue(sql.startswith('SELECT '));self.assertIn("sha256(convert_to(",sql)
        self.assertIn('octet_length',sql);self.assertIn('encrypted_password',sql)
        self.assertNotIn('ALTER ',sql);self.assertNotIn('UPDATE ',sql);self.assertNotIn('INSERT ',sql)
        self.assertIn('"auth"."users"',sql)


class ReverseFidelityTests(unittest.TestCase):
    def test_full_existing_proofs_required_and_time_metadata_not_data_hashes(self):
        source=proof();target=copy.deepcopy(source)
        target['schema']['baselineCatalogResult']['targetCheckedAt']='later'
        result=reverse.fidelity_gate(source,target,storage(),storage())
        self.assertEqual(result['status'],'PASS');self.assertFalse(result['managedCloudStorageReverseProven'])
        self.assertFalse(result['phaseComplete'])

    def test_any_table_auth_schema_sequence_privilege_storage_change_aborts(self):
        changes=(lambda p:p['tables'][0].update(md5='b'*32),lambda p:p.update(sequenceChecks=1),
            lambda p:p['privileges'].update(targetEntries=551),lambda p:p.update(passwordHashBytesCoveredByWholeTableFingerprints=False),
            lambda p:p['schema'].update(unexplainedDifferences=[{'object':'policy:private'}]),
            lambda p:p['schema'].update(exceptions=[{'object':'policy:private'}]),
            lambda p:p['schema'].update(approvedP6Additions=[]),lambda p:p.update(authTableChecks=0))
        for change in changes:
            target=proof();change(target)
            with self.assertRaises(reverse.ReverseSyncError):reverse.fidelity_gate(proof(),target,storage(),storage())
        changed=storage();changed['manifestSHA256']='b'*64
        with self.assertRaises(reverse.ReverseSyncError):reverse.fidelity_gate(proof(),proof(),storage(),changed)


class ReverseOwnedDeltaTests(unittest.TestCase):
    def ledgers(self):
        values=reverse.fixture_rows(RUN)
        original={'public.waitlist':{'hasPrimaryKey':True,'rows':[hashed('customer-existing','unchanged-customer')]}}
        original|={'public.fixture_'+str(index):{'hasPrimaryKey':True,'rows':[]} for index in range(61)}
        target=copy.deepcopy(original);source=copy.deepcopy(original)
        def fixture(name,row):return {'keyHash':values[name]['keyHash'],'rowHash':hashlib.sha256(row.encode()).hexdigest(),'count':1}
        target['public.waitlist']['rows']+=[fixture('update','old-fixture'),fixture('delete','deleted-fixture')]
        source['public.waitlist']['rows']+=[fixture('update','updated-fixture'),fixture('insert','inserted-fixture')]
        return original,target,source

    def test_owned_delta_records_exact_insert_update_delete_without_customer_changes(self):
        original,target,source=self.ledgers()
        report=reverse.fixture_ledger_gate(original,target,source,RUN)
        self.assertEqual(report['status'],'PASS');self.assertTrue(report['copiedCustomerRowsUnchanged'])
        for key in ('inserted','updated','deleted'):self.assertEqual(len(report['delta'][key]),1)
        self.assertNotIn('@invalid.test',json.dumps(report));self.assertNotIn('unchanged-customer',json.dumps(report))
        self.assertFalse(report['nativeProof'])

    def test_any_customer_mutation_unexpected_fixture_or_collision_aborts(self):
        for kind in ('customer-update','customer-delete','wrong-fixture','collision','unchanged-fixture'):
            with self.subTest(kind=kind):
                original,target,source=self.ledgers()
                if kind=='customer-update':source['public.waitlist']['rows'][0]['rowHash']='f'*64
                elif kind=='customer-delete':source['public.waitlist']['rows'].pop(0)
                elif kind=='wrong-fixture':source['public.waitlist']['rows'][-1]['keyHash']='f'*64
                elif kind=='collision':original['public.waitlist']['rows'].append(copy.deepcopy(target['public.waitlist']['rows'][-1]))
                else:source['public.waitlist']['rows'][1]['rowHash']=target['public.waitlist']['rows'][1]['rowHash']
                with self.assertRaises(reverse.ReverseSyncError):reverse.fixture_ledger_gate(original,target,source,RUN)

    def test_exact_safe_shape_and_fixed_stdin_sql_only(self):
        import reverse_sync_guest as guest
        from acl_repair import literal
        shape={'columns':guest.WAITLIST_BASE,'primaryKey':['id'],'relation':{'kind':'r','persistence':'p','partition':False}}
        shape|={name:0 for name in ('generatedColumns','userTriggers','rules','foreignKeys','checks','inheritance')}
        for columns in (guest.WAITLIST_BASE,guest.WAITLIST_BASE|guest.WAITLIST_LAUNCH):
            current=shape|{'columns':columns};approved=guest.fixture_shape(current)
            for operation in ('seed','mutate','remove'):
                sql=guest.fixture_sql(RUN,operation,approved,literal)
                self.assertIn('public.waitlist',sql)
                for forbidden in ('TRUNCATE ','CASCADE','ALTER ','GRANT ','REVOKE ','pg_','auth.','storage.','http'):
                    self.assertNotIn(forbidden,sql)
            self.assertIn('WHERE id=',guest.fixture_sql(RUN,'mutate',approved,literal))
            self.assertIn('AND email=',guest.fixture_sql(RUN,'remove',approved,literal))
        for field in ('generatedColumns','userTriggers','rules','foreignKeys','checks','inheritance'):
            with self.assertRaises(guest.RecoveryError):guest.fixture_shape(shape|{field:1})
        with self.assertRaises(guest.RecoveryError):guest.fixture_shape(shape|{'columns':guest.WAITLIST_BASE|{'unknown':'text'}})

    def test_dynamic_full_fingerprints_match_without_rewriting_original_verifier_result(self):
        original,target_rows,source_rows=self.ledgers()
        ledger=reverse.fixture_ledger_gate(original,target_rows,source_rows,RUN)
        pristine=proof();pristine['tables'][-1]['name']='public.waitlist'
        source=copy.deepcopy(pristine);source.update(status='FAIL',dataDifferences=['public.waitlist'])
        source['tables'][-1].update(rows='2',md5='b'*32)
        target=copy.deepcopy(source);before=json.dumps((pristine,source,target),sort_keys=True)
        result=reverse.fixture_fidelity_gate(pristine,source,target,storage(),storage(),ledger)
        self.assertEqual(result['status'],'PASS');self.assertTrue(result['originalVerifierUnchanged'])
        self.assertEqual(before,json.dumps((pristine,source,target),sort_keys=True))
        self.assertEqual(source['status'],'FAIL');self.assertFalse(result['productionRollbackReady'])
        for kind in ('auth','target','schema','sequence'):
            changed=copy.deepcopy(target)
            if kind=='auth':changed['tables'][0]['md5']='c'*32
            elif kind=='target':changed['tables'][-1]['md5']='c'*32
            elif kind=='schema':changed['schema']['baselineCatalogResult']['objectsHash']='c'*32
            else:changed['dataDifferences'].append('sequences')
            with self.assertRaises(reverse.ReverseSyncError):reverse.fixture_fidelity_gate(pristine,source,changed,storage(),storage(),ledger)


@unittest.skipIf(os.name!='posix','Synthetic child-process pipeline needs POSIX process groups')
class ReverseStreamingTests(unittest.TestCase):
    def test_real_synthetic_unicode_binary_stream_has_no_plaintext_files(self):
        body='synthetic 😀 café Ελληνικά 日本語'.encode()+b'\x00\xff'
        producer=(sys.executable,'-c','import sys;sys.stdout.buffer.write(bytes.fromhex("'+body.hex()+'"))')
        consumer=(sys.executable,'-c','import sys;data=sys.stdin.buffer.read();sys.exit(0 if data==bytes.fromhex("'+body.hex()+'") else 7)')
        result=reverse._pipe_commands((producer,consumer))
        self.assertEqual(result['status'],'PASS');self.assertEqual(result['bytes'],len(body))
        self.assertEqual(result['archiveSHA256'],hashlib.sha256(body).hexdigest())
        self.assertEqual(result['plaintextArchives'],0);self.assertEqual(result['exitCodes'],[0,0])

    def test_failure_redacts_stderr_and_exposes_sealed_diagnostic_metadata(self):
        producer=(sys.executable,'-c','import sys;sys.stderr.write("synthetic-private-sentinel");sys.exit(7)')
        consumer=(sys.executable,'-c','import sys;sys.stdin.buffer.read()')
        with self.assertRaises(reverse.ReverseSyncError) as error:reverse._pipe_commands((producer,consumer))
        result=error.exception.report
        self.assertEqual(result['status'],'FAIL');self.assertNotIn('synthetic-private-sentinel',json.dumps(result))
        self.assertTrue(any(row['bytes']>0 and len(row['sha256Prefix'])==16 for row in result['diagnostics']))


class ReverseBundleTests(unittest.TestCase):
    def test_entire_guest_graph_compiles_without_private_state_or_calls(self):
        import reverse_sync_guest as guest
        with public_bootstrap():code=guest.program({'public':'fixture'},RUN)
        compile(code,'<synthetic-reverse-compile>','exec')
        self.assertIn("root=Path('/opt/ir35/.env.p8-reverse')",code)
        self.assertIn('managedCloudStorageReverseProven',code)

    def test_native_source_keeps_original_mock_boundaries_and_never_restores_globals(self):
        import inspect
        import reverse_sync_guest as guest
        body=inspect.getsource(guest.run)
        self.assertIn('prepared(data);require_prepared(data)',body)
        self.assertIn("web.get('APPLY_RUNNER')!='mock'",body)
        self.assertIn("web.get('APPLICATION_WORKER_ACCEPT_JOBS')!='false'",body)
        self.assertIn("web.get('IR35_READ_ONLY')!='true'",body)
        for forbidden in ('--globals-only','ALTER ROLE','GRANT ','REVOKE ','--force','pg_terminate_backend'):
            self.assertNotIn(forbidden,body)


if __name__=='__main__':unittest.main()
