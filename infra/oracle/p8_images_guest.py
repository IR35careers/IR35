"""Build TWO new native images; no service/queue/app/edge/secret activation."""
import base64
import io
import json
import os
from pathlib import Path
import re
import shutil
import signal
import subprocess
import tarfile
import time
from immutable_artifacts import Store, digest
from web_build_guest import safe_members, public_build_env
from web_security import security_versions
from p6_mock_guest import prepared
from web_services_guest import require_prepared
from web_edge_guest import private_env
from p6_restart_diagnosis_guest import containment
import p8_image_policy

ROOT = Path('/opt/ir35')
ORIGINAL_CONTAINERS = ('ir35-p5-web', 'ir35-p6-mock-worker-v7-fixedip', 'ir35-p6-mock-worker-v7-fixedip-rollback')


def memory():
    text = Path('/proc/meminfo').read_text()
    return {name: int(re.search(r'^' + name + r':\s+([0-9]+)', text, re.M)[1]) for name in ('MemTotal', 'MemAvailable')}


def original_state(runtime):
    rows = json.loads(runtime['run'](['docker', 'inspect', *ORIGINAL_CONTAINERS]))
    if {row['Name'].lstrip('/') for row in rows} != set(ORIGINAL_CONTAINERS):
        raise RuntimeError('ExistingOriginalContainerInventoryRequired')
    return {row['Name'].lstrip('/'): {**{key: row[key] for key in ('Id', 'Image', 'RestartCount')},
        'state': {key: row['State'][key] for key in ('Status', 'Running', 'Paused', 'StartedAt', 'ExitCode')}} for row in rows}


class Steps:
    def __init__(self, store):
        self.store, self.anchors, self.results = store, {}, {}

    def step(self, number, name, action):
        if {path.name for path in self.store.root.iterdir()} != set(self.anchors):
            raise RuntimeError('UnanchoredNativeImageStage_Abort')
        for old, anchor in self.anchors.items():
            self.store.verify(old, anchor)
        stage = self.store.stage(f'{number:02d}-{name}')
        self.store.put(stage, 'intent.json', json.dumps({'operation': name, 'newNativeImageOnly': True,
            'runtimeActivation': False, 'oldSlotsReplayed': False}).encode())
        result = {'status': 'FAIL'}
        try:
            result = action(stage)
        except Exception as error:
            code = str(error) if type(error) is RuntimeError and re.fullmatch('[A-Za-z][A-Za-z0-9_]{0,110}', str(error)) else type(error).__name__
            result = {'status': 'FAIL', 'code': code, 'rawErrorWithheld': True}
        self.store.put(stage, 'result.json', json.dumps(result, sort_keys=True).encode())
        anchor = self.store.seal(stage, previous=next(reversed(self.anchors.values()), None))
        self.anchors[stage.name] = anchor
        self.store.verify(stage.name, anchor)
        self.results[name] = {'stage': stage.name, 'manifestSHA256': anchor, 'result': result}
        if result.get('status') != 'PASS':
            raise RuntimeError('NativeImageStepFailed_' + name)
        return result


def build_command(command, store, stage):
    """Observe THIS live owned process; never treat observation silence as exit."""
    started, minimum = time.monotonic(), memory()['MemAvailable']
    with store.sink(stage, 'build.log') as output:
        child = subprocess.Popen(command, stdout=output, stderr=output, start_new_session=True)
        store.put(stage, 'builder-pid.json', json.dumps({'pid': child.pid, 'sourceBuildOnly': True}).encode())
        try:
            while child.poll() is None:
                minimum = min(minimum, memory()['MemAvailable'])
                if minimum < 2 * 1024 * 1024:
                    raise RuntimeError('NativeBuildOSHeadroomBelowTwoGiB_StopOwnedProcess')
                if time.monotonic() - started > 1200:
                    raise RuntimeError('NativeBuild1200SecondDeadline_InspectBeforeRetry')
                try: child.wait(timeout=1)
                except subprocess.TimeoutExpired: pass
        except BaseException:
            if child.poll() is None:
                os.killpg(child.pid, signal.SIGTERM)
                try: child.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    os.killpg(child.pid, signal.SIGKILL); child.wait(timeout=5)
            raise
        code = child.returncode
    if code:
        raise RuntimeError('NativeImageBuildFailed_PrivateLogPreserved_NoReplay')
    return {'exitCode': code, 'seconds': round(time.monotonic() - started, 3), 'minimumOSAvailableKiB': minimum}


