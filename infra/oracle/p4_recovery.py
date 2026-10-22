"""Orchestrate separately journalled owner-approved staging recovery only."""
import base64
from datetime import datetime,timezone
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import sys
import uuid
import cloud_schema as schema
import immutable_artifacts
import owner_parity
import p4_source
import rehearsal
import storage_release
import storage_source
import storage_target
import inspect
import auth_redaction
from bootstrap_audit import KEY_DIRECTORY
from key_ceremony import write_new
from security_session import private_file

STATE_DIRECTORY=KEY_DIRECTORY/'p4-recovery'
ACTIVE=STATE_DIRECTORY/'active.json'


def sql():
    paths={'catalog':'oracle_schema_catalog.sql','transport':'oracle_transport_catalog.sql','extensions':'oracle_extension_security.sql',
           'privileges':'oracle_effective_privileges.sql','inventory':'oracle_data_inventory.sql'}
    return {k:(schema.REPO/'supabase/verification'/v).read_text() for k,v in paths.items()}|{'expiry':rehearsal.EXPIRY_SQL}


def state():
    value=json.loads(private_file(ACTIVE))
    if value.get('protocol')!='owner-recovery-20261021-v1' or not re.fullmatch(r'p4_[0-9]{8}T[0-9]{6}Z_[0-9a-f]{8}',value.get('runId','')):raise ValueError('Private recovery identity refused')
    return value


def report_directory():
    return schema.REPO/'docs/evidence/p4-recovery'/state()['runId']


def reports():
    directory=report_directory()
    records={}
    for path in sorted(directory.glob('*.json')) if directory.exists() else []:
        name=path.stem.removesuffix('-summary')
        if name in records:raise ValueError('Duplicate operation evidence; reconcile, never choose silently')
        records[name]=json.loads(path.read_text())
    return records


def public_result(operation,result):
    result=dict(result)
    if operation=='restore' and 'normalization' in result:
        # The normalizer returns a PRIVATE full catalog for the next comparison.
        # Public evidence needs ONLY repair counts, never those role/policy values.
        result['normalization']={key:result['normalization'][key] for key in ('ownerRepairs','aclObjectsReplayed')}
    return result


def publish(operation,result):
    result=public_result(operation,result)
    directory=report_directory();directory.mkdir(parents=True,exist_ok=True)
    path=directory/(operation+'.json')
    # Generated redacted evidence is write-once too, including failed reports.
    with path.open('x',encoding='utf-8') as stream:json.dump(result,stream,indent=2);stream.write('\n')
    print(json.dumps({'status':result['status'],'operation':operation,'report':str(path.relative_to(schema.REPO)),
                      'manifestSHA256':result.get('manifestSHA256'),'runId':state()['runId'],'sourceWrites':0}))


def contain_local_projection():
    """Move the never-published verbose restore report outside Git, byte-identical."""
    origin=report_directory()/'restore.json';body=origin.read_bytes();result=json.loads(body)
    if result.get('runId')!=state()['runId'] or result.get('stage')!='02-restore' or 'catalog' not in result.get('normalization',{}):raise ValueError('Exact unpublished restore projection required')
    destination=STATE_DIRECTORY/(state()['runId']+'-unpublished-restore.json')
    if not destination.exists():write_new(destination,body)
    info=destination.lstat()
    # This is a bounded full catalog, NOT a <=64KiB CLI session file. Preserve
    # the CLI reader's stricter guard and independently check this artifact.
    if destination.resolve()!=destination or info.st_uid!=os.getuid() or not stat.S_ISREG(info.st_mode) or stat.S_IMODE(info.st_mode) not in (0o400,0o600) or info.st_nlink!=1 or info.st_size>4_000_000:raise ValueError('Local private evidence custody mismatch')
    if hashlib.sha256(destination.read_bytes()).hexdigest()!=hashlib.sha256(body).hexdigest():raise ValueError('Local private evidence move hash mismatch')
    os.chmod(destination,0o400)
    # Source bytes are retained outside Git, never overwritten. The new redacted
    # summary has a different filename and keeps the original VM manifest anchor.
    summary=public_result('restore',result)
    summary['projectionContainment']={'originalBytes':len(body),'originalSHA256':hashlib.sha256(body).hexdigest(),'published':False,'preservedOutsideGit':True}
    with (report_directory()/'restore-summary.json').open('x',encoding='utf-8') as output:json.dump(summary,output,indent=2);output.write('\n')
    origin.unlink()
    print(json.dumps({'status':'PASS','originalSHA256':hashlib.sha256(body).hexdigest(),'preservedOutsideGit':True,'rawOutput':'withheld'}))


def payload():
    history=reports()
    anchors={r['stage']:r['manifestSHA256'] for k,r in history.items() if k!='incident' and r.get('manifestSHA256')}
    return {'runId':state()['runId'],'sql':sql(),'anchors':dict(sorted(anchors.items())),
            'incident':history.get('incident')}


