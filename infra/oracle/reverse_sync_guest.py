"""New disposable reverse-copy cycle; never imports/runs at CLI startup.

Only a verified pristine snapshot is cloned. No provider, secret, global-role,
catalogue normalization or production adapter exists. Every failure is sealed;
only exact annotated/disconnected objects created by this cycle may be removed.
"""
import copy
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import stat

from p4_recovery_guest import RecoveryError
from p6_restart_diagnosis_guest import containment
from p8_upgrade_guest import scoped_recovery,clone_denials
from reverse_sync import (ReverseSyncError,scope,stream_database,fidelity_gate,ledger_sql,row_delta,
                          fixture_rows,fixture_ledger_gate,fixture_fidelity_gate)
from p6_mock_guest import prepared
from web_services_guest import require_prepared
from web_edge_guest import private_env


class ReverseStorageError(RecoveryError,ReverseSyncError):pass


def _physical_files(root):
    """A byte manifest must not silently ignore links or special entries."""
    files=set()
    for path in root.rglob('*'):
        mode=path.lstat().st_mode
        if stat.S_ISREG(mode):files.add(path)
        elif not stat.S_ISDIR(mode):raise RecoveryError('ReverseStorageSpecialEntryRefused_Abort')
    return files


def storage_copy(source_root,target_root,source_manifest,backend_path,*,uid=1002):
    """Actual bytes/xattrs, no archive and no path/customer value in result."""
    source_root,target_root=Path(source_root),Path(target_root)
    if source_root.resolve()!=source_root or source_root.is_symlink() or not source_root.is_dir():
        raise RecoveryError('ReversePhysicalSourceStorageRequired')
    if target_root.exists() or target_root.is_symlink() or target_root.parent.resolve()!=target_root.parent:
        raise RecoveryError('ReverseFreshOwnedStorageTargetRequired')
    objects=source_manifest['storage']['privateObjects']
    if len(objects)!=73:raise RecoveryError('ReverseAll73StorageObjectsRequired')
    source_files=_physical_files(source_root)
    target_root.mkdir(mode=0o700);os.chown(target_root,uid,uid)
    expected=set();records=[]
    for obj in objects:
        relative=Path(backend_path(obj['bucket'],obj['name'],obj['version']))
        if relative.is_absolute() or '..' in relative.parts:raise RecoveryError('ReverseStorageLocatorRefused')
        original=source_root/relative;destination=target_root/relative;expected.add(original)
        if (original.resolve()!=original or original.is_symlink() or not original.is_file()
            or original.stat().st_nlink!=1 or original.stat().st_uid!=uid
            or stat.S_IMODE(original.stat().st_mode)!=0o400
            or original.stat().st_size!=int(obj['bytes'])):
            raise RecoveryError('ReverseOriginalStorageCustodyMismatch_Abort')
        body=original.read_bytes()
        if hashlib.sha256(body).hexdigest()!=obj['sha256']:
            raise ReverseStorageError('ReverseOriginalStorageByteMismatch_Abort',report={'status':'FAIL','bucket':obj['bucket'],
                'pathHash':hashlib.sha256(relative.as_posix().encode()).hexdigest(),'expectedSHA256':obj['sha256'],
                'actualSHA256':hashlib.sha256(body).hexdigest()})
        parents=[];parent=destination.parent
        while parent!=target_root:parents.append(parent);parent=parent.parent
        for parent in reversed(parents):
            if not parent.exists():parent.mkdir(mode=0o700);os.chown(parent,uid,uid)
            if parent.is_symlink() or parent.resolve()!=parent:raise RecoveryError('ReverseStorageParentEscape_Abort')
        fd=os.open(destination,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
        try:
            os.fchown(fd,uid,uid)
            with os.fdopen(fd,'wb',closefd=False) as output:output.write(body);output.flush();os.fsync(output.fileno())
            for name in os.listxattr(original):os.setxattr(destination,name,os.getxattr(original,name))
            os.fchmod(fd,0o400)
        finally:os.close(fd)
        if destination.read_bytes()!=body or set(os.listxattr(original))!=set(os.listxattr(destination)):
            raise RecoveryError('ReverseStorageCopyMismatch_Abort')
        for name in os.listxattr(original):
            if os.getxattr(original,name)!=os.getxattr(destination,name):raise RecoveryError('ReverseStorageMetadataMismatch_Abort')
        observed=original.stat()
        os.utime(destination,ns=(observed.st_atime_ns,observed.st_mtime_ns),follow_symlinks=False)
        for field,attribute in (('contentType','content-type'),('cacheControl','cache-control'),('contentEncoding','content-encoding')):
            if obj.get(field) and os.getxattr(destination,'user.supabase.'+attribute)!=obj[field].encode():
                raise RecoveryError('ReverseStorageHeaderMismatch_Abort')
        records.append({'pathHash':hashlib.sha256(relative.as_posix().encode()).hexdigest(),
                        'bytes':len(body),'sha256':obj['sha256'],
                        'xattrHash':hashlib.sha256(json.dumps({name:os.getxattr(destination,name).hex()
                            for name in sorted(os.listxattr(destination))},sort_keys=True).encode()).hexdigest()})
        body=None
    if source_files!=expected or _physical_files(source_root)!=expected:
        raise RecoveryError('ReverseUnmanifestedSourceStorage_Abort')
    if {path.relative_to(target_root) for path in _physical_files(target_root)}!={path.relative_to(source_root) for path in expected}:
        raise RecoveryError('ReverseUnmanifestedTargetStorage_Abort')
    records.sort(key=lambda row:row['pathHash'])
    return {'status':'PASS','objects':73,'bytes':sum(row['bytes'] for row in records),
            'manifestSHA256':hashlib.sha256(json.dumps(records,sort_keys=True).encode()).hexdigest(),
            'fileBackendMetadataAndLocatorsCovered':True,'managedCloudStorageReverseProven':False}


def collect_ledger(recovery):
    source=recovery.source();inventory=json.loads(recovery.query(recovery.sql['inventory']))
    if inventory!=source['rows']['inventory'] or len(inventory['tables'])!=62:
        raise RecoveryError('Reverse62TableInventoryMismatch_Abort')
    result={}
    for table in inventory['tables']:
        values=json.loads(recovery.query(ledger_sql(table,recovery.verifiers['identifier'])))
        if len(values)>1_000_000:raise RecoveryError('ReverseRowLedgerBoundExceeded_NoTruncation')
        # Validation also rejects ambiguous/duplicate primary-key identities.
        row_delta(values,values,has_primary_key=bool(table['primaryKey']))
        result[table['schema']+'.'+table['name']]={'hasPrimaryKey':bool(table['primaryKey']),'rows':values}
    return result


def compare_ledgers(before,after):
    if set(before)!=set(after) or len(before)!=62:raise RecoveryError('ReverseLedgerInventoryMismatch_Abort')
    result={}
    for name in sorted(before):
        if before[name]['hasPrimaryKey']!=after[name]['hasPrimaryKey']:raise RecoveryError('ReversePrimaryKeyInventoryChanged_Abort')
        result[name]=row_delta(before[name]['rows'],after[name]['rows'],has_primary_key=before[name]['hasPrimaryKey'])
    return result


WAITLIST_SHAPE_SQL="""SELECT jsonb_build_object(
 'columns',(SELECT jsonb_object_agg(a.attname,format_type(a.atttypid,a.atttypmod))
   FROM pg_attribute a WHERE a.attrelid='public.waitlist'::regclass AND a.attnum>0 AND NOT a.attisdropped),
 'generatedColumns',(SELECT count(*) FROM pg_attribute a WHERE a.attrelid='public.waitlist'::regclass
   AND a.attnum>0 AND NOT a.attisdropped AND (a.attgenerated<>'' OR a.attidentity<>'')),
 'primaryKey',(SELECT jsonb_agg(a.attname ORDER BY ord.n) FROM pg_constraint c
   CROSS JOIN LATERAL unnest(c.conkey) WITH ORDINALITY AS ord(attnum,n)
   JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=ord.attnum
   WHERE c.conrelid='public.waitlist'::regclass AND c.contype='p'),
 'userTriggers',(SELECT count(*) FROM pg_trigger WHERE tgrelid='public.waitlist'::regclass AND NOT tgisinternal),
 'rules',(SELECT count(*) FROM pg_rewrite WHERE ev_class='public.waitlist'::regclass),
 'foreignKeys',(SELECT count(*) FROM pg_constraint WHERE contype='f'
   AND (conrelid='public.waitlist'::regclass OR confrelid='public.waitlist'::regclass)),
 'checks',(SELECT count(*) FROM pg_constraint WHERE contype='c' AND conrelid='public.waitlist'::regclass),
 'inheritance',(SELECT count(*) FROM pg_inherits WHERE inhrelid='public.waitlist'::regclass OR inhparent='public.waitlist'::regclass),
 'relation',(SELECT jsonb_build_object('kind',relkind,'persistence',relpersistence,'partition',relispartition)
   FROM pg_class WHERE oid='public.waitlist'::regclass));"""
WAITLIST_BASE={'id':'uuid','email':'text','created_at':'timestamp with time zone'}
WAITLIST_LAUNCH={'launch_notified_at':'timestamp with time zone','launch_email_id':'text',
                 'launch_email_attempts':'integer','launch_last_error':'text'}


def fixture_shape(observed):
    if (observed.get('columns') not in (WAITLIST_BASE,WAITLIST_BASE|WAITLIST_LAUNCH)
        or observed.get('primaryKey')!=['id'] or observed.get('relation')!={'kind':'r','persistence':'p','partition':False}
        or any(observed.get(name)!=0 for name in ('generatedColumns','userTriggers','rules','foreignKeys','checks','inheritance'))):
        raise RecoveryError('ExactSideEffectFreeWaitlistFixtureShapeRequired_Abort')
    return tuple(WAITLIST_BASE)+(tuple(WAITLIST_LAUNCH) if observed['columns']==WAITLIST_BASE|WAITLIST_LAUNCH else ())


def fixture_sql(run_id,operation,columns,literal):
    """Fixed SQL only; values enter native stdin, never evidence/argv/logs."""
    if tuple(columns) not in (tuple(WAITLIST_BASE),tuple(WAITLIST_BASE)+tuple(WAITLIST_LAUNCH)):
        raise RecoveryError('ReviewedFixtureColumnsRequired')
    rows=fixture_rows(run_id)
    def values(name):
        row=rows[name]
        data=[literal(row['id'])+'::uuid',literal(row['email']),literal(rows['createdAt'])+'::timestamptz']
        if len(columns)>3:data+=['NULL','NULL','0','NULL']
        return '('+','.join(data)+')'
    fields=','.join('"'+column+'"' for column in columns)
    if operation=='seed':
        return 'WITH owned AS (INSERT INTO public.waitlist('+fields+') VALUES '+values('update')+','+values('delete')+' RETURNING id) SELECT count(*) FROM owned;'
    if operation=='mutate':
        return ('WITH removed AS (DELETE FROM public.waitlist WHERE id='+literal(rows['delete']['id'])+'::uuid AND email='+literal(rows['delete']['email'])+' RETURNING id),'
            ' changed AS (UPDATE public.waitlist SET email='+literal(rows['updatedEmail'])+' WHERE id='+literal(rows['update']['id'])+'::uuid AND email='+literal(rows['update']['email'])+' RETURNING id),'
            ' added AS (INSERT INTO public.waitlist('+fields+') VALUES '+values('insert')+' RETURNING id)'
            " SELECT jsonb_build_object('inserted',(SELECT count(*) FROM added),'updated',(SELECT count(*) FROM changed),'deleted',(SELECT count(*) FROM removed));")
    if operation=='remove':
        return ('WITH owned AS (DELETE FROM public.waitlist WHERE (id='+literal(rows['update']['id'])+'::uuid AND email='+literal(rows['updatedEmail'])+') OR (id='+literal(rows['insert']['id'])+'::uuid AND email='+literal(rows['insert']['email'])+') RETURNING id) SELECT count(*) FROM owned;')
    raise RecoveryError('FixedFixtureOperationRequired')


def run(data,runtime,store,run_id):
    prepared(data);require_prepared(data)
    web=private_env(Path('/opt/ir35/.env.p5-web'))
    if (web.get('IR35_READ_ONLY')!='true' or web.get('APPLY_RUNNER')!='mock'
        or web.get('APPLICATION_WORKER_ACCEPT_JOBS')!='false'):
        raise RecoveryError('ReverseProtectedReadonlyMockFixtureRequired')
    names=scope(run_id);recovery=scoped_recovery(data,runtime);pristine=recovery.database
    source_name,target_name=names['sourceDatabase'],names['targetDatabase'];source_manifest=recovery.source()
    storage_root=Path(names['storageRoot']);storage_parent=storage_root.parent
    owned=[];anchors={};step_number=0;custody={'storageCreated':False}
    def step(label,action):
        nonlocal step_number
        for old,anchor in anchors.items():store.verify(old,anchor)
        step_number+=1;stage=store.stage(f'{step_number:02d}-reverse-'+label)
        store.put(stage,'intent.json',json.dumps({'operation':label,'scope':'DISPOSABLE_STAGING_ONLY','runId':run_id}).encode())
        result={'status':'FAIL'}
        try:result=action(stage)
        except Exception as error:
            result={'status':'FAIL','exceptionType':type(error).__name__,'rawErrorWithheld':True}
            if isinstance(error,ReverseSyncError):
                result['code']=str(error)
                if error.report is not None:result['streamDiagnostics']=error.report
            elif type(error)is RecoveryError and re.fullmatch('[A-Za-z0-9_]+',str(error)):
                result['code']=str(error)
        store.put(stage,'result.json',json.dumps(result,sort_keys=True).encode())
        anchor=store.seal(stage,previous=next(reversed(anchors.values()),None));anchors[stage.name]=anchor
        store.verify(stage.name,anchor)
        if result.get('status')!='PASS':raise RecoveryError('ReverseStepFailed_'+label)
        return result
    def admin(sql):return recovery.command(recovery.base+['psql','-XqAt','-v','ON_ERROR_STOP=1','-U','supabase_admin','-d','postgres','-f','-'],input=sql.encode())
    def absent(name):return recovery.query('SELECT count(*) FROM pg_database WHERE datname='+recovery.verifiers['literal'](name)+';','postgres').strip()=='0'
    def annotation(name):return names['annotation']+':'+('source' if name==source_name else 'target')
    def drop_owned(name):
        if absent(name):return
        literal=recovery.verifiers['literal'](name)
        detail=json.loads(recovery.query("SELECT jsonb_build_object('owner',pg_get_userbyid(datdba),'annotation',obj_description(oid,'pg_database'),'connections',(SELECT count(*) FROM pg_stat_activity WHERE datname="+literal+")) FROM pg_database WHERE datname="+literal+';','postgres'))
        if detail!={'owner':'postgres','annotation':annotation(name),'connections':0} or name not in (source_name,target_name):
            raise RecoveryError('ReverseOwnedDisconnectedCloneRequired_NoDrop')
        admin('DROP DATABASE '+name+';')
        if not absent(name):raise RecoveryError('ReverseCloneCleanupReadbackFailed_Abort')
    def preflight(stage):
        full=containment(data,runtime,probe_container='ir35-p6-mock-worker-v7-fixedip')
        if full['status']!='PASS':raise RecoveryError('ReverseOriginalContainmentMismatch_Abort')
        available=int(next(line.split()[1] for line in Path('/proc/meminfo').read_text().splitlines() if line.startswith('MemAvailable:')))*1024
        database_bytes=int(recovery.query('SELECT pg_database_size('+recovery.verifiers['literal'](pristine)+');').strip())
        storage_bytes=sum(int(item['bytes']) for item in source_manifest['storage']['privateObjects'])
        needed=2*database_bytes+2*storage_bytes+512*1024**2
        free=shutil.disk_usage('/opt/ir35/data').free
        if available<2*1024**3 or database_bytes<=0 or free<needed:raise RecoveryError('ReverseExistingVmMemoryOrDiskHeadroomInsufficient_Abort')
        if not absent(source_name) or not absent(target_name) or storage_root.exists() or storage_root.is_symlink():
            raise RecoveryError('ReverseOwnedSlotAlreadyExists_NoReplay')
        recovery.check_storage_files(source_manifest)
        if not storage_parent.exists():storage_parent.mkdir(mode=0o700);os.chown(storage_parent,1002,1002)
        if storage_parent.resolve()!=storage_parent or stat.S_IMODE(storage_parent.stat().st_mode)!=0o700 or storage_parent.stat().st_uid!=1002:
            raise RecoveryError('ReverseStorageParentCustodyRequired')
        storage_root.mkdir(mode=0o700);custody['storageCreated']=True;os.chown(storage_root,1002,1002)
        return {'status':'PASS','fullOriginalContainment':full,'sourceWrites':0,
                'availableMemoryBytes':available,'dataVolumeFreeBytes':free,'requiredScratchBytes':needed,
                'containerLimitsChanged':False,'newResourcesCreated':0}
    def create_source(stage):
        owned.append(source_name) # Ambiguous create cannot be replayed.
        admin('CREATE DATABASE '+source_name+' WITH TEMPLATE '+pristine+' OWNER postgres; COMMENT ON DATABASE '+source_name+' IS '+recovery.verifiers['literal'](annotation(source_name))+';')
        item=copy.copy(recovery);item.database=source_name
        proof=item.check_database()
        if proof['status']!='PASS':raise RecoveryError('ReverseSourceCloneMismatch_Abort')
        return {'status':'PASS','database':source_name,'fidelity':proof,'queueBoundary':clone_denials(item,source_name)}
    def restore(stage):
        source=copy.copy(recovery);source.database=source_name
        # There are no service containers or timers for this fresh source. Fail
        # if another client/prepared transaction appeared; do not terminate it.
        other=source.query("SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid();").strip()
        if other!='0':raise RecoveryError('ReverseDisposableSourceNotQuiescent_Abort')
        before=collect_ledger(source);pristine_proof=source.check_database()
        if pristine_proof['status']!='PASS':raise RecoveryError('ReverseOriginalSourceProofRequired_Abort')
        store.put(stage,'source-original-row-manifest.json',json.dumps(before,sort_keys=True).encode())
        columns=fixture_shape(json.loads(source.query(WAITLIST_SHAPE_SQL)))
        owned.append(target_name)
        metadata=source_manifest['rows']['metadata']
        if metadata.get('encoding')!='UTF8' or metadata.get('collation')!={'ctype':'en_US.UTF-8','locale':'en-US','collate':'en_US.UTF-8','provider':'i'}:
            raise RecoveryError('ReverseExactSourceCollationRequired')
        admin('CREATE DATABASE '+target_name+' WITH TEMPLATE '+pristine+' OWNER postgres; COMMENT ON DATABASE '+target_name+' IS '+recovery.verifiers['literal'](annotation(target_name))+';')
        target=copy.copy(recovery);target.database=target_name
        denials={'beforeReplacement':clone_denials(target,target_name)}
        target_pristine=target.check_database()
        store.put(stage,'target-original-database-proof.json',json.dumps(target_pristine,sort_keys=True).encode())
        if target_pristine['status']!='PASS' or collect_ledger(target)!=before or fixture_shape(json.loads(target.query(WAITLIST_SHAPE_SQL)))!=columns:
            raise RecoveryError('ReverseFreshTargetMustMatchOriginalSource_Abort')
        fixtures=fixture_rows(run_id)
        store.put(stage,'fixture-intent.json',json.dumps({'table':'public.waitlist','scope':'OWNED_SYNTHETIC_ROWS_ONLY',
            'ownedKeyHashes':sorted(fixtures[name]['keyHash'] for name in ('update','delete','insert')),
            'seedRowsPerDisposableDatabase':2,'sourceMutationCounts':{'inserted':1,'updated':1,'deleted':1},
            'customerRowWrites':0,'baselineAssertionsChanged':False},sort_keys=True).encode())
        # Fresh clones have no services. Do not touch an already existing ID;
        # an unexpected collision is a hard stop before any fixture write.
        if any(row['keyHash'] in {fixtures[name]['keyHash'] for name in ('update','delete','insert')}
               for row in before['public.waitlist']['rows']):
            raise RecoveryError('ReverseOwnedFixtureCollision_Abort')
        seed_counts={}
        for name,item in (('source',source),('target',target)):
            if item.query("SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid();").strip()!='0':
                raise RecoveryError('ReverseFixtureMustHaveNoOtherClients_Abort')
            seed_counts[name]=int(item.query(fixture_sql(run_id,'seed',columns,item.verifiers['literal']),readonly=False).strip())
            store.put(stage,'fixture-seed-'+name+'-result.json',json.dumps({'inserted':seed_counts[name]},sort_keys=True).encode())
            if seed_counts[name]!=2:raise RecoveryError('ReverseExactTwoFixtureSeedsRequired_Abort')
        store.put(stage,'fixture-seed-counts.json',json.dumps(seed_counts,sort_keys=True).encode())
        target_seeded=collect_ledger(target);source_seeded=collect_ledger(source)
        if source_seeded!=target_seeded:raise RecoveryError('ReverseFixtureSeedSourceTargetMismatch_Abort')
        mutation=json.loads(source.query(fixture_sql(run_id,'mutate',columns,source.verifiers['literal']),readonly=False))
        store.put(stage,'fixture-mutation-counts.json',json.dumps(mutation,sort_keys=True).encode())
        if mutation!={'inserted':1,'updated':1,'deleted':1}:raise RecoveryError('ReverseExactFixtureMutationCountsRequired_Abort')
        mutated=collect_ledger(source)
        ledger_proof=fixture_ledger_gate(before,target_seeded,mutated,run_id)
        store.put(stage,'target-before-reverse-row-manifest.json',json.dumps(target_seeded,sort_keys=True).encode())
        store.put(stage,'source-after-fixture-row-manifest.json',json.dumps(mutated,sort_keys=True).encode())
        store.put(stage,'explicit-change-and-deletion-ledger.json',json.dumps(ledger_proof,sort_keys=True).encode())
        # The mirror strategy replaces only this disconnected annotated scratch
        # database; no cloud adapter, table DELETE/TRUNCATE or restore --clean.
        drop_owned(target_name)
        admin('CREATE DATABASE '+target_name+" WITH OWNER postgres TEMPLATE template0 ENCODING 'UTF8' LC_COLLATE 'en_US.UTF-8' LC_CTYPE 'en_US.UTF-8' LOCALE_PROVIDER icu ICU_LOCALE 'en-US'; COMMENT ON DATABASE "+target_name+' IS '+recovery.verifiers['literal'](annotation(target_name))+';')
        denials['afterReplacement']=clone_denials(target,target_name)
        transfer=stream_database(run_id,source_name,target_name)
        source_proof=source.check_database();target_proof=target.check_database()
        store.put(stage,'source-owned-fixture-database-proof.json',json.dumps(source_proof,sort_keys=True).encode())
        store.put(stage,'target-owned-fixture-database-proof.json',json.dumps(target_proof,sort_keys=True).encode())
        source_storage=storage_copy(Path('/opt/ir35/data/p4-runs')/recovery.run_id,storage_root/'source',source_manifest,recovery.verifiers['backend_path'])
        target_storage=storage_copy(storage_root/'source',storage_root/'target',source_manifest,recovery.verifiers['backend_path'])
        after_source=collect_ledger(source);after_target=collect_ledger(target)
        store.put(stage,'source-before-fixture-removal-row-manifest.json',json.dumps(after_source,sort_keys=True).encode())
        store.put(stage,'target-row-manifest.json',json.dumps(after_target,sort_keys=True).encode())
        if after_source!=mutated or after_target!=after_source:raise RecoveryError('ReverseHashedRowLedgerMismatch_Abort')
        delta_verified=fixture_fidelity_gate(pristine_proof,source_proof,target_proof,source_storage,target_storage,ledger_proof)
        # Remove only the two precisely identified owned rows, then prove the
        # unchanged original verifier PASS on both databases. No hash rebaseline.
        removal={}
        for name,item in (('source',source),('target',target)):
            removal[name]=int(item.query(fixture_sql(run_id,'remove',columns,item.verifiers['literal']),readonly=False).strip())
            store.put(stage,'fixture-remove-'+name+'-result.json',json.dumps({'deleted':removal[name]},sort_keys=True).encode())
            if removal[name]!=2:raise RecoveryError('ReverseExactOwnedFixtureRemovalRequired_Abort')
        store.put(stage,'fixture-removal-counts.json',json.dumps(removal,sort_keys=True).encode())
        source_final=source.check_database();target_final=target.check_database()
        store.put(stage,'source-final-database-proof.json',json.dumps(source_final,sort_keys=True).encode())
        store.put(stage,'target-final-database-proof.json',json.dumps(target_final,sort_keys=True).encode())
        if collect_ledger(source)!=before or collect_ledger(target)!=before:raise RecoveryError('ReverseOriginalCustomerLedgerNotRestored_Abort')
        verified=fidelity_gate(source_final,target_final,source_storage,target_storage)
        return {'status':'PASS','stream':transfer,'verification':verified,'targetFidelity':target_final,
            'queueBoundary':denials,'storage':target_storage,'deletionLedger':ledger_proof,'ownedFixtureFidelity':delta_verified,
            'sourceFrozenScope':'fresh-owned-unpublished-source-no-other-clients',
            'nativeDeltaMutationExercised':True,'sourceClusterRolesChanged':False,
            'productionRollbackReady':False,'managedCloudStorageReverseProven':False,'queueDataReverseProven':False}
    def cleanup(stage):
        for name in reversed(owned):
            drop_owned(name)
        if custody['storageCreated'] and storage_root.exists():
            if storage_root.resolve()!=storage_root or storage_root.parent!=Path('/opt/ir35/data/p8-reverse') or storage_root.name!=run_id:
                raise RecoveryError('ReverseOwnedStorageCleanupScopeMismatch_NoDelete')
            if any(path.is_symlink() for path in storage_root.rglob('*')):raise RecoveryError('ReverseStorageCleanupSymlink_NoDelete')
            shutil.rmtree(storage_root)
        return {'status':'PASS','ownedSourceAndTargetAbsent':True,'onlyOwnedStorageCopiesRemoved':True,'forcedDisconnects':0}
    result={'status':'FAIL','scope':'DISPOSABLE_STAGING_ONLY','sourceWrites':0,'cloudWrites':0,'phaseComplete':False}
    try:
        result['before']=step('preflight',preflight)
        result['source']=step('source',create_source)
        result['reverse']=step('restore',restore)
        result['status']='PASS'
    except Exception as error:result['exceptionType']=type(error).__name__
    finally:
        try:result['cleanup']=step('cleanup',cleanup)
        except Exception as error:result.update(status='FAIL',cleanupErrorType=type(error).__name__)
        try:
            final=containment(data,runtime,probe_container='ir35-p6-mock-worker-v7-fixedip')
            result['after']=step('containment',lambda stage:final)
        except Exception as error:result.update(status='FAIL',containmentErrorType=type(error).__name__)
    result.update(manifests=anchors,managedCloudStorageReverseProven=False,
                  nativeDeltaMutationExercised=result.get('reverse',{}).get('nativeDeltaMutationExercised',False),
                  productionRollbackReady=False,queueDataReverseProven=False)
    return result


def program(data,run_id):
    # Imported on the laptop only when explicit --rehearse is selected. Public
    # source compilation is testable with the existing bootstrap fixture.
    import p6_capture_repair
    import cloud_schema as schema
    import inspect
    import p8_app_readiness as capabilities
    code=p6_capture_repair.bundle()
    code+="module=types.ModuleType('p8_app_readiness');sys.modules['p8_app_readiness']=module\nexec("+repr(
        'COLUMNS='+repr(capabilities.COLUMNS)+'\nFUNCTIONS='+repr(capabilities.FUNCTIONS)
        +'\nSQL='+repr(capabilities.SQL)+'\n'+inspect.getsource(capabilities.readiness))+',module.__dict__)\n'
    for name in ('upgrade_review','p8_upgrade_guest','reverse_sync','reverse_sync_guest'):
        body=(schema.REPO/'infra/oracle'/(name+'.py')).read_text(encoding='utf-8')
        code+='\nmodule=types.ModuleType('+repr(name)+');sys.modules['+repr(name)+']=module\nexec('+repr(body)+',module.__dict__)\n'
    code+='\ndata='+repr(data)+'\nrun_id='+repr(run_id)+'\n'
    code+='''
import os,stat,json
from immutable_artifacts import Store
from reverse_sync_guest import run
from pathlib import Path
root=Path('/opt/ir35/.env.p8-reverse')
if not root.exists():root.mkdir(mode=0o700);os.chown(root,1002,1002)
if root.is_symlink() or root.resolve()!=root or root.stat().st_uid!=1002 or stat.S_IMODE(root.stat().st_mode)!=0o700:raise RuntimeError('ReversePrivateJournalParentRequired')
slot=root/run_id;slot.mkdir(mode=0o700);os.chown(slot,1002,1002)
print(json.dumps(run(data,runtime,Store(slot,uid=1002),run_id)))
'''
    compile(code,'<owned-disposable-reverse>','exec')
    return code
