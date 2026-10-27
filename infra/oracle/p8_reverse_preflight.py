"""Read-only reverse-sync capability inventory; no restore or role changes."""
import json
import sys
import cloud_schema as schema
import p6_capture_repair
import p8_staging_readonly as load
from p6_audit_log import Journal
from p6_pause_reconcile import verified_manifest

SQL="""SELECT jsonb_build_object(
 'role',current_user,'replicationRole',current_setting('session_replication_role'),
 'canSetReplicationRole',has_parameter_privilege(current_user,'session_replication_role','SET'),
 'superuser',(SELECT rolsuper FROM pg_roles WHERE rolname=current_user),
 'canCreateDatabase',(SELECT rolcreatedb OR rolsuper FROM pg_roles WHERE rolname=current_user),
 'serverMajor',current_setting('server_version_num')::int/10000,
 'partitionRelations',(SELECT count(*) FROM pg_inherits i JOIN pg_class c ON c.oid=i.inhrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname!~'^pg_' AND n.nspname<>'information_schema'),
 'generatedColumns',(SELECT count(*) FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind IN('r','p') AND a.attnum>0 AND NOT a.attisdropped AND a.attgenerated<>'' AND n.nspname!~'^pg_' AND n.nspname<>'information_schema'),
 'identityColumns',(SELECT count(*) FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind IN('r','p') AND a.attnum>0 AND NOT a.attisdropped AND a.attidentity<>'' AND n.nspname!~'^pg_' AND n.nspname<>'information_schema'),
 'foreignKeys',(SELECT count(*) FROM pg_constraint k JOIN pg_namespace n ON n.oid=k.connamespace WHERE k.contype='f' AND n.nspname!~'^pg_' AND n.nspname<>'information_schema'),
 'nonDeferrableForeignKeys',(SELECT count(*) FROM pg_constraint k JOIN pg_namespace n ON n.oid=k.connamespace WHERE k.contype='f' AND NOT k.condeferrable AND n.nspname!~'^pg_' AND n.nspname<>'information_schema')
);"""


def program(data):
    code=p6_capture_repair.bundle()+'\ndata='+repr(data)+'\nQUERY='+repr(SQL)+'\n'
    code+='''
from p6_mock_guest import prepared
from web_services_guest import require_prepared
from p4_recovery_guest import Recovery
from p6_restart_diagnosis_guest import containment
prepared(data);require_prepared(data)
recovery=Recovery(data['p4'],runtime)
metadata=json.loads(recovery.query(QUERY))
full=containment(data,runtime,probe_container='ir35-p6-mock-worker-v7-fixedip')
print(json.dumps({'status':'PASS' if full['status']=='PASS' else 'FAIL','readOnly':True,'vmWrites':0,
 'metadata':metadata,'fullContainment':full,'cloudCapabilityProven':False,'reverseDataTransferProven':False,
 'phaseComplete':False,'roleChanges':0,'databaseOrTableCreates':0,'sessionSettingChanges':0}))
'''
    compile(code,'<readonly-reverse-preflight>','exec')
    return code


def main():
    if sys.argv[1:]!=['--read-only']:raise RuntimeError('ReadOnlyReversePreflightRequired')
    proof=schema.REPO/'docs/evidence/p8/readonly-load-02'
    if verified_manifest(proof)!='e95c2ff16232eb766195b2715f9671b48370b3af5e72a0f741ea2b62ab52c443':raise RuntimeError('ActualLoadAndContainmentPassRequired')
    data=load.context();code=program(data)
    journal=Journal(schema.REPO/'docs/evidence/p8/reverse-preflight-01');result={'status':'FAIL','readOnly':True,'phaseComplete':False}
    try:
        result['preflight']=journal.step(1,'capabilities-containment',lambda:schema.run_guest(code,timeout=600))
        result['status']=result['preflight']['status']
    except Exception as error:result['code']=str(error)if type(error)is RuntimeError else type(error).__name__
    finally:result['manifestSHA256']=journal.seal(result)
    print(json.dumps({k:v for k,v in result.items()if k!='preflight'}))
    if result['status']!='PASS':raise SystemExit(1)


if __name__=='__main__':main()
