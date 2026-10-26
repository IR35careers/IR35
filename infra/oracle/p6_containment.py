"""Keep the raw P4/P5 verifiers and 552 baseline; record P6 additions separately."""
import json
import p6_role_policy
from p4_recovery_guest import Recovery
from sdk_owner1_guest import fidelity as baseline_fidelity


def fidelity(data,runtime):
    original=Recovery(data['p4'],runtime);source=original.source()
    actual_expiry=json.loads(original.query(original.sql['expiry'],'postgres'))
    baseline=runtime['verifiers']['fidelity_compare']
    def compare(source_catalog,target_catalog,conditions,privileges,_legacy_exact_expiry):
        # No filtering, hash rewriting or change to the old comparator. Its raw
        # FAIL for the two additions remains part of the new phase report.
        return p6_role_policy.compare(source_catalog,target_catalog,conditions,privileges,
                                      source['roleExpiry'],actual_expiry,baseline)
    scoped=runtime|{'verifiers':runtime['verifiers']|{'fidelity_compare':compare}}
    result,pristine,fixture=baseline_fidelity(data,scoped)
    reports=[proof['schema'] for proof in (pristine,fixture)]
    approved=all(report['status']=='PASS_WITH_APPROVED_P6_ADDITIONS' and report['baseline552Unchanged']
                 and report['sourceRolesUnchanged'] and report['sourceRoleExpiryUnchanged']
                 and len(report['approvedP6Additions'])==2 for report in reports)
    result=result|{'approvedP6RolesEach':2,'baseline552Unchanged':approved,'sourceRolesUnchanged':approved,
                   'rawCatalogDifferencesRetained':True}
    if not approved:result['status']='FAIL'
    return result,pristine,fixture
