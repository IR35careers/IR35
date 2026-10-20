import contextlib
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
import subprocess
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import host_identity_iam as iam
import host_identity_repair as repair
from key_ceremony import KeySafetyError
from visibility import OciError

VM = "ocid1.instance.oc1.uk-london-1.controlledfixture01"
CHILD = "ocid1.compartment.oc1..controlledfixture01"
ROOT = "ocid1.tenancy.oc1..controlledfixture01"


class TemporaryIamTests(unittest.TestCase):
    def test_cleanup_deletes_exact_owned_policy_once_then_proves_get_and_list_absence(self):
        payload = iam.specs(VM, CHILD, ROOT, "fixture")["policy"]
        identifier = "ocid1.policy.oc1..controlledfixture01"
        row = {iam.re.sub(r"[A-Z]", lambda m: "-" + m[0].lower(), key): value for key, value in payload.items()}
        row.update(id=identifier, **{"lifecycle-state": "ACTIVE"})
        state = {"temporaryIam": {"policy": {"id": identifier}}}
        with tempfile.TemporaryDirectory() as directory, patch.object(repair, "STATE", Path(directory) / "state.json"), \
                patch.object(iam.infra, "invoke", side_effect=[row, OciError("get", "NotAuthorizedOrNotFound", 404), []]), \
                patch.object(iam, "ensure_session"), patch.object(iam.subprocess, "run", return_value=subprocess.CompletedProcess([], 0, "", "")) as delete, \
                contextlib.redirect_stdout(io.StringIO()):
            iam.remove_one(state, "policy", payload)
        self.assertTrue(state["temporaryIam"]["policy"]["deleted"])
        self.assertEqual(delete.call_count, 1)
        self.assertIn(identifier, delete.call_args.args[0])
        self.assertEqual(delete.call_args.args[0][-5:], ["policy", "delete", "--policy-id", identifier, "--force"])

    def test_absent_block_and_cleanup_are_required_before_any_iam_call(self):
        for console in ({}, {"readComplete": True, "fingerprintBlockPresent": True, "deleted": True},
                        {"readComplete": True, "fingerprintBlockPresent": False, "deleted": False}):
            with patch.object(iam.infra, "invoke") as api:
                with self.assertRaisesRegex(KeySafetyError, "approved ONLY"):
                    iam.temporary_fallback({"console": console}, {}, {}, None)
                api.assert_not_called()

    def test_membership_is_one_vm_and_permission_only_own_execution(self):
        payload = iam.specs(VM, CHILD, ROOT, "fixture")
        self.assertEqual(payload["group"]["matchingRule"], "ALL {instance.id = '" + VM + "'}")
        self.assertEqual(payload["policy"]["compartmentId"], CHILD)
        self.assertEqual(payload["policy"]["statements"], ["Allow dynamic-group ir35-hostkey-temporary to use instance-agent-command-execution-family in compartment ir35 where request.instance.id=target.instance.id"])
        self.assertNotIn("manage", json.dumps(payload))
        self.assertEqual(iam.SCRIPT, "#!/bin/bash\nset -eu\n/usr/bin/ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub -E sha256\n")

    def test_reuse_exact_group_does_not_create_or_recheck_create_budget(self):
        payload = iam.specs(VM, CHILD, ROOT, "fixture")["group"]
        row = {iam.re.sub(r"[A-Z]", lambda m: "-" + m[0].lower(), key): value for key, value in payload.items()}
        row.update(id="ocid1.dynamicgroup.oc1..controlledfixture01", **{"lifecycle-state": "ACTIVE"})
        calls = []
        def invoke(arguments):
            calls.append(arguments)
            return [row] if arguments[2] == "list" else row
        with tempfile.TemporaryDirectory() as directory, patch.object(repair, "STATE", Path(directory) / "state.json"), \
                patch.object(iam.infra, "invoke", side_effect=invoke), contextlib.redirect_stdout(io.StringIO()):
            iam.ensure_one({}, "group", payload, lambda: self.fail("no create budget call"))
        self.assertFalse(any(arguments[2] == "create" for arguments in calls))

    def test_fingerprint_output_is_bound_to_command_instance_success(self):
        command = "ocid1.instanceagentcommand.oc1.uk-london-1.controlledfixture01"
        row = {"instance-agent-command-id": command, "instance-id": VM, "lifecycle-state": "SUCCEEDED",
               "content": {"output-type": "TEXT", "exit-code": 0, "text": "256 SHA256:" + "a" * 43 + " root@fixture (ED25519)\n"}}
        self.assertEqual(iam.parse_public_output(row, command, VM), {"algorithm": "ed25519", "fingerprint": "SHA256:" + "a" * 43})
        for bad in ({**row, "instance-id": "other"}, {**row, "lifecycle-state": "FAILED"},
                    {**row, "content": {"output-type": "TEXT", "exit-code": 0, "text": "private-sentinel"}}):
            with self.assertRaises(KeySafetyError) as error:
                iam.parse_public_output(bad, command, VM)
            self.assertNotIn("private-sentinel", str(error.exception))

    def test_cleanup_rejects_changed_policy_before_delete(self):
        payload = iam.specs(VM, CHILD, ROOT, "fixture")["policy"]
        state = {"temporaryIam": {"policy": {"id": "ocid1.policy.oc1..controlledfixture01"}}}
        with patch.object(iam.infra, "invoke", return_value={"statements": ["manage all-resources"]}), patch.object(iam.subprocess, "run") as delete:
            with self.assertRaises(KeySafetyError):
                iam.remove_one(state, "policy", payload)
            delete.assert_not_called()


if __name__ == "__main__":
    unittest.main()
