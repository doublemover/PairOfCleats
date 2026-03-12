import importlib
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(__file__))

from runtime_harness import FakeWindow, install_fake_modules


class IndexBehaviorTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.sublime, _ = install_fake_modules()
        cls.index = importlib.import_module('PairOfCleats.commands.index')

    def setUp(self):
        self.sublime.reset()
        self.window = FakeWindow()
        self.sublime.set_active_window(self.window)
        self.runner_calls = []
        self._originals = {
            'get_settings': self.index.config.get_settings,
            'validate_settings': self.index.config.validate_settings,
            'resolve_cli': self.index.paths.resolve_cli,
            'build_env': self.index.config.build_env,
            'run_process': self.index.runner.run_process,
            'record_last_build': self.index.index_state.record_last_build,
        }
        self.index.config.get_settings = lambda _window: {
            'index_watch_mode': 'all',
            'index_watch_scope': 'repo',
            'index_watch_poll_ms': 2500,
            'index_watch_debounce_ms': 500,
        }
        self.index.config.validate_settings = lambda _settings, _repo_root: []
        self.index.paths.resolve_cli = lambda _settings, _repo_root: {
            'command': 'pairofcleats',
            'args_prefix': [],
            'source': 'path',
        }
        self.index.config.build_env = lambda _settings: {}
        self.index.index_state.record_last_build = lambda *_args, **_kwargs: None
        self.index.runner.run_process = self._run_process

    def tearDown(self):
        for key, value in self._originals.items():
            if key == 'get_settings':
                self.index.config.get_settings = value
            elif key == 'validate_settings':
                self.index.config.validate_settings = value
            elif key == 'resolve_cli':
                self.index.paths.resolve_cli = value
            elif key == 'build_env':
                self.index.config.build_env = value
            elif key == 'run_process':
                self.index.runner.run_process = value
            elif key == 'record_last_build':
                self.index.index_state.record_last_build = value

    def test_index_build_prompts_for_repo_when_multiple_roots_exist(self):
        with tempfile.TemporaryDirectory() as tmp:
            repo_a = os.path.join(tmp, 'repo-a')
            repo_b = os.path.join(tmp, 'repo-b')
            os.makedirs(os.path.join(repo_a, '.git'))
            os.makedirs(os.path.join(repo_b, '.git'))
            self.window.set_folders([repo_a, repo_b])

            self.index.PairOfCleatsIndexBuildCodeCommand(self.window).run()

            self.assertEqual(self.runner_calls, [])
            self.assertEqual(len(self.window.quick_panel_items), 2)
            self.window.quick_panel_callback(1)
            self.assertEqual(self.runner_calls[0]['cwd'], os.path.abspath(repo_b))
            self.assertTrue(
                any('Using selected repo:' in message for message in self.sublime.status_history),
                'expected explicit selected-repo status message',
            )

    def test_index_build_fails_closed_without_repo_root(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder = os.path.join(tmp, 'workspace')
            os.makedirs(folder)
            self.window.set_folders([folder])

            self.index.PairOfCleatsIndexBuildCodeCommand(self.window).run()

            self.assertEqual(self.runner_calls, [])
            self.assertIn('require an explicit repo root', self.sublime.last_error)

    def _run_process(self, _command, _args, cwd=None, env=None, window=None, title=None, capture_json=None, on_done=None, stream_output=None, panel_name=None, **_kwargs):
        self.runner_calls.append({
            'cwd': cwd,
            'title': title,
        })
        if on_done:
            on_done(type('FakeResult', (), {
                'returncode': 0,
                'output': '',
                'error': None,
                'payload': None,
            })())


if __name__ == '__main__':
    unittest.main()
