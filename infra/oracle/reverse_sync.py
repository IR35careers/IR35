"""Zero-loss disposable reverse-copy primitives, not a cloud rollback adapter.

Default dry-run has no private-state imports, network, subprocess or filesystem
writes. Native rehearsal is separately guarded, annotated, journalled and uses
fixed local Docker commands. Actual managed-cloud Storage locator preservation
remains UNPROVEN; this module never substitutes a logical-byte-only PASS.
"""
from collections import Counter
from datetime import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import subprocess
import sys
import threading
import time
import uuid

BASE = ('docker','compose','--env-file','/opt/ir35/.env','-f','/opt/ir35/compose.yml',
        'exec','-T','db','/run/ir35/env-exec','/opt/ir35/.env.db')
PARTS = ('public','auth','storage')
DEFAULT_RUN = 'reverse_20261030T000000Z_00000000'
HASH = re.compile(r'[a-f0-9]{64}')


class ReverseSyncError(RuntimeError):
    """Only fixed codes, never native diagnostics/arguments/row values."""
    def __init__(self,code,*,report=None):
        if type(code) is not str or not re.fullmatch('[A-Za-z0-9_]+',code):code='ControlledReverseErrorCodeRequired'
        self.report=report
        super().__init__(code)


def scope(run_id):
    if type(run_id) is not str or not re.fullmatch(r'reverse_[0-9]{8}T[0-9]{6}Z_[a-f0-9]{8}',run_id):
        raise ReverseSyncError('FixedDisposableRunIdentityRequired')
    try: datetime.strptime(run_id[8:24],'%Y%m%dT%H%M%SZ')
    except ValueError: raise ReverseSyncError('ValidUtcRunIdentityRequired') from None
    suffix=run_id.removeprefix('reverse_').lower()
    return {'runId':run_id,'sourceDatabase':'ir35_p8_reverse_source_'+suffix,
            'targetDatabase':'ir35_p8_reverse_target_'+suffix,
            'annotation':'ir35-p8-reverse:'+run_id,
            'storageRoot':'/opt/ir35/data/p8-reverse/'+run_id}


def database_commands(run_id,source,target):
    expected=scope(run_id)
    if source!=expected['sourceDatabase'] or target!=expected['targetDatabase'] or source==target:
        raise ReverseSyncError('OnlyExactOwnedDisposableDatabasesAllowed_NoCloud')
    return (BASE+('pg_dump','--no-password','--username=supabase_admin','--format=custom','--dbname='+source),
            BASE+('pg_restore','--no-password','--single-transaction','--exit-on-error',
                  '--username=supabase_admin','--dbname='+target))


def plan(run_id=DEFAULT_RUN):
    value=scope(run_id)
    return value|{'status':'DRY_RUN','writes':0,'networkCalls':0,'privateStateRead':False,
        'scope':'DISPOSABLE_STAGING_ONLY','plaintextArchives':0,'sourceClusterRoleChanges':0,
        'actions':['full-original-containment-and-112-HBA-before',
                   'fresh-annotated-source-clone-from-verified-pristine',
                   'eight-real-queue-denials-per-extra-clone',
                   'fresh-annotated-target-clone-and-side-effect-free-waitlist-shape-gate',
                   'owned-synthetic-insert-update-delete-with-explicit-hashed-ledger',
                   'replace-only-owned-disconnected-target-with-identical-collation',
                   'pg17-custom-dump-stream-to-single-transaction-restore-with-owners-ACLs',
                   'all-73-storage-bytes-xattrs-and-locators-copied-to-owned-private-root',
                   '62-ordered-MD5-Auth-two-sequences-schema-552-queue-storage-verification',
                   'remove-owned-fixture-rows-and-require-unchanged-original-baseline-PASS',
                   'drop-only-disconnected-owned-clones-and-storage-copies',
                   'full-original-containment-and-112-HBA-after'],
        'productionTargetSupported':False,'managedCloudStorageReverseProven':False,
        'nativeDeltaMutationExercised':False,'queueDataReverseProven':False,'phaseComplete':False}


def _rows(value,has_primary_key):
    if type(value) is not list or type(has_primary_key) is not bool:
        raise ReverseSyncError('CompleteHashedRowManifestRequired')
    rows=Counter();keys=set()
    for item in value:
        if (type(item) is not dict or set(item)!={'keyHash','rowHash','count'}
            or type(item['keyHash']) is not str or not HASH.fullmatch(item['keyHash'])
            or type(item['rowHash']) is not str or not HASH.fullmatch(item['rowHash'])
            or type(item['count']) is not int or item['count']<1):
            raise ReverseSyncError('CompleteHashedRowManifestRequired')
        key=(item['keyHash'],item['rowHash'])
        if key in rows or has_primary_key and (item['keyHash'] in keys or item['count']!=1):
            raise ReverseSyncError('DuplicatePrimaryOrManifestKey_Abort')
        if not has_primary_key and item['keyHash']!=item['rowHash']:
            raise ReverseSyncError('NoPrimaryKeyMustUseWholeRowIdentity')
        rows[key]=item['count'];keys.add(item['keyHash'])
    return rows


