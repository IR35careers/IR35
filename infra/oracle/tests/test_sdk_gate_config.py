import json
import hashlib
from pathlib import Path
import sys
import unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from sdk_gate_config import sdk_block,literal_sdk,instrument_sdk,redact_adapted,instrument_edge
import staging_stack
import web_stack


class SDKConfigTests(unittest.TestCase):
    def test_negative_fixture_is_exact_frozen_pre_repair_sdk_block(self):
        repo=Path(__file__).resolve().parents[3]
        # Frozen pre-repair 32066ca SDK handle; independent of shallow CI Git
        # history / Windows-managed worktree metadata. This is a negative control.
        actual=(repo/'infra/oracle/fixtures/sdk-before.caddy').read_text()
        self.assertEqual(hashlib.sha256(actual.encode()).hexdigest(),'a7af757b2c5aff2e7429210e1fee364a4afb1b1485bbf86c03b3f493a48a149c')

    def test_only_sdk_child_order_gets_literal_route_and_guard_is_not_weakened(self):
        block=(Path(__file__).resolve().parents[1]/'fixtures/sdk-before.caddy').read_text()
        fixed=literal_sdk(block)
        self.assertEqual([s.strip() for s in block.splitlines()][1:-1],[s.strip() for s in fixed.splitlines()][2:-2])
        result=instrument_edge(web_stack.caddyfile(staging_stack.CADDYFILE))
        self.assertIn('handle @sdk {\n            route {',result)
        for value in ('SameSite=Strict','HttpOnly','Secure','basic_auth','noindex','no-store','X-Caddy-Request-ID','sdk-guard','sdk-proxy','sdk-fallback'):
            self.assertIn(value,result)
        with self.assertRaises(RuntimeError):literal_sdk(fixed)

    def test_adapted_projection_redacts_every_occurrence(self):
        value={'a':['hash-example','gate-example',{'cookie':'prefix gate-example; Secure'}]}
        result=redact_adapted(value,{'hash-example':'<hash>','gate-example':'<gate>'})
        self.assertNotIn('example',json.dumps(result));self.assertIn('Secure',json.dumps(result))

    def test_runtime_sdk_block_is_the_exact_private_positive_control(self):
        original=(Path(__file__).resolve().parents[1]/'fixtures/sdk-before.caddy').read_text()
        self.assertEqual(sdk_block(instrument_edge(web_stack.caddyfile(staging_stack.CADDYFILE))),instrument_sdk(literal_sdk(original)))


if __name__=='__main__':unittest.main()
