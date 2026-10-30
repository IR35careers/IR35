"""Offline public SDK/CLI serialization diagnosis; NOT a repair or OCI call.

Reads public repository/installed-package source only. The current controller's
pure retention_items function is extracted by AST, never imported/executed as a
controller. Evidence uses a new exclusive Journal; failed/used slots never replay.
"""
import ast
import hashlib
from importlib import metadata
import inspect
import json
from pathlib import Path
from types import SimpleNamespace

from p6_audit_log import Journal

REPOSITORY = Path(__file__).resolve().parents[2]
CONTROLLER = REPOSITORY / 'infra/oracle/p8_backup_iam_owner.py'
SLOT = REPOSITORY / 'docs/evidence/p8/lifecycle-cli-shape-diagnosis-20261030-01'
PREFIX = 'ir35-backups-v1'


def sha(body):
    return hashlib.sha256(body).hexdigest()


def retention_from_public_source(source):
    """Only the unchanged function's no-call literal/comprehension expression."""
    parsed = ast.parse(source)
    functions = [node for node in parsed.body if isinstance(node, ast.FunctionDef)
                 and node.name == 'retention_items']
    if len(functions) != 1:
        raise ValueError('OnePublicRetentionFunctionRequired')
    function = functions[0]
    allowed = (ast.FunctionDef, ast.arguments, ast.Return, ast.ListComp, ast.List, ast.Dict,
               ast.Constant, ast.Name, ast.Load, ast.Store, ast.BinOp, ast.Add,
               ast.Attribute, ast.comprehension, ast.Tuple)
    for node in ast.walk(function):
        if not isinstance(node, allowed):
            raise ValueError('PublicRetentionMustRemainPureNoCallExpression')
        if isinstance(node, ast.Attribute) and (not isinstance(node.value, ast.Name)
                or node.value.id != 'scope' or node.attr != 'PREFIX'):
            raise ValueError('OnlyPublicRetentionPrefixAttributeAllowed')
        if isinstance(node, ast.Name) and node.id not in ('scope', 'lane', 'days'):
            raise ValueError('OnlyFixedPublicRetentionNamesAllowed')
    namespace = {'__builtins__': {}, 'scope': SimpleNamespace(PREFIX=PREFIX)}
    code = compile(ast.Module(body=[function], type_ignores=[]), '<public-retention-only>', 'exec')
    exec(code, namespace)
    return namespace['retention_items']()


def compare_cli_rows(inputs, serializer, rule_model, filter_model):
    """Use the installed public model constructors + real CLI serializer."""
    rows = []
    for value in inputs:
        rows.append(rule_model(name=value['name'], target=value['target'], action=value['action'],
            time_amount=value['timeAmount'], time_unit=value['timeUnit'], is_enabled=value['isEnabled'],
            object_name_filter=filter_model(inclusion_prefixes=value['objectNameFilter']['inclusionPrefixes'])))
    actual = json.loads(json.dumps(serializer(rows)))
    return {'status': 'DIAGNOSED_NOT_REPAIRED', 'controllerInputItems': inputs,
        'installedCliSerializedItems': actual, 'currentStrictEquality': actual == inputs,
        'existingControllerWouldFailEquality': actual != inputs,
        'documentedKeyMapping': {'isEnabled': 'is-enabled', 'timeAmount': 'time-amount',
            'timeUnit': 'time-unit', 'objectNameFilter': 'object-name-filter',
            'inclusionPrefixes': 'inclusion-prefixes'},
        'additionalModelDefaultNullFields': ['object-name-filter.exclusion-patterns',
            'object-name-filter.inclusion-patterns'],
        'nativeCalls': 0, 'iamWrites': 0, 'lifecycleWrites': 0, 'controllerEdits': 0,
        'assertionsChanged': False, 'repairApplied': False}


def main():
    # These imports instantiate no signer/client and read no config. HOME is
    # additionally isolated by the explicit operator command used for evidence.
    from oci_cli import cli_util
    from oci.object_storage.models import ObjectLifecycleRule, ObjectNameFilter
    from oci.object_storage.object_storage_client import ObjectStorageClient
    original = CONTROLLER.read_bytes()
    inputs = retention_from_public_source(original.decode('utf-8'))
    cli_source_path = Path(cli_util.__file__).resolve()
    generated_path = cli_source_path.parents[1] / 'services/object_storage/src/oci_cli_object_storage/generated/objectstorage_cli.py'
    generated_source = generated_path.read_text(encoding='utf-8')
    generated = ast.parse(generated_source)
    functions = [node for node in generated.body if isinstance(node, ast.FunctionDef)
                 and node.name == 'put_object_lifecycle_policy']
    if len(functions) != 1:
        raise ValueError('InstalledPublicLifecycleCliFunctionRequired')
    put_source = ast.get_source_segment(generated_source, functions[0])
    serializer_source = inspect.getsource(cli_util.to_dict)
    sdk_put_source = inspect.getsource(ObjectStorageClient.put_object_lifecycle_policy)
    comparison = compare_cli_rows(inputs, cli_util.to_dict, ObjectLifecycleRule, ObjectNameFilter)
    if comparison['currentStrictEquality'] is not False:
        raise ValueError('ExpectedCurrentControllerMismatchNotReproduced')
    journal = Journal(SLOT)
    journal.put('public-source-versions.json', {'ociSdkVersion': metadata.version('oci'),
        'ociCliVersion': metadata.version('oci-cli'), 'controllerSHA256': sha(original),
        'cliSerializerSourceSHA256': sha(serializer_source.encode()),
        'cliSerializerFunction': 'oci_cli.cli_util.to_dict',
        'cliGeneratedLifecycleFunction': 'put_object_lifecycle_policy',
        'cliGeneratedLifecycleSourceSHA256': sha(put_source.encode()),
        'sdkLifecycleSourceSHA256': sha(sdk_put_source.encode()),
        'reads': 'public repository + installed SDK/CLI package source only',
        'privateFilesRead': 0, 'networkCalls': 0})
    journal.put('serialization-mismatch.json', comparison)
    journal.put('additional-public-cli-findings.json', {
        'status': 'DIAGNOSED_NOT_REPAIRED',
        'cliPromptsForConfirmationWhenItemsAndNotForce':
            'if not force:' in put_source and 'if items:' in put_source and 'click.confirm(' in put_source,
        'controllerPassesForce': "['--force']" in original.decode() or "'--force'," in original.decode(),
        'cliSupportsIfNoneMatch': 'if_none_match' in put_source,
        'sdkDocumentsIfNoneMatchStarToRefuseExistingResource':
            "The only valid value is '*'" in sdk_put_source and 'if_none_match' in sdk_put_source,
        'finding': 'Current put-lifecycle command has neither explicit confirmation nor a create-only precondition; no command was run',
        'repairApplied': False, 'nativeCalls': 0})
    if CONTROLLER.read_bytes() != original:
        raise ValueError('PublicControllerChangedDuringDiagnosis')
    result = {'status': 'DIAGNOSED_NOT_REPAIRED', 'existingControllerWouldFailEquality': True,
        'controllerSHA256Before': sha(original), 'controllerSHA256After': sha(CONTROLLER.read_bytes()),
        'nativeCalls': 0, 'cloudWrites': 0, 'privateFilesRead': 0, 'repairApplied': False}
    manifest = journal.seal(result)
    print(json.dumps({'status': result['status'], 'manifestSHA256': manifest}))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
