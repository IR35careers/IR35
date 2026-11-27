"""Full offline helper suite with a fresh empty home; exclusive public evidence."""
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
import tempfile
import time


TMPFS_SLOT='p8-current-source-hermetic-20261126-01'
TMPFS_PREDECESSORS=(
    ('p8-lifecycle-owner23-hermetic-20261124-01','97871d8837e089487d8126e3f99b903b231c7d070c91e9431e4768ce8622e8f2'),
    ('p8-lifecycle-cloud-only-20261126-01','b3997ff6b2186e20f4ab438b1b20fa71414f25c12a0c926c5db36c85e2c59244'),
    ('p8-lifecycle-cloud-only-20261126-tmpfs-01','3c7da722504b839869a798c467e846874830a46aaf054e3fc29a8f95324a298c'),
)


def put(path,body):
    fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
    with os.fdopen(fd,'wb') as output:output.write(body);output.flush();os.fsync(output.fileno())


def python_sources(repo):
    """Public helper/test source binding, not a claim about live VM images."""
    return {path.relative_to(repo).as_posix():hashlib.sha256(path.read_bytes()).hexdigest()
        for path in sorted((repo/'infra/oracle').rglob('*.py'))}


def fixture_temp_directory(value):
    """Accept only a newly created, empty, owner-only real directory."""
    path=Path(value)
    if not path.is_absolute() or path.is_symlink() or path.resolve(strict=True)!=path:
        raise ValueError('HermeticFixtureDirectoryUnsafe')
    info=path.stat()
    if (not stat.S_ISDIR(info.st_mode) or info.st_uid!=os.geteuid()
            or stat.S_IMODE(info.st_mode)!=0o700 or any(path.iterdir())):
        raise ValueError('HermeticFixtureDirectoryUnsafe')
    return str(path)


def capture_suite(repo, test_home, result, fixture_temp_dir=None):
    """Preserve fixture-only failure output, including an unchanged 180s timeout.

    The child has an empty HOME and a cleared environment. Do not forward raw
    launcher exceptions: only the fixed exception category belongs in evidence.
    """
    start=time.monotonic()
    stdout=stderr=b''
    result.update(exitCode=None,tests=None,freshHome=True,
        ir35DirectoryPresentBefore=(Path(test_home)/'.ir35').exists())
    try:
        environment={'HOME':test_home,'PATH':'/usr/bin:/bin','LANG':'C.UTF-8','PYTHONNOUSERSITE':'1'}
        if fixture_temp_dir is not None:
            environment['TMPDIR']=fixture_temp_directory(fixture_temp_dir)
        reply=subprocess.run([sys.executable,'-m','unittest','discover','-s','infra/oracle/tests','-v'],cwd=repo,
            env=environment,capture_output=True,timeout=180)
        stdout,stderr=reply.stdout,reply.stderr
        result['exitCode']=reply.returncode
    except subprocess.TimeoutExpired as error:
        stdout,stderr=error.stdout or b'',error.stderr or b''
        result['failureCode']='Unchanged180SecondSuiteTimeout'
    except Exception as error:
        result.update(failureCode='HermeticChildLaunchFailed',exceptionType=type(error).__name__)
    result.update(seconds=round(time.monotonic()-start,3),
        ir35DirectoryPresentAfter=(Path(test_home)/'.ir35').exists())
    if not isinstance(stdout,bytes):stdout=stdout.encode()
    if not isinstance(stderr,bytes):stderr=stderr.encode()
    match=re.search(r'Ran ([0-9]+) tests in ([0-9.]+)s',stderr.decode(errors='replace'))
    result['tests']=int(match[1]) if match else None
    if (result['exitCode']==0 and match and not result['ir35DirectoryPresentBefore']
            and not result['ir35DirectoryPresentAfter'] and 'failureCode' not in result):result['status']='PASS'
    return stdout,stderr


