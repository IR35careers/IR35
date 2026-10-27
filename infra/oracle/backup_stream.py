"""Shell-free encrypted streaming primitives; no cloud writer or timer enabled.

No plaintext intermediate files, passphrases, private identities or credential
arguments. Real use still requires the owner's public recipient and restore
drill. Offline subprocess fixtures do NOT prove age cryptography or a restore.
"""
import hashlib
import os
from pathlib import Path
import re
import signal
import stat
import subprocess
import threading
import time

AGE=('/usr/bin/age',)
HEADER=b'age-encryption.org/v1\n'
BASE=('/usr/bin/docker','compose','--env-file','/opt/ir35/.env','-f','/opt/ir35/compose.yml',
      'exec','-T','db','/run/ir35/env-exec','/opt/ir35/.env.db')
PARTS=frozenset(('database','globals','queue','storage','verification'))
MAX_BYTES=8_000_000_000


class BackupPipelineError(RuntimeError):
    def __init__(self,report):
        self.report=report
        super().__init__(report['code']) # Never native stderr/argv/input.


def commands(part,*,snapshot=None):
    if part not in PARTS:raise ValueError('KnownBackupPartRequired')
    if part in ('database','queue'):
        if not re.fullmatch(r'[0-9A-F]{8}-[0-9A-F]{8}-[1-9][0-9]*',snapshot or ''):raise ValueError('ExportedReadOnlySnapshotRequired')
        database='ir35_p5_app' if part=='database' else 'postgres'
        return (BASE+('pg_dump','--no-password','-U','supabase_admin','--format=custom','--snapshot='+snapshot,'--dbname='+database),)
    if snapshot is not None:raise ValueError('SnapshotOnlyAppliesToDatabaseArchive')
    if part=='globals':return (BASE+('pg_dumpall','--no-password','-U','supabase_admin','--globals-only'),('/usr/bin/gzip','-n','-c'))
    if part=='storage':return (('/usr/bin/tar','--xattrs','--acls','--numeric-owner','-C','/opt/ir35/data/p5-storage','-czf','-','.'),)
    return () # Private verification JSON supplied through stdin in RAM.


def recipient_file(path,uid):
    path=Path(path)
    if path.resolve()!=path or path.is_symlink():raise ValueError('PinnedPublicRecipientFileRequired')
    info=path.stat()
    if (not stat.S_ISREG(info.st_mode) or info.st_nlink!=1 or info.st_uid!=uid
            or stat.S_IMODE(info.st_mode)not in (0o400,0o600) or info.st_size>100):raise ValueError('OwnerOnlyPublicRecipientRequired')
    value=path.read_text(encoding='ascii').strip()
    if not re.fullmatch(r'age1[023456789acdefghjklmnpqrstuvwxyz]{58}',value):raise ValueError('X25519PublicRecipientRequired_NoPrivateIdentity')
    return path # age performs the actual recipient checksum/curve validation.


def encrypt_part(part,recipient,destination,*,uid,snapshot=None,timeout=300,input_bytes=None,maximum_bytes=MAX_BYTES):
    return _encrypt_pipeline(part,commands(part,snapshot=snapshot),recipient,destination,uid=uid,timeout=timeout,input_bytes=input_bytes,maximum_bytes=maximum_bytes)


