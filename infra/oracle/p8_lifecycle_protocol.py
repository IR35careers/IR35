"""Strict, offline OCI lifecycle wire protocol for the 31-Oct owner allowance.

Input is OCI CLI kebab-case output, not the camel-case CLI request. Only the
two documented optional pattern defaults are normalised; no other difference
is ignored. This module does not import OCI, local credentials or native I/O.
"""
import json
import re

BUCKET = 'ir35-backups'
PREFIX = 'ir35-backups-v1'


class ProtocolError(RuntimeError):
    """Fixed codes only; untrusted CLI values never escape in an exception."""


def approved_items():
    return [{'name': 'ir35-' + lane + '-expiry', 'target': 'objects',
             'action': 'DELETE', 'timeAmount': days, 'timeUnit': 'DAYS',
             'isEnabled': True,
             'objectNameFilter': {'inclusionPrefixes': [PREFIX + '/' + lane + '/']}}
            for lane, days in (('daily', 7), ('weekly', 28))]


def normalize_cli_items(items):
    """Validate the complete policy; return the exact approved request shape.

    OCI SDK 2.188.0 serialises absent inclusion/exclusion patterns as null;
    absent/null/empty lists all mean no pattern selection, never a wildcard.
    Unknown keys, non-empty patterns, duplicate/reordered rules and bad types
    fail closed rather than being stripped or sorted into a passing policy.
    """
    if type(items) is not list or len(items) != 2:
        raise ProtocolError('ExactTwoLifecycleRulesRequired')
    required = {'name', 'target', 'action', 'time-amount', 'time-unit',
                'is-enabled', 'object-name-filter'}
    converted = []
    for item in items:
        if type(item) is not dict or set(item) != required:
            raise ProtocolError('ExactLifecycleRuleFieldsRequired')
        if (any(type(item[key]) is not str for key in ('name', 'target', 'action', 'time-unit'))
                or type(item['time-amount']) is not int
                or type(item['is-enabled']) is not bool):
            raise ProtocolError('ExactLifecycleRuleTypesRequired')
        selector = item['object-name-filter']
        optional = {'inclusion-patterns', 'exclusion-patterns'}
        if (type(selector) is not dict or 'inclusion-prefixes' not in selector
                or set(selector) - ({'inclusion-prefixes'} | optional)):
            raise ProtocolError('ExactOwnedPrefixFilterRequired')
        prefixes = selector['inclusion-prefixes']
        if type(prefixes) is not list or len(prefixes) != 1 or type(prefixes[0]) is not str:
            raise ProtocolError('ExactOwnedPrefixListRequired')
        for key in optional & set(selector):
            if selector[key] is not None and not (type(selector[key]) is list and not selector[key]):
                raise ProtocolError('NoLifecyclePatternsPermitted')
        converted.append({'name': item['name'], 'target': item['target'],
                          'action': item['action'], 'timeAmount': item['time-amount'],
                          'timeUnit': item['time-unit'], 'isEnabled': item['is-enabled'],
                          'objectNameFilter': {'inclusionPrefixes': prefixes[:]}})
    if converted != approved_items():
        raise ProtocolError('ExactApprovedRetentionPolicyRequired')
    return converted


def namespace(value):
    if type(value) is not str or not re.fullmatch(r'[a-z0-9]{1,63}', value):
        raise ProtocolError('AuthenticatedExactNamespaceRequired')
    return value


def etag(value):
    # HTTP validators are opaque. Preserve quotes/case, but reject header
    # injection, missing values and an unbounded/error payload.
    if (type(value) is not str or not 1 <= len(value) <= 256
            or value == '*' or ',' in value or value.startswith('W/')
            or any(ord(character) < 33 or ord(character) > 126 for character in value)):
        raise ProtocolError('ExactReadbackEtagRequired')
    return value


def lifecycle_arguments(operation, ns, *, expected_etag=None):
    if operation not in ('get', 'create', 'delete-created'):
        raise ProtocolError('LifecycleOperationOutsideOwnerScope')
    verb = {'get': 'get', 'create': 'put', 'delete-created': 'delete'}[operation]
    args = ['os', 'object-lifecycle-policy', verb, '--namespace-name', namespace(ns),
            '--bucket-name', BUCKET]
    if operation == 'create':
        if expected_etag is not None:
            raise ProtocolError('CreateOnlyCannotOverwriteEtag')
        args += ['--items', json.dumps(approved_items(), sort_keys=True, separators=(',', ':')),
                 '--if-none-match', '*', '--force']
    elif operation == 'delete-created':
        args += ['--if-match', etag(expected_etag), '--force']
    elif expected_etag is not None:
        raise ProtocolError('GetDoesNotAcceptMutationPrecondition')
    return args


def response(raw):
    """Keep response metadata separate: data projection must not lose ETag."""
    if type(raw) is not dict or 'data' not in raw or set(raw) - {'data', 'etag', 'opc-request-id'}:
        raise ProtocolError('ExpectedCliDataEnvelopeRequired')
    result = {'data': raw['data']}
    if 'etag' in raw:
        result['etag'] = etag(raw['etag'])
    return result


def list_response(raw):
    """Installed CLI render([]) omits data, even with pagination headers.

    Only the CLI's documented DISPLAY_HEADERS are accepted, with explicit
    types. They are not mistaken for a resource; unknown metadata still fails.
    Native --all callers may return data=[], metadata only, or empty stdout.
    """
    headers = {'etag', 'opc-next-cursor', 'opc-total-items', 'opc-work-request-id', 'opc-next-page'}
    if type(raw) is not dict or set(raw) - ({'data'} | headers):
        raise ProtocolError('ExpectedCliListEnvelopeRequired')
    if 'data' in raw and type(raw['data']) is not list:
        raise ProtocolError('ExpectedCliListDataRequired')
    for key in set(raw) & headers:
        value = raw[key]
        if key == 'etag':
            etag(value)
        elif key == 'opc-total-items':
            if not ((type(value) is int and value >= 0)
                    or (type(value) is str and re.fullmatch(r'[0-9]{1,12}', value))):
                raise ProtocolError('ExpectedCliListTotalRequired')
        elif (type(value) is not str or not 1 <= len(value) <= 4096
                or any(ord(character) < 32 or ord(character) > 126 for character in value)):
            raise ProtocolError('ExpectedCliListCursorMetadataRequired')
    # Every caller uses --all. The installed aggregator preserves final-page
    # headers; a remaining cursor is incomplete, never evidence of absence.
    if 'opc-next-cursor' in raw or 'opc-next-page' in raw:
        raise ProtocolError('AllPagesIamInventoryRequired')
    rows = raw.get('data', [])
    if 'opc-total-items' in raw and int(raw['opc-total-items']) != len(rows):
        raise ProtocolError('IamInventoryTotalMismatch')
    return {'data': rows}