def sealed_predecessor(repo, name, expected_sha):
    root=repo/'docs/evidence'/name
    manifest=root/'manifest.json'
    if (root.is_symlink() or root.resolve(strict=True)!=root or manifest.is_symlink()
            or hashlib.sha256(manifest.read_bytes()).hexdigest()!=expected_sha):
        raise RuntimeError('OriginalHermeticEvidenceRequired')
    recorded=json.loads(manifest.read_bytes())
    names=set()
    for item in recorded['artifacts']:
        name=item['name']
        if (not isinstance(name,str) or not re.fullmatch(r'[A-Za-z0-9_.-]+',name)
                or name in names or name=='manifest.json'):
            raise RuntimeError('OriginalHermeticArtifactNameUnsafe')
        names.add(name)
        path=root/name
        if path.is_symlink() or hashlib.sha256(path.read_bytes()).hexdigest()!=item['sha256']:
            raise RuntimeError('OriginalHermeticArtifactChanged')
    if names!={path.name for path in root.iterdir() if path.name!='manifest.json'}:
        raise RuntimeError('OriginalHermeticArtifactSetChanged')
    return root,json.loads((root/'result.json').read_bytes())


def verify_tmpfs_predecessors(repo):
    previous=[sealed_predecessor(repo,*item) for item in TMPFS_PREDECESSORS]
    original=previous[0][1]
    failed=previous[1][1]
    passed=previous[2][1]
    if (original.get('status')!='FAIL' or original.get('failureCode')!='Unchanged180SecondSuiteTimeout'
            or original.get('pythonSourcesUnchanged')is not True or original.get('vmCalls')!=0
            or original.get('realKeysSupplied')is not False
            or failed.get('status')!='FAIL' or failed.get('failureCode')!='Unchanged180SecondFocusedDeadline'
            or failed.get('sourceUnchanged')is not True or failed.get('nativeCalls')!=0
            or failed.get('privateFilesCopied')!=0
            or passed.get('status')!='PASS' or passed.get('tests')!=51 or passed.get('exitCode')!=0
            or passed.get('sourceUnchanged')is not True or passed.get('nativeCalls')!=0
            or passed.get('privateFilesCopied')!=0 or passed.get('fsyncMocked')is not False
            or passed.get('fixtureFilesystem')!='tmpfs'
            or passed.get('previousFailureManifestSHA256')!=TMPFS_PREDECESSORS[1][1]):
        raise RuntimeError('ExactPriorHermeticFailureAndTmpfsProofRequired')
    for root,_result in previous[1:]:
        if (root/'source-before.json').read_bytes()!=(root/'source-after.json').read_bytes():
            raise RuntimeError('OriginalHermeticSourcesChanged')
    fail_sources=json.loads((previous[1][0]/'source-before.json').read_bytes())
    pass_sources=json.loads((previous[2][0]/'source-before.json').read_bytes())
    if not fail_sources or any(pass_sources.get(name)!=digest for name,digest in fail_sources.items()):
        raise RuntimeError('TmpfsComparisonSourceMismatch')
    intent=json.loads((previous[2][0]/'intent.json').read_bytes())
    if (intent.get('deadlineSeconds')!=180 or intent.get('assertionsChanged')is not False
            or intent.get('fsyncMocked')is not False or intent.get('testsRemoved')!=0):
        raise RuntimeError('OriginalTmpfsAssertionsRequired')


def tmpfs_metadata():
    base=Path('/dev/shm')
    # Public kernel mount metadata only; no subprocess, credential or private state.
    mounts=[line.split() for line in Path('/proc/mounts').read_text().splitlines()]
    if base.is_symlink() or not any(len(row)>2 and row[1]=='/dev/shm' and row[2]=='tmpfs' for row in mounts):
        raise RuntimeError('TmpfsFixtureFilesystemRequired')
    info=os.statvfs(base)
    free=info.f_bavail*info.f_frsize
    if free<16*1024*1024:raise RuntimeError('TmpfsFixtureFreeSpaceRequired')
    return {'fixtureFilesystem':'tmpfs','fixtureFreeBytesBefore':free}


