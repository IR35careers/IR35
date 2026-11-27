import copy
import hashlib
import json
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import p8_lifecycle_protocol as protocol

EVIDENCE = Path(__file__).resolve().parents[3] / 'docs/evidence/p8/lifecycle-cli-shape-diagnosis-20261030-01'
MANIFEST = '13f617824baff855a86c85c7d75b981e1f0c3f0d68c4069c37727ad6ff60b0db'


def captured():
    body = (EVIDENCE / 'manifest.json').read_bytes()
    if hashlib.sha256(body).hexdigest() != MANIFEST:
        raise AssertionError('Captured manifest changed')
    for item in json.loads(body)['artifacts']:
        if hashlib.sha256((EVIDENCE / item['name']).read_bytes()).hexdigest() != item['sha256']:
            raise AssertionError('Captured artifact changed')
    return json.loads((EVIDENCE / 'serialization-mismatch.json').read_bytes())


class LifecycleProtocolTests(unittest.TestCase):
    def setUp(self):
        self.fixture = captured()
        self.items = copy.deepcopy(self.fixture['installedCliSerializedItems'])

    def test_recorded_installed_cli_serialization_matches_approved_input(self):
        self.assertEqual(protocol.normalize_cli_items(self.items), self.fixture['controllerInputItems'])
        self.assertEqual(protocol.approved_items(), self.fixture['controllerInputItems'])

    def test_only_documented_absent_null_empty_pattern_defaults_are_equivalent(self):
        for replacement in (None, []):
            value = copy.deepcopy(self.items)
            for item in value:
                for key in ('exclusion-patterns', 'inclusion-patterns'):
                    item['object-name-filter'][key] = replacement
            self.assertEqual(protocol.normalize_cli_items(value), protocol.approved_items())
        for item in self.items:
            del item['object-name-filter']['exclusion-patterns']
            del item['object-name-filter']['inclusion-patterns']
        self.assertEqual(protocol.normalize_cli_items(self.items), protocol.approved_items())

    def test_nonempty_and_malformed_pattern_fields_never_disappear(self):
        for value in (['*'], [''], '', False, 0, {}, ()):
            for key in ('exclusion-patterns', 'inclusion-patterns'):
                with self.subTest(value=value, key=key):
                    items = copy.deepcopy(self.items)
                    items[0]['object-name-filter'][key] = value
                    with self.assertRaises(protocol.ProtocolError):
                        protocol.normalize_cli_items(items)

    def test_unknown_even_null_fields_fail_closed(self):
        for target in ('rule', 'filter'):
            items = copy.deepcopy(self.items)
            item = items[0] if target == 'rule' else items[0]['object-name-filter']
            item['new-optional-field'] = None
            with self.assertRaises(protocol.ProtocolError):
                protocol.normalize_cli_items(items)

    def test_no_semantic_or_type_difference_is_normalized(self):
        replacements = {'name': 'unowned', 'target': 'multipart-uploads', 'action': 'ARCHIVE',
                        'time-amount': 8, 'time-unit': 'HOURS', 'is-enabled': False,
                        'object-name-filter': None}
        for key, value in replacements.items():
            with self.subTest(key=key):
                items = copy.deepcopy(self.items)
                items[0][key] = value
                with self.assertRaises(protocol.ProtocolError):
                    protocol.normalize_cli_items(items)
        for value in (True, 7.0, '7', None):
            items = copy.deepcopy(self.items)
            items[0]['time-amount'] = value
            with self.assertRaises(protocol.ProtocolError):
                protocol.normalize_cli_items(items)
        for value in ('true', 1, None):
            items = copy.deepcopy(self.items)
            items[0]['is-enabled'] = value
            with self.assertRaises(protocol.ProtocolError):
                protocol.normalize_cli_items(items)

    def test_empty_duplicate_reordered_and_broad_prefixes_fail(self):
        bad = [[], self.items[:1], self.items * 2, self.items[::-1], [self.items[0], self.items[0]]]
        for prefixes in (None, [], [''], ['ir35-backups-v1/'], ['ir35-backups-v1/daily/*'],
                         ['ir35-backups-v1/daily/', 'extra/'], 'ir35-backups-v1/daily/'):
            items = copy.deepcopy(self.items)
            items[0]['object-name-filter']['inclusion-prefixes'] = prefixes
            bad.append(items)
        for value in bad:
            with self.subTest(value=value), self.assertRaises(protocol.ProtocolError):
                protocol.normalize_cli_items(value)

    def test_create_is_exact_noninteractive_create_only(self):
        args = protocol.lifecycle_arguments('create', 'knownnamespace')
        self.assertEqual(args[:7], ['os', 'object-lifecycle-policy', 'put', '--namespace-name',
                                   'knownnamespace', '--bucket-name', 'ir35-backups'])
        self.assertEqual(args[-3:], ['--if-none-match', '*', '--force'])
        self.assertEqual(json.loads(args[args.index('--items') + 1]), protocol.approved_items())
        self.assertNotIn('--if-match', args)
        for value in ('other namespace', '../bad', 'NS', '', None):
            with self.assertRaises(protocol.ProtocolError):
                protocol.lifecycle_arguments('create', value)

    def test_envelope_preserves_etag_and_rejects_header_injection(self):
        self.assertEqual(protocol.response({'data': {'items': self.items}, 'etag': '"abc"'})['etag'], '"abc"')
        for value in ('', None, '*', 'a,b', '"a","b"', 'W/"weak"', '*\r\npassword=secret', ' '):
            with self.assertRaises(protocol.ProtocolError) as caught:
                protocol.lifecycle_arguments('delete-created', 'knownnamespace', expected_etag=value)
            self.assertNotIn('password', str(caught.exception))
            self.assertNotIn('secret', str(caught.exception))

    def test_fake_executor_uses_actual_serialized_response_without_weakening(self):
        calls = []
        def fake(args):
            calls.append(args)
            return {'data': {'items': copy.deepcopy(self.items)}, 'etag': '"etag"'}
        reply = protocol.response(fake(protocol.lifecycle_arguments('create', 'knownnamespace')))
        self.assertEqual(protocol.normalize_cli_items(reply['data']['items']), protocol.approved_items())
        self.assertEqual(len(calls), 1)
        reply['data']['items'][0]['action'] = 'ARCHIVE'
        with self.assertRaises(protocol.ProtocolError):
            protocol.normalize_cli_items(reply['data']['items'])
        self.assertEqual(len(calls), 1)

    def test_cli_empty_list_can_have_typed_known_display_headers_only(self):
        for value in ({}, {'data': []}, {'opc-total-items': '0'}, {'data': [], 'opc-total-items': 0}):
            self.assertEqual(protocol.list_response(value), {'data': []})
        for value in ({'data': None}, {'data': {}}, {'data': [], 'unknown': None},
                      {'opc-total-items': False}, {'opc-total-items': '-1'},
                      {'opc-total-items': '1'}, {'data': [], 'opc-total-items': 1},
                      {'data': [{'id': 'public'}], 'opc-total-items': '2'},
                      {'opc-next-page': None}, {'opc-next-page': 'remaining'},
                      {'opc-next-cursor': 'remaining', 'opc-total-items': 0},
                      {'opc-work-request-id': 'bad\nheader'}):
            with self.assertRaises(protocol.ProtocolError):
                protocol.list_response(value)
        self.assertEqual(protocol.list_response({'data': [{'id': 'public'}], 'opc-total-items': '1'}),
                         {'data': [{'id': 'public'}]})


if __name__ == '__main__':
    unittest.main()