def guest(operation,data):
    modules=[('immutable_artifacts',Path(immutable_artifacts.__file__).read_text()),
             ('p4_recovery_guest',(schema.REPO/'infra/oracle/p4_recovery_guest.py').read_text()),
             ('auth_redaction',Path(auth_redaction.__file__).read_text()),
             ('p4_auth_probe',(schema.REPO/'infra/oracle/p4_auth_probe.py').read_text())]
    # Read-only / original credential entrypoints never receive DROP capability.
    if operation.startswith('mail-'):modules.append(('p4_mail_probe',(schema.REPO/'infra/oracle/p4_mail_probe.py').read_text()))
    script=schema.guest_bundle(rehearsal=True)+owner_parity.BASE
    script+='\nimport types\n'
    for name,body in modules:
        script+='module=types.ModuleType('+repr(name)+');sys.modules['+repr(name)+']=module\nexec('+repr(body)+',module.__dict__)\n'
    verification_source=rehearsal.verification_modules()+'\nfrom pathlib import PurePosixPath\n'+inspect.getsource(storage_target.backend_path)
    script+='verification_namespace={}\nexec('+repr(verification_source)+',verification_namespace)\n'
    script+='runtime={"run":run,"read_env":read_env,"role_usage":role_usage,"verifiers":verification_namespace,"component_env":component_env,"env_text":env_text,"kong_config":stack.kong_config}\n'
    module='p4_auth_probe' if operation in ('storage-api','runtime-audit','observer-audit') or operation.startswith(('synthetic-','storage-api-repair-','named-')) else 'p4_recovery_guest'
    if operation.startswith('mail-'):module='p4_mail_probe'
    script+='result=sys.modules['+repr(module)+'].run('+repr(operation)+','+repr(data)+',runtime)\nprint(json.dumps(result))\n'
    return script


def remote(operation,data=None,timeout=360):
    if operation in reports():raise ValueError('Operation already recorded; reconcile, never replay')
    data=data or payload()
    if operation=='runtime-audit':data['priorRuntime']=reports()['storage-api']['runtime']
    if operation=='observer-audit':data['priorRuntime']=reports()['synthetic-1']['runtime']
    pins=json.loads((schema.REPO/'infra/oracle/staging-images.json').read_text())['images']
    pins['storage']=json.loads(storage_release.PIN.read_text())['image']
    data['pins']=pins
    return schema.run_guest(guest(operation,data),timeout=timeout)


def capture():
    history=reports()
    if history.get('initialize',{}).get('status')!='PASS' or 'receive' in history:raise ValueError('One new initialized run required')
    environment=schema.source_environment();key=os.environ.pop('IR35_SOURCE_STORAGE_KEY',None)
    if not key:raise ValueError('Read-only source Storage credential required in memory')
    started=datetime.now(timezone.utc).isoformat();clock=__import__('time').monotonic()
    versions={name:schema.native(name,['--version'],environment).decode().strip() for name in ('pg_dump','psql')}
    queries=sql();source={}
    with schema.Snapshot(environment) as snapshot:
        snapshot.send("SELECT jsonb_build_object('snapshotId',pg_export_snapshot(),'walLSN',pg_current_wal_lsn()::text,'serverVersion',current_setting('server_version'));")
        identity=json.loads(snapshot.line())
        identity['dumpSnapshotId']=snapshot.snapshot
        source['rows']=p4_source.collect(snapshot,environment)
        for field in ('catalog','transport','extensions','privileges'):
            snapshot.send(queries[field]);source[field]=json.loads(snapshot.line())
        snapshot.send(queries['expiry']);source['roleExpiry']=json.loads(snapshot.line())
        snapshot.send("SELECT to_char(rolvaliduntil AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS.US')||'+00' FROM pg_roles WHERE rolname='cli_login_postgres' AND isfinite(rolvaliduntil);")
        source['expiry']=snapshot.line().decode()
        source['storage']=storage_source.collect(snapshot,key)
        snapshot.send("SELECT jsonb_agg(jsonb_build_object('id',id,'name',name,'hash',hash) ORDER BY id) FROM storage.migrations;")
        source['storageMigrations']=json.loads(snapshot.line())
        fixture=json.loads(storage_release.FIXTURE_REPORT.read_text())
        if storage_release.compare(source['storageMigrations'],fixture['migrations'])['status']!='PASS':raise ValueError('New cloud Storage history differs from proven image; abort')
        archive=schema.native('pg_dump',['--no-password','--role=postgres','--format=custom','--snapshot='+snapshot.snapshot],environment,maximum=256_000_000)
        if not archive.startswith(b'PGDMP'):raise ValueError('Native custom archive required')
        if source['rows']['sequences']!=p4_source.sequence_values(snapshot,source['rows']['inventory']):raise ValueError('Source sequences moved; abort inconsistent snapshot')
        with schema.Snapshot(environment) as current:
            current.send(storage_source.SQL)
            if json.loads(current.line())!=source['storage']['metadata']:raise ValueError('Source Storage metadata moved; abort inconsistent snapshot')
    key=None
    for obj in source['storage']['privateObjects']:obj['body']=base64.b64encode(obj['body']).decode()
    source.update(snapshotBound=True,sequenceStable=True,storageStable=True,
                  capture={'startUTC':started,'endUTC':datetime.now(timezone.utc).isoformat(),'durationSeconds':round(__import__('time').monotonic()-clock,3),**identity,'tools':versions})
    data=payload()|{'archive':base64.b64encode(archive).decode(),'archiveSHA256':hashlib.sha256(archive).hexdigest(),'source':source}
    result=remote('receive',data)
    publish('receive',result)


