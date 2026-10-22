"""Write-once, sealed artifact stages. Hash integrity, not protection from root."""
import hashlib
import json
import os
from pathlib import Path
import re
import stat
from contextlib import contextmanager


def digest(body):return hashlib.sha256(body).hexdigest()


class ArtifactError(RuntimeError):pass


class Store:
    def __init__(self,root,*,uid=None):
        self.root=Path(root)
        self.uid=os.getuid() if uid is None else uid
        if self.root.absolute()!=self.root.resolve() or self.root.is_symlink() or not self.root.is_dir():raise ArtifactError('Artifact root missing/unsafe')
        observed=self.root.stat()
        if observed.st_uid!=self.uid or stat.S_IMODE(observed.st_mode)!=0o700:raise ArtifactError('Artifact root custody mismatch')

    def stage(self,name):
        if not re.fullmatch(r'[0-9]{2}-[a-z][a-z0-9-]{0,50}',name):raise ArtifactError('Fixed stage name required')
        target=self.root/name
        target.mkdir(mode=0o700) # Refuses an existing stage, including failed ones.
        os.chown(target,self.uid,self.uid)
        return target

    def put(self,stage,name,body):
        stage=Path(stage)
        if stage.parent!=self.root or stage.is_symlink():raise ArtifactError('Artifact stage escaped root')
        if stat.S_IMODE(stage.stat().st_mode)!=0o700 or stage.stat().st_uid!=self.uid:raise ArtifactError('Artifact stage not open')
        if not re.fullmatch(r'[a-zA-Z0-9][a-zA-Z0-9_.-]{0,100}',name):raise ArtifactError('Artifact filename refused')
        if not isinstance(body,bytes):raise ArtifactError('Explicit bytes required')
        target=stage/name
        fd=os.open(target,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
        try:
            os.fchown(fd,self.uid,self.uid)
            with os.fdopen(fd,'wb',closefd=False) as output:
                output.write(body);output.flush();os.fsync(output.fileno())
            os.fchmod(fd,0o400)
        finally:os.close(fd)
        self._sync(stage)
        return {'name':name,'bytes':len(body),'sha256':digest(body)}

    @contextmanager
    def sink(self,stage,name):
        """Private full tool log, created once and sealed even when the tool fails."""
        stage=Path(stage)
        if stage.parent!=self.root or stage.is_symlink() or stat.S_IMODE(stage.stat().st_mode)!=0o700 or not re.fullmatch(r'[a-zA-Z0-9][a-zA-Z0-9_.-]{0,100}',name):raise ArtifactError('Log destination refused')
        fd=os.open(stage/name,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
        os.fchown(fd,self.uid,self.uid)
        try:
            with os.fdopen(fd,'wb',closefd=False) as output:
                yield output
                output.flush();os.fsync(output.fileno())
        finally:
            os.fsync(fd);os.fchmod(fd,0o400);os.close(fd);self._sync(stage)

    def seal(self,stage,*,previous=None):
        stage=Path(stage)
        if stage.parent!=self.root:raise ArtifactError('Stage outside root')
        items=[]
        for item in sorted(stage.iterdir()):
            if item.is_symlink() or not item.is_file():raise ArtifactError('Non-regular artifact refused')
            observed=item.stat()
            if observed.st_uid!=self.uid or stat.S_IMODE(observed.st_mode)!=0o400 or observed.st_nlink!=1:raise ArtifactError('Artifact custody mismatch')
            body=item.read_bytes();items.append({'name':item.name,'bytes':len(body),'sha256':digest(body)})
        body=json.dumps({'version':1,'stage':stage.name,'previousManifestSHA256':previous,'artifacts':items},sort_keys=True,separators=(',',':')).encode()
        record=self.put(stage,'manifest.json',body)
        os.chmod(stage,0o500);self._sync(self.root)
        return record['sha256']

    def verify(self,name,expected):
        if not isinstance(name,str) or not re.fullmatch(r'[0-9]{2}-[a-z][a-z0-9-]{0,50}',name):raise ArtifactError('Fixed stage name required')
        if not isinstance(expected,str) or not re.fullmatch(r'[0-9a-f]{64}',expected):raise ArtifactError('External manifest anchor required')
        stage=self.root/name
        if stage.is_symlink() or not stage.is_dir() or stat.S_IMODE(stage.stat().st_mode)!=0o500:raise ArtifactError('Stage not sealed')
        manifest=stage/'manifest.json'
        if manifest.is_symlink() or digest(manifest.read_bytes())!=expected:raise ArtifactError('Artifact manifest digest mismatch')
        info=manifest.stat()
        if info.st_uid!=self.uid or stat.S_IMODE(info.st_mode)!=0o400 or info.st_nlink!=1:raise ArtifactError('Manifest custody mismatch')
        data=json.loads(manifest.read_bytes())
        if data.get('version')!=1 or data.get('stage')!=name:raise ArtifactError('Manifest identity mismatch')
        expected_names={'manifest.json'}
        for entry in data['artifacts']:
            filename=entry.get('name','')
            if not re.fullmatch(r'[a-zA-Z0-9][a-zA-Z0-9_.-]{0,100}',filename) or filename in expected_names:raise ArtifactError('Duplicate/unsafe manifest entry')
            expected_names.add(filename)
            target=stage/filename
            if target.is_symlink() or not target.is_file():raise ArtifactError('Artifact missing/not regular')
            observed=target.stat()
            if observed.st_uid!=self.uid or stat.S_IMODE(observed.st_mode)!=0o400 or observed.st_nlink!=1:raise ArtifactError('Artifact permission/link mismatch')
            body=target.read_bytes()
            if len(body)!=entry['bytes'] or digest(body)!=entry['sha256']:raise ArtifactError('Artifact hash mismatch')
        if {p.name for p in stage.iterdir()}!=expected_names:raise ArtifactError('Unmanifested artifact present')
        return data

    @staticmethod
    def _sync(path):
        fd=os.open(path,os.O_RDONLY|os.O_DIRECTORY)
        try:os.fsync(fd)
        finally:os.close(fd)
