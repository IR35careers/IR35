"""CI-only synthetic Docker route test. No VM, real data/keys or public ports.

Uses the REAL new edge handler tree with only listen/certificate/upstream
addresses replaced for an internal stub. This proves routing/Bearer handoff,
not certificate/VM readiness or a migration phase PASS.
"""
import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import time
import traceback
import urllib.error
from immutable_artifacts import Store
from p8_webqa_edge import caddyfile, CERTIFICATE
from sdk_gate_private import request, CADDY, NODE, PASSWORD, TOKEN
from sdk_gate_config import redact_adapted
from sdk_gate_observation import Observer, sdk_cases

LABEL = 'ir35.purpose=p8-webqa-edge-regression'


class SyntheticDockerError(RuntimeError):
    def __init__(self, code, stderr):
        super().__init__('PrivateDockerCommandFailed_' + str(code))
        # Only this public-fixture-only Docker context uses this projection.
        # No VM key, env, token, provider or private mount is passed to it.
        text = stderr.decode(errors='replace')
        for value in (PASSWORD, TOKEN): text = text.replace(value, '<public-fixture-value>')
        text = re.sub(r'\$2[aby]\$[0-9]{2}\$[./A-Za-z0-9]{53}', '<public-fixture-bcrypt>', text)
        text = re.sub(r'(?i)(Bearer|Basic)\s+[^\s"\']+', r'\1 <redacted>', text)
        self.diagnostic = {'exitCode': code, 'stderrBytes': len(stderr), 'stderrSHA256': hashlib.sha256(stderr).hexdigest(),
                           'syntheticStderr': text[:4000], 'truncated': len(text) > 4000}


def command(args, *, input=None, timeout=60):
    if type(args) is not list or not args or args[0] != 'docker': raise RuntimeError('SyntheticDockerOnly')
    reply = subprocess.run(args, input=input, capture_output=True, timeout=timeout)
    if reply.returncode: raise SyntheticDockerError(reply.returncode, reply.stderr)
    return reply.stdout.decode()


def common_flags():
    # Match the already-PASS SDK fixture's owned700 tmpfs mounts, not root-owned
    # shared1777 defaults. This changes CI fixture custody only, not the VM plan.
    uid = os.getuid()
    return ['--read-only', '--memory', '128m', '--pids-limit', '128', '--user', f'{uid}:{uid}',
            '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true', '--log-driver', 'none', '--restart', 'no',
            *[argument for path, size in (('/tmp', '16m'), ('/data', '1m'), ('/config', '1m'))
              for argument in ('--tmpfs', f'{path}:rw,size={size},uid={uid},gid={uid},mode=0700')]]
STUB = '''import http from 'node:http';
http.createServer((req,res)=>{res.setHeader('content-type','application/json');
if(req.url==='/echo-app'){res.end(JSON.stringify({authorization:req.headers.authorization||'',staging:!!req.headers['x-staging-authorization']}));return;}
if(req.url==='/jobs'){res.setHeader('content-type','text/html');res.end('<h1>QA contracts</h1>');return;}
if(req.url==='/auth/v1/health'){res.end(JSON.stringify({path:req.url}));return;}
if(req.url==='/upstream-error'){res.writeHead(500).end('{}');return;}
res.writeHead(404).end('{}');}).listen(8081,'0.0.0.0');'''


def stub_config(gateway, bcrypt):
    value = caddyfile(gateway)
    for old, new in (('https://staging.ir35careers.com {', ':8080 {'),
                     ('    tls ' + CERTIFICATE + '.crt ' + CERTIFICATE + '.key\n', ''),
                     ('ir35-p8-webqa01-kong:8000', 'qa-edge-stub:8081'),
                     ('ir35-p8-webqa01-web:3000', 'qa-edge-stub:8081'),
                     ('{$STAGING_BASIC_HASH}', bcrypt), ('{$STAGING_GATE_TOKEN}', TOKEN)):
        if value.count(old) != (2 if old == '{$STAGING_GATE_TOKEN}' else 1): raise RuntimeError('ExactSyntheticEdgeSubstitutionRequired')
        value = value.replace(old, new)
    return value