def image_probe(runtime, tag, kind):
    row = json.loads(runtime['run'](['docker', 'image', 'inspect', tag]))[0]
    if (not re.fullmatch('sha256:[a-f0-9]{64}', row.get('Id', '')) or row.get('Architecture') != 'arm64'
            or row.get('Os') != 'linux' or row.get('Config', {}).get('User') != '1002:1002'
            or type(row.get('Size')) is not int or row['Size'] <= 0):
        raise RuntimeError('NativeImageArmNonrootIdentityMismatch')
    if kind == 'web':
        script = "const fs=require('node:fs');let r={};for(const n of ['next','react','react-dom','sharp'])r[n]=JSON.parse(fs.readFileSync('/app/node_modules/'+n+'/package.json','utf8')).version;console.log(JSON.stringify(r))"
        args, expected = ['-e', script], {'next': '16.4.3', 'react': '19.2.9', 'react-dom': '19.2.9', 'sharp': '0.35.5'}
    else:
        script = "const fs=require('node:fs'),m=require('./services/application-worker/mock-web-runtime.ts');const exports=Object.keys(m).sort();let versions={};for(const n of ['playwright-core','pg-boss'])versions[n]=JSON.parse(fs.readFileSync('/app/node_modules/'+n+'/package.json','utf8')).version;console.log(JSON.stringify({exports,versions,importOnly:true}))"
        args, expected = ['--import', 'tsx', '-e', script], {'exports': ['runWebMockWorker', 'setupWebMockQueue', 'webMockOwnerOptions'],
            'versions': {'playwright-core': '1.61.0', 'pg-boss': '12.38.0'}, 'importOnly': True}
    observed = json.loads(runtime['run'](['docker', 'run', '--rm', '--network', 'none', '--read-only', '--cap-drop', 'ALL',
        '--memory', '256m', '--pids-limit', '32', '--log-driver', 'none', '--env', 'TSX_DISABLE_CACHE=1',
        '--tmpfs', '/tmp:rw,noexec,nosuid,size=64m,uid=1002,gid=1002', '--entrypoint', 'node', row['Id'], *args]))
    if observed != expected:
        raise RuntimeError('NativeImagePackageOrEntrypointProbeMismatch')
    return {'image': row['Id'], 'imageBytes': row['Size'], 'architecture': 'linux/arm64', 'nonroot': True,
            'probe': observed, 'runtimeDeployed': False, 'networkNoneProbe': True}


