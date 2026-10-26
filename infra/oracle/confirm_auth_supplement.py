"""Apply the exact owner's two NONE decisions locally; no API or credentials."""
import copy
import hashlib
import json
import os
from pathlib import Path
import sys
import tempfile
import fill_auth_supplement as supplement


def confirm():
    with supplement.exclusive_run():
        original,before=supplement.load()
        if original.get('owner_confirmation')==supplement.owner_none_confirmation():
            return {'status':'PASS','alreadyConfirmed':True,'supplementSHA256':before,'g3Closed':True,'networkRequests':0}
        if before!=supplement.OWNER_NONE_API_SHA256 or any(original['settings'][name] is not None
                or original.get('source_observations',{}).get(name)!={'state':'explicit_null','source_type':'null'} for name in supplement.FIELDS):
            raise supplement.SupplementRefused('ExactOwnerReportedAPINullsRequired')
        archive=supplement.DESTINATION.with_name('oracle-auth-settings-supplement-api-'+before+'.json')
        source=supplement.private_bytes(supplement.DESTINATION)
        if archive.exists():
            if hashlib.sha256(supplement.private_bytes(archive)).hexdigest()!=before:
                raise supplement.SupplementRefused('ArchivedAPIProofMismatch')
        else:
            archived_descriptor=os.open(archive,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
            try:
                supplement.exporter.custody(archive,apply=True)
                with os.fdopen(archived_descriptor,'wb') as archived:
                    archived_descriptor=None;archived.write(source);archived.flush();os.fsync(archived.fileno())
            finally:
                if archived_descriptor is not None:os.close(archived_descriptor)
            if hashlib.sha256(supplement.private_bytes(archive)).hexdigest()!=before:
                raise supplement.SupplementRefused('ArchivedAPIProofMismatch')
        archive.chmod(0o400)
        document=copy.deepcopy(original)
        document['settings']={name:'' for name in supplement.FIELDS}
        document['owner_confirmation']=supplement.owner_none_confirmation()
        supplement.validate_document(document,supplement.SOURCE_SHA256)
        body=(json.dumps(document,ensure_ascii=False,sort_keys=True,indent=2)+'\n').encode()
        descriptor,name=tempfile.mkstemp(prefix='.ir35-auth-confirm-',suffix='.tmp',dir=supplement.DESTINATION.parent)
        temporary=Path(name)
        try:
            supplement.exporter.custody(temporary,apply=True)
            with os.fdopen(descriptor,'wb') as output:
                descriptor=None;output.write(body);output.flush();os.fsync(output.fileno())
            supplement.exporter.custody(temporary)
            if supplement.load()[1]!=before:raise supplement.SupplementRefused('ConfirmationConcurrentEdit')
            os.replace(temporary,supplement.DESTINATION)
            checked,after=supplement.load()
            if after!=hashlib.sha256(body).hexdigest():raise supplement.SupplementRefused('ConfirmationReadbackMismatch')
            return {'status':'PASS','apiSupplementSHA256':before,'supplementSHA256':after,
                'fieldCount':2,'ownerConfirmationRecorded':True,'apiNullObservationsPreserved':True,
                'originalExportPreserved':True,'archivedAPIProofSHA256':hashlib.sha256(supplement.private_bytes(archive)).hexdigest(),
                'custodyVerified':True,'g3Closed':True,'networkRequests':0,'valuesPrinted':False}
        finally:
            if descriptor is not None:os.close(descriptor)
            if temporary.exists():temporary.unlink()


if __name__=='__main__':
    try:print(json.dumps(confirm()))
    except Exception as error:
        print(json.dumps({'status':'STOP','code':str(error) if type(error)is supplement.SupplementRefused else type(error).__name__,'valuesPrinted':False}));raise SystemExit(1)