def run(root):
    root = Path(root); root.mkdir(mode=0o700, parents=True, exist_ok=True)
    store = Store(root); stage = store.stage('01-owned-edge'); network = 'ir35-p8-edge-regression'
    names = [network + '-stub', network + '-caddy']; created = []; network_created = False
    result = {'status': 'FAIL', 'scope': 'CI_SYNTHETIC_ONLY', 'vmCalls': 0, 'publicPorts': 0, 'realCertificateMounted': False}
    common = common_flags()
    try:
        store.put(stage, 'intent.json', json.dumps(result | {'network': network, 'containers': names, 'syntheticOnly': True}).encode())
        if command(['docker', 'network', 'ls', '--filter', 'name=^' + network + '$', '--format', '{{.Name}}']).strip(): raise RuntimeError('SyntheticNetworkExists_NoReplay')
        for name in names:
            if command(['docker', 'ps', '-a', '--filter', 'name=^/' + name + '$', '--format', '{{.Names}}']).strip(): raise RuntimeError('SyntheticContainerExists_NoReplay')
        result['step'] = 'pull-pinned-synthetic-images'
        for image in (CADDY, NODE): command(['docker', 'pull', image], timeout=180)
        result['step'] = 'hash-public-fixture-password'
        bcrypt = command(['docker', 'run', '--rm', '-i', '--network', 'none', '--log-driver', 'none', CADDY,
                          'caddy', 'hash-password', '--algorithm', 'bcrypt'], input=(PASSWORD + '\n').encode()).strip()
        result['step'] = 'create-internal-synthetic-network'
        command(['docker', 'network', 'create', '--internal', '--label', LABEL, network]); network_created = True
        net = json.loads(command(['docker', 'network', 'inspect', network]))[0]
        if not net['Internal'] or net['Containers']: raise RuntimeError('EmptyPrivateSyntheticNetworkRequired')
        result['step'] = 'synthetic-config'
        gateway = net['IPAM']['Config'][0]['Gateway']
        store.put(stage, 'Caddyfile', stub_config(gateway, bcrypt).encode()); store.put(stage, 'stub.mjs', STUB.encode())
        validate = ['docker', 'run', '--rm', '--network', 'none', *common, '--cap-add', 'NET_BIND_SERVICE',
                    '--volume', str(stage / 'Caddyfile') + ':/fixture.caddy:ro', CADDY, 'caddy']
        result['step'] = 'caddy-adapt'
        adapted = json.loads(command(validate + ['adapt', '--config', '/fixture.caddy', '--adapter', 'caddyfile']))
        result['step'] = 'caddy-validate'
        command(validate + ['validate', '--config', '/fixture.caddy', '--adapter', 'caddyfile'])
        store.put(stage, 'adapted.json', json.dumps(redact_adapted(adapted, {bcrypt: '<synthetic-bcrypt>', TOKEN: '<synthetic-gate>'}), sort_keys=True).encode())
        result['step'] = 'start-synthetic-containers'
        for index, image in enumerate((NODE, CADDY)):
            args = ['docker', 'run', '-d', '--name', names[index], '--network', network, '--label', LABEL, *common]
            if index == 0:
                args += ['--network-alias', 'qa-edge-stub', '--volume', str(stage / 'stub.mjs') + ':/stub.mjs:ro', image, 'node', '/stub.mjs']
            else: args += ['--cap-add', 'NET_BIND_SERVICE', '--volume', str(stage / 'Caddyfile') + ':/fixture.caddy:ro', image, 'caddy', 'run', '--config', '/fixture.caddy', '--adapter', 'caddyfile']
            created.append(command(args).strip())
        inspect = json.loads(command(['docker', 'inspect', *created]))
        if any(row['HostConfig'].get('PortBindings') or set(row['NetworkSettings']['Networks']) != {network} for row in inspect): raise RuntimeError('SyntheticIsolationFailed')
        address = inspect[1]['NetworkSettings']['Networks'][network]['IPAddress']
        result['step'] = 'synthetic-readiness'
        deadline = time.monotonic() + 20
        while True:
            try:
                if request(address, 'GET', '/jobs', {})[0] == 401: break
            except (urllib.error.URLError, TimeoutError, ConnectionError): pass
            if time.monotonic() > deadline: raise RuntimeError('SyntheticEdgeReadinessFailed')
            time.sleep(1)
        result['step'] = 'actual-route-cases'
        observer = Observer(store, stage); call = lambda method, path, headers: request(address, method, path, headers)
        sdk_cases(observer, call, TOKEN)
        basic = 'Basic ' + base64.b64encode(('ir35:' + PASSWORD).encode()).decode()
        observer.case('app-bearer', 'POST', '/echo-app', 200,
            lambda rid: call('POST', '/echo-app', {'Authorization': 'Bearer public-fixture-session', 'X-Staging-Authorization': basic}),
            checks=lambda headers, body: {'bearerPreserved': json.loads(body)['authorization'] == 'Bearer public-fixture-session',
                                        'basicRemoved': json.loads(body)['staging'] is False})
        observer.case('bad-basic-valid-bearer', 'POST', '/echo-app', 401,
            lambda rid: call('POST', '/echo-app', {'Authorization': 'Bearer public-fixture-session', 'X-Staging-Authorization': 'Basic invalid'}))
        observer.case('protected-jobs', 'GET', '/jobs', 200, lambda rid: call('GET', '/jobs', {'Authorization': basic}),
            checks=lambda headers, body: {'h1': b'<h1>QA contracts</h1>' in body,
                'secureGate': all(flag in headers.get('set-cookie', '') for flag in ('Secure', 'HttpOnly', 'SameSite=Strict', 'Path=/'))})
        # Supplemental owner-approved error-path coverage. The original six
        # cases/expected values/timeouts above remain byte-for-byte unchanged.
        observer.case('auth-error-headers', 'POST', '/echo-app', 401,
            lambda rid: call('POST', '/echo-app', {'Authorization': 'Bearer public-fixture-session', 'X-Staging-Authorization': 'Basic invalid'}),
            checks=lambda headers, body: {'challengePreserved': headers.get('www-authenticate') == 'Basic realm="restricted"',
                                         'serverRemoved': 'server' not in headers})
        observer.case('sdk-error-fallback', 'GET', '/supabase/not-supported', 404,
            lambda rid: call('GET', '/supabase/not-supported', {'Cookie': '__Host-ir35-staging=' + TOKEN}),
            checks=lambda headers, body: {'exactRoute': headers.get('x-ir35-matched-route') == 'sdk-fallback', 'serverRemoved': 'server' not in headers})
        observer.case('upstream-http-error', 'GET', '/upstream-error', 500,
            lambda rid: call('GET', '/upstream-error', {'Authorization': basic}),
            checks=lambda headers, body: {'serverRemoved': 'server' not in headers})
        command(['docker', 'stop', '--time', '10', created[0]])
        observer.case('proxy-error-headers', 'GET', '/jobs', 502,
            lambda rid: call('GET', '/jobs', {'Authorization': basic}),
            checks=lambda headers, body: {'serverRemoved': 'server' not in headers})
        result.update(cases=observer.records, validate='PASS', adapt='PASS', internalOnly=True,
                      status='PASS' if all(row['passed'] for row in observer.records) else 'FAIL')
    except Exception as error:
        result['errorClass'] = type(error).__name__
        result['failureFrames'] = [{'file': Path(frame.filename).name, 'function': frame.name, 'line': frame.lineno}
                                   for frame in traceback.extract_tb(error.__traceback__)]
        if isinstance(error, SyntheticDockerError):
            result['dockerDiagnostic'] = error.diagnostic
            result['code'] = 'PrivateDockerCommandFailed_' + str(error.diagnostic['exitCode'])
        safe = {'SyntheticNetworkExists_NoReplay', 'SyntheticContainerExists_NoReplay', 'EmptyPrivateSyntheticNetworkRequired',
                'SyntheticIsolationFailed', 'SyntheticEdgeReadinessFailed', 'SyntheticReadFailure'}
        if type(error) is RuntimeError and (str(error) in safe or re.fullmatch('PrivateDockerCommandFailed_[0-9]+', str(error))):
            result['code'] = str(error)
    finally:
        try:
            for cid in reversed(created):
                item = json.loads(command(['docker', 'inspect', cid]))[0]
                if item['Config']['Labels'].get('ir35.purpose') != 'p8-webqa-edge-regression': raise RuntimeError('SyntheticCleanupOwnershipMismatch')
                command(['docker', 'rm', '--force', '--volumes', cid])
            if network_created: command(['docker', 'network', 'rm', network])
            result['cleanup'] = 'PASS'
        except Exception as error: result.update(status='FAIL', cleanup='FAIL', cleanupErrorClass=type(error).__name__)
    store.put(stage, 'result.json', json.dumps(result, sort_keys=True).encode())
    result['manifestSHA256'] = store.seal(stage)
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser(); parser.add_argument('--root', required=True)
    result = run(parser.parse_args().root)
    # Complete public synthetic result, including redacted cases and safe stack
    # locations, survives even if the ephemeral CI filesystem is discarded.
    # No raw exception messages, headers, command output or real values.
    print(json.dumps(result, sort_keys=True))
    if result['status'] != 'PASS': raise SystemExit(1)
