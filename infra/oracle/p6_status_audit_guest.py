"""Read-only observation cases. No service, queue, DB, sink or file writes."""
import json
import re
import urllib.request
from pathlib import Path

from immutable_artifacts import digest
from p4_recovery_guest import Recovery
from p6_containment import fidelity
from p6_lifecycle_guest import retained_receipts
from p6_mock_control import Control
from p6_mock_guest import prepared, ROOT
from p6_queue_boundary_gate import anchored_result, verify_live
from p6_queue_function_scope import audit as function_scope
from web_edge_guest import private_env

CASES = ('sealed-history', 'queue-before', 'worker-idle', 'smtp-empty', 'full-containment', 'queue-after')


def history(data):
    store = prepared(data)
    failure = data['currentFailure']
    anchored_result(store, failure)
    if (failure.get('code') != 'NativeMockCaseFailed_reject-employer-url'
            or failure.get('failureContainment', {}).get('status') != 'PASS'
            or failure.get('failurePause') != {'paused': True, 'realAcceptance': False}):
        raise RuntimeError('ExactStatusFailureAndContainmentRequired')
    manifest = store.verify(failure['stage'], failure['manifestSHA256'])
    receipts = retained_receipts(store, data['failureLifecycle'])
    matches = []
    for item in manifest['artifacts']:
        if re.fullmatch(r'[0-9]{3}-(?:terminal-(?:success|server_error|timeout|lost_ack|captcha|unknown_answer)|concurrent-terminal)\.json', item['name']):
            row = json.loads((store.root / failure['stage'] / item['name']).read_bytes())
            if row['applicationId'] in receipts:
                raise RuntimeError('DuplicateRecordedMockApplication')
            receipts[row['applicationId']] = row
        if item['name'].endswith('-reject-employer-url.json'):
            matches.append(json.loads((store.root / failure['stage'] / item['name']).read_bytes()))
    if len(receipts) != 12 or matches != [{'actual': 202, 'expected': 400}]:
        raise RuntimeError('ExactTwelveReceiptsAndRejectedStatusEvidenceRequired')
    return store, receipts


QUEUE_SQL = """SELECT jsonb_build_object(
 'applications',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',id::text,'state',state,'events',events,'errorCode',error_code,'receiptConfirmed',receipt_confirmed,'updatedAt',updated_at) ORDER BY id),'[]') FROM pgboss.ir35_mock_application),
 'applyJobs',(SELECT coalesce(jsonb_agg(id::text ORDER BY id),'[]') FROM pgboss.job WHERE name='ir35-staging-mock-apply'),
 'allJobCount',(SELECT count(*) FROM pgboss.job),
 'pendingJobs',(SELECT count(*) FROM pgboss.job WHERE state IN ('active','created','retry')),
 'schedules',(SELECT count(*) FROM pgboss.ir35_mock_schedule));"""


def queue(data, runtime):
    _, expected = history(data)
    current = json.loads(Recovery(data['p4'], runtime).query(QUEUE_SQL, 'postgres'))
    rows = current['applications']
    def same(row):
        old = expected[row['id']]
        return (row['state'] == old['state'] and row['events'] == old['events']
                and row['errorCode'] == old['errorCode'] and row['receiptConfirmed'] == old['receiptConfirmed'])
    checks = {'exactExpectedApplicationIDs': {r['id'] for r in rows} == set(expected),
              'exactExpectedJobIDs': set(current['applyJobs']) == set(expected),
              'noUnexpectedJobs': current['allJobCount'] == 12,
              'noPendingJobs': current['pendingJobs'] == 0, 'noScheduleWrite': current['schedules'] == 0}
    checks['allTwelveReceiptsUnchanged'] = checks['exactExpectedApplicationIDs'] and all(same(row) for row in rows)
    return {'status': 'PASS' if all(checks.values()) else 'FAIL', 'checks': checks,
            'applicationCount': len(rows), 'jobCount': current['allJobCount'], 'pendingJobCount': current['pendingJobs'],
            'scheduleCount': current['schedules'], 'ledgerSHA256': digest(json.dumps(current, sort_keys=True).encode())}


def run_case(name, data, runtime):
    if name not in CASES:
        raise RuntimeError('FixedReadOnlyAuditCaseRequired')
    if name == 'sealed-history':
        _, receipts = history(data)
        return {'status': 'PASS', 'expectedReceipts': len(receipts), 'stage16ManifestSHA256': data['currentFailure']['manifestSHA256']}
    if name in ('queue-before', 'queue-after'):
        return queue(data, runtime)
    if name == 'worker-idle':
        control = Control(private_env(ROOT / '.env.p6-mock-control')['APPLICATION_WORKER_SECRET'])
        health = control.request('GET', '/health')[1]
        item = json.loads(runtime['run'](['docker', 'inspect', 'ir35-p6-mock-worker-v3']))[0]
        processes = runtime['run'](['docker', 'top', 'ir35-p6-mock-worker-v3', '-eo', 'stat,comm']).splitlines()[1:]
        chromium = [line for line in processes if re.search(r'\b(?:chrome|chromium|chrome_crashpad)\b', line)]
        checks = {'paused': health.get('paused') is True, 'activeZero': health.get('active') == 0,
                  'noBrowserProcesses': not chromium, 'realAcceptanceFalse': health.get('realAcceptance') is False,
                  'previousImageUnchanged': item['Image'] == data['runtimeProof']['image'],
                  'previousContainerRunning': item['State']['Running'] is True}
        return {'status': 'PASS' if all(checks.values()) else 'FAIL', 'checks': checks,
                'chromiumProcessCount': len(chromium), 'workerActive': health.get('active'), 'image': item['Image']}
    if name == 'smtp-empty':
        identifiers = runtime['run'](['docker', 'ps', '-q']).splitlines()
        if not identifiers:
            raise RuntimeError('ExistingRunningContainersRequired')
        containers = json.loads(runtime['run'](['docker', 'inspect', *identifiers]))
        sinks = [row for row in containers if row['Config']['Image'].startswith('axllent/mailpit:')]
        if len(sinks) != 1:
            raise RuntimeError('ExactlyOneExistingSinkRequired')
        sink = sinks[0]
        if sink['HostConfig'].get('PortBindings') or sink['HostConfig']['LogConfig']['Type'] != 'none':
            raise RuntimeError('PrivateUnpublishedSinkRequired')
        address = sink['NetworkSettings']['Networks']['ir35-staging_backend']['IPAddress']
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        with opener.open('http://' + address + ':8025/api/v1/messages', timeout=10) as reply:
            body = reply.read(262145)
        if len(body) > 262144:
            raise RuntimeError('BoundedSinkMetadataRequired')
        mail = json.loads(body)
        if not isinstance(mail.get('messages'), list) or type(mail.get('total')) is not int:
            raise RuntimeError('ExactSinkInventoryRequired')
        return {'status': 'PASS' if mail['total'] == 0 and not mail['messages'] else 'FAIL',
                'sinkTotal': mail['total'], 'listedMessages': len(mail['messages']), 'sinkWrites': 0}
    store, _ = history(data)
    containment, _, _ = fidelity(data, runtime)
    recovery = Recovery(data['p4'], runtime)
    boundary = verify_live(data, recovery, store, function_scope(recovery))
    return {'status': 'PASS' if containment['status'] == boundary['status'] == 'PASS' else 'FAIL',
            'containment': containment, 'queueBoundary': boundary, 'sourceWrites': 0, 'auditTableWrites': 0}
