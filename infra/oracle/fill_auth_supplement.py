"""Owner-run two-field supplement. One hidden token, fixed GET, no retries."""
from contextlib import contextmanager
import copy
from datetime import datetime,timezone
import getpass
import hashlib
import json
import os
from pathlib import Path
import sys
import tempfile
import uuid
import warnings
import export_auth_settings as exporter

SOURCE=exporter.DESTINATION
DESTINATION=SOURCE.with_name('oracle-auth-settings-supplement.json')
SOURCE_SHA256='b6f708f921a730b8e07e5c2e77052318207900d06b3d855d9b45fa28f2a959c9'
FORMAT='ir35-auth-settings-supplement-v1'
FIELDS=exporter.PUBLIC_SUPPLEMENT_FIELDS
ACCEPTED=('present','explicit_null')
OWNER_NONE_API_SHA256='79b4842204e05b9c4b4d05812ed8f97975928f1bb58bb3ba4013d5389c76727a'


def owner_none_confirmation():
    return {'authority':'owner-explicit-none-20261026','api_supplement_sha256':OWNER_NONE_API_SHA256,'field_names':list(FIELDS)}


class SupplementRefused(RuntimeError):pass


def private_bytes(path):
    for candidate in (path,*path.parents):
        if candidate.is_symlink() or getattr(candidate,'is_junction',lambda:False)():
            raise SupplementRefused('ReparsePathRefused')
    exporter.custody(path)
    body=path.read_bytes()
    if len(body)>exporter.MAX_BYTES:raise SupplementRefused('BoundedPrivateFileRequired')
    return body


def load():
    source_hash=hashlib.sha256(private_bytes(SOURCE)).hexdigest()
    if source_hash!=SOURCE_SHA256:raise SupplementRefused('OriginalExportHashMismatch')
    body=private_bytes(DESTINATION)
    document=json.loads(body,object_pairs_hook=exporter.unique_object)
    validate_document(document,source_hash)
    return document,hashlib.sha256(body).hexdigest()


def validate_document(document,source_hash):
    if (type(document)is not dict or set(document)-{'format','source_export_sha256','settings','source_observations','owner_confirmation'}
            or document.get('format')!=FORMAT or document.get('source_export_sha256')!=source_hash
            or type(document.get('settings'))is not dict or set(document['settings'])!=set(FIELDS)):
        raise SupplementRefused('ExactBoundSupplementRequired')
    observations=document.get('source_observations',{})
    if type(observations)is not dict or set(observations)-set(FIELDS):raise SupplementRefused('InvalidObservationNames')
    confirmed='owner_confirmation' in document
    if confirmed and (document['owner_confirmation']!=owner_none_confirmation()
            or any(document['settings'][name]!='' or observations.get(name)!={'state':'explicit_null','source_type':'null'} for name in FIELDS)):
        raise SupplementRefused('ExactOwnerNoneConfirmationRequired')
    for name,value in document['settings'].items():
        checked,observation=exporter.public_setting({name:value},name,'<NO_TOKEN_IN_LOCAL_VALIDATION>')
        if observation['state'] not in ACCEPTED:raise SupplementRefused('InvalidExistingPublicField')
        if name in observations and observations[name]!=observation and not confirmed:raise SupplementRefused('InvalidExistingObservation')


def pending(document):
    observations=document.get('source_observations',{})
    return tuple(name for name in FIELDS if document['settings'][name]is None
        and observations.get(name,{}).get('state')!='explicit_null')


def project_two(payload,token):
    if type(payload)is not dict:raise SupplementRefused('ObjectResponseRequired')
    settings={};observations={}
    for name in FIELDS:settings[name],observations[name]=exporter.public_setting(payload,name,token)
    return {'settings':settings,'source_observations':observations}


@contextmanager
def exclusive_run():
    path=DESTINATION.with_name('.ir35-auth-supplement.lock')
    for candidate in (path.parent,*path.parent.parents):
        if candidate.is_symlink() or getattr(candidate,'is_junction',lambda:False)():
            raise SupplementRefused('ReparsePathRefused')
    descriptor=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
    identity=os.fstat(descriptor)
    try:
        exporter.custody(path,apply=True)
        yield
    finally:
        os.close(descriptor)
        current=path.lstat()
        if (current.st_dev,current.st_ino)!=(identity.st_dev,identity.st_ino):
            raise SupplementRefused('LockIdentityChanged')
        path.unlink()  # Only the empty lock created by this invocation.


