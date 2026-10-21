import os
from pathlib import Path
import subprocess
import tempfile
import unittest


class EnvExecTests(unittest.TestCase):
    def test_real_compiled_launcher_reads_private_file_and_rejects_leaks_injection_and_symlinks(self):
        source = Path(__file__).resolve().parents[1] / "env-exec.c"
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            output = root / "env-exec"
            prefix = str(root / ".env.")
            subprocess.run(["gcc", "-static", "-Os", "-Wall", "-Wextra", "-Werror", '-DIR35_ENV_PREFIX="' + prefix + '"', str(source), "-o", str(output)], capture_output=True, check=True)
            environment = root / ".env.fixture"
            environment.write_text("IR35_FIXTURE='literal-$()-not-executed'\n")
            environment.chmod(0o600)
            if os.geteuid() == 0:
                os.chown(environment, 1002, 1002)
            result = subprocess.run([str(output), str(environment), "/usr/bin/printenv", "IR35_FIXTURE"], capture_output=True, text=True)
            self.assertEqual(result.returncode, 0)
            self.assertEqual(result.stdout, "literal-$()-not-executed\n")
            self.assertEqual(result.stderr, "")
            for bad in ("IR35_FIXTURE='private-sentinel'\nPATH='/bad'\n", "DUP='a'\nDUP='b'\n", "BROKEN=unquoted\n"):
                environment.write_text(bad)
                result = subprocess.run([str(output), str(environment), "/usr/bin/true"], capture_output=True, text=True)
                self.assertEqual(result.returncode, 111)
                self.assertNotIn("private-sentinel", result.stdout + result.stderr)
            environment.write_text("IR35_FIXTURE='fixture'\n")
            environment.chmod(0o644)
            self.assertEqual(subprocess.run([str(output), str(environment), "/usr/bin/true"], capture_output=True).returncode, 111)
            environment.chmod(0o600)
            link = root / ".env.link"
            link.symlink_to(environment)
            self.assertEqual(subprocess.run([str(output), str(link), "/usr/bin/true"], capture_output=True).returncode, 111)


if __name__ == "__main__":
    unittest.main()
