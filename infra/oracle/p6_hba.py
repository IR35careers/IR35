"""ONE explicit owner-approved staging HBA repair; never replay stage09."""
import json
import sys

import cloud_schema as schema
import p6_context
import p6_worker_build
from key_ceremony import KeySafetyError
from security_session import ensure_session
from ssh_agent_session import ensure_agent


def credential_gate():
    agent = ensure_agent()
    if not agent.get('keyLoaded') or (agent.get('keyLeaseMode') != 'until-agent-restart'
                                    and agent.get('keyLifetimeSecondsRemaining', 0) < 1800):
        raise KeySafetyError('OwnerSSHGate_ExistingFourHourKeyExpiredOrInsufficient_NoAutomaticPrompt')
    # One bounded refresh only; no API key fallback or browser automatically.
    ensure_session(minimum_seconds=1800)


def main():
    if sys.argv[1:] not in (['--apply-owner-queue-boundary'], ['--inspect-owner-boundary'], ['--reconcile-inspection']):
        raise RuntimeError('ExplicitOwnerQueueBoundaryRequired')
    inspecting = sys.argv[1:] == ['--inspect-owner-boundary']
    reconciling = sys.argv[1:] == ['--reconcile-inspection']
    directory = schema.REPO / 'docs/evidence/p6'
    destination = directory / ('queue-hba-owner-inspect-reconciled.json' if reconciling else
                               'queue-hba-owner-inspect.json' if inspecting else 'queue-hba-owner-boundary.json')
    if destination.exists():
        raise RuntimeError('QueueBoundaryAlreadyRecorded_NoReplay')
    credential_gate()
    data = p6_context.context()
    for name, path in [('p6Inventory', 'p6-inventory.json'), ('rolePreflight', 'p6-role-preflight.json'), ('roleInstall', 'p6-role-install.json')]:
        data[name] = json.loads((schema.REPO / 'docs/evidence' / path).read_text())
    data.update(mockPrepare=json.loads((directory / 'mock-prepare.json').read_text()),
                scopeFailure=json.loads((directory / 'mock-runtime-update-two.json').read_text()))
    script = p6_worker_build.bundle()
    for name in ('p6_roles_guest', 'p6_mock_guest', 'p6_queue_function_scope', 'p6_queue_hba', 'p6_hba_guest'):
        code = (schema.REPO / 'infra/oracle' / (name + '.py')).read_text()
        script += 'module=types.ModuleType(' + repr(name) + ');sys.modules[' + repr(name) + ']=module\nexec(' + repr(code) + ',module.__dict__)\n'
    operation = 'reconcile_inspection' if reconciling else 'inspect_only' if inspecting else 'run'
    script += 'result=sys.modules["p6_hba_guest"].' + operation + '(' + repr(data) + ',runtime)\nprint(json.dumps(result))\n'
    result = schema.run_guest(script, timeout=900)
    with destination.open('x', encoding='utf-8') as output:
        json.dump(result, output, indent=2)
    print(json.dumps(result if inspecting or reconciling else {key: result.get(key) for key in ('status', 'code', 'manifestSHA256', 'queueOnlyConnectionBoundary', 'rollback', 'containment')}))
    if result['status'] not in ('PASS', 'ABSENT'):
        raise SystemExit(1)


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(json.dumps({'status': 'STOP', 'code': str(error) if isinstance(error, (RuntimeError, KeySafetyError)) else type(error).__name__}))
        raise SystemExit(1)