def row_delta(before,after,*,has_primary_key):
    """Explicit insertion/deletion/update ledger; no cleartext IDs or values.

    Without a primary key, SQL cannot identify an updated row uniquely. Preserve
    duplicate multiplicities and report changes honestly as delete+insert.
    """
    left,right=_rows(before,has_primary_key),_rows(after,has_primary_key)
    inserted=[];deleted=[];updated=[]
    if has_primary_key:
        a={key:row for key,row in left};b={key:row for key,row in right}
        for key in sorted(a.keys()|b.keys()):
            if key not in a:inserted.append({'keyHash':key,'rowHash':b[key],'count':1})
            elif key not in b:deleted.append({'keyHash':key,'rowHash':a[key],'count':1})
            elif a[key]!=b[key]:updated.append({'keyHash':key,'beforeHash':a[key],'afterHash':b[key]})
    else:
        for (key,row),count in sorted((right-left).items()):inserted.append({'keyHash':key,'rowHash':row,'count':count})
        for (key,row),count in sorted((left-right).items()):deleted.append({'keyHash':key,'rowHash':row,'count':count})
    return {'inserted':inserted,'deleted':deleted,'updated':updated,
            'beforeRows':sum(left.values()),'afterRows':sum(right.values()),
            'classification':'primary-key' if has_primary_key else 'whole-row-multiset'}


def fixture_rows(run_id):
    """Public synthetic values for owned disposable rows, never customer IDs.

    Values stay in RAM/native SQL stdin. Journals contain only these IDs' key
    hashes and operation counts, not addresses or row values.
    """
    scope(run_id)
    result={}
    for name in ('update','delete','insert'):
        value=str(uuid.uuid5(uuid.NAMESPACE_URL,'ir35-owned-reverse:'+run_id+':'+name))
        result[name]={'id':value,'email':'ir35-reverse-'+run_id.removeprefix('reverse_').lower()+'-'+name+'@invalid.test',
            'keyHash':hashlib.sha256(('V36:'+value+';').encode()).hexdigest()}
    result['updatedEmail']=result['update']['email'].replace('-update@','-updated@')
    result['createdAt']=datetime.strptime(run_id[8:24],'%Y%m%dT%H%M%SZ').strftime('%Y-%m-%dT%H:%M:%SZ')
    return result


def fixture_ledger_gate(original,target_before,source_after,run_id):
    """Compare actual hashed ledgers, allowing ONLY three owned fixture keys.

    This does not edit any original 62-table fingerprint or its expected values.
    Original data must be identical after removing only newly inserted fixture
    keys, which must have been absent from the verified snapshot.
    """
    fixtures=fixture_rows(run_id);table='public.waitlist'
    if (type(original)is not dict or set(original)!=set(target_before) or set(original)!=set(source_after)
        or len(original)!=62 or table not in original):
        raise ReverseSyncError('Exact62FixtureLedgerInventoryRequired')
    keys={fixtures[name]['keyHash'] for name in ('update','delete','insert')}
    def customer_only(ledger):
        copied={}
        for name,entry in ledger.items():
            if type(entry)is not dict or set(entry)!={'hasPrimaryKey','rows'}:
                raise ReverseSyncError('CompleteFixtureLedgerRequired')
            _rows(entry['rows'],entry['hasPrimaryKey'])
            copied[name]={'hasPrimaryKey':entry['hasPrimaryKey'],'rows':[
                row for row in entry['rows'] if name!=table or row['keyHash'] not in keys]}
        return copied
    if (original[table].get('hasPrimaryKey')is not True
        or any(row['keyHash'] in keys for row in original[table]['rows'])
        or customer_only(original)!=customer_only(target_before) or customer_only(original)!=customer_only(source_after)):
        raise ReverseSyncError('CopiedCustomerRowsChanged_Abort')
    if target_before[table]['hasPrimaryKey']is not True or source_after[table]['hasPrimaryKey']is not True:
        raise ReverseSyncError('OriginalWaitlistPrimaryKeyRequired')
    seeded={row['keyHash'] for row in target_before[table]['rows'] if row['keyHash'] in keys}
    final={row['keyHash'] for row in source_after[table]['rows'] if row['keyHash'] in keys}
    if seeded!={fixtures['update']['keyHash'],fixtures['delete']['keyHash']} or final!={fixtures['update']['keyHash'],fixtures['insert']['keyHash']}:
        raise ReverseSyncError('ExactOwnedFixtureCoverageRequired')
    delta=row_delta(target_before[table]['rows'],source_after[table]['rows'],has_primary_key=True)
    for kind,fixture_name in (('inserted','insert'),('updated','update'),('deleted','delete')):
        if len(delta[kind])!=1 or delta[kind][0]['keyHash']!=fixtures[fixture_name]['keyHash']:
            raise ReverseSyncError('ExactOwnedInsertUpdateDeleteRequired')
    return {'status':'PASS','table':table,'copiedCustomerRowsUnchanged':True,'delta':delta,
            'ownedKeyHashes':sorted(keys),'nativeProof':False}


