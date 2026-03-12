import importlib
import json
import os
import io
import sys
import tempfile
import threading
import time
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
        self.config = importlib.import_module('PairOfCleats.lib.config')
        self.tasks = importlib.import_module('PairOfCleats.lib.tasks')
        self.tasks.clear_all()

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

    def test_cancel_terminates_running_process_and_updates_progress(self):
        proc = _FakeLongRunningProcess(wait_seconds=0.2)
        done = threading.Event()
        handle = self.runner.run_process(
            'fake-command',
            [],
            window=self.window,
            title='PairOfCleats search',
            stream_output=False,
            spawn_process=lambda *args, **kwargs: proc,
            on_done=lambda result: done.set(),
        )
        handle.cancel()
        self.assertTrue(done.wait(5), 'cancelled runner did not complete in time')
        self.assertEqual(proc.terminated, 1)
        panel = self.window.panels[self.tasks.TASK_PANEL]
        self.assertIn('[cancelled] pairofcleats search', panel.appended.lower())

    def test_watchdog_marks_silent_long_running_process(self):
        proc = _FakeLongRunningProcess(wait_seconds=0.08)
        done = threading.Event()
        self.runner.run_process(
            'fake-command',
            [],
            window=self.window,
            title='PairOfCleats map',
            stream_output=False,
            watchdog_ms=20,
            spawn_process=lambda *args, **kwargs: proc,
            on_done=lambda result: done.set(),
        )
        self.assertTrue(done.wait(5), 'silent runner did not complete in time')
        panel = self.window.panels[self.tasks.TASK_PANEL]
        self.assertIn('watchdog:', panel.appended)
        self.assertTrue(any('still running' in message.lower() for message in self.sublime.status_history))

    def test_progress_panel_setting_can_disable_auto_show(self):
        settings = self.sublime.load_settings(self.config.SETTINGS_FILE)
        settings.set('progress_panel_on_start', False)
        proc = _FakeLongRunningProcess(wait_seconds=0.02)
        done = threading.Event()
        self.runner.run_process(
            'fake-command',
            [],
            window=self.window,
            title='PairOfCleats search',
            stream_output=False,
            spawn_process=lambda *args, **kwargs: proc,
            on_done=lambda result: done.set(),
        )
        self.assertTrue(done.wait(5), 'runner did not complete in time')
        show_panel_commands = [entry for entry in self.window.commands if entry['name'] == 'show_panel']
        self.assertEqual(show_panel_commands, [])


class _FakeLongRunningProcess:
    def __init__(self, wait_seconds=0.1):
        self.stdout = io.StringIO('')
        self.stderr = io.StringIO('')
        self.returncode = None
        self.terminated = 0
        self.killed = 0
        self._wait_seconds = wait_seconds

    def poll(self):
        return self.returncode

    def wait(self):
        time.sleep(self._wait_seconds)
        if self.returncode is None:
            self.returncode = 0
        return self.returncode

    def terminate(self):
        self.terminated += 1
        self.returncode = -15

    def kill(self):
        self.killed += 1
        self.returncode = -9


if __name__ == '__main__':
    unittest.main()
