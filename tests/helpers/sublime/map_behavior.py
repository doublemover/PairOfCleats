import importlib
import json
import copy
import os
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, os.path.dirname(__file__))

from runtime_harness import isolated_temp_directory, FakeWindow, install_fake_modules


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
        self.map_commands.config.validate_settings = lambda _settings, _repo_root, workflow=None: []
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

    def _install_successful_map_runner(self, out_path='https://example.test/map'):
        runner_calls = []

        def _run_process(command, args, cwd=None, env=None, window=None, title=None, capture_json=None, on_done=None, stream_output=None, panel_name=None, **options):
            self.assertIsNotNone(options.get('operation_scope'))
            runner_calls.append({'cwd': cwd, 'title': title})
            on_done(_FakeResult({
                'ok': True,
                'source': 'cli',
                'format': 'html-iso',
                'outPath': out_path,
                'summary': {'counts': {'files': 1, 'members': 1, 'edges': 0}},
                'warnings': [],
            }))

        self.map_commands.runner.run_process = _run_process
        return runner_calls

    def test_map_primary_owned_failure_precedes_secondary_exit_output(self):
        failed = _FakeResult({})
        failed.returncode = 2
        failed.output = 'secondary map exit text'
        failed.error = 'original owned map read failure'
        self.map_commands.runner.run_process = lambda *args, **options: options['on_done'](failed)
        self.map_commands._dispatch_map(self.window, 'repo', None, 'C:/repo')
        self.assertEqual(self.sublime.last_error, 'original owned map read failure')

    def test_map_dispatch_records_report_and_reopens_url_output(self):
        payload = {
            'ok': True,
            'source': 'api',
            'format': 'html-iso',
            'outPath': 'https://example.test/map',
            'summary': {'counts': {'files': 2, 'members': 3, 'edges': 4}},
            'warnings': ['dataflow metadata missing'],
        }

        def _run_process(command, args, cwd=None, env=None, window=None, title=None, capture_json=None, on_done=None, stream_output=None, panel_name=None, **options):
            self.assertIsNotNone(options.get('operation_scope'))
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

    def test_map_options_keep_original_runtime_and_revoke_old_native_steps(self):
        def original_root(_window, on_done, **options):
            self.assertIsNotNone(options.get('operation_scope'))
            on_done('C:/repo')
        resolver = patch.object(self.map_commands, '_with_map_repo_root', side_effect=original_root)
        resolver.start()
        self.addCleanup(resolver.stop)
        settings = self.map_commands.config.get_settings(self.window)
        settings.update({'map_prompt_options': True, 'env': {'ORIGINAL_PROFILE': 'captured'}})
        calls = []
        self.map_commands.runner.run_process = lambda *args, **options: calls.append((args, options))
        self.map_commands.config.get_settings = lambda _window: copy.deepcopy(settings)
        self.map_commands.config.build_env = lambda snapshot: dict(snapshot.get('env') or {})
        command = self.map_commands.PairOfCleatsMapRepoCommand(self.window)
        command.run()
        old_type = self.window.quick_panel_callback
        old_type(0)
        format_choice = self.window.quick_panel_callback
        old_type(1)
        self.assertIs(self.window.quick_panel_callback, format_choice)
        settings['env']['ORIGINAL_PROFILE'] = 'replacement'
        format_choice(0)
        format_choice(0)
        self.assertEqual(len(calls), 1)
        self.assertEqual(calls[0][1]['env']['ORIGINAL_PROFILE'], 'captured')
        old_result = calls[0][1]['on_done']
        command.run()
        cancelled_type = self.window.quick_panel_callback
        cancelled_type(-1)
        cancelled_type(0)
        self.assertEqual(len(calls), 1)
        old_result(_FakeResult({'ok': True, 'outPath': 'https://example.test/obsolete', 'format': 'html-iso'}))
        self.assertEqual(self.opened_urls, [])

        command.run()
        original_type = self.window.quick_panel_callback
        self.window.set_project_data({'settings': {'pairofcleats': {'map_max_edges': 15}}})
        original_type(0)
        self.assertIs(self.window.quick_panel_callback, original_type)
        self.assertEqual(len(calls), 1)

    def test_map_history_isolation_and_host_open_refusal(self):
        payload = {'repo': 'C:/repo', 'outPath': 'https://example.test/original',
                   'summary': {'counts': {'files': 1}}, 'format': 'html-iso'}
        self.map_state.record_last_map(self.window, payload)
        payload['summary']['counts']['files'] = 99
        saved = self.map_state.get_last_map(self.window)
        self.assertEqual(saved['summary']['counts']['files'], 1)
        saved['summary']['counts']['files'] = 98
        self.assertEqual(self.map_state.get_last_map(self.window)['summary']['counts']['files'], 1)
        acknowledged = copy.deepcopy(self.window.project_data())
        with patch.object(self.window, 'set_project_data', side_effect=OSError('original map history failure')):
            with self.assertRaisesRegex(OSError, 'original map history failure'):
                self.map_state.record_last_map(self.window, {'outPath': 'replacement'})
        self.assertEqual(self.window.project_data(), acknowledged)
        self.map_commands.webbrowser.open_new_tab = lambda url: False
        self.assertFalse(self.map_commands._open_in_browser('https://example.test/original'))
        self.assertIn('browser refused', self.sublime.last_error)

    def test_generated_map_remains_usable_after_independent_history_and_panel_failures(self):
        settings = self.map_commands.config.get_settings(self.window)
        settings['map_show_report_panel'] = True
        self.map_commands.config.get_settings = lambda _window: copy.deepcopy(settings)
        self._install_successful_map_runner()
        with patch.object(self.map_state, 'record_last_map', side_effect=OSError('original map persistence failure')), \
                patch.object(self.map_commands.ui, 'write_output_panel', side_effect=RuntimeError('independent map panel failure')):
            self.map_commands._dispatch_map(self.window, 'repo', None, 'C:/repo')
        self.assertEqual(self.opened_urls, ['https://example.test/map'])
        self.assertIn('generation completed', self.sublime.last_error)
        self.assertIn('original map persistence failure', self.sublime.last_error)
        self.assertIn('independent map panel failure', self.sublime.last_error)

    def test_map_open_last_viewer_opens_local_file_predictably(self):
        with isolated_temp_directory() as tmp:
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
        with isolated_temp_directory() as tmp:
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

    def test_map_stays_cli_only_when_api_is_preferred(self):
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
        runner_calls = self._install_successful_map_runner()

        self.map_commands._dispatch_map(self.window, 'repo', '', 'C:/repo')

        state = self.map_state.get_last_map(self.window)
        self.assertEqual(state['source'], 'cli')
        self.assertEqual(self.opened_urls, ['https://example.test/map'])
        self.assertEqual(len(runner_calls), 1)

    def test_map_require_api_fails_closed(self):
        self.map_commands.config.get_settings = lambda _window: {
            'map_show_report_panel': None,
            'map_stream_output': False,
            'map_prompt_options': False,
            'api_execution_mode': 'require',
            'api_server_url': 'http://127.0.0.1:7464',
            'api_timeout_ms': 5000,
            'map_type_default': 'combined',
            'map_format_default': 'html-iso',
            'map_output_dir': '.pairofcleats/maps',
            'map_index_mode': 'code',
            'map_collapse_default': 'none',
        }

        self.map_commands._dispatch_map(self.window, 'repo', '', 'C:/repo')

        self.assertIn('API mode is not supported for map.', self.sublime.last_error)

    def test_repo_map_prompts_for_repo_when_multiple_roots_exist(self):
        with isolated_temp_directory() as tmp:
            repo_a = os.path.join(tmp, 'repo-a')
            repo_b = os.path.join(tmp, 'repo-b')
            os.makedirs(os.path.join(repo_a, '.git'))
            os.makedirs(os.path.join(repo_b, '.git'))
            self.window.set_folders([repo_a, repo_b])
            self.map_commands.paths.resolve_repo_root = self._originals['resolve_repo_root']
            runner_calls = self._install_successful_map_runner()
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