def semantic_proof(value):
    """Drop observation timestamps only; never a catalogue/data/hash value."""
    if isinstance(value,dict):return {key:semantic_proof(item) for key,item in value.items() if key not in ('sourceCheckedAt','targetCheckedAt')}
    if isinstance(value,list):return [semantic_proof(item) for item in value]
    return value


def fixture_fidelity_gate(pristine,source,target,source_storage,target_storage,ledger_proof):
    """Full actual hashes must match each other during the owned-row exercise.

    The existing verifier is intentionally left unchanged: it reports FAIL vs
    the pristine snapshot while these two explicit synthetic rows exist. Record
    that result verbatim, require ONLY public.waitlist differs, then require all
    original baseline gates to PASS after those owned rows are removed.
    """
    fidelity_gate(pristine,pristine,source_storage,source_storage)
    if ledger_proof.get('status')!='PASS' or ledger_proof.get('copiedCustomerRowsUnchanged')is not True:
        raise ReverseSyncError('OwnedFixtureAndCustomerLedgerProofRequired')
    base_tables={row['name']:row for row in pristine['tables']}
    if 'public.waitlist' not in base_tables:raise ReverseSyncError('OriginalWaitlistFingerprintRequired')
    for proof in (source,target):
        if (proof.get('status')!='FAIL' or proof.get('dataDifferences')!=['public.waitlist']
            or proof.get('sequenceChecks')!=2 or proof.get('authTableChecks')!=pristine['authTableChecks']
            or proof.get('passwordHashBytesCoveredByWholeTableFingerprints')is not True
            or len(proof.get('tables',[]))!=62):
            raise ReverseSyncError('OnlyExplicitOwnedWaitlistBaselineDifferenceAllowed_Abort')
        tables={row['name']:row for row in proof['tables']}
        if set(tables)!=set(base_tables):raise ReverseSyncError('FixtureFullTableCoverageMismatch_Abort')
        for name in base_tables:
            if name!='public.waitlist' and tables[name]!=base_tables[name]:
                raise ReverseSyncError('FixtureChangedNonOwnedTable_Abort')
        if int(tables['public.waitlist']['rows'])!=int(base_tables['public.waitlist']['rows'])+2:
            raise ReverseSyncError('ExactTwoOwnedFinalRowsRequired')
        for name in ('schema','transport','extensionChecks','privileges'):
            if semantic_proof(proof.get(name))!=semantic_proof(pristine.get(name)):
                raise ReverseSyncError('FixtureSecurityOrSchemaMismatch_Abort')
    if source['tables']!=target['tables'] or source_storage!=target_storage:
        raise ReverseSyncError('FixtureSourceTargetFullDataOrStorageMismatch_Abort')
    return {'status':'PASS','tables':62,'sequences':2,'storageObjects':73,'copiedCustomerRowsUnchanged':True,
        'sourceTargetFullFingerprintsMatch':True,'originalVerifierUnchanged':True,
        'originalBaselineDuringFixture':'FAIL_owned_public_waitlist_rows_only',
        'originalBaselineMustPassAfterFixtureRemoval':True,'productionRollbackReady':False}


