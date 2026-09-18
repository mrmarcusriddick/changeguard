import importlib.util
import os
from pathlib import Path
import subprocess
import unittest

spec = importlib.util.spec_from_file_location('probe_command', 'scripts/ci/probe-command.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class ProbeCommandTests(unittest.TestCase):
    def azure_wrapper(self, command):
        # Reproduce init_container.sh's eval, capturing the argument passed to Oryx.
        wrapper = '''oryx() { while [ "$#" -gt 0 ]; do
          if [ "$1" = "-userStartupCommand" ]; then printf '%s' "$2"; return; fi
          shift
        done; }
        eval "$ORYX_COMMAND"'''
        return subprocess.run(['bash', '-c', wrapper], env={**os.environ,
            'ORYX_COMMAND': "oryx create-script -userStartupCommand '" + command + "'"},
            capture_output=True, text=True, check=True).stdout

    def test_both_shell_layers_preserve_javascript(self):
        command = module.startup_command('console.log("probe-ready")')
        generated = self.azure_wrapper(command)
        self.assertEqual(generated, command)
        output = subprocess.run(['sh', '-c', generated], capture_output=True, text=True, check=True)
        self.assertEqual(output.stdout, 'probe-ready\n')

    def test_real_probe_fits_and_survives_azure_wrapper(self):
        source = Path('scripts/ci/probe-worker.mjs').read_text().replace('__NONCE__', 'a' * 32)
        command = module.startup_command(source)
        self.assertLessEqual(len(command), 1024)
        self.assertEqual(self.azure_wrapper(command), command)

    def test_unsafe_source_rejected(self):
        for source in ("console.log('bad')", 'console.log(`bad`)', 'console.log("$HOME")', 'a\nb'):
            with self.subTest(source=source), self.assertRaises(ValueError):
                module.startup_command(source)

if __name__ == '__main__':
    unittest.main()
