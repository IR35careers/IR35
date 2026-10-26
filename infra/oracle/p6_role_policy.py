"""Owner-approved ADDITIONS, not rewritten catalogs or a changed 552 baseline."""
import hashlib

APPROVED_ROLES={'ir35_queue':4,'ir35_queue_producer':2}


def expected_role(name):
    return {'superuser':False,'inherit':False,'createRole':False,'createDB':False,'login':True,
            'replication':False,'bypassRLS':False,'connectionLimit':APPROVED_ROLES[name],'config':None}


def compare(source,target,conditions,privileges,source_expiry,target_expiry,base_compare):
    a={row['kind']+':'+row['name']:row for row in source['objects']}
    b={row['kind']+':'+row['name']:row for row in target['objects']}
    if len(a)!=len(source['objects']) or len(b)!=len(target['objects']):raise ValueError('Duplicate catalog key')
    null_expiry={'hash':hashlib.md5(b'NULL').hexdigest(),'configured':False,'finite':False}
    source_expiry_match=all(target_expiry.get(name)==value for name,value in source_expiry.items())
    expiry_additions={name:value for name,value in target_expiry.items() if name not in source_expiry}
    expiry_ok=source_expiry_match and set(expiry_additions)==set(APPROVED_ROLES) and all(value==null_expiry for value in expiry_additions.values())
    # Raw source/target and all 552 checks are passed UNMODIFIED. The baseline
    # result remains visible, including the two expected extra role objects.
    raw=base_compare(source,target,conditions,privileges,expiry_ok)
    additions=[];unexpected=[]
    for difference in raw['unexplainedDifferences']:
        key=difference['object'];name=key.removeprefix('role:')
        role=b.get(key)
        approved=(key.startswith('role:') and name in APPROVED_ROLES and key not in a
                  and role is not None and role['value']==expected_role(name))
        if approved:additions.append(difference|{'name':name,'approvedP6Addition':True,'attributesVerified':True})
        else:unexpected.append(difference)
    baseline_unchanged=(privileges.get('status')=='PASS' and privileges.get('sourceEntries')==552 and privileges.get('targetEntries')==552)
    source_roles_match=all(key in b and b[key]['hash']==row['hash'] for key,row in a.items() if row['kind'] in ('role','role-membership'))
    complete={item['name'] for item in additions}==set(APPROVED_ROLES) and len(additions)==2
    ok=complete and not unexpected and expiry_ok and baseline_unchanged and source_roles_match and raw['conditionsPASS'] and raw['metadataMatch']
    return {'status':'PASS_WITH_APPROVED_P6_ADDITIONS' if ok else 'FAIL','sourceObjects':raw['sourceObjects'],'targetObjects':raw['targetObjects'],
            'baselineCatalogResult':raw,'approvedP6Additions':additions,'unexplainedDifferences':unexpected,
            'exceptions':raw['exceptions'],'sourceRolesUnchanged':source_roles_match,'sourceRoleExpiryUnchanged':source_expiry_match,
            'additionExpiryVerified':expiry_ok,'baseline552Unchanged':baseline_unchanged,'fullDataVerification':False,'phaseComplete':False}