def _encrypt_pipeline(part,producer_commands,recipient,destination,*,uid,timeout=300,input_bytes=None,maximum_bytes=MAX_BYTES):
    """Exclusive ciphertext artifact. Preserve partials, redact all diagnostics.

    Each process owns its new process group. On failure/timeout kill ONLY those
    groups, reap all children and retain read-only partial ciphertext/evidence.
    """
    if part not in PARTS or type(timeout)not in (int,float) or timeout<=0:raise ValueError('BoundedKnownBackupPartRequired')
    if type(uid)is not int or uid<0 or type(maximum_bytes)is not int or not 0<maximum_bytes<=MAX_BYTES:raise ValueError('OwnerAndCiphertextBudgetRequired')
    if part=='verification' and (producer_commands or not input_bytes):raise ValueError('CompleteVerificationStdinRequired')
    if part!='verification' and (not producer_commands or input_bytes is not None):raise ValueError('FixedDumpProducerRequired')
    if input_bytes is not None and (producer_commands or type(input_bytes)is not bytes or len(input_bytes)>16_000_000):raise ValueError('BoundedVerificationStdinOnly')
    recipient=recipient_file(recipient,uid)
    destination=Path(destination);parent=destination.parent
    if parent.resolve()!=parent or parent.is_symlink() or not parent.is_dir():raise ValueError('ControlledBackupGenerationDirectoryRequired')
    info=parent.stat()
    if info.st_uid!=uid or stat.S_IMODE(info.st_mode)!=0o700 or destination.name!=part+'.age':raise ValueError('OwnerOnlyBackupGenerationRequired')
    stages=[tuple(row) for row in producer_commands]
    if len(stages)>2 or any(not row or any(type(arg)is not str or '\x00' in arg for arg in row) for row in stages):raise ValueError('TrustedArgumentVectorsRequired')
    stages.append(AGE+('--encrypt','--recipients-file',str(recipient)))
    # This is deliberately before any producer. Existing slots never replay.
    fd=os.open(destination,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
    try:
        if os.fstat(fd).st_uid!=uid:os.fchown(fd,uid,-1)
    except Exception:
        os.fchmod(fd,0o400);os.close(fd)
        raise ValueError('BackupCiphertextCustodyFailed')from None
    children=[];drains=[];diagnostics=[];feeders=[];feed_state={'complete':input_bytes is None};output=os.fdopen(fd,'wb');result={'status':'FAIL','part':part,'plaintextFiles':0,'rawStderrPrinted':False}
    environment={'PATH':'/usr/sbin:/usr/bin:/sbin:/bin','LANG':'C.UTF-8'}
    started=time.monotonic()
    def drain(stream,record):
        digest=hashlib.sha256();length=0
        try:
            while body:=stream.read(65536):digest.update(body);length+=len(body)
        except Exception as error:record['drainErrorType']=type(error).__name__
        finally:stream.close();record.update(stderrBytes=length,stderrSHA256Prefix=digest.hexdigest()[:16])
    try:
        previous=None
        for index,args in enumerate(stages):
            child=subprocess.Popen(args,stdin=previous if previous is not None else (subprocess.PIPE if input_bytes is not None else subprocess.DEVNULL),
                stdout=output if index==len(stages)-1 else subprocess.PIPE,stderr=subprocess.PIPE,
                env=environment,start_new_session=True,close_fds=True)
            children.append(child)
            if previous is not None:previous.close()
            previous=child.stdout
            record={'stage':index};diagnostics.append(record)
            thread=threading.Thread(target=drain,args=(child.stderr,record),daemon=True);thread.start();drains.append(thread)
        if input_bytes is not None:
            def feed_private_input():
                try:
                    written=children[0].stdin.write(input_bytes);children[0].stdin.flush()
                    feed_state['complete']=written==len(input_bytes)
                except Exception:pass # Completeness AND return codes must pass; no thread traceback/input.
                finally:
                    try:children[0].stdin.close()
                    except OSError:feed_state['complete']=False
            thread=threading.Thread(target=feed_private_input,daemon=True);thread.start();feeders.append(thread)
        while any(child.poll()is None for child in children):
            if any(child.returncode not in (None,0) for child in children):raise RuntimeError('BackupPipelineStageFailed')
            if os.fstat(output.fileno()).st_size>maximum_bytes:raise RuntimeError('BackupCiphertextBudgetExceeded')
            if time.monotonic()-started>timeout:raise RuntimeError('BackupPipelineDeadline')
            time.sleep(0.01)
        if any(child.returncode!=0 for child in children):raise RuntimeError('BackupPipelineStageFailed')
        for thread in feeders:thread.join(timeout=5)
        if input_bytes is not None and not feed_state['complete']:raise RuntimeError('BackupVerificationInputIncomplete')
        output.flush();os.fsync(output.fileno())
        if os.fstat(output.fileno()).st_size>maximum_bytes:raise RuntimeError('BackupCiphertextBudgetExceeded')
        with destination.open('rb') as source:
            if source.read(len(HEADER))!=HEADER:raise RuntimeError('AgeCiphertextHeaderRequired')
        result['status']='PASS'
    except Exception as error:
        result['code']=str(error) if type(error)is RuntimeError else type(error).__name__
    finally:
        for child in children:
            if result['status']!='PASS' or child.poll()is None:
                try:os.killpg(child.pid,signal.SIGKILL)
                except ProcessLookupError:pass
        for child in children:child.wait()
        for child in children:
            if child.stdout is not None:child.stdout.close()
            if child.stdin is not None and not child.stdin.closed:
                try:child.stdin.close()
                except OSError:result.update(status='FAIL',code='BackupVerificationInputIncomplete')
        for thread in drains+feeders:thread.join(timeout=5)
        if any(thread.is_alive()for thread in drains+feeders):result.update(status='FAIL',code='BackupPipeDrainIncomplete')
        if any('drainErrorType'in record for record in diagnostics):result.update(status='FAIL',code='BackupStderrCaptureIncomplete')
        output.flush();os.fsync(output.fileno());os.fchmod(output.fileno(),0o400);output.close()
        digest=hashlib.sha256();size=0
        with destination.open('rb') as source:
            while body:=source.read(1024*1024):digest.update(body);size+=len(body)
        result.update(ciphertextBytes=size,ciphertextSHA256=digest.hexdigest(),seconds=round(time.monotonic()-started,3),
            childrenReaped=all(child.poll()is not None for child in children),exitCodes=[child.returncode for child in children],diagnostics=diagnostics)
    if result['status']!='PASS':raise BackupPipelineError(result)
    return result