def ledger_sql(table,identifier):
    """Use the original length-framed text casts; return only SHA256 metadata."""
    if (type(table) is not dict or not table.get('columns') or len(set(table['columns']))!=len(table['columns'])
        or len(set(table.get('primaryKey',[])))!=len(table.get('primaryKey',[]))
        or not set(table.get('primaryKey',[])).issubset(table['columns'])):
        raise ReverseSyncError('CompleteOriginalTableInventoryRequired')
    def framed(columns):
        fields=[]
        for name in columns:
            col='t.'+identifier(name)
            fields.append("CASE WHEN "+col+" IS NULL THEN 'N;' ELSE 'V'||octet_length(convert_to("+col+"::text,'UTF8'))::text||':'||"+col+"::text||';' END")
        return '||'.join(fields)
    row=framed(table['columns']);key=framed(table.get('primaryKey') or table['columns'])
    relation=identifier(table['schema'])+'.'+identifier(table['name'])
    return ("SELECT COALESCE(jsonb_agg(jsonb_build_object('keyHash',k,'rowHash',r,'count',n) ORDER BY k,r),'[]'::jsonb) FROM ("
            "SELECT encode(sha256(convert_to("+key+",'UTF8')),'hex') k,encode(sha256(convert_to("+row+
            ",'UTF8')),'hex') r,count(*) n FROM "+relation+" t GROUP BY 1,2) q;")


def fidelity_gate(source,target,source_storage,target_storage):
    for proof in (source,target):
        if (type(proof)is not dict or type(proof.get('tables'))is not list
            or any(type(row)is not dict or type(row.get('name'))is not str for row in proof['tables'])):
            raise ReverseSyncError('CompleteNamedTableProofRequired_Abort')
        names=[row['name'] for row in proof['tables']]
        if (type(proof) is not dict or proof.get('status')!='PASS' or len(proof.get('tables',[]))!=62
            or len(set(names))!=62 or not {'auth.users','auth.identities','auth.mfa_factors'}.issubset(names)
            or proof.get('authTableChecks')!=sum(name.startswith('auth.') for name in names)
            or proof.get('sequenceChecks')!=2 or proof.get('passwordHashBytesCoveredByWholeTableFingerprints') is not True
            or proof.get('dataDifferences')!=[] or proof.get('privileges',{}).get('status')!='PASS'
            or proof.get('transport',{}).get('status')!='PASS' or proof.get('extensionChecks',{}).get('status')!='PASS'
            or proof['privileges'].get('sourceEntries')!=552 or proof['privileges'].get('targetEntries')!=552
            or proof.get('schema',{}).get('baseline552Unchanged') is not True
            or proof['schema'].get('unexplainedDifferences')!=[]
            or proof['schema'].get('sourceRolesUnchanged') is not True
            or proof['schema'].get('sourceRoleExpiryUnchanged') is not True
            or proof['schema'].get('additionExpiryVerified') is not True
            or not {row.get('object') for row in proof['schema'].get('exceptions',[])}.issubset(
                {'extension:pg_stat_statements','extension:pgcrypto','extension:uuid-ossp'})
            or {row.get('name') for row in proof['schema'].get('approvedP6Additions',[])}!={'ir35_queue','ir35_queue_producer'}):
            raise ReverseSyncError('Full62AuthSequencePrivilegeProofRequired_Abort')
    for key in ('tables','schema','transport','extensionChecks','privileges','authTableChecks'):
        if semantic_proof(source.get(key))!=semantic_proof(target.get(key)):raise ReverseSyncError('SourceTargetFidelityMismatch_Abort')
    if (type(source_storage) is not dict or source_storage.get('status')!='PASS'
        or source_storage.get('objects')!=73 or source_storage!=target_storage):
        raise ReverseSyncError('All73StorageBytesAndMetadataMismatch_Abort')
    return {'status':'PASS','tables':62,'sequences':2,'storageObjects':73,
            'authHashesCovered':True,'sourceTargetProofsIdentical':True,
            'managedCloudStorageReverseProven':False,'queueDataReverseProven':False,'phaseComplete':False}


