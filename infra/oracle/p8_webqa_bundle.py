"""Compile the complete isolated QA dependency graph, without executing it.

No entrypoint, SSH call, native slot or fixture is created here. Runtime custody
and the final bounded QA controller remain mandatory before executing a bundle.
"""
import inspect
import cloud_schema as schema
import p6_capture_repair
import p8_app_readiness as capabilities
from p7_auth_rehearsal import AUTH_MODULES


def bundle():
    source = p6_capture_repair.bundle()
    for name in (*AUTH_MODULES, 'upgrade_review'):
        source += 'module=types.ModuleType(' + repr(name) + ');sys.modules[' + repr(name) + ']=module\nexec(' + repr(
            (schema.REPO / 'infra/oracle' / (name + '.py')).read_text()) + ',module.__dict__)\n'
    source += "module=types.ModuleType('p8_app_readiness');sys.modules['p8_app_readiness']=module\nexec(" + repr(
        'COLUMNS=' + repr(capabilities.COLUMNS) + '\nFUNCTIONS=' + repr(capabilities.FUNCTIONS)
        + '\nSQL=' + repr(capabilities.SQL) + '\n' + inspect.getsource(capabilities.readiness)) + ',module.__dict__)\n'
    for name in ('p8_upgrade_guest', 'p8_webqa_config', 'p8_webqa_edge', 'p8_webqa_realtime', 'p8_webqa_guest'):
        source += 'module=types.ModuleType(' + repr(name) + ');sys.modules[' + repr(name) + ']=module\nexec(' + repr(
            (schema.REPO / 'infra/oracle' / (name + '.py')).read_text()) + ',module.__dict__)\n'
    compile(source, '<p8-private-webqa-dependency-graph>', 'exec')
    return source