def capture_tmpfs_suite(repo, root, result):
    stdout=stderr=b''
    result.update(fullReleasePassClaimed=False,productionDurabilityClaimed=False,fsyncMocked=False)
    try:
        result.update(tmpfs_metadata())
        with tempfile.TemporaryDirectory(prefix='ir35-hermetic-home-',dir='/dev/shm') as test_home, \
                tempfile.TemporaryDirectory(prefix='ir35-hermetic-fixtures-',dir='/dev/shm') as fixtures:
            fixture_temp_directory(test_home)
            fixture_temp_directory(fixtures)
            put(root/'intent.json',(json.dumps({
                'freshHomeEmpty':not any(Path(test_home).iterdir()),'fixtureEmptyBefore':not any(Path(fixtures).iterdir()),
                'fixtureFilesystem':result['fixtureFilesystem'],'fixtureFreeBytesBefore':result['fixtureFreeBytesBefore'],
                'fixtureOwnerMatches':True,'fixtureMode':'700','homeOwnerMatches':True,'homeMode':'700',
                'environmentNames':['HOME','PATH','LANG','PYTHONNOUSERSITE','TMPDIR'],
                'privateStateCopied':False,'fsyncMocked':False,'testsRemoved':0,'assertionsChanged':False,
                'deadlineSeconds':180,'predecessorManifests':[digest for _name,digest in TMPFS_PREDECESSORS],
            },sort_keys=True,indent=2)+'\n').encode())
            stdout,stderr=capture_suite(repo,test_home,result,fixture_temp_dir=fixtures)
            result['fixtureRemainingEntries']=len(list(Path(fixtures).iterdir()))
    except Exception as error:
        result.update(status='FAIL',failureCode='HermeticTmpfsPreparationFailed',exceptionType=type(error).__name__)
    return stdout,stderr


