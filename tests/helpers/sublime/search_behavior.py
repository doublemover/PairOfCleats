import importlib
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(__file__))

from runtime_harness import FakeWindow, install_fake_modules


class SearchBehaviorTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.sublime, _ = install_fake_modules()
        cls.search = importlib.import_module('PairOfCleats.commands.search')
        cls.results_state = importlib.import_module('PairOfCleats.lib.results_state')

    def setUp(self):
        self.sublime.reset()
        self.window = FakeWindow()
        self.sublime.set_active_window(self.window)
        self.runner_calls = []
        self.api_calls = []
        self._originals = {
            'resolve_repo_root': self.search.paths.resolve_repo_root,
            'get_settings': self.search.config.get_settings,
            'validate_settings': self.search.config.validate_settings,
            'resolve_cli': self.search.paths.resolve_cli,
            'build_env': self.search.config.build_env,
            'run_process': self.search.runner.run_process,
            'api_search_json': self.search.api_client.search_json,
            'api_run_async': self.search.api_client.run_async,
        }
        self.search.paths.resolve_repo_root = (
            lambda _window, return_reason=True, path_hint=None, allow_fallback=True: ('C:/repo', None)
            if return_reason else 'C:/repo'
        )
        self.search.config.validate_settings = lambda _settings, _repo_root: []
        self.search.paths.resolve_cli = lambda _settings, _repo_root: {
            'command': 'pairofcleats',
            'args_prefix': [],
            'source': 'path',
        }
        self.search.config.build_env = lambda _settings: {}

    def tearDown(self):
        for key, value in self._originals.items():
            if key == 'resolve_repo_root':
                self.search.paths.resolve_repo_root = value
            elif key == 'get_settings':
                self.search.config.get_settings = value
            elif key == 'validate_settings':
                self.search.config.validate_settings = value
            elif key == 'resolve_cli':
                self.search.paths.resolve_cli = value
            elif key == 'build_env':
                self.search.config.build_env = value
            elif key == 'run_process':
                self.search.runner.run_process = value
            elif key == 'api_search_json':
                self.search.api_client.search_json = value
            elif key == 'api_run_async':
                self.search.api_client.run_async = value

    def test_search_prefers_api_when_configured(self):
        self.search.config.get_settings = lambda _window: {
            'index_mode_default': 'both',
            'search_backend_default': '',
            'search_limit': 25,
            'open_results_in': 'quick_panel',
            'results_buffer_threshold': 50,
            'history_limit': 25,
            'api_server_url': 'http://127.0.0.1:7464',
            'api_timeout_ms': 5000,
            'api_execution_mode': 'prefer',
        }
        self.search.api_client.search_json = self._search_json_success
        self.search.api_client.run_async = self._run_api_immediate
        self.search.runner.run_process = self._run_process

        self.search._execute_search(self.window, 'return', {'mode': 'code', 'limit': 5}, explain=False)

        self.assertEqual(len(self.api_calls), 1)
        self.assertEqual(len(self.runner_calls), 0)
        self.assertIsNotNone(self.window.quick_panel_items)
        self.assertIn('PairOfCleats search', self.window.panels['pairofcleats-progress'].appended)
        session = self.results_state.get_last_results(self.window)
        self.assertEqual(session['query'], 'return')

    def test_search_api_prefer_falls_back_to_cli_on_error(self):
        self.search.config.get_settings = lambda _window: {
            'index_mode_default': 'both',
            'search_backend_default': '',
            'search_limit': 25,
            'open_results_in': 'quick_panel',
            'results_buffer_threshold': 50,
            'history_limit': 25,
            'api_server_url': 'http://127.0.0.1:7464',
            'api_timeout_ms': 5000,
            'api_execution_mode': 'prefer',
        }
        self.search.api_client.run_async = self._run_api_error
        self.search.runner.run_process = self._run_process

        self.search._execute_search(self.window, 'return', {'mode': 'code', 'limit': 5}, explain=False)

        self.assertEqual(len(self.runner_calls), 1)
        self.assertIsNotNone(self.window.quick_panel_items)

    def test_require_api_blocks_unsupported_explain(self):
        self.search.config.get_settings = lambda _window: {
            'index_mode_default': 'both',
            'search_backend_default': '',
            'search_limit': 25,
            'open_results_in': 'quick_panel',
            'results_buffer_threshold': 50,
            'history_limit': 25,
            'api_server_url': 'http://127.0.0.1:7464',
            'api_timeout_ms': 5000,
            'api_execution_mode': 'require',
        }
        self.search.runner.run_process = self._run_process

        self.search._execute_search(self.window, 'return', {'mode': 'code', 'limit': 5}, explain=True)

        self.assertIn('API mode is not supported for search explain.', self.sublime.last_error)
        self.assertEqual(len(self.runner_calls), 0)

    def _search_json_success(self, base_url, repo_root, settings, query, mode, backend=None, limit=None):
        self.api_calls.append({
            'base_url': base_url,
            'repo_root': repo_root,
            'query': query,
            'mode': mode,
            'backend': backend,
            'limit': limit,
        })
        return ({
            'ok': True,
            'code': [{
                'file': 'src/index.js',
                'name': 'index',
                'startLine': 3,
            }],
        }, {})

    def _run_api_immediate(self, request_fn, on_done, on_progress=None):
        if callable(on_progress):
            on_progress('Request started.')
        payload, headers = request_fn()
        on_done(self.search.api_client.ApiResult(payload=payload, headers=headers))
        return None

    def _run_api_error(self, _request_fn, on_done, on_progress=None):
        if callable(on_progress):
            on_progress('Request started.')
        on_done(self.search.api_client.ApiResult(error='api down'))
        return None

    def _run_process(self, _command, _args, cwd=None, env=None, window=None, title=None, capture_json=None, on_done=None, stream_output=None, panel_name=None):
        self.runner_calls.append({
            'cwd': cwd,
            'title': title,
        })
        payload = {
            'ok': True,
            'code': [{
                'file': 'src/index.js',
                'name': 'index',
                'startLine': 3,
            }],
        }
        on_done(type('FakeResult', (), {
            'returncode': 0,
            'output': '',
            'error': None,
            'payload': payload,
        })())


if __name__ == '__main__':
    unittest.main()
