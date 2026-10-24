"""Verify exported write-once projections; record the adapted ordering diff."""
import argparse
import difflib
import hashlib
import json
from pathlib import Path


def verify(root,attempt):
    root=Path(root);summaries={}
    for mode,status in [('baseline','REPRODUCED'),('fixed','PASS')]:
        prefix=f'a{attempt}-{mode}-'
        summary=json.loads((root/(prefix+'summary.json')).read_bytes())
        manifest=(root/(prefix+'manifest.json')).read_bytes()
        if hashlib.sha256(manifest).hexdigest()!=summary['manifestSHA256']:raise RuntimeError('PrivateManifestChanged')
        for entry in json.loads(manifest)['artifacts']:
            # The sole private-only artifact contains only synthetic bcrypt,
            # but is deliberately omitted; the local Store verifies its bytes.
            if entry['name']=='Caddyfile':continue
            body=(root/(prefix+entry['name'])).read_bytes()
            if len(body)!=entry['bytes'] or hashlib.sha256(body).hexdigest()!=entry['sha256']:raise RuntimeError('ExportedArtifactChanged')
        if summary['status']!=status or len(summary['cases'])!=7 or summary.get('validate')!='PASS' or summary.get('adapt')!='PASS':raise RuntimeError('CompletePrivateSuiteRequired')
        if mode=='fixed' and not all(case['passed'] and case['checks'].get('exactRoute') for case in summary['cases']):raise RuntimeError('ExactPrivateRouteProofRequired')
        if summary.get('temporaryContainersRemoved')!=2 or summary.get('temporaryNetworkRemoved')is not True or not summary.get('networkInternal') or any(summary.get(key)!=0 for key in ('publicPorts','existingNetworkConnections','dataOrSecretMounts')):raise RuntimeError('PrivateContainmentRequired')
        summaries[mode]=summary
    before=(root/f'a{attempt}-baseline-adapted.json').read_text().splitlines(True)
    after=(root/f'a{attempt}-fixed-adapted.json').read_text().splitlines(True)
    diff=''.join(difflib.unified_diff(before,after,fromfile='redacted-before.json',tofile='redacted-after.json'))
    if not diff:raise RuntimeError('AdaptedOrderingDiffRequired')
    return {'status':'PASS','privateAttempt':attempt,'cases':7,'baselines':{key:value['manifestSHA256'] for key,value in summaries.items()},
            'diffSHA256':hashlib.sha256(diff.encode()).hexdigest(),'privateProjectionOmission':'Caddyfile (public synthetic bcrypt only); fully verified by local Store',
            'realDataOrSecretMounts':0,'publicPorts':0},diff


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--root',required=True);parser.add_argument('--attempt',type=int,choices=(1,2),required=True)
    args=parser.parse_args();proof,diff=verify(args.root,args.attempt);root=Path(args.root)
    with (root/'adapted-ordering.diff').open('x') as output:output.write(diff)
    with (root/'private-signoff.json').open('x') as output:json.dump(proof,output,indent=2)
    print(json.dumps(proof))


if __name__=='__main__':main()