def main():
    if len(sys.argv)!=2 or (sys.argv[1]!=TMPFS_SLOT and not re.fullmatch(r'(?:ci-isolation-0[12]|p7-journal-hermetic-0[12]|auth-export-hermetic-0[12]|auth-supplement-hermetic-0[12]|owner-g3-hermetic-0[12]|p7-auth-hermetic-0[12]|p7-link-hermetic-0[12]|p7-storage-hermetic-0[12]|p8-readonly-hermetic-0[12]|p8-backup-hermetic-0[12]|p8-reverse-hermetic-0[12]|p8-oci-hermetic-0[12]|p8-oci-hermetic-repair-01|p8-oci-final-01|p8-browser-hermetic-01|p8-app-readiness-hermetic-0[12]|p8-upgrade-hermetic-01|p8-images-hermetic-01|p8-images-interop-hermetic-01|p8-webqa-hermetic-01|p8-webqa-final-hermetic-01|p8-qa-transport-hermetic-01|p8-qa-binding-hermetic-01|p8-qa-edge-repair2-hermetic-01|p8-owner-batch-hermetic-01|p8-owner-resume-hermetic-01|p8-owner-decisions-hermetic-01|p8-lifecycle-owner31-hermetic-0[123]|p8-lifecycle-owner23-hermetic-20261124-01|p8-version-pin-hermetic-20261125-01)',sys.argv[1])):raise RuntimeError('FixedHermeticEvidenceSlotRequired')
    repo=Path(__file__).resolve().parents[2]
    if sys.argv[1]==TMPFS_SLOT:verify_tmpfs_predecessors(repo)
    if sys.argv[1]=='p8-version-pin-hermetic-20261125-01':
        prior=repo/'docs/evidence/p8-lifecycle-owner23-hermetic-20261124-01'
        manifest=prior/'manifest.json'
        if manifest.is_symlink() or hashlib.sha256(manifest.read_bytes()).hexdigest()!='97871d8837e089487d8126e3f99b903b231c7d070c91e9431e4768ce8622e8f2':raise RuntimeError('OriginalUnchangedTimeoutEvidenceRequired')
        for item in json.loads(manifest.read_bytes())['artifacts']:
            path=prior/item['name']
            if path.is_symlink() or hashlib.sha256(path.read_bytes()).hexdigest()!=item['sha256']:raise RuntimeError('OriginalTimeoutArtifactChanged')
        previous=json.loads((prior/'result.json').read_bytes())
        if (previous.get('status')!='FAIL' or previous.get('failureCode')!='Unchanged180SecondSuiteTimeout'
                or previous.get('pythonSourcesUnchanged')is not True or previous.get('vmCalls')!=0
                or previous.get('realKeysSupplied')is not False):raise RuntimeError('ExactPriorOfflineTimeoutRequired')
    if sys.argv[1]=='p8-oci-hermetic-repair-01':
        prior=repo/'docs/evidence/p8-oci-hermetic-02'
        if hashlib.sha256((prior/'manifest.json').read_bytes()).hexdigest()!='2dd502238a9379a002c9a8638d19477e0032fc00fd7346d81d28c30ff6dfd127':raise RuntimeError('OriginalFixtureFailureRequired')
        for item in json.loads((prior/'manifest.json').read_bytes())['artifacts']:
            if hashlib.sha256((prior/item['name']).read_bytes()).hexdigest()!=item['sha256']:raise RuntimeError('OriginalFixtureFailureChanged')
        if json.loads((prior/'result.json').read_bytes())['status']!='FAIL':raise RuntimeError('OriginalFixtureFailureRequired')
    root=repo/'docs/evidence/p6'/sys.argv[1] if sys.argv[1].startswith('ci-') else repo/'docs/evidence'/sys.argv[1]
    root.mkdir()  # No overwrite/replay of a failed run.
    result={'status':'FAIL','realKeysSupplied':False,'copiedPrivateFiles':0,'vmCalls':0,'testsRemoved':0}
    sources=python_sources(repo)
    put(root/'python-sources-before.json',(json.dumps(sources,sort_keys=True,indent=2)+'\n').encode())
    if sys.argv[1]==TMPFS_SLOT:
        stdout,stderr=capture_tmpfs_suite(repo,root,result)
    else:
        with tempfile.TemporaryDirectory(prefix='ir35-hermetic-home-') as test_home:
            before=(Path(test_home)/'.ir35').exists()
            put(root/'intent.json',json.dumps({'freshHomeEmpty':not any(Path(test_home).iterdir()),'ir35DirectoryPresentBefore':before,
                'environmentNames':['HOME','PATH','LANG','PYTHONNOUSERSITE'],'privateStateCopied':False}).encode())
            stdout,stderr=capture_suite(repo,test_home,result)
    # No production credentials exist in this cleared child environment.
    # Preserve the complete fixture-only outputs, not just green summaries.
    put(root/'stdout.log',stdout);put(root/'stderr.log',stderr)
    after=python_sources(repo)
    put(root/'python-sources-after.json',(json.dumps(after,sort_keys=True,indent=2)+'\n').encode())
    result.update(pythonSourceFiles=len(sources),pythonSourcesUnchanged=sources==after)
    if sources!=after:result.update(status='FAIL',failureCode='PythonSourcesChangedDuringSuite')
    put(root/'result.json',(json.dumps(result,sort_keys=True,indent=2)+'\n').encode())
    manifest={'version':1,'artifacts':[{'name':path.name,'sha256':hashlib.sha256(path.read_bytes()).hexdigest()} for path in sorted(root.iterdir())]}
    put(root/'manifest.json',(json.dumps(manifest,sort_keys=True,indent=2)+'\n').encode())
    for path in root.iterdir():path.chmod(0o400)
    print(json.dumps(result|{'manifestSHA256':hashlib.sha256((root/'manifest.json').read_bytes()).hexdigest()}))
    if result['status']!='PASS':raise SystemExit(1)


if __name__=='__main__':main()
