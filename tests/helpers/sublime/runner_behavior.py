import importlib
import json
import os
import sys
import tempfile
import threading
import unittest

sys.path.insert(0, os.path.dirname(__file__))

from runtime_harness import FakeWindow, install_fake_modules


class RunnerBehaviorTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.sublime, _ = install_fake_modules()
        cls.runner = importlib.import_module('PairOfCleats.lib.runner')

    def setUp(self):
        self.sublime.reset()
        self.window = FakeWindow()
        self.sublime.set_active_window(self.window)

    def test_capture_json_parses_stdout_and_preserves_stderr_output(self):
        with tempfile.TemporaryDirectory() as tmp:
            script_path = os.path.join(tmp, 'emit_json.py')
            with open(script_path, 'w', encoding='utf-8') as handle:
                handle.write(
                    'import json, sys\n'
                    'sys.stderr.write("warning on stderr\\n")\n'
                    'sys.stdout.write(json.dumps({"ok": True, "value": 7}))\n'
                )

            result_holder = {}
            done = threading.Event()

            self.runner.run_process(
                sys.executable,
                [script_path],
                window=self.window,
                capture_json=True,
                stream_output=True,
                panel_name='pairofcleats-test',
                on_done=lambda result: (result_holder.update({'result': result}), done.set()),
            )

            self.assertTrue(done.wait(5), 'runner did not complete in time')
            result = result_holder['result']
            self.assertEqual(result.returncode, 0)
            self.assertIsNone(result.error)
            self.assertEqual(result.payload, {'ok': True, 'value': 7})
            self.assertIn('warning on stderr', result.output)
            panel = self.window.panels['pairofcleats-test']
            self.assertIn('warning on stderr', panel.appended)


if __name__ == '__main__':
    unittest.main()
