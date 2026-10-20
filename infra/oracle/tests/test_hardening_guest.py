import base64
import copy
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import hardening_guest as guest
import p2_harden
from key_ceremony import KeySafetyError


def config():
    return {"uuid": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "ownerCIDR": "8.8.8.8/32", "bastionCIDR": "10.35.1.8/32",
            "publicKey": "ssh-ed25519 " + base64.b64encode(b"\0\0\0\x0bssh-ed25519\0\0\0\x20" + b"\0" * 32).decode()}


class HardeningTests(unittest.TestCase):
    def test_public_inputs_reject_broad_ssh_wrong_target_private_keys_and_extra_fields(self):
        self.assertEqual(guest.public_config(config()), config())
        for field, value in (("ownerCIDR", "0.0.0.0/0"), ("ownerCIDR", "10.0.0.1/32"), ("bastionCIDR", "8.8.8.8/32"),
                             ("bastionCIDR", "10.35.1.0/24"), ("uuid", "different"), ("publicKey", "PRIVATE KEY")):
            with self.assertRaises((RuntimeError, ValueError)):
                guest.public_config({**config(), field: value})
        with self.assertRaises(RuntimeError):
            guest.public_config({**config(), "password": "never-accepted"})

    def test_mount_guard_fails_closed_for_missing_wrong_uuid_or_wrong_mount(self):
        with patch.object(guest, "run", return_value=""):
            with self.assertRaisesRegex(RuntimeError, "mount identity mismatch"):
                guest.mount_proof(config())
        with patch.object(guest, "run", return_value=config()["uuid"] + " ext4 /opt/ir35/data"):
            self.assertTrue(guest.mount_proof(config()))
        source = guest.docker_guard(config()["uuid"])
        compile(source, "guard", "exec")
        self.assertNotIn("mount(", source)
        self.assertIn("sys.exit", source)

    def test_persistent_image_ssh_rule_is_restricted_without_changing_other_rules(self):
        text = "*filter\n-A INPUT -p tcp -m tcp --dport 22 -j ACCEPT\n-A INPUT -i lo -j ACCEPT\nCOMMIT\n"
        result = guest.restrict_platform_ssh(text, config()["ownerCIDR"], config()["bastionCIDR"])
        self.assertNotIn("-A INPUT -p tcp -m tcp --dport 22 -j ACCEPT", result)
        self.assertIn("-A INPUT -i lo -j ACCEPT", result)
        self.assertEqual(result.count("--dport 22"), 2)
        self.assertEqual(guest.restrict_platform_ssh(result, config()["ownerCIDR"], config()["bastionCIDR"]), result)

    def test_docker_forwarding_guard_limits_original_public_ports(self):
        script = guest.firewall_script("ens3")
        self.assertIn("--ctorigdstport 80", script)
        self.assertIn("--ctorigdstport 443", script)
        self.assertIn("-i ens3 -j DROP", script)
        self.assertNotIn("--ctorigdstport 22", script)
        subprocess.run(["sh", "-n"], input=script, text=True, check=True)
        with self.assertRaises(RuntimeError):
            guest.firewall_script("ens3; arbitrary")

    def test_ufw_hook_precedes_platform_reject_without_widening_ingress(self):
        script = guest.ufw_order_script()
        self.assertIn('-I INPUT 1 -j "$chain"', script)
        self.assertIn("chain=ufw-before-input", script)
        self.assertIn("chain=ufw6-before-input", script)
        self.assertIn("iptables ip6tables", script)
        self.assertNotIn("ACCEPT", script)
        self.assertNotIn("0.0.0.0", script)
        subprocess.run(["sh", "-n"], input=script, text=True, check=True)

    def test_ipv6_filter_enablement_preserves_other_settings_and_requires_known_format(self):
        text = "# existing configuration\nIPV6=no\nDEFAULT_FORWARD_POLICY=DROP\n"
        self.assertEqual(guest.ufw_ipv6_defaults(text), text.replace("IPV6=no", "IPV6=yes"))
        self.assertEqual(guest.ufw_ipv6_defaults(guest.ufw_ipv6_defaults(text)), guest.ufw_ipv6_defaults(text))
        for invalid in ("", "IPV6=unknown\n", "IPV6=yes\nIPV6=no\n"):
            with self.assertRaises(RuntimeError):
                guest.ufw_ipv6_defaults(invalid)

    def test_retries_are_durable_and_never_exceed_three_attempts(self):
        state = {}
        for index in (1, 2, 3):
            self.assertEqual(p2_harden.next_attempt(state, "configure", "hash")["attempts"], index)
        with self.assertRaisesRegex(KeySafetyError, "three times"):
            p2_harden.next_attempt(copy.deepcopy(state), "configure", "hash")

    def test_listener_audit_handles_loopback_zones_without_hiding_wildcard_private_ports(self):
        rows = "LISTEN 0 1 127.0.0.53%lo:53 0.0.0.0:*\nLISTEN 0 1 [::1]:5432 [::]:*\nLISTEN 0 1 0.0.0.0:22 0.0.0.0:*\n"
        self.assertEqual(guest.public_tcp_ports(rows), [22])
        self.assertEqual(guest.public_tcp_ports(rows + "LISTEN 0 1 [::]:5432 [::]:*\n"), [22, 5432])

    def test_real_ssh_repeated_users_and_swap_text_formats_are_preserved(self):
        settings = guest.ssh_settings("permitrootlogin no\nallowusers ubuntu\nallowusers ir35\npasswordauthentication no\n")
        self.assertEqual(settings["allowusers"], ["ubuntu", "ir35"])
        self.assertEqual(guest.ssh_settings("allowusers ubuntu ir35\n")["allowusers"], ["ubuntu", "ir35"])
        self.assertEqual(guest.swap_rows("/swapfile 4294963200\n"), [{"name": "/swapfile", "size": 4294963200}])
        with patch.object(guest, "run", return_value="/swapfile 4294963200\n") as command:
            self.assertEqual(guest.swaps()[0]["size"], 4294963200)
            self.assertEqual(command.call_args.args[0], ["swapon", "--show=NAME,SIZE", "--bytes", "--noheadings", "--raw"])
        for invalid in ("/swapfile unknown\n", "missing-size\n", "relative 1\n"):
            with self.assertRaises(RuntimeError):
                guest.swap_rows(invalid)

    def test_unused_rpc_guard_refuses_nfs_or_another_listener(self):
        guest.unused_rpc_guard("ext4\ntmpfs\n", 'LISTEN 0 1 0.0.0.0:111 *:* users:(("rpcbind",pid=1))\n')
        with self.assertRaises(RuntimeError):
            guest.unused_rpc_guard("ext4\nnfs4\n", "")
        with self.assertRaises(RuntimeError):
            guest.unused_rpc_guard("ext4", 'LISTEN 0 1 *:111 *:* users:(("other",pid=1))')

    def test_external_probe_requires_positive_control_and_closed_private_ports(self):
        def connect(address, timeout):
            if address[1] == 22:
                return MagicMock()
            raise TimeoutError()
        with patch.object(p2_harden.socket, "create_connection", side_effect=connect) as call:
            report = p2_harden.external_exposure("8.8.8.8")
            self.assertTrue(report["sshPositiveControl"])
            self.assertEqual(report["privateTCPPortsUnreachable"], list(p2_harden.PRIVATE_PORTS))
            self.assertEqual(call.call_count, 1 + len(p2_harden.PRIVATE_PORTS))
        with patch.object(p2_harden.socket, "create_connection", return_value=MagicMock()):
            with self.assertRaisesRegex(KeySafetyError, "reachable staging TCP port: 111"):
                p2_harden.external_exposure("8.8.8.8")
        with patch.object(p2_harden.socket, "create_connection", side_effect=TimeoutError()) as call:
            with self.assertRaises(TimeoutError):
                p2_harden.external_exposure("8.8.8.8")
            self.assertEqual(call.call_count, 1)
        with patch.object(p2_harden.socket, "create_connection") as call:
            with self.assertRaises(KeySafetyError):
                p2_harden.external_exposure("127.0.0.1")
            call.assert_not_called()


if __name__ == "__main__":
    unittest.main()
