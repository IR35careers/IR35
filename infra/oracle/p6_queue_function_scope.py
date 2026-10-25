"""Additional effective-access audit; never edits the unchanged 552 baseline."""
import copy
import json
from p4_recovery_guest import RecoveryError

SQL = """SELECT jsonb_build_object('checks',count(*),'outsideQueueDefiners',
 COALESCE(jsonb_agg(jsonb_build_object('role',r.rolname,'schema',n.nspname,
 'function',p.proname||'('||pg_get_function_identity_arguments(p.oid)||')',
 'definitionMD5',md5(pg_get_functiondef(p.oid)),
 'resultType',pg_get_function_result(p.oid),
 'alsoAccessibleToAnon',has_schema_privilege('anon',n.oid,'USAGE') AND has_function_privilege('anon',p.oid,'EXECUTE'))
 ORDER BY r.rolname,n.nspname,p.proname,p.oid)
 FILTER(WHERE has_schema_privilege(r.oid,n.oid,'USAGE') AND has_function_privilege(r.oid,p.oid,'EXECUTE')),'[]'::jsonb))
 FROM pg_roles r CROSS JOIN pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE r.rolname IN ('ir35_queue','ir35_queue_producer') AND n.nspname IN ('auth','public','storage') AND p.prosecdef;"""


def audit(original):
    reports = []
    for database in ('postgres', original.database, 'ir35_p5_app'):
        scoped = copy.copy(original)
        scoped.database = database
        result = json.loads(scoped.query(SQL))
        if type(result.get('checks')) is not int or not isinstance(result.get('outsideQueueDefiners'), list):
            raise RecoveryError('QueueFunctionScopeIncomplete_NoAssumedPass')
        reports.append({'database': database, **result})
    return {'status': 'PASS' if not any(row['outsideQueueDefiners'] for row in reports) else 'REVIEW_REQUIRED',
            'baseline552Changed': False, 'functionCalls': 0, 'mutations': 0, 'databases': reports}
