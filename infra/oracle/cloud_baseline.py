"""Executable staging-only baseline, gated by the two actual native proofs."""
import json
from pathlib import Path
import sys
import owner_parity

REPO=Path(__file__).resolve().parents[2]
EXCEPTIONS={'extension:pg_stat_statements','extension:pgcrypto','extension:uuid-ossp'}


def validate(manifest,evidence):
    if (manifest.get('state')!='STAGING_SCHEMA_VERIFIED' or manifest.get('executable') is not True
        or manifest.get('scope')!='guarded-staging-schema-only' or evidence.get('status')!='PASS'
        or evidence.get('schemaOnly') is not True or evidence.get('customerRowsImported')!=0):
        raise ValueError('Verified staging-only baseline required; no SSH')
    gates=evidence.get('gates',{})
    if set(gates)!={'ir35_owner_parity_20261021','ir35_baseline_proof_20261021'}:
        raise ValueError('Both independent native schema proofs required')
    for gate in gates.values():
        if (gate.get('status')!='PASS_WITH_OWNER_APPROVED_EXCEPTIONS' or gate.get('unexplainedDifferences')!=[]
            or {x['object'] for x in gate.get('exceptions',[])}!=EXCEPTIONS or len(gate['exceptions'])!=3
            or gate.get('roleAttributesMatch') is not True or gate.get('metadataMatch') is not True
            or gate.get('sourceObjects')!=3752 or gate.get('targetObjects')!=3752):
            raise ValueError('Unexpected schema/role difference; no SSH')
        ext=gate['extensions'];priv=gate['appRolePrivileges']
        expected={'adminOwner':True,'allObjectACLs':True,'ddlCapabilities':True,'versions':True}
        if (ext.get('status')!='PASS' or ext.get('conditions')!=expected or ext.get('unapprovedDifferences')!=[]
            or ext.get('objectACLChecks')!=62 or ext.get('capabilityChecks')!=198 or ext.get('typeACLChecks')!=4
            or ext.get('memberChecks')!=55
            or priv.get('status')!='PASS' or priv.get('differences')!=[] or priv.get('morePermissive')!=[]
            or priv.get('sourceEntries')!=552 or priv.get('targetEntries')!=552):
            raise ValueError('Conditional exception security proof incomplete; no SSH')


def main():
    if sys.argv[1:]!=['--staging-schema-only']:raise ValueError('Explicit staging-only operation required')
    manifest=json.loads((REPO/'supabase/baseline/cloud-20261021.json').read_text())
    evidence=json.loads((REPO/'docs/evidence/oracle-p3-owner-fidelity.json').read_text())
    validate(manifest,evidence)
    owner_parity.install_verified_baselines()


if __name__=='__main__':
    try:main()
    except Exception as error:
        print(json.dumps({'status':'FAIL','code':type(error).__name__,'rawOutput':'withheld'}));raise SystemExit(1)
