"""New owner-approved recovery only; never executes in another helper's globals."""
import base64
from datetime import datetime,timezone
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess
import time
from immutable_artifacts import Store,digest


class RecoveryError(RuntimeError):pass


class Recovery:
    def __init__(self,payload,runtime):
        self.payload=payload;self.runtime=runtime;self.root=Path('/opt/ir35')
        self.run_id=payload['runId']
        if not re.fullmatch(r'p4_[0-9]{8}T[0-9]{6}Z_[0-9a-f]{8}',self.run_id):raise RecoveryError('RunIdentityRefused')
        self.database='ir35_'+self.run_id.lower()
        self.run_root=self.root/'.env.p4-runs'/self.run_id
        self.base=['docker','compose','--env-file',str(self.root/'.env'),'-f',str(self.root/'compose.yml'),'exec','-T','db','/run/ir35/env-exec','/opt/ir35/.env.db']
        self.sql=payload['sql'];self.verifiers=runtime['verifiers']
        if runtime['read_env']().get('APPLY_RUNNER')!='mock':raise RecoveryError('MockOnlyRequired')

    def command(self,args,**kwargs):
        result=subprocess.run(args,capture_output=True,timeout=kwargs.pop('timeout',120),**kwargs)
        if result.returncode:raise RecoveryError('NativeCommandFailed_'+Path(args[0]).name)
        return result.stdout

    def query(self,sql,database=None,*,readonly=True,log=None):
        database=database or self.database
        if database not in ('postgres',self.database):raise RecoveryError('DestinationDatabaseRefused')
        prefix='BEGIN ISOLATION LEVEL REPEATABLE READ '+('READ ONLY' if readonly else 'READ WRITE')+'; '+self.verifiers['SETTINGS']
        args=self.base+['psql','-XqAt','-v','ON_ERROR_STOP=1','-v','VERBOSITY=sqlstate','-U','supabase_admin','-d',database,'-f','-']
        result=subprocess.run(args,input=(prefix+sql+('ROLLBACK;' if readonly else 'COMMIT;')).encode(),capture_output=True,timeout=180)
        if log:log.write(result.stdout);log.write(result.stderr);log.flush()
        if result.returncode:raise RecoveryError('StagingSQLFailed_RawPrivateOnly')
        return result.stdout.decode()

    def store(self):return Store(self.run_root,uid=1002)

    def verify_previous(self):
        incident=self.payload.get('incident')
        if incident:
            Store(Path(incident['incidentDirectory']),uid=1002).verify(incident['stage'],incident['manifestSHA256'])
        anchors=self.payload.get('anchors',{})
        for name,anchor in sorted(anchors.items()):
            self.store().verify(name,anchor)
            result=self.run_root/name/'result.json'
            if result.exists():
                runtime=json.loads(result.read_bytes()).get('runtime')
                if runtime:self.check_runtime_files(name,runtime)
        if not anchors:raise RecoveryError('PriorManifestAnchorsRequired')
        if '04-storage' in anchors:
            self.check_storage_files(json.loads((self.run_root/'01-source/source.json').read_bytes()))

    def check_runtime_files(self,stage,runtime):
        root=self.run_root/('runtime-'+stage)
        if runtime.get('environmentRoot')!=str(root) or root.resolve()!=root or root.is_symlink():raise RecoveryError('RuntimeDirectoryIdentityMismatch')
        info=root.lstat()
        if not stat.S_ISDIR(info.st_mode) or info.st_uid!=1002 or stat.S_IMODE(info.st_mode)!=0o700:raise RecoveryError('RuntimeDirectoryCustodyMismatch')
        expected=set()
        for record in runtime['files']:
            path=Path(record['path']);expected.add(path);info=path.lstat()
            if path.parent!=root or path.resolve()!=path or not stat.S_ISREG(info.st_mode) or info.st_uid!=1002 or stat.S_IMODE(info.st_mode)!=0o600 or info.st_nlink!=1 or digest(path.read_bytes())!=record['sha256']:raise RecoveryError('RuntimeSecretFileIntegrityMismatch')
        if set(root.iterdir())!=expected:raise RecoveryError('UnmanifestedRuntimeArtifact')

    def check_storage_files(self,source):
        root=self.root/'data/p4-runs'/self.run_id;expected=set()
        for obj in source['storage']['privateObjects']:
            target=root/self.verifiers['backend_path'](obj['bucket'],obj['name'],obj['version']);expected.add(target)
            if target.absolute()!=target.resolve() or target.is_symlink() or not target.is_file():raise RecoveryError('PhysicalStorageLocatorMismatch')
            observed=target.stat()
            if observed.st_uid!=1002 or stat.S_IMODE(observed.st_mode)!=0o400 or observed.st_nlink!=1 or observed.st_size!=int(obj['bytes']) or digest(target.read_bytes())!=obj['sha256']:raise RecoveryError('PhysicalStorageIntegrityMismatch_Abort')
            for field,attr in (('contentType','content-type'),('cacheControl','cache-control'),('contentEncoding','content-encoding')):
                if obj.get(field) and os.getxattr(target,'user.supabase.'+attr)!=obj[field].encode():raise RecoveryError('StorageHeaderMetadataMismatch')
        if {p for p in root.rglob('*') if p.is_file()}!=expected:raise RecoveryError('UnmanifestedStorageFile_Abort')

    def source(self):
        self.verify_previous()
        if '01-source' not in self.payload['anchors']:raise RecoveryError('SnapshotManifestRequired')
        return json.loads((self.run_root/'01-source/source.json').read_bytes())

    def seal(self,store,stage,result):
        store.put(stage,'result.json',json.dumps(result,sort_keys=True).encode())
        previous=next(reversed(self.payload.get('anchors',{}).values()),None)
        anchor=store.seal(stage,previous=previous)
        return {**result,'stage':stage.name,'manifestSHA256':anchor,'runId':self.run_id,'target':self.database}

    def incident(self):
        destination=self.root/'incident'/self.run_id.removeprefix('p4_')
        if destination.exists() or destination.is_symlink():raise RecoveryError('IncidentAlreadyExists_NoReplay')
        sources=['.env.p4-cycle1-source.json','config/p4-auth-authorized-2.json','config/p4-auth-login.json','config/p4-rehearsal.json',
                 '.env.p4-cycle1-restore.log','.env.p4-compat1-restore.log']
        paths=[]
        for relative in sources:
            target=self.root/relative
            info=target.lstat()
            if not stat.S_ISREG(info.st_mode) or info.st_nlink!=1 or info.st_uid not in (0,1002) or stat.S_IMODE(info.st_mode)!=0o600:raise RecoveryError('IncidentSourceCustodyMismatch')
            paths.append((relative,target,digest(target.read_bytes())))
        info=json.loads(self.runtime['run'](['docker','inspect','ir35-p4-auth2-auth','ir35-p4-auth2-rest','ir35-p4-auth2-kong']))
        if any(i['State']['Status']!='exited' or i['HostConfig'].get('PortBindings') for i in info):raise RecoveryError('IncidentContainersMustBeStopped')
        parent=destination.parent
        if not parent.exists():parent.mkdir(mode=0o700);os.chown(parent,1002,1002)
        if parent.is_symlink() or parent.stat().st_uid!=1002 or stat.S_IMODE(parent.stat().st_mode)!=0o700:raise RecoveryError('IncidentRootCustodyMismatch')
        destination.mkdir(mode=0o700);os.chown(destination,1002,1002)
        store=Store(destination,uid=1002);stage=store.stage('00-evidence');moved=[]
        # Same-filesystem hard-link + unlink is no-replace even if interrupted.
        for index,(relative,origin,expected) in enumerate(paths):
            target=stage/('artifact-'+str(index)+('.json' if origin.suffix=='.json' else '.log'))
            os.link(origin,target,follow_symlinks=False)
            if digest(target.read_bytes())!=expected:raise RecoveryError('IncidentMoveHashMismatch')
            origin.unlink();os.chown(target,1002,1002);os.chmod(target,0o400)
            moved.append({'originalPath':relative,'archivedFile':target.name,'sha256':expected,'bytes':target.stat().st_size,'mode':'400'})
        result={'status':'PASS','incidentDirectory':str(destination),'artifacts':moved,'sourceWrites':0,'customerDataWrites':0,
                'unavailableLogs':'GoTrue Docker driver none; no historical raw response log exists',
                'originalDumpUnmoved':True,'originalQuarantineUnchanged':True}
        store.put(stage,'record.json',json.dumps(result,sort_keys=True).encode())
        anchor=store.seal(stage);store.verify(stage.name,anchor)
        return {**result,'manifestSHA256':anchor,'stage':stage.name,'runId':self.run_id}

    def initialize(self):
        incident=self.payload['incident'];incident_store=Store(Path(incident['incidentDirectory']),uid=1002)
        incident_store.verify(incident['stage'],incident['manifestSHA256'])
        parent=self.run_root.parent
        if not parent.exists():parent.mkdir(mode=0o700);os.chown(parent,1002,1002)
        if parent.is_symlink() or parent.stat().st_uid!=1002 or stat.S_IMODE(parent.stat().st_mode)!=0o700:raise RecoveryError('RunParentCustodyMismatch')
        self.run_root.mkdir(mode=0o700);os.chown(self.run_root,1002,1002)
        store=self.store();stage=store.stage('00-run')
        result={'status':'PASS','runId':self.run_id,'target':self.database,'incidentManifestSHA256':incident['manifestSHA256'],
                'writeOnce':True,'sourceWrites':0,'customerDataWrites':0,'protocol':'owner-recovery-20261021-v1'}
        return self.seal(store,stage,result)

    def receive(self):
        self.verify_previous();store=self.store();stage=store.stage('01-source')
        dump=base64.b64decode(self.payload['archive'],validate=True);source=self.payload['source']
        if not dump.startswith(b'PGDMP') or digest(dump)!=self.payload['archiveSHA256'] or len(dump)>256_000_000:raise RecoveryError('SourceArchiveDigestInvalid')
        if not all(source.get(k) is True for k in ('snapshotBound','sequenceStable','storageStable')):raise RecoveryError('IncompleteSourceSnapshot')
        store.put(stage,'cloud.dump',dump);reference=json.dumps(source,sort_keys=True).encode();store.put(stage,'source.json',reference)
        result={'status':'PASS','sourceWrites':0,'customerDataWrites':0,'archiveSHA256':digest(dump),'archiveBytes':len(dump),
                'referenceSHA256':digest(reference),'snapshot':source['capture'],'tableCount':len(source['rows']['tables']),
                'objectCount':len(source['storage']['privateObjects']),'storageMigrations':source['storageMigrations']}
        return self.seal(store,stage,result)

    def catalog(self,database=None):return json.loads(self.query(self.sql['catalog'],database))

    def restore(self):
        source=self.source();store=self.store();stage=store.stage('02-restore')
        usage=self.runtime['role_usage']()
        catalog=self.catalog('postgres')
        roles=lambda cat:{o['kind']+':'+o['name']:o['hash'] for o in cat['objects'] if o['kind'] in ('role','role-membership')}
        if roles(catalog)!=roles(source['catalog']):raise RecoveryError('ClusterRoleMismatch_NoImport')
        # Only the previously approved, operationally unused CLI expiry alignment.
        current=json.loads(self.query(self.sql['expiry'],'postgres'))
        other={k:v for k,v in current.items() if k!='cli_login_postgres'}
        if other!={k:v for k,v in source['roleExpiry'].items() if k!='cli_login_postgres'}:raise RecoveryError('UnreviewedRoleExpiryDifference')
        if current.get('cli_login_postgres')!=source['roleExpiry'].get('cli_login_postgres'):
            until=source['expiry']
            if not re.fullmatch(r'\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{6}\+00',until):raise RecoveryError('SourceExpiryFormatRefused')
            self.query('ALTER ROLE "cli_login_postgres" VALID UNTIL '+self.verifiers['literal'](until)+';','postgres',readonly=False)
        if json.loads(self.query(self.sql['expiry'],'postgres'))!=source['roleExpiry']:raise RecoveryError('RoleExpiryReadbackMismatch')
        if self.query("SELECT 1 FROM pg_database WHERE datname='"+self.database+"';",'postgres').strip():raise RecoveryError('TargetAlreadyExists_NoReplay')
        if source['catalog']['encoding']!='UTF8' or source['catalog']['collation']!={'ctype':'en_US.UTF-8','locale':'en-US','collate':'en_US.UTF-8','provider':'i'}:raise RecoveryError('SourceEncodingCollationUnreviewed')
        store.put(stage,'intent.json',json.dumps({'target':self.database,'attempts':1,'sourceManifest':self.payload['anchors']['01-source']}).encode())
        with store.sink(stage,'restore.log') as log:
            args=self.base+['psql','-XqAt','-v','ON_ERROR_STOP=1','-U','supabase_admin','-d','postgres','-f','-']
            create='CREATE DATABASE '+self.database+" WITH OWNER postgres TEMPLATE template0 ENCODING 'UTF8' LC_COLLATE 'en_US.UTF-8' LC_CTYPE 'en_US.UTF-8' LOCALE_PROVIDER icu ICU_LOCALE 'en-US';"
            result=subprocess.run(args,input=create.encode(),stdout=log,stderr=log,timeout=60)
            if result.returncode:raise RecoveryError('CreateStagingDatabaseFailed_PrivateLog')
            args=self.base+['pg_restore','--no-password','--verbose','--single-transaction','--exit-on-error','--username=supabase_admin','--dbname='+self.database]
            with (self.run_root/'01-source/cloud.dump').open('rb') as dump:
                result=subprocess.run(args,stdin=dump,stdout=log,stderr=log,timeout=300)
            if result.returncode:raise RecoveryError('RestoreFailed_PrivateLog_NoReplay')
            def query(sql,database=None,transaction=True,log=None):return self.query(sql,database,readonly=not transaction,log=log)
            normalized=self.verifiers['normalize_restored_cloud'](query,self.catalog,source['catalog'],self.database,log)
        result={'status':'RESTORED','sourceWrites':0,'target':self.database,'attempts':1,'normalization':normalized,
                'roleUsage':usage,'dumpSHA256':digest((self.run_root/'01-source/cloud.dump').read_bytes())}
        return self.seal(store,stage,result)

    def check_database(self):
        source=self.source();v=self.verifiers
        target=self.catalog();extensions=v['extension_compare'](source['extensions'],json.loads(self.query(self.sql['extensions'])))
        privileges=v['privilege_compare'](source['privileges'],json.loads(self.query(self.sql['privileges'])))
        fidelity=v['fidelity_compare'](source['catalog'],target,extensions,privileges,json.loads(self.query(self.sql['expiry']))==source['roleExpiry'])
        transport=v['transport_compare'](source['transport'],json.loads(self.query(self.sql['transport'])))
        inventory=json.loads(self.query(self.sql['inventory']));tables=[];sequences=[]
        if inventory!=source['rows']['inventory']:raise RecoveryError('TableInventoryMismatch')
        for table in inventory['tables']:
            sql='BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; '+v['SETTINGS']+v['copy_sql'](table)+' ROLLBACK;'
            value=v['fingerprint'](self.base+['psql','-XqAt','-v','ON_ERROR_STOP=1','-U','supabase_admin','-d',self.database,'-f','-'],
                                   {'PATH':'/usr/sbin:/usr/bin:/sbin:/bin','LC_ALL':'C.UTF-8'},sql)
            tables.append({'name':table['schema']+'.'+table['name'],**value})
        for seq in inventory['sequences']:
            value=json.loads(self.query("SELECT jsonb_build_object('lastValue',last_value::text,'isCalled',is_called) FROM "+v['identifier'](seq['schema'])+'.'+v['identifier'](seq['name'])+';'))
            sequences.append({'name':seq['schema']+'.'+seq['name'],**value})
        expected={x['name']:x for x in source['rows']['tables']};actual={x['name']:x for x in tables}
        differences=[k for k in sorted(expected.keys()|actual.keys()) if expected.get(k)!=actual.get(k)]
        if sequences!=source['rows']['sequences']:differences.append('sequences')
        metadata=json.loads(self.query("SELECT jsonb_build_object('encoding',current_setting('server_encoding'),'unicodeRoundTripMD5',md5(convert_from(convert_to('😀 café Ελληνικά 日本語 العربية','UTF8'),'UTF8')),'collation',(SELECT jsonb_build_object('collate',datcollate,'ctype',datctype,'provider',datlocprovider,'locale',datlocale) FROM pg_database WHERE datname=current_database()));"))
        if metadata!=source['rows']['metadata']:differences.append('encoding-collation-unicode')
        ok=not differences and fidelity['status']!='FAIL' and transport['status']=='PASS' and privileges['status']=='PASS'
        return {'status':'PASS' if ok else 'FAIL','schema':fidelity,'transport':transport,'extensionChecks':extensions,'privileges':privileges,
                'tables':tables,'dataDifferences':differences,'sequenceChecks':len(sequences),'authTableChecks':sum(t['name'].startswith('auth.') for t in tables),
                'passwordHashBytesCoveredByWholeTableFingerprints':True,'sourceWrites':0,'stagingWrites':0,'fullP4Complete':False}
    def verify(self):
        self.verify_previous();store=self.store();stage=store.stage('03-verify')
        return self.seal(store,stage,self.check_database())

    def storage(self):
        source=self.source();store=self.store();stage=store.stage('04-storage')
        if json.loads((self.run_root/'03-verify/result.json').read_text()).get('status')!='PASS':raise RecoveryError('FullDatabaseVerificationRequired')
        data_parent=self.root/'data/p4-runs'
        if not data_parent.exists():data_parent.mkdir(mode=0o700);os.chown(data_parent,1002,1002)
        if data_parent.is_symlink() or data_parent.stat().st_uid!=1002 or stat.S_IMODE(data_parent.stat().st_mode)!=0o700:raise RecoveryError('StorageParentCustodyMismatch')
        data_root=data_parent/self.run_id
        data_root.mkdir(mode=0o700);os.chown(data_root,1002,1002)
        objects=[]
        for obj in source['storage']['privateObjects']:
            relative=self.verifiers['backend_path'](obj['bucket'],obj['name'],obj['version']);target=data_root/relative
            parent=data_root
            for part in Path(relative).parts[:-1]:
                parent=parent/part
                if not parent.exists():parent.mkdir(mode=0o700);os.chown(parent,1002,1002)
                if parent.is_symlink() or parent.stat().st_uid!=1002:raise RecoveryError('StorageLocatorCustodyMismatch')
            body=base64.b64decode(obj['body'],validate=True)
            if len(body)!=int(obj['bytes']) or digest(body)!=obj['sha256']:raise RecoveryError('CapturedStorageByteMismatch')
            fd=os.open(target,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
            try:
                os.fchown(fd,1002,1002)
                with os.fdopen(fd,'wb',closefd=False) as output:output.write(body);output.flush();os.fsync(fd)
                for field,attr in (('contentType','content-type'),('cacheControl','cache-control'),('contentEncoding','content-encoding')):
                    if obj.get(field):os.setxattr(target,'user.supabase.'+attr,obj[field].encode())
                os.fchmod(fd,0o400)
            finally:os.close(fd)
            if digest(target.read_bytes())!=obj['sha256']:raise RecoveryError('PhysicalStorageByteMismatch')
            objects.append({k:obj[k] for k in ('pathHash','bytes','sha256')})
        for directory in sorted((p for p in data_root.rglob('*') if p.is_dir()),key=lambda p:len(p.parts),reverse=True):os.chmod(directory,0o500)
        os.chmod(data_root,0o500)
        store.put(stage,'objects.json',json.dumps(objects,sort_keys=True).encode())
        result={'status':'PASS','objectCount':len(objects),'totalBytes':sum(int(o['bytes']) for o in objects),
                'allSHA256Match':True,'physicalRoot':str(data_root),'sourceWrites':0,'databaseWrites':0,'bucketMetadataCoveredByDatabaseFingerprint':True,
                'storageAPIProofPending':True,'phaseComplete':False}
        return self.seal(store,stage,result)


def run(operation,payload,runtime):
    recovery=Recovery(payload,runtime)
    if operation not in ('incident','initialize','receive','restore','verify','storage'):raise RecoveryError('OperationRefused')
    try:return getattr(recovery,operation)()
    except Exception as error:
        code=str(error) if isinstance(error,RecoveryError) and re.fullmatch(r'[A-Za-z0-9_]+',str(error)) else type(error).__name__
        stage_name={'receive':'01-source','restore':'02-restore','verify':'03-verify','storage':'04-storage'}.get(operation)
        stage=recovery.run_root/stage_name if stage_name else None
        if stage and stage.is_dir() and stat.S_IMODE(stage.stat().st_mode)==0o700 and not (stage/'manifest.json').exists():
            return recovery.seal(recovery.store(),stage,{'status':'FAIL','code':code,'sourceWrites':0,'phaseComplete':False,'replayAllowed':False})
        raise RecoveryError(code) from None
