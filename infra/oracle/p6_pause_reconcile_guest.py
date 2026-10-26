"""Read-only processing-pause reconciliation; no PID/worker/config repair."""
from datetime import datetime, timezone
import json
import re
import urllib.request

from immutable_artifacts import digest
from p4_recovery_guest import Recovery
from p6_mock_control import Control
from p6_mock_guest import ROOT, validate_config
from p6_status_audit_guest import history, queue, run_case as prior_case
from web_edge_guest import private_env

CUTOFF = '2026-10-25T22:36:00+00:00'
CASES = ('processing-flag', 'application-ledger', 'smtp-sink', 'external-isolation', 'full-containment', 'ledger-after')


def instant(value):
    return datetime.fromisoformat(value.replace('Z', '+00:00')).astimezone(timezone.utc)


def activity_times(jobs, cutoff=CUTOFF):
    found = []
    retry_counts = []
    for job in jobs:
        created = False
        for name, value in job.items():
            compact = name.replace('_', '').lower()
            if compact == 'retrycount':
                retry_counts.append(value)
            if compact in ('createdon', 'startedon', 'completedon', 'failedon', 'laststartedon') and value:
                found.append(instant(value))
                created = created or compact == 'createdon'
        if not created:
            raise RuntimeError('PauseReconciliationJobCreationTimestampMissing')
    return {'noJobActivityAfterCutoff': bool(found) and all(value <= instant(cutoff) for value in found),
            'jobRetryCountsZero': len(retry_counts) == len(jobs) and all(value == 0 for value in retry_counts),
            'latestRecordedJobActivityUTC': max(found).isoformat() if found else None}


def containers(runtime):
    identifiers = runtime['run'](['docker', 'ps', '-q']).splitlines()
    if not identifiers:
        raise RuntimeError('PauseReconciliationRunningContainersMissing')
    return json.loads(runtime['run'](['docker', 'inspect', *identifiers]))