def main():
    if sys.argv[1:]==['--contain-local-projection']:contain_local_projection();return
    if sys.argv[1:]==['--new']:
        if not STATE_DIRECTORY.exists():STATE_DIRECTORY.mkdir(mode=0o700)
        value={'protocol':'owner-recovery-20261021-v1','runId':'p4_'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')+'_'+uuid.uuid4().hex[:8]}
        write_new(ACTIVE,json.dumps(value).encode());print(json.dumps({'status':'PASS',**value}));return
    if sys.argv[1:]==['--capture']:capture();return
    if sys.argv[1:]==['--named-status']:
        print(json.dumps(remote('named-status')));return
    if sys.argv[1:]==['--named-stdin-secret']:
        # Never prompt/read stdin unless BOTH actual snapshot and synthetic gates passed.
        if remote('named-status').get('status')!='READY_STOPPED':raise ValueError('Named attempt not ready; no secret read')
        value=json.loads(sys.stdin.read(16385));password=value.pop('password',None)
        if value or not isinstance(password,str) or not 1<=len(password)<=1024:raise ValueError('One owner-entered hidden password required')
        result=remote('named-login',payload()|{'password':password});password=None
        publish('named-login',result)
        if result['status']!='PASS':raise SystemExit(1)
        return
    if len(sys.argv)!=2 or sys.argv[1] not in ('--incident','--initialize','--restore','--verify','--storage','--storage-api','--storage-api-repair-1','--storage-api-repair-2','--runtime-audit','--observer-audit','--synthetic-1','--synthetic-2','--synthetic-3','--named-ready','--mail-1','--mail-2','--mail-3','--revised-signoff'):raise ValueError('Fixed recovery operation required')
    operation='revised_signoff' if sys.argv[1]=='--revised-signoff' else sys.argv[1][2:]
    expected={'initialize':'incident','restore':'receive','verify':'restore','storage':'verify','storage-api':'storage'}.get(operation)
    history=reports()
    if expected and history.get(expected,{}).get('status') not in ('PASS','RESTORED'):raise ValueError('Prior operation must pass')
    if operation.startswith('storage-api-repair-'):
        index=int(operation[-1]);previous=history.get('storage-api' if index==1 else 'storage-api-repair-1',{})
        if previous.get('status')!='FAIL' or previous.get('code') not in ('PrivateServiceAddressRequired','FrozenStorageAPIHealthFailed') or previous.get('fullPostAPIFidelity')!='PASS':
            raise ValueError('Only documented low-risk launcher/config repair; no data mismatch retry')
    if operation=='synthetic-1':
        candidate=history.get('storage-api',{})
        for key in ('storage-api-repair-1','storage-api-repair-2'):
            if key in history:candidate=history[key]
        if candidate.get('status')!='PASS' or candidate.get('fullPostAPIFidelity')!='PASS':raise ValueError('Actual read-only Storage API and full post-fidelity required')
    if operation in ('synthetic-2','synthetic-3'):
        previous=history.get('synthetic-'+str(int(operation[-1])-1),{})
        diagnosed_timeout=operation=='synthetic-2' and previous.get('code')=='TimeoutExpired' and history.get('observer-audit',{}).get('termWaitTimedOut') is True
        if previous.get('status')!='FAIL' or previous.get('pristineDatabaseUnchanged') is not True or not (diagnosed_timeout or previous.get('code') in ('Controlled400DiagnosticsFailed','SyntheticPasswordGrantFailed','PrivateGatewayReadinessFailed','SyntheticUserCreationFailed','StagingSessionRefreshFailed')):
            raise ValueError('No eligible documented harness/config failure; no retry')
    result=remote(operation);publish(operation,result)
    if result['status']=='FAIL':raise SystemExit(1)


if __name__=='__main__':
    try:main()
    except Exception as error:
        # Controlled constants only. Vendor/stdout/URI bodies never go public.
        print(json.dumps({'status':'FAIL','code':type(error).__name__,'rawOutput':'withheld'}));raise SystemExit(1)
