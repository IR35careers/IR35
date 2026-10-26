"""Fresh owner3 journals. No replay of decoder2 dispatch or old full runs."""
import json
import sys
import cloud_schema as schema
import p6_fixed_ip
from p6_audit_log import Journal
from p6_pause_reconcile import verified_manifest


def bundle():
    code=p6_fixed_ip.bundle()
    for name in ('p6_dispatch_observability','p6_dispatch_probe_guest','p6_capture_repair_guest'):
        code+='module=types.ModuleType('+repr(name)+');sys.modules['+repr(name)+']=module\nexec('+repr((schema.REPO/'infra/oracle'/(name+'.py')).read_text())+',module.__dict__)\n'
    return code


def context():
    data=p6_fixed_ip.context()
    parent=schema.REPO/'docs/evidence/p6'
    for key,path,sha in (
        ('owner1Full','fixedip-owner1-full','df58ac31665bfc0e9d24894c1325fdaa612248939efdfff6f52bd27bd19ec2eb'),
        ('owner2Isolated','decoder-owner2-isolated','6f963b27d9dc2326b5de63645f8645cdbed53fa3debe7f39cbaef615ec5739ef')):
        root=parent/path
        if verified_manifest(root)!=sha:raise RuntimeError('ExactHistoricalManifestRequired')
        file='01-fixedip-full-result.json' if key=='owner1Full' else '01-isolated-dispatch-result.json'
        data[key]=json.loads((root/file).read_text())
    return data


def main():
    if sys.argv[1:] not in (['--preflight'],['--drain']):raise RuntimeError('ExplicitCaptureOwner3OperationRequired')
    operation=sys.argv[1][2:];root=schema.REPO/('docs/evidence/p6/capture-owner3-'+operation)
    if root.exists():raise RuntimeError('CaptureOwner3OperationRecorded_NoReplay')
    data=context()
    if operation=='drain':
        prior=schema.REPO/'docs/evidence/p6/capture-owner3-preflight';verified_manifest(prior)
        data['capturePreflight']=json.loads((prior/'01-preflight-result.json').read_text())
        if data['capturePreflight']['status']!='PASS':raise RuntimeError('ActualKnownPendingPreflightRequired')
    journal=Journal(root);result={'status':'FAIL','operation':operation,'fullP6Runs':0,'productionChanges':False,'newDispatches':0}
    journal.put('01-'+operation+'-intent.json',{'readOnly':operation=='preflight','mockOnly':True,'newPublications':0,
        'knownPendingID':'0ec588ee-fbd8-4c05-8367-c7e0d5437fc1','restoreOriginalEvenOnFailure':True})
    try:
        code=bundle()+"result=sys.modules['p6_capture_repair_guest']."+('preflight' if operation=='preflight' else 'drain')+'('+repr(data)+',runtime)\nprint(json.dumps(result))\n'
        observed=schema.run_guest(code,timeout=600 if operation=='drain' else 180)
        journal.put('01-'+operation+'-result.json',observed);result.update(status=observed['status'],native=observed)
    except Exception as error:result['code']=str(error) if type(error)is RuntimeError else type(error).__name__
    result['manifestSHA256']=journal.seal(result)
    print(json.dumps({k:v for k,v in result.items() if k!='native'}))
    if result['status']!='PASS':raise SystemExit(1)


if __name__=='__main__':
    try:main()
    except Exception as error:
        print(json.dumps({'status':'STOP','code':str(error) if type(error)is RuntimeError else type(error).__name__,'rawErrorWithheld':True}));raise SystemExit(1)
