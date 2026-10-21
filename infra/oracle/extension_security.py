"""Only three extension-owner differences may be conditionally approved."""
EXTENSIONS={'pg_stat_statements':'1.11','pgcrypto':'1.3','uuid-ossp':'1.1'}
APP_ROLES={'anon','authenticated','service_role','authenticator'}


def compare(source,target):
    def ext_index(value):
        if value.get('version')!=1:raise ValueError('Extension security schema version')
        result={x['name']:x for x in value['extensions']}
        if set(result)!=set(EXTENSIONS) or len(result)!=len(value['extensions']):
            raise ValueError('Exactly three extension records required')
        return result
    a,b=ext_index(source),ext_index(target)
    differences=[];owners=[]
    for name,version in EXTENSIONS.items():
        if a[name]['version']!=version or b[name]['version']!=version or a[name]['schema']!=b[name]['schema']:
            differences.append('version-or-schema:'+name)
        if a[name]['owner']!=b[name]['owner']:
            owners.append({'object':'extension:'+name,'cloudOwner':a[name]['owner'],'stagingOwner':b[name]['owner'],'version':version})
        if b[name]['owner'] not in ('postgres','supabase_admin') or b[name]['owner'] in APP_ROLES:
            differences.append('non-admin-owner:'+name)
    for field,keys in (('objects',('kind','name')),('capabilities',('kind','name','role')),('members',('extension','class','identity'))):
        def index(value):
            rows=value[field]
            result={tuple(row[k] for k in keys):row for row in rows}
            if not rows or len(result)!=len(rows):raise ValueError('Missing/duplicate extension security coverage')
            return result
        left,right=index(source),index(target)
        for key in sorted(left.keys()|right.keys()):
            if left.get(key)!=right.get(key):differences.append(field+':'+':'.join(key))
    kinds={r['kind'] for r in source['objects']}
    if not {'schema','function','relation','type'}.issubset(kinds):
        raise ValueError('All ACL-bearing extension surface kinds required')
    capability_roles={r['role'] for r in source['capabilities']}
    if capability_roles!={'anon','authenticated','service_role'}:raise ValueError('Three-role DDL matrix required')
    return {'status':'FAIL' if differences else 'PASS','ownerDifferences':owners,'unapprovedDifferences':differences,
       'objectACLChecks':len(source['objects']),'capabilityChecks':len(source['capabilities']),
       'memberChecks':len(source['members']),'typeACLChecks':sum(x['kind']=='type' for x in source['objects']),
       'conditions':{'adminOwner':not any(x.startswith('non-admin-owner:') for x in differences),
        'allObjectACLs':not any(x.startswith('objects:') for x in differences),
        'ddlCapabilities':not any(x.startswith('capabilities:') for x in differences),
        'versions':not any(x.startswith('version-or-schema:') for x in differences)},
       'conditionalExceptionsOnly':True}
