"""Verify the Windows gateway launcher without installing packages or running a model."""
import os
from pathlib import Path
import subprocess
import tempfile
import unittest


@unittest.skipUnless(os.name == "nt", "CMD launchers require Windows")
class GatewayLauncherTests(unittest.TestCase):
    def run_launcher(self, dependencies=0, installation=0, startup=0):
        with tempfile.TemporaryDirectory(prefix="aigw-launcher-") as directory:
            folder = Path(directory)
            log = folder / "commands.txt"
            (folder / "npm.cmd").write_text(
                '@echo off\n'
                'echo %*>>"%AIGW_TEST_LOG%"\n'
                f'if "%1"=="ls" exit /b {dependencies}\n'
                f'if "%1"=="ci" exit /b {installation}\n'
                f'if "%1"=="start" exit /b {startup}\n'
                'exit /b 99\n'
            )
            environment = {**os.environ, "PATH": directory + os.pathsep + os.environ["PATH"], "AIGW_TEST_LOG": str(log)}
            launcher = Path(__file__).resolve().parents[1] / "run-aigw.cmd"
            result = subprocess.run(
                [os.environ.get("COMSPEC", "cmd.exe"), "/d", "/c", str(launcher)],
                cwd=directory, env=environment, capture_output=True, text=True, timeout=30,
            )
            self.assertTrue(log.exists(), result.stdout + result.stderr)
            return result, log.read_text().splitlines()

    def test_installed_dependencies_are_reused(self):
        result, commands = self.run_launcher()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(commands, ["ls --omit=dev --all", "start"])

    def test_missing_dependencies_are_installed_before_start(self):
        result, commands = self.run_launcher(dependencies=1)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(commands, ["ls --omit=dev --all", "ci --no-audit --no-fund", "start"])

    def test_failed_installation_does_not_start_gateway(self):
        result, commands = self.run_launcher(dependencies=1, installation=1)
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn("start", commands)

    def test_gateway_exit_status_is_propagated(self):
        result, commands = self.run_launcher(startup=7)
        self.assertEqual(result.returncode, 7)
        self.assertEqual(commands[-1], "start")


if __name__ == "__main__":
    unittest.main()
