import copy
from pathlib import Path
import sys
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import p8_webqa_config as config
from test_p8_webqa_config import PRISTINE, native_proof, inputs, pins

NEXT_SOURCE = 'c1ccd56d2e030c80dac7979d761447f82dd2ea46'  # Public committed source, not a claim it was built.


def proof_at(sha):
    proof = copy.deepcopy(native_proof())
    for row in (proof, proof['web'], proof['worker']): row['sourceSHA'] = sha
    return proof


class QaSourceBindingTests(unittest.TestCase):
    def test_new_images_require_explicit_expected_source_and_all_nested_proofs_match(self):
        proof = proof_at(NEXT_SOURCE)
        with self.assertRaises(config.ConfigError): config.image_pair(proof)
        images = config.image_pair(proof, expected_source_sha=NEXT_SOURCE)
        self.assertEqual(images['sourceSHA'], NEXT_SOURCE)
        for side in ('web', 'worker'):
            changed = copy.deepcopy(proof); changed[side]['sourceSHA'] = config.BUILD_SHA
            with self.assertRaises(config.ConfigError): config.image_pair(changed, expected_source_sha=NEXT_SOURCE)
        with self.assertRaises(config.ConfigError): config.image_pair(native_proof(), expected_source_sha=NEXT_SOURCE)

    def test_historical_exact_proof_and_default_binding_stay_unchanged(self):
        self.assertEqual(config.BUILD_SHA, '679dc8c234c525e9ebb246d2efbea857b6a5b660')
        self.assertEqual(config.image_pair(native_proof())['sourceSHA'], config.BUILD_SHA)

    def test_env_and_compose_reject_old_or_new_mixed_source_and_use_one_exact_attested_source(self):
        args = inputs(); args[7] = config.image_pair(proof_at(NEXT_SOURCE), expected_source_sha=NEXT_SOURCE)
        with self.assertRaises(config.ConfigError): config.environments(*args)
        with self.assertRaises(config.ConfigError): config.compose(args[7], pins())
        values = config.environments(*args, expected_source_sha=NEXT_SOURCE)
        for name in ('web', 'worker'): self.assertEqual(values[name]['IR35_BUILD_SHA'], NEXT_SOURCE)
        plan = config.compose(args[7], pins(), expected_source_sha=NEXT_SOURCE)
        self.assertTrue(all(row['labels']['ir35.image-source'] == NEXT_SOURCE for row in plan['services'].values()))

    def test_owned_drop_annotation_cannot_drift_to_another_source_or_original_target(self):
        target = config.database_name(PRISTINE); comment = config.PROJECT + ':' + NEXT_SOURCE + ':' + 'a' * 64
        with self.assertRaises(config.ConfigError): config.assert_owned_database(PRISTINE, target, comment, comment, '0')
        config.assert_owned_database(PRISTINE, target, comment, comment, '0', expected_source_sha=NEXT_SOURCE)
        for observed, connections in ((comment.replace(NEXT_SOURCE, config.BUILD_SHA), '0'), (comment, '1')):
            with self.assertRaises(config.ConfigError):
                config.assert_owned_database(PRISTINE, target, observed, comment, connections, expected_source_sha=NEXT_SOURCE)

    def test_untrusted_sha_shape_cannot_select_any_source(self):
        for bad in (None, '', 'main', 'A' * 40, 'a' * 40 + '\n', 'a' * 39):
            with self.assertRaises(config.ConfigError): config.image_pair(native_proof(), expected_source_sha=bad)