def run(data, runtime):
    prepared(data); require_prepared(data)
    sha = data.get('sourceSHA', '')
    if not re.fullmatch('[a-f0-9]{40}', sha): raise RuntimeError('ExactCommittedImageSourceRequired')
    if p8_image_policy.hosted_checks(data['hostedChecks'], sha)['status'] != 'PASS': raise RuntimeError('ExactHostedGreenRequired')
    root = ROOT / '.env.p8-webmock-images01'
    if root.exists() or root.is_symlink(): raise RuntimeError('P8ImageJournalAlreadyExists_NoReplay')
    root.mkdir(mode=0o700); os.chown(root, 1002, 1002)
    steps = Steps(Store(root, uid=1002))
    result = {'status': 'FAIL', 'sourceSHA': sha, 'runtimeDeployed': False, 'phaseComplete': False,
              'newOCIResources': 0, 'newSecrets': 0, 'sourceWrites': 0, 'cutover': False}
    state = {}
    target = ROOT / 'data/p8-webmock-source' / sha

    def preflight(stage):
        values = runtime['read_env']()
        web = private_env(ROOT / '.env.p5-web')
        if (values.get('APPLY_RUNNER') != 'mock' or values.get('APPLICATION_WORKER_ACCEPT_JOBS') != 'false'
                or web.get('IR35_READ_ONLY') != 'true' or web.get('APPLY_RUNNER') != 'mock'
                or web.get('APPLICATION_WORKER_ACCEPT_JOBS') != 'false'):
            raise RuntimeError('ProtectedOriginalMockReadonlyConfigurationRequired')
        now = memory()
        budget = p8_image_policy.resources(os.uname().machine, os.cpu_count(), now['MemTotal'], now['MemAvailable'], shutil.disk_usage(ROOT / 'data').free)
        docker_root = runtime['run'](['docker', 'info', '--format', '{{.DockerRootDir}}']).strip()
        if docker_root != str(ROOT / 'data/docker'): raise RuntimeError('ExistingDockerDataRootRequired_NoReconfiguration')
        if target.absolute() != target.resolve() or target.parent.is_symlink(): raise RuntimeError('SourceArchiveDestinationEscapeRefused')
        if target.exists() or target.is_symlink(): raise RuntimeError('NewSourceDestinationAlreadyExists_NoOverwrite')
        state['containers'] = original_state(runtime)
        full = containment(data, runtime, probe_container='ir35-p6-mock-worker-v7-fixedip')
        steps.store.put(stage, 'containment.json', json.dumps(full, sort_keys=True).encode())
        if full['status'] != 'PASS': raise RuntimeError('PreImageContainmentMismatch_Abort')
        body = base64.b64decode(data['archive'], validate=True)
        if digest(body) != data['archiveSHA256']: raise RuntimeError('ExactGitArchiveHashRequired')
        target.parent.mkdir(exist_ok=True); target.mkdir(mode=0o755)
        with tarfile.open(fileobj=io.BytesIO(body), mode='r:') as archive:
            archive.extractall(target, members=safe_members(archive), filter='data')
        state['versions'] = security_versions(json.loads((target / 'package-lock.json').read_text()))
        return {'status': 'PASS', 'resources': budget, 'dockerDataRoot': docker_root, 'originalContainers': state['containers'],
                'archiveSHA256': digest(body), 'archiveBytes': len(body)}

    def build(stage, kind):
        now = memory()
        p8_image_policy.resources(os.uname().machine, os.cpu_count(), now['MemTotal'], now['MemAvailable'], shutil.disk_usage(ROOT / 'data').free)
        tag = 'ir35-p8-webmock-' + kind + ':' + sha
        file = 'services/web/Dockerfile' if kind == 'web' else 'services/application-worker/Dockerfile.mock'
        command = ['docker', 'build', '--platform', 'linux/arm64', '--network', 'host', '--file', str(target / file), '--tag', tag]
        if kind == 'web':
            env_path = ROOT / ('.env.p8-webmock-build-' + sha[:12])
            fd = os.open(env_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
            try:
                os.fchown(fd, 1002, 1002)
                payload = runtime['env_text'](public_build_env(runtime['read_env']())).encode()
                with os.fdopen(fd, 'wb', closefd=False) as output: output.write(payload); output.flush(); os.fsync(output.fileno())
            finally: os.close(fd)
            command.extend(['--secret', 'id=web-build,src=' + str(env_path)])
        command.append(str(target))
        observation = build_command(command, steps.store, stage)
        probe = image_probe(runtime, tag, kind)
        return {'status': 'PASS', 'sourceSHA': sha, 'tag': tag, **observation, **probe,
                'webMockConsumerRequiresExplicitEntrypoint': kind == 'worker'}

    try:
        steps.step(1, 'preflight', preflight)
        result['web'] = steps.step(2, 'web-build', lambda stage: build(stage, 'web'))
        result['worker'] = steps.step(3, 'worker-build', lambda stage: build(stage, 'worker'))
        result['status'] = 'PASS'
    except Exception as error:
        result['code'] = str(error) if type(error) is RuntimeError and re.fullmatch('[A-Za-z][A-Za-z0-9_]{0,110}', str(error)) else type(error).__name__
    finally:
        def final(stage):
            prepared(data); require_prepared(data)
            full = containment(data, runtime, probe_container='ir35-p6-mock-worker-v7-fixedip')
            steps.store.put(stage, 'containment.json', json.dumps(full, sort_keys=True).encode())
            current = original_state(runtime)
            if full['status'] != 'PASS': raise RuntimeError('PostImageContainmentMismatch_Abort')
            if state.get('containers') is not None and current != state['containers']:
                raise RuntimeError('OriginalContainerIdentityOrRestartChanged_Abort')
            return {'status': 'PASS', 'fullContainment': full, 'originalContainersUnchanged': state.get('containers') is not None}
        try: result['post'] = steps.step(4, 'post-containment', final)
        except Exception as error: result.update(status='FAIL', finalCode=type(error).__name__)
    result['steps'] = steps.results
    return result
