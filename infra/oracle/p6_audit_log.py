"""Local write-once audit journal and metadata-only read-command diagnostics."""
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess


class AuditFailure(RuntimeError):
    pass


def sha(body):
    return hashlib.sha256(body).hexdigest()


def command_kind(arguments, supplied_input=None):
    """Fail closed BEFORE executing; never return arguments, input or credentials."""
    args = list(arguments) if isinstance(arguments, (list, tuple)) else []
    if not args or not all(isinstance(item, str) for item in args):
        raise AuditFailure('ReadOnlyArgumentVectorRequired')
    if args[0] == 'findmnt' and args[1:] == ['-n', '-o', 'UUID,FSTYPE,TARGET', '--mountpoint', '/opt/ir35/data']:
        return 'findmnt-data-volume'
    if args[0] != 'docker' or len(args) < 2:
        raise AuditFailure('ReadOnlyCommandNotAllowed')
    if args[1] in ('inspect', 'ps', 'top'):
        return 'docker-' + args[1]
    if args[1:3] in (['image', 'inspect'], ['network', 'inspect']):
        return 'docker-' + args[1] + '-inspect'
    if args == ['docker', 'cp', 'ir35-staging-db-1:/etc/postgresql/pg_hba.conf', '-']:
        # Existing verifier's archive GET, stdout in RAM only. Never permit
        # reverse-direction cp, another file/container, flags or a destination.
        return 'docker-read-hba-archive'
    if args[1] == 'compose' and 'exec' in args and 'psql' in args:
        body = supplied_input.decode() if isinstance(supplied_input, bytes) else supplied_input
        if not isinstance(body, str) or not body.startswith('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;') or not body.rstrip().endswith('ROLLBACK;'):
            raise AuditFailure('ReadOnlySQLTransactionRequired')
        return 'docker-compose-read-only-psql'
    raise AuditFailure('ReadOnlyCommandNotAllowed')


def stderr_category(body):
    """Only fixed classifications escape. Raw stderr may contain private values."""
    value = body.decode(errors='replace') if isinstance(body, bytes) else body or ''
    lowered = value.lower()
    for needle, category in (
        ('is not running', 'container-not-running'),
        ('no such container', 'container-not-found'),
        ('no such object', 'object-not-found'),
        ('requires at least', 'missing-command-arguments'),
        ('unknown shorthand flag', 'unsupported-short-option'),
        ('unknown flag', 'unsupported-option'),
        ('unrecognized option', 'unsupported-process-option'),
        ('cannot connect to the docker daemon', 'docker-daemon-unreachable'),
        ('permission denied', 'permission-denied'),
        ('executable file not found', 'executable-not-found'),
        ('syntax error', 'syntax-error'),
    ):
        if needle in lowered:
            return category
    return 'unclassified-output-withheld'


class CommandTrace:
    def __init__(self, native):
        self.native = native
        self.observations = []

    def __call__(self, arguments, *positional, **options):
        try:
            operation = command_kind(arguments, options.get('input'))
        except AuditFailure as error:
            self.observations.append({'operation': 'rejected-before-execution', 'status': 'FAIL', 'code': str(error)})
            raise
        observation = {'operation': operation, 'status': 'STARTED'}
        self.observations.append(observation)
        try:
            result = self.native(arguments, *positional, **options)
        except Exception as error:
            observation.update(status='FAIL', exceptionType=type(error).__name__)
            raise
        observation.update(status='PASS' if result.returncode == 0 else 'FAIL', exitCode=result.returncode)
        if result.returncode:
            raw = result.stderr or b''
            raw = raw.encode() if isinstance(raw, str) else raw
            observation.update(stderrSHA256=sha(raw), stderrCategory=stderr_category(raw))
        return result


class Journal:
    """On the operator machine only: no file/config writes on the staging VM."""
    def __init__(self, root):
        self.root = Path(root)
        self.root.mkdir()  # One fixed owner slot, including failed runs. Never resume/replay.
        self.hashes = {}
        self.closed = False

    def verify(self):
        if {item.name for item in self.root.iterdir()} != set(self.hashes):
            raise AuditFailure('UnexpectedAuditArtifact')
        for name, expected in self.hashes.items():
            path = self.root / name
            if path.is_symlink() or sha(path.read_bytes()) != expected:
                raise AuditFailure('AuditArtifactChanged')

    def put(self, name, value):
        if self.closed or not re.fullmatch(r'[a-z0-9][a-z0-9-]*\.json', name):
            raise AuditFailure('ClosedOrUnsafeAuditArtifact')
        self.verify()
        body = (json.dumps(value, sort_keys=True, indent=2) + '\n').encode()
        descriptor = os.open(self.root / name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        try:
            with os.fdopen(descriptor, 'wb', closefd=False) as output:
                output.write(body)
                output.flush()
                os.fsync(output.fileno())
        finally:
            os.close(descriptor)
        self.hashes[name] = sha(body)

    def step(self, number, name, action):
        prefix = f'{number:02d}-{name}'
        self.put(prefix + '-intent.json', {'operation': name, 'readOnly': True})
        try:
            result = action()
        except Exception as error:
            result = {'status': 'FAIL', 'operation': name, 'exceptionType': type(error).__name__, 'rawErrorWithheld': True}
        self.put(prefix + '-result.json', result)  # BEFORE checking status/raising.
        if not isinstance(result, dict) or result.get('status') != 'PASS':
            raise AuditFailure('ReadOnlyAuditFailed_' + name)
        return result

    def seal(self, result):
        self.put('result.json', result)
        self.put('manifest.json', {'version': 1, 'artifacts': [
            {'name': name, 'sha256': digest} for name, digest in sorted(self.hashes.items())]})
        self.closed = True
        return self.hashes['manifest.json']
