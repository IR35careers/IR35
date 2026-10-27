"""Snapshot schema capability inventory, not a migration or functional QA gate."""
import json
import sys
import cloud_schema as schema
import p6_capture_repair
import p8_staging_readonly as staging
from p6_audit_log import Journal


COLUMNS = {
    'application_packets': {
        'delivery_status': 'text', 'delivery_version': 'bigint',
        'failure_reason': 'text', 'error_detail': 'text',
        'delivery_started_at': 'timestamp with time zone',
    },
    'application_events': {
        'from_status': 'text', 'to_status': 'text',
        'failure_reason': 'text', 'error_detail': 'text',
    },
    'application_worker_tasks': {'attempt_base': 'integer'},
}
FUNCTIONS = (
    'application_has_delivery_receipt', 'application_delivery_can_transition',
    'guard_application_delivery', 'audit_application_delivery',
    'transition_application_delivery', 'commit_application_delivery_result',
    'project_application_task_delivery', 'guard_application_task_attempt',
    'claim_application_delivery_task', 'save_application_draft',
)

# Only fixed public catalogue names/types; no function definitions, user rows,
# defaults, credentials or migration-history payloads are read by this query.
SQL = """SELECT jsonb_build_object(
 'columns',COALESCE((SELECT jsonb_agg(jsonb_build_object(
   'table',c.relname,'column',a.attname,'type',pg_catalog.format_type(a.atttypid,a.atttypmod))
   ORDER BY c.relname,a.attname)
  FROM pg_catalog.pg_attribute a JOIN pg_catalog.pg_class c ON c.oid=a.attrelid
  JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND a.attnum>0 AND NOT a.attisdropped
   AND (c.relname,a.attname) IN (
    ('application_packets','delivery_status'),('application_packets','delivery_version'),
    ('application_packets','failure_reason'),('application_packets','error_detail'),
    ('application_packets','delivery_started_at'),('application_events','from_status'),
    ('application_events','to_status'),('application_events','failure_reason'),
    ('application_events','error_detail'),('application_worker_tasks','attempt_base'))),'[]'::jsonb),
 'functions',COALESCE((SELECT jsonb_agg(DISTINCT p.proname ORDER BY p.proname)
  FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname IN
    ('application_has_delivery_receipt','application_delivery_can_transition',
     'guard_application_delivery','audit_application_delivery','transition_application_delivery',
     'commit_application_delivery_result','project_application_task_delivery',
     'guard_application_task_attempt','claim_application_delivery_task','save_application_draft')),'[]'::jsonb)
);"""


def readiness(metadata):
    if type(metadata) is not dict or set(metadata) != {'columns', 'functions'}:
        raise RuntimeError('ExactCapabilityMetadataRequired')
    if type(metadata['columns']) is not list or type(metadata['functions']) is not list:
        raise RuntimeError('CapabilityListsRequired')
    observed = {}
    for row in metadata['columns']:
        if type(row) is not dict or set(row) != {'table', 'column', 'type'}:
            raise RuntimeError('ExactColumnCapabilityRequired')
        table, column, kind = row['table'], row['column'], row['type']
        if (type(table) is not str or table not in COLUMNS or type(column) is not str
                or type(kind) is not str or column not in COLUMNS[table]):
            raise RuntimeError('FixedApplicationColumnRequired')
        key = table + '.' + column
        if key in observed:
            raise RuntimeError('DuplicateColumnCapabilityRefused')
        observed[key] = kind
    functions = metadata['functions']
    if (any(type(name) is not str or name not in FUNCTIONS for name in functions)
            or len(set(functions)) != len(functions)):
        raise RuntimeError('UniqueFixedFunctionNamesRequired')
    missing_columns, wrong_types = [], []
    for table, fields in COLUMNS.items():
        for column, expected in fields.items():
            name = table + '.' + column
            if name not in observed:
                missing_columns.append(name)
            elif observed[name] != expected:
                wrong_types.append({'name': name, 'expected': expected, 'actual': observed[name]})
    missing_functions = sorted(set(FUNCTIONS) - set(functions))
    return {
        'schemaCapabilities': 'BLOCKED' if missing_columns or missing_functions or wrong_types else 'PRESENT_ONLY',
        'missingColumns': sorted(missing_columns), 'wrongColumnTypes': wrong_types,
        'missingFunctions': missing_functions,
        'requiredColumns': sum(map(len, COLUMNS.values())), 'requiredFunctions': len(FUNCTIONS),
        'functionalQAProven': False, 'migrationApplied': False,
    }


BODY = '''
from p6_mock_guest import prepared
from web_services_guest import require_prepared
from p4_recovery_guest import Recovery
from p6_restart_diagnosis_guest import containment
prepared(data);require_prepared(data)
result={'status':'FAIL','readOnly':True,'vmWrites':0,'cloudRequests':0,
 'phaseComplete':False,'scope':'verified pristine snapshot; app copy parity checked by full containment'}
try:
 metadata=json.loads(Recovery(data['p4'],runtime).query(QUERY))
 result['capabilities']=readiness(metadata)
 result['status']='PASS'
except Exception as error:
 result['code']=type(error).__name__
finally:
 result['fullContainment']=containment(data,runtime,probe_container='ir35-p6-mock-worker-v7-fixedip')
 if result['fullContainment']['status']!='PASS':
  result.update(status='FAIL',code='FullContainmentFailed_Abort')
print(json.dumps(result))
'''


def program(data):
    import inspect
    code = (p6_capture_repair.bundle() + '\ndata=' + repr(data) + '\nQUERY=' + repr(SQL)
            + '\nCOLUMNS=' + repr(COLUMNS) + '\nFUNCTIONS=' + repr(FUNCTIONS)
            + '\n' + inspect.getsource(readiness) + '\n' + BODY)
    compile(code, '<snapshot-app-readiness>', 'exec')
    return code


def main():
    if sys.argv[1:] != ['--read-only']:
        raise RuntimeError('ExplicitReadOnlyCapabilityInventoryRequired')
    data = staging.context()
    code = program(data)
    journal = Journal(schema.REPO / 'docs/evidence/p8/snapshot-app-readiness-01')
    result = {'status': 'FAIL', 'readOnly': True, 'phaseComplete': False}
    try:
        result['inventory'] = journal.step(1, 'snapshot-capabilities-containment',
            lambda: schema.run_guest(code, timeout=600))
        result['status'] = result['inventory']['status']
    except Exception as error:
        result['code'] = type(error).__name__
    finally:
        result['manifestSHA256'] = journal.seal(result)
    print(json.dumps({key: value for key, value in result.items() if key != 'inventory'}))
    if result['status'] != 'PASS':
        raise SystemExit(1)


if __name__ == '__main__':
    main()
