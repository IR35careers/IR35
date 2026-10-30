"""Full offline helper suite with a fresh empty home; exclusive public evidence."""
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import time


def put(path,body):
    fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
    with os.fdopen(fd,'wb') as output:output.write(body);output.flush();os.fsync(output.fileno())


def main():
    if len(sys.argv)!=2 or not re.fullmatch(r'(?:ci-isolation-0[12]|p7-journal-hermetic-0[12]|auth-export-hermetic-0[12]|auth-supplement-hermetic-0[12]|owner-g3-hermetic-0[12]|p7-auth-hermetic-0[12]|p7-link-hermetic-0[12]|p7-storage-hermetic-0[12]|p8-readonly-hermetic-0[12]|p8-backup-hermetic-0[12]|p8-reverse-hermetic-0[12]|p8-oci-hermetic-0[12]|p8-oci-hermetic-repair-01|p8-oci-final-01|p8-browser-hermetic-01|p8-app-readiness-hermetic-0[12]|p8-upgrade-hermetic-01|p8-images-hermetic-01|p8-images-interop-hermetic-01|p8-webqa-hermetic-01|p8-webqa-final-hermetic-01|p8-qa-transport-hermetic-01|p8-qa-binding-hermetic-01|p8-qa-edge-repair2-hermetic-01|p8-owner-batch-hermetic-01|p8-owner-resume-hermetic-01|p8-owner-decisions-hermetic-01)',sys.argv[1]):raise RuntimeError('FixedHermeticEvidenceSlotRequired')
    repo=Path(__file__).resolve().parents[2]
    if sys.argv[1]=='p8-oci-hermetic-repair-01':
        prior=repo/'docs/evidence/p8-oci-hermetic-02'
        if hashlib.sha256((prior/'manifest.json').read_bytes()).hexdigest()!='2dd502238a9379a002c9a8638d19477e0032fc00fd7346d81d28c30ff6dfd127':raise RuntimeError('OriginalFixtureFailureRequired')
        for item in json.loads((prior/'manifest.json').read_bytes())['artifacts']:
            if hashlib.sha256((prior/item['name']).read_bytes()).hexdigest()!=item['sha256']:raise RuntimeError('OriginalFixtureFailureChanged')
        if json.loads((prior/'result.json').read_bytes())['status']!='FAIL':raise RuntimeError('OriginalFixtureFailureRequired')
    root=repo/'docs/evidence/p6'/sys.argv[1] if sys.argv[1].startswith('ci-') else repo/'docs/evidence'/sys.argv[1]
    root.mkdir()  # No overwrite/replay of a failed run.
    result={'status':'FAIL','realKeysSupplied':False,'copiedPrivateFiles':0,'vmCalls':0,'testsRemoved':0}
    with tempfile.TemporaryDirectory(prefix='ir35-hermetic-home-') as test_home:
        before=(Path(test_home)/'.ir35').exists()
        put(root/'intent.json',json.dumps({'freshHomeEmpty':not any(Path(test_home).iterdir()),'ir35DirectoryPresentBefore':before,
            'environmentNames':['HOME','PATH','LANG','PYTHONNOUSERSITE'],'privateStateCopied':False}).encode())
        start=time.monotonic()
        reply=subprocess.run([sys.executable,'-m','unittest','discover','-s','infra/oracle/tests','-v'],cwd=repo,
            env={'HOME':test_home,'PATH':'/usr/bin:/bin','LANG':'C.UTF-8','PYTHONNOUSERSITE':'1'},capture_output=True,timeout=180)
        result.update(exitCode=reply.returncode,seconds=round(time.monotonic()-start,3),freshHome=True,
            ir35DirectoryPresentBefore=before,ir35DirectoryPresentAfter=(Path(test_home)/'.ir35').exists())
        # No production credentials exist in this cleared child environment.
        # Preserve the complete fixture-only outputs, not just green summaries.
        put(root/'stdout.log',reply.stdout);put(root/'stderr.log',reply.stderr)
        summary=reply.stderr.decode(errors='replace')
        match=re.search(r'Ran ([0-9]+) tests in ([0-9.]+)s',summary)
        result['tests']=int(match[1]) if match else None
        if reply.returncode==0 and match and not before and not result['ir35DirectoryPresentAfter']:result['status']='PASS'
    put(root/'result.json',(json.dumps(result,sort_keys=True,indent=2)+'\n').encode())
    manifest={'version':1,'artifacts':[{'name':path.name,'sha256':hashlib.sha256(path.read_bytes()).hexdigest()} for path in sorted(root.iterdir())]}
    put(root/'manifest.json',(json.dumps(manifest,sort_keys=True,indent=2)+'\n').encode())
    for path in root.iterdir():path.chmod(0o400)
    print(json.dumps(result|{'manifestSHA256':hashlib.sha256((root/'manifest.json').read_bytes()).hexdigest()}))
    if result['status']!='PASS':raise SystemExit(1)


if __name__=='__main__':main()
