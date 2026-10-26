"""Read only: copy already sanitised, sealed unit results, never raw journals."""
import json
import cloud_schema as schema
import p6_capture_repair as controller
from p6_pause_reconcile import verified_manifest
from p6_audit_log import Journal


def main():
    parent=schema.REPO/'docs/evidence/p6';root=parent/'capture-owner3-journal-proof'
    if root.exists():raise RuntimeError('CaptureJournalProofAlreadyRecorded')
    if verified_manifest(parent/'capture-owner3-full')!='5b51ba02d4785d1ddd7dab874c8622a57c163f40adbc9bc26598633259325c24':
        raise RuntimeError('ExactFullP6PassRequired')
    proof=json.loads((parent/'capture-owner3-full/01-full-result.json').read_text())
    if proof['status']!='PASS' or proof['phaseComplete']is not True:raise RuntimeError('ActualFullP6PassRequired')
    data=controller.context();journal=Journal(root);result={'status':'FAIL','readOnly':True,'vmWrites':0}
    code=controller.bundle()+'''
from p6_mock_guest import prepared
store=prepared(DATA)
proof=PROOF
manifest=store.verify(proof['integration']['stage'],proof['integration']['manifestSHA256'])
found=[]
for artifact in manifest['artifacts']:
 name=artifact['name']
 if re.fullmatch(r'ir35-p6-mock-(?:mock-ingest|mock-automation|watchdog)-decoder3-execution-result\\.json',name):
  value=json.loads((store.root/proof['integration']['stage']/name).read_bytes())
  found.append({'name':name,'sha256':artifact['sha256'],'result':value})
passed=len(found)==3 and all(row['result']['status']=='PASS' and row['result']['journalReadExitCode']==0
 and row['result']['startAttempts']==1 and row['result']['commandExitCode']==0
 and row['result']['service']['Result']=='success' and row['result']['service']['ExecMainStatus']=='0'
 and row['result']['journalWithinSizeLimit']is True and row['result']['journalValidJSON']is True for row in found)
print(json.dumps({'status':'PASS' if passed else 'FAIL','readOnly':True,'vmWrites':0,'units':found,
 'sealedIntegrationManifestSHA256':proof['integration']['manifestSHA256']}))
'''.replace('DATA',repr(data)).replace('PROOF',repr(proof))
    try:
        result['proof']=journal.step(1,'sealed-schedule-journals',lambda:schema.run_guest(code,timeout=180));result['status']='PASS'
    finally:result['manifestSHA256']=journal.seal(result)
    print(json.dumps({k:v for k,v in result.items() if k!='proof'}))


if __name__=='__main__':
    try:main()
    except Exception as error:
        print(json.dumps({'status':'STOP','code':str(error) if type(error)is RuntimeError else type(error).__name__,'rawErrorWithheld':True}));raise SystemExit(1)
