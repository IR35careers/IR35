"""Schema equality except exactly the owner's three conditional owner records."""
import extension_security


def compare(source,target,conditions,privileges,expiry_match):
    def index(catalog):
        result={row['kind']+':'+row['name']:row for row in catalog['objects']}
        if len(result)!=len(catalog['objects']):raise ValueError('Duplicate catalog key')
        return result
    a,b=index(source),index(target);differences=[];exceptions=[]
    ready=conditions['status']=='PASS' and privileges['status']=='PASS' and expiry_match
    for key in sorted(a.keys()|b.keys()):
        left,right=a.get(key),b.get(key)
        if left and right and left['hash']==right['hash']:continue
        record={'object':key,'cloudHash':left['hash'] if left else None,'stagingHash':right['hash'] if right else None}
        name=key.removeprefix('extension:')
        allowed=(ready and key.startswith('extension:') and name in extension_security.EXTENSIONS and left and right
          and {k:v for k,v in left['value'].items() if k!='owner'}=={k:v for k,v in right['value'].items() if k!='owner'}
          and left['value']['owner']=='postgres' and right['value']['owner'] in ('postgres','supabase_admin')
          and left['value']['version']==extension_security.EXTENSIONS[name])
        if allowed:exceptions.append(record|{'reason':'Owner-approved platform extension owner only; all a-d conditions independently PASS'})
        else:differences.append(record)
    metadata_match=all(source[key]==target[key] for key in ('encoding','collation','schemas'))
    ok=ready and metadata_match and not differences
    return {'status':'PASS_WITH_OWNER_APPROVED_EXCEPTIONS' if ok and exceptions else 'CATALOG_MATCH_ONLY' if ok else 'FAIL',
       'sourceCheckedAt':source['checkedAt'],'targetCheckedAt':target['checkedAt'],'sourceObjects':len(a),'targetObjects':len(b),
       'unexplainedDifferences':differences,'exceptions':exceptions,'roleAttributesMatch':expiry_match,
       'metadataMatch':metadata_match,'conditionsPASS':ready,'fullDataVerification':False,'phaseComplete':False}