def journal(result,run_id):
    """Write-once diagnostic metadata only: fixed names/types/codes, no values."""
    path=DESTINATION.with_name('oracle-auth-supplement-'+run_id+'.json')
    descriptor=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
    try:
        exporter.custody(path,apply=True)
        with os.fdopen(descriptor,'wb') as output:
            descriptor=None
            output.write((json.dumps(result,sort_keys=True,indent=2)+'\n').encode())
            output.flush();os.fsync(output.fileno())
        exporter.custody(path)
    finally:
        if descriptor is not None:os.close(descriptor)


def write_supplement(document,snapshot):
    previous,observed=load()
    if observed!=snapshot:raise SupplementRefused('SupplementChangedDuringRequest')
    validate_document(document,SOURCE_SHA256)
    for name in FIELDS:
        if name not in pending(previous) and (document['settings'][name]!=previous['settings'][name]
                or document.get('source_observations',{}).get(name)!=previous.get('source_observations',{}).get(name)):
            raise SupplementRefused('PopulatedValuePreserved')
    body=(json.dumps(document,ensure_ascii=False,sort_keys=True,indent=2)+'\n').encode()
    if len(body)>exporter.MAX_BYTES:raise SupplementRefused('BoundedSupplementRequired')
    descriptor,name=tempfile.mkstemp(prefix='.ir35-auth-supplement-',suffix='.tmp',dir=DESTINATION.parent)
    temporary=Path(name)
    try:
        exporter.custody(temporary,apply=True)
        with os.fdopen(descriptor,'wb') as output:
            descriptor=None;output.write(body);output.flush();os.fsync(output.fileno())
        exporter.custody(temporary)
        if load()[1]!=snapshot:raise SupplementRefused('SupplementChangedBeforeReplace')
        os.replace(temporary,DESTINATION)
        result,actual=load()
        if actual!=hashlib.sha256(body).hexdigest():raise SupplementRefused('SupplementReadbackMismatch')
        return actual
    finally:
        if descriptor is not None:os.close(descriptor)
        if temporary.exists():temporary.unlink()  # Only this invocation's temporary.


def main():
    summary={'field_count':0,'null_fields':list(FIELDS),'file_sha256':None};token=None
    run_id=datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')+'-'+uuid.uuid4().hex
    diagnostic={'request_method':'GET','network_attempts':0,'field_names':list(FIELDS),
        'values_recorded':False,'raw_response_recorded':False,'status':'FAIL'}
    try:
        if len(sys.argv)!=1 or not exporter.native_windows():raise SupplementRefused('NativeWindowsNoArgumentsRequired')
        with exclusive_run():
            original,snapshot=load();needed=pending(original)
            if not needed:
                summary={'field_count':2,'null_fields':[name for name in FIELDS if original['settings'][name]is None],'file_sha256':snapshot}
                print(json.dumps(summary));return 0  # No prompt or HTTP when already filled.
            journal({'stage':'intent',**diagnostic},run_id+'-intent')
            try:
                with warnings.catch_warnings():
                    warnings.simplefilter('error',getpass.GetPassWarning)
                    token=getpass.getpass('Supabase personal access token (hidden; two fields only): ')
                diagnostic['network_attempts']=1
                fetched=exporter.fetch(token,projector=project_two);token=None
                diagnostic['source_observations']=fetched['source_observations']
                if any(fetched['source_observations'][name]['state']not in ACCEPTED for name in needed):
                    raise SupplementRefused('RequiredFieldAbsentInvalidOrUnsafe')
                result=copy.deepcopy(original)
                result.setdefault('source_observations',{})
                for name in needed:
                    result['settings'][name]=fetched['settings'][name]
                    result['source_observations'][name]=fetched['source_observations'][name]
                digest=write_supplement(result,snapshot)
                diagnostic.update(status='PASS',file_sha256=digest,filled_field_names=list(needed))
                summary={'field_count':2,'null_fields':[name for name in FIELDS if result['settings'][name]is None],'file_sha256':digest}
            except (Exception,KeyboardInterrupt) as error:
                diagnostic['code']=str(error) if type(error)is SupplementRefused else type(error).__name__
                raise
            finally:
                token=None;journal(diagnostic,run_id+'-result')
        print(json.dumps(summary));return 0
    except (Exception,KeyboardInterrupt):
        print(json.dumps({'field_count':0,'null_fields':list(FIELDS),'file_sha256':None}));return 1
    finally:token=None


if __name__=='__main__':raise SystemExit(main())
