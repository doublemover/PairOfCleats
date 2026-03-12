import importlib
import json
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(__file__))

from runtime_harness import FakeWindow, install_fake_modules


class _FakeResult:
    def __init__(self, payload):
        self.returncode = 0
        self.output = ''
        self.error = None
        self.payload = payload


class MapBehaviorTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.sublime, _ = install_fake_modules()
        cls.map_commands = importlib.import_module('PairOfCleats.commands.map')
        cls.map_state = importlib.import_module('PairOfCleats.lib.map_state')

    def setUp(self):
        self.sublime.reset()
        self.window = FakeWindow()
        self.sublime.set_active_window(self.window)
        self._originals = {
            'webbrowser_open': self.map_commands.webbrowser.open_new_tab,
            'resolve_repo_root': self.map_commands.paths.resolve_repo_root,
            'get_settings': self.map_commands.config.get_settings,
            'validate_settings': self.map_commands.config.validate_settings,
            'resolve_cli': self.map_commands.paths.resolve_cli,
            'build_env': self.map_commands.config.build_env,
            'run_process': self.map_commands.runner.run_process,
            'api_generate_map_report': self.map_commands.api_client.generate_map_report,
            'api_run_async': self.map_commands.api_client.run_async,
        }
        self.opened_urls = []
        self.map_commands.webbrowser.open_new_tab = lambda url: self.opened_urls.append(url) or True
        self.map_commands.paths.resolve_repo_root = (
            lambda _window, return_reason=True, path_hint=None, allow_fallback=True: ('C:/repo', None)
            if return_reason else 'C:/repo'
        )
        self.map_commands.config.get_settings = lambda _window: {
            'map_show_report_panel': None,
            'map_stream_output': False,
            'map_prompt_options': False,
            'api_execution_mode': 'cli',
            'api_server_url': '',
            'api_timeout_ms': 5000,
            'map_type_default': 'combined',
            'map_format_default': 'html-iso',
            'map_output_dir': '.pairofcleats/maps',
            'map_index_mode': 'code',
            'map_collapse_default': 'none',
        }
        self.map_commands.config.validate_settings = lambda _settings, _repo_root: []
        self.map_commands.paths.resolve_cli = lambda _settings, _repo_root: {
            'command': 'pairofcleats',
            'args_prefix': [],
            'source': 'path',
        }
        self.map_commands.config.build_env = lambda _settings: {}

    def tearDown(self):
        for key, value in self._originals.items():
            if key == 'webbrowser_open':
                self.map_commands.webbrowser.open_new_tab = value
            elif key == 'resolve_repo_root':
                self.map_commands.paths.resolve_repo_root = value
            elif key == 'get_settings':
                self.map_commands.config.get_settings = value
            elif key == 'validate_settings':
                self.map_commands.config.validate_settings = value
            elif key == 'resolve_cli':
                self.map_commands.paths.resolve_cli = value
            elif key == 'build_env':
                self.map_commands.config.build_env = value
            elif key == 'run_process':
                self.map_commands.runner.run_process = value
            elif key == 'api_generate_map_report':
                self.map_commands.api_client.generate_map_report = value
            elif key == 'api_run_async':
                self.map_commands.api_client.run_async = value

    def test_map_dispatch_records_report_and_reopens_url_output(self):
        payload = {
            'ok': True,
            'source': 'api',
            'format': 'html-iso',
            'outPath': 'https://example.test/map',
            'summary': {'counts': {'files': 2, 'members': 3, 'edges': 4}},
            'warnings': ['dataflow metadata missing'],
        }

        def _run_process(command, args, cwd=None, env=None, window=None, title=None, capture_json=None, on_done=None, stream_output=None, panel_name=None):
            on_done(_FakeResult(payload))

        self.map_commands.runner.run_process = _run_process
        self.map_commands._dispatch_map(self.window, 'repo', '', 'C:/repo')

        state = self.map_state.get_last_map(self.window)
        self.assertEqual(state['repo'], 'C:/repo')
        self.assertEqual(state['outPath'], 'https://example.test/map')
        self.assertIn('Follow-up:', state['reportText'])
        self.assertEqual(self.opened_urls, ['https://example.test/map'])
        panel = self.window.panels['pairofcleats-map']
        self.assertIn('Warnings:', panel.appended)

    def test_map_open_last_viewer_opens_local_file_predictably(self):
        with tempfile.TemporaryDirectory() as tmp:
            out_path = os.path.join(tmp, 'map.svg')
            with open(out_path, 'w', encoding='utf-8') as handle:
                handle.write('<svg/>')
            self.map_state.record_last_map(self.window, {
                'repo': 'C:/repo',
                'format': 'dot',
                'outPath': out_path,
            })
            command = self.map_commands.PairOfCleatsMapOpenLastViewerCommand(self.window)
            command.run()
            self.assertEqual(self.window.opened_files[-1]['path'], out_path)

    def test_map_jump_to_node_uses_stored_repo_and_handles_missing_location(self):
        with tempfile.TemporaryDirectory() as tmp:
            node_list_path = os.path.join(tmp, 'nodes.json')
            with open(node_list_path, 'w', encoding='utf-8') as handle:
                json.dump({'nodes': [{'label': 'Detached', 'id': 'n1'}]}, handle)
            self.map_state.record_last_map(self.window, {
                'repo': 'C:/stored-repo',
                'nodeListPath': node_list_path,
            })
            command = self.map_commands.PairOfCleatsMapJumpToNodeCommand(self.window)
            command.run()
            self.window.quick_panel_callback(0)
            self.assertEqual(self.sublime.last_status, 'PairOfCleats: selected node has no source location.')

    def test_map_show_last_report_reopens_persisted_report(self):
        self.map_state.record_last_map(self.window, {
            'repo': 'C:/repo',
            'format': 'html-iso',
            'outPath': 'https://example.test/map',
            'summary': {'counts': {'files': 1, 'members': 2, 'edges': 3}},
        }, report_text='stored report\n')
        command = self.map_commands.PairOfCleatsMapShowLastReportCommand(self.window)
        command.run()
        panel = self.window.panels['pairofcleats-map']
        self.assertEqual(panel.appended, 'stored report\n')
        self.assertEqual(self.sublime.last_status, 'PairOfCleats: showing last map report.')

    def test_map_prefers_api_when_configured(self):
        self.map_commands.config.get_settings = lambda _window: {
            'map_show_report_panel': None,
            'map_stream_output': False,
            'map_prompt_options': False,
            'api_execution_mode': 'prefer',
            'api_server_url': 'http://127.0.0.1:7464',
            'api_timeout_ms': 5000,
            'map_type_default': 'combined',
            'map_format_default': 'html-iso',
            'map_output_dir': '.pairofcleats/maps',
            'map_index_mode': 'code',
            'map_collapse_default': 'none',
        }
        self.map_commands.runner.run_process = lambda *_args, **_kwargs: self.fail('CLI fallback should not run')
        self.map_commands.api_client.generate_map_report = lambda *args, **kwargs: ({
            'ok': True,
            'source': 'api',
            'format': 'html-iso',
            'outPath': 'https://example.test/map',
            'summary': {'counts': {'files': 1, 'members': 1, 'edges': 0}},
            'warnings': [],
        })
        self.map_commands.api_client.run_async = lambda request_fn, on_done, on_progress=None: (
            on_progress('Request started.') if callable(on_progress) else None,
            on_done(self.map_commands.api_client.ApiResult(payload=request_fn()))
        )

        self.map_commands._dispatch_map(self.window, 'repo', '', 'C:/repo')

        state = self.map_state.get_last_map(self.window)
        self.assertEqual(state['source'], 'api')
        self.assertEqual(self.opened_urls, ['https://example.test/map'])
        self.assertIn('PairOfCleats map', self.window.panels['pairofcleats-progress'].appended)

    def test_repo_map_prompts_for_repo_when_multiple_roots_exist(self):
        with tempfile.TemporaryDirectory() as tmp:
            repo_a = os.path.join(tmp, 'repo-a')
            repo_b = os.path.join(tmp, 'repo-b')
            os.makedirs(os.path.join(repo_a, '.git'))
            os.makedirs(os.path.join(repo_b, '.git'))
            self.window.set_folders([repo_a, repo_b])
            self.map_commands.paths.resolve_repo_root = self._originals['resolve_repo_root']
            runner_calls = []

            def _run_process(command, args, cwd=None, env=None, window=None, title=None, capture_json=None, on_done=None, stream_output=None, panel_name=None):
                runner_calls.append({'cwd': cwd, 'title': title})
                on_done(_FakeResult({
                    'ok': True,
                    'source': 'cli',
                    'format': 'html-iso',
                    'outPath': 'https://example.test/map',
                    'summary': {'counts': {'files': 1, 'members': 1, 'edges': 0}},
                    'warnings': [],
                }))

            self.map_commands.runner.run_process = _run_process
            self.map_commands.PairOfCleatsMapRepoCommand(self.window).run()

            self.assertEqual(runner_calls, [])
            self.assertEqual(len(self.window.quick_panel_items), 2)
            self.window.quick_panel_callback(1)
            self.assertEqual(runner_calls[0]['cwd'], os.path.abspath(repo_b))
            self.assertTrue(
                any('Using selected repo:' in message for message in self.sublime.status_history),
                'expected explicit selected-repo status message',
            )


if __name__ == '__main__':
    unittest.main()