def _pipe_commands(commands,*,timeout=300):
    """Real streaming transfer. Fixed commands supplied only by public guard.

    Test-only callers use synthetic processes. No archive/row bytes or native
    stderr are persisted/printed; only byte counts/SHA/exit codes escape.
    """
    if len(commands)!=2 or timeout!=300:raise ReverseSyncError('FixedTwoStageDeadlineRequired')
    env={'PATH':'/usr/sbin:/usr/bin:/sbin:/bin','LANG':'C.UTF-8'}
    children=[];threads=[];diagnostics=[];transfer={'complete':False,'bytes':0}
    digest=hashlib.sha256();started=time.monotonic();result={'status':'FAIL','plaintextArchives':0,'rawOutputPrinted':False}
    def drain(stream,record):
        value=hashlib.sha256();size=0
        try:
            while body:=stream.read(65536):value.update(body);size+=len(body)
        except Exception:record['drainFailed']=True
        finally:stream.close();record.update(bytes=size,sha256Prefix=value.hexdigest()[:16])
    try:
        for index,arguments in enumerate(commands):
            child=subprocess.Popen(arguments,stdin=subprocess.DEVNULL if index==0 else subprocess.PIPE,
                stdout=subprocess.PIPE,stderr=subprocess.PIPE,env=env,start_new_session=True,close_fds=True)
            children.append(child)
            for label,stream in (('stderr',child.stderr),('stdout',child.stdout)):
                if index==0 and label=='stdout':continue
                record={'stage':index,'channel':label};diagnostics.append(record)
                thread=threading.Thread(target=drain,args=(stream,record),daemon=True);thread.start();threads.append(thread)
        def relay():
            try:
                while body:=children[0].stdout.read(65536):
                    digest.update(body);transfer['bytes']+=len(body);children[1].stdin.write(body)
                children[1].stdin.flush();transfer['complete']=True
            except Exception:pass
            finally:
                children[0].stdout.close()
                try:children[1].stdin.close()
                except OSError:transfer['complete']=False
        stream=threading.Thread(target=relay,daemon=True);stream.start();threads.append(stream)
        while any(child.poll() is None for child in children):
            if any(child.returncode not in (None,0) for child in children):raise ReverseSyncError('ReverseStreamStageFailed')
            if time.monotonic()-started>timeout:raise ReverseSyncError('ReverseStreamDeadline')
            time.sleep(0.01)
        for thread in threads:thread.join(timeout=5)
        for child in children:
            for stream in (child.stdin,child.stdout,child.stderr):
                if stream is not None and not stream.closed:
                    try:stream.close()
                    except OSError:result.update(status='FAIL',code='ReverseStreamCloseFailed')
        if any(child.returncode!=0 for child in children) or not transfer['complete'] or transfer['bytes']==0:
            raise ReverseSyncError('ReverseStreamIncomplete')
        result['status']='PASS'
    except Exception as error:
        result['code']=str(error) if type(error)is ReverseSyncError else type(error).__name__
    finally:
        for child in children:
            if child.poll() is None:
                try:os.killpg(child.pid,signal.SIGKILL)
                except ProcessLookupError:pass
        for child in children:child.wait()
        for thread in threads:thread.join(timeout=5)
        if any(thread.is_alive() for thread in threads) or any(row.get('drainFailed') for row in diagnostics):
            result.update(status='FAIL',code='ReverseStreamDrainIncomplete')
        result.update(bytes=transfer['bytes'],archiveSHA256=digest.hexdigest(),diagnostics=diagnostics,
                      exitCodes=[child.returncode for child in children],seconds=round(time.monotonic()-started,3))
    if result['status']!='PASS':raise ReverseSyncError(result.get('code','ReverseStreamFailed'),report=result)
    return result


def stream_database(run_id,source,target):
    return _pipe_commands(database_commands(run_id,source,target))


def main(argv=None):
    args=sys.argv[1:] if argv is None else argv
    if not args or args==['--dry-run']:args=['--dry-run',DEFAULT_RUN]
    if len(args)!=2 or args[0] not in ('--dry-run','--rehearse'):
        raise ReverseSyncError('DisposableDryRunOrRehearsalOnly_NoCloud')
    run_id=args[1];scope(run_id)
    if args[0]=='--dry-run':print(json.dumps(plan(run_id),sort_keys=True));return 0
    # Lazy imports: no private state or transport during default dry-run/import.
    import cloud_schema as schema
    import p8_staging_readonly as staging
    from p6_audit_log import Journal
    from reverse_sync_guest import program
    data=staging.context()  # Original strict clean-branch/immutable-proof gate.
    code=program(data,run_id)
    journal=Journal(schema.REPO/'docs/evidence/p8'/('reverse-disposable-'+run_id))
    result={'status':'FAIL','scope':'DISPOSABLE_STAGING_ONLY','productionWrites':0,'cloudWrites':0,'phaseComplete':False}
    try:
        result['rehearsal']=journal.step(1,'disposable-reverse',lambda:schema.run_guest(code,timeout=900))
        result['status']='PASS'
    except Exception as error:result['exceptionType']=type(error).__name__
    finally:result['manifestSHA256']=journal.seal(result)
    print(json.dumps(result,sort_keys=True));return 0 if result['status']=='PASS' else 1


if __name__=='__main__':
    try:raise SystemExit(main())
    except ReverseSyncError as error:print(json.dumps({'status':'STOP','code':str(error),'rawErrorWithheld':True}));raise SystemExit(1)
    except Exception as error:print(json.dumps({'status':'STOP','exceptionType':type(error).__name__,'rawErrorWithheld':True}));raise SystemExit(1)