def run_case(name, data, runtime):
    if name not in CASES:
        raise RuntimeError('FixedPauseReconciliationCaseRequired')
    store, receipts = history(data)
    cutoff = instant(CUTOFF)
    if name in ('application-ledger', 'ledger-after'):
        report = queue(data, runtime)
        original = Recovery(data['p4'], runtime)
        jobs = json.loads(original.query("SELECT coalesce(jsonb_agg(to_jsonb(j) ORDER BY id),'[]') FROM pgboss.job j;", 'postgres'))
        timestamps = activity_times(jobs)
        report['checks'].update({key: value for key, value in timestamps.items() if key != 'latestRecordedJobActivityUTC'})
        report['checks']['noReceiptEventAfterCutoff'] = all(instant(event['at']) <= cutoff for row in receipts.values() for event in row['events'])
        report['checks']['allJobsAccountedFor'] = len(jobs) == 12 and {str(row['id']) for row in jobs} == set(receipts)
        report.update(status='PASS' if all(report['checks'].values()) else 'FAIL', cutoffUTC=CUTOFF,
                      latestRecordedJobActivityUTC=timestamps['latestRecordedJobActivityUTC'])
        return report
    if name == 'processing-flag':
        values = private_env(ROOT / '.env.p6-mock-worker')
        validate_config(values)
        item = json.loads(runtime['run'](['docker', 'inspect', 'ir35-p6-mock-worker-v3']))[0]
        health = Control(private_env(ROOT / '.env.p6-mock-control')['APPLICATION_WORKER_SECRET']).request('GET', '/health')[1]
        current = item['State']
        marker = store.root / data['currentFailure']['stage'] / 'manifest.json'
        checks = {'containerRunning': current['Running'] is True, 'dockerNotPaused': current['Paused'] is False,
                  'processingFlagPaused': health.get('paused') is True, 'activeZero': health.get('active') == 0,
                  'mockOnlyHealth': health.get('mode') == 'staging-mock-only' and health.get('realAcceptance') is False,
                  'mockModeConfigured': values['APPLY_RUNNER'] == 'mock' and values['APPLICATION_WORKER_ACCEPT_JOBS'] == 'false',
                  'noContainerRestart': item['RestartCount'] == 0,
                  'startedBeforePauseReport': instant(current['StartedAt']) < cutoff,
                  'unchangedSincePriorDiagnosis': current['StartedAt'] == data['priorDiagnosis']['inspect']['StartedAt'],
                  'sameVerifiedImage': item['Image'] == data['runtimeProof']['image'],
                  'pauseEvidencePredatesReport': marker.stat().st_mtime <= cutoff.timestamp(),
                  'sameVerifiedBuildSHA': health.get('buildSHA') == data['runtimeProof']['sourceSHA']}
        return {'status': 'PASS' if all(checks.values()) else 'FAIL', 'checks': checks, 'cutoffUTC': CUTOFF,
                'StartedAt': current['StartedAt'], 'DockerPaused': current['Paused'], 'processingPaused': health.get('paused'),
                'RestartCount': item['RestartCount'], 'workerActive': health.get('active'), 'APPLY_RUNNER': values['APPLY_RUNNER'],
                'explanation': 'The /mock/maintenance processing flag gates queue fetches; the container remains alive for health, the empty-queue watchdog and database heartbeat.',
                'expectedInternalHeartbeatTraffic': True, 'dockerPauseOrStopWasNeverRequestedByFailureHandler': True}
    if name == 'smtp-sink':
        sinks = [row for row in containers(runtime) if row['Config']['Image'].startswith('axllent/mailpit:')]
        if len(sinks) != 1:
            raise RuntimeError('PauseReconciliationSingleSinkRequired')
        sink = sinks[0]
        aliases = set(sink['NetworkSettings']['Networks']['ir35-staging_backend'].get('Aliases') or []) | {sink['Name'].lstrip('/')}
        routing = []
        for filename in ('.env.auth', '.env.p5-auth'):
            config = private_env(ROOT / filename)
            routing.append(config.get('GOTRUE_SMTP_HOST') in aliases and config.get('GOTRUE_SMTP_PORT') == '1025'
                           and not config.get('GOTRUE_SMTP_USER') and not config.get('GOTRUE_SMTP_PASS'))
        env = private_env(ROOT / '.env.smtp')
        relay_keys = [key for key, value in env.items() if value and re.search(r'RELAY|FORWARD', key)]
        relay_flags = [part for part in (sink['Config'].get('Cmd') or []) if re.search(r'relay|forward', part, re.I)]
        address = sink['NetworkSettings']['Networks']['ir35-staging_backend']['IPAddress']
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        with opener.open('http://' + address + ':8025/api/v1/messages', timeout=10) as response:
            body = response.read(262145)
        if len(body) > 262144:
            raise RuntimeError('PauseReconciliationSinkResponseTooLarge')
        mail = json.loads(body)
        if type(mail.get('total')) is not int or not isinstance(mail.get('messages'), list):
            raise RuntimeError('PauseReconciliationSinkInventoryInvalid')
        checks = {'bothAuthStacksRouteToSink': all(routing), 'sinkEmpty': mail['total'] == 0 and not mail['messages'],
                  'noForwardOrRelayConfigured': not relay_keys and not relay_flags,
                  'noSinkRestart': sink['RestartCount'] == 0, 'sinkStartedBeforeCutoff': instant(sink['State']['StartedAt']) < cutoff,
                  'privateUnpublishedSink': not sink['HostConfig'].get('PortBindings')}
        return {'status': 'PASS' if all(checks.values()) else 'FAIL', 'checks': checks,
                'sinkMessages': mail['total'], 'sinkStartedAt': sink['State']['StartedAt'], 'sinkRestartCount': sink['RestartCount'],
                'smtpPort': 1025, 'mailContentOrRecipientLogged': False}
    if name == 'external-isolation':
        item = json.loads(runtime['run'](['docker', 'inspect', 'ir35-p6-mock-worker-v3']))[0]
        network = json.loads(runtime['run'](['docker', 'inspect', '--type', 'network', 'ir35-staging_backend']))[0]
        values = private_env(ROOT / '.env.p6-mock-worker')
        validate_config(values)
        merged_keys = {entry.split('=', 1)[0].upper() for entry in item['Config'].get('Env', []) if '=' in entry and entry.split('=', 1)[1]} | {key.upper() for key, value in values.items() if value}
        mounts = [row['Destination'] for row in item.get('Mounts', [])]
        checks = {'onlyInternalNetwork': set(item['NetworkSettings']['Networks']) == {'ir35-staging_backend'} and network.get('Internal') is True,
                  'noHostNetworking': item['HostConfig']['NetworkMode'] != 'host',
                  'noProxyConfigured': not (merged_keys & {'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY'}),
                  'noProviderCredentials': not any(re.match(r'^(?:SUPABASE|NEXT_PUBLIC|STRIPE|POSTMARK|RESEND|OPENAI|OPENROUTER|AWS_|GOOGLE_)', key) for key in merged_keys),
                  'noDockerSocket': not any(path.endswith('docker.sock') for path in mounts),
                  'readOnlyUnprivileged': item['HostConfig']['ReadonlyRootfs'] is True and not item['HostConfig'].get('Privileged') and not item['HostConfig'].get('CapAdd'),
                  'verifiedMockImage': item['Image'] == data['runtimeProof']['image'],
                  'mockSettingsUnchanged': values['APPLY_RUNNER'] == 'mock'}
        return {'status': 'PASS' if all(checks.values()) else 'FAIL', 'checks': checks,
                'externalEgressBlocked': checks['onlyInternalNetwork'], 'expectedInternalTraffic': ['database heartbeat', 'empty-queue watchdog', 'read-only health requests'],
                'historicalPacketCaptureClaimed': False,
                'scope': 'No application/employer/provider delivery; internal health and heartbeat traffic intentionally continues.'}
    return prior_case('full-containment', data, runtime)
