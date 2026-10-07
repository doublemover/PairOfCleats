import importlib
import json
import os
import sys
import unittest
from unittest import mock

sys.path.insert(0, os.path.dirname(__file__))

from runtime_harness import FakeWindow, install_fake_modules


class SettingsBehaviorTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.sublime, _ = install_fake_modules()
        cls.config = importlib.import_module('PairOfCleats.lib.config')
        cls.settings_commands = importlib.import_module('PairOfCleats.commands.settings')

    def setUp(self):
        self.sublime.reset()
        self.window = FakeWindow()
        self.sublime.set_active_window(self.window)
        settings = self.sublime.load_settings(self.config.SETTINGS_FILE)
        settings.set('search_limit', 33)
        settings.set('search_prompt_options', False)
        settings.set('map_stream_output', False)
        settings.set('env', {'BASE_ONLY': '1', 'SHARED': 'base'})
        self.process_guards = []
        for name in ('subprocess.Popen', 'subprocess.run'):
            guard = mock.patch(name, side_effect=AssertionError('Settings fixtures cannot launch software'))
            patched = guard.start()
            self.process_guards.append(patched)
            self.addCleanup(guard.stop)

    def tearDown(self):
        for guard in self.process_guards:
            guard.assert_not_called()

    def test_validate_settings_covers_api_output_watch_and_map_keys(self):
        settings = self.config.get_settings(None)
        settings.update({
            'api_server_url': 'ftp://bad',
            'api_timeout_ms': 0,
            'api_execution_mode': 'api',
            'progress_panel_on_start': 'sometimes',
            'progress_watchdog_ms': 0,
            'search_prompt_options': 'yes',
            'search_ann_default': 'yes',
            'search_allow_sparse_fallback': 'yes',
            'search_as_of_default': 12,
            'search_snapshot_default': 34,
            'search_filter_default': True,
            'search_advanced_defaults': {
                'unknown': 'value',
                'modified_since': -1,
                'case': 'yes',
            },
            'map_stream_output': 'true',
            'map_show_report_panel': 'sometimes',
            'index_watch_scope': 'workspace',
        })
        errors = self.config.validate_settings(settings, repo_root='C:/repo')
        self.assertIn('api_server_url must be an http:// or https:// URL.', errors)
        self.assertIn('api_timeout_ms must be 1 or higher.', errors)
        self.assertIn('api_execution_mode must be one of: cli, prefer, require.', errors)
        self.assertIn('progress_panel_on_start must be true or false.', errors)
        self.assertIn('progress_watchdog_ms must be 1 or higher.', errors)
        self.assertIn('search_prompt_options must be true or false.', errors)
        self.assertIn('search_ann_default must be true, false, or null.', errors)
        self.assertIn('search_allow_sparse_fallback must be true or false.', errors)
        self.assertIn('search_as_of_default must be a string when set.', errors)
        self.assertIn('search_snapshot_default must be a string when set.', errors)
        self.assertIn('search_filter_default must be a string when set.', errors)
        self.assertIn('search_advanced_defaults contains unsupported keys: unknown.', errors)
        self.assertIn('search_advanced_defaults.modified_since must be an integer 0 or higher.', errors)
        self.assertIn('search_advanced_defaults.case must be true or false.', errors)
        self.assertIn('map_stream_output must be true or false.', errors)
        self.assertIn('map_show_report_panel must be true, false, or null.', errors)
        self.assertIn('index_watch_scope must be repo or folder.', errors)

    def test_validate_settings_rejects_conflicting_search_temporal_defaults(self):
        settings = self.config.get_settings(None)
        settings.update({
            'search_as_of_default': 'snap:one',
            'search_snapshot_default': 'snap-two',
        })
        errors = self.config.validate_settings(settings, repo_root='C:/repo')
        self.assertIn('search_as_of_default and search_snapshot_default cannot both be set.', errors)

    def test_validate_settings_requires_server_url_for_api_modes(self):
        settings = self.config.get_settings(None)
        settings['api_execution_mode'] = 'require'
        errors = self.config.validate_settings(settings, repo_root='C:/repo')
        self.assertIn('api_server_url must be set when api_execution_mode is prefer or require.', errors)

        settings['api_execution_mode'] = 'prefer'
        errors = self.config.validate_settings(settings, repo_root='C:/repo')
        self.assertIn('api_server_url must be set when api_execution_mode is prefer or require.', errors)

    def test_resolve_execution_mode_uses_workflow_transport_matrix(self):
        settings = {
            'api_server_url': 'http://127.0.0.1:7464',
            'api_execution_mode': 'prefer',
        }

        search_mode = self.config.resolve_execution_mode(settings, 'search')
        self.assertEqual(search_mode['mode'], 'api')
        self.assertTrue(search_mode['allow_fallback'])

        map_mode = self.config.resolve_execution_mode(settings, 'map')
        self.assertEqual(map_mode['mode'], 'cli')
        self.assertFalse(map_mode['allow_fallback'])
        self.assertIsNone(map_mode['error'])

        explain_mode = self.config.resolve_execution_mode({
            'api_server_url': 'http://127.0.0.1:7464',
            'api_execution_mode': 'require',
        }, 'search-explain')
        self.assertIsNone(explain_mode['mode'])
        self.assertIn('API mode is not supported for search explain.', explain_mode['error'])

    def test_resolve_execution_mode_supports_explicit_transports(self):
        explicit_cli = self.config.resolve_execution_mode({
            'api_server_url': '',
            'api_execution_mode': 'require',
        }, 'tooling-doctor', requested_mode='cli')
        self.assertEqual(explicit_cli['mode'], 'cli')
        self.assertIsNone(explicit_cli['error'])

        explicit_api = self.config.resolve_execution_mode({
            'api_server_url': 'http://127.0.0.1:7464',
            'api_execution_mode': 'cli',
        }, 'server-health', requested_mode='api')
        self.assertEqual(explicit_api['mode'], 'api')
        self.assertFalse(explicit_api['allow_fallback'])
        self.assertIsNone(explicit_api['error'])

    def test_project_overrides_preserve_user_execution_settings_and_override_scalars(self):
        user = self.sublime.load_settings(self.config.SETTINGS_FILE)
        protected = {
            'pairofcleats_path': '/owned/cli.js',
            'node_path': '/owned/node',
            'api_server_url': 'http://127.0.0.1:7464',
            'api_execution_mode': 'prefer',
        }
        user.update(protected)
        user.set('cli_args', ['--not-supported'])
        user.set('extra_search_args', ['--not-supported'])
        self.window.set_project_data({
            'settings': {
                'pairofcleats': {
                    'pairofcleats_path': '/project/ignored.js',
                    'node_path': '/project/ignored-node',
                    'api_server_url': 'http://ignored.invalid',
                    'api_execution_mode': 'require',
                    'cli_args': ['--ignored'],
                    'extra_search_args': ['--ignored-search'],
                    'api_timeout_ms': 6200,
                    'open_results_in': 'output_panel',
                    'progress_panel_on_start': False,
                    'progress_watchdog_ms': 20000,
                    'env': {
                        'PROJECT_ONLY': '1',
                        'SHARED': 'project'
                    }
                }
            }
        })
        settings = self.config.get_settings(self.window)
        for key, value in protected.items():
            self.assertEqual(settings[key], value)
        self.assertNotIn('cli_args', settings)
        self.assertNotIn('extra_search_args', settings)
        self.assertEqual(settings['api_timeout_ms'], 6200)
        self.assertEqual(settings['open_results_in'], 'output_panel')
        self.assertEqual(settings['progress_panel_on_start'], False)
        self.assertEqual(settings['progress_watchdog_ms'], 20000)
        self.assertEqual(settings['env']['BASE_ONLY'], '1')
        self.assertNotIn('PROJECT_ONLY', settings['env'])
        self.assertEqual(settings['env']['SHARED'], 'base')
        self.assertEqual(self.config.extract_project_settings(self.window)['env']['SHARED'], 'project')

    def test_project_settings_command_ensures_override_root_exists(self):
        command = self.settings_commands.PairOfCleatsOpenProjectSettingsCommand(self.window)
        command.run()
        data = self.window.project_data()
        self.assertIn('settings', data)
        self.assertIn('pairofcleats', data['settings'])
        self.assertEqual(self.window.commands[-1]['name'], 'edit_project')

    def test_project_settings_template_command_opens_template_view(self):
        command = self.settings_commands.PairOfCleatsProjectSettingsTemplateCommand(self.window)
        command.run()
        template_view = self.window.new_views[-1]
        self.assertEqual(template_view.name, 'PairOfCleats Project Settings Template')
        self.assertTrue(template_view.scratch)
        payload = json.loads(template_view.appended)
        self.assertIn('settings', payload)
        self.assertIn('pairofcleats', payload['settings'])
        override = payload['settings']['pairofcleats']
        for key in ('pairofcleats_path', 'node_path', 'env', 'api_server_url',
                    'api_execution_mode', 'cli_args', 'extra_search_args'):
            self.assertNotIn(key, override)
        self.assertEqual(override['api_timeout_ms'], 5000)
        self.assertIn('search_ann_default', override)
        self.assertIn('search_allow_sparse_fallback', override)
        self.assertIn('search_as_of_default', override)
        self.assertIn('search_snapshot_default', override)
        self.assertIn('search_filter_default', override)
        self.assertIn('search_advanced_defaults', override)
        self.assertIn('progress_panel_on_start', override)
        self.assertIn('progress_watchdog_ms', override)
        self.assertIn('map_stream_output', override)
        self.assertIn('index_watch_mode', override)
        self.assertIn('open_results_in', override)

    def test_project_settings_template_round_trips_supported_defaults(self):
        user = self.sublime.load_settings(self.config.SETTINGS_FILE)
        user.set('pairofcleats_path', '/owned/cli.js')
        user.set('index_watch_folder', './user-folder')
        payload = json.loads(self.config.build_project_settings_template())
        self.window.set_project_data(payload)
        settings = self.config.get_settings(self.window)
        for key, value in payload['settings']['pairofcleats'].items():
            self.assertEqual(settings[key], value)
        self.assertEqual(settings['pairofcleats_path'], '/owned/cli.js')
        self.assertEqual(settings['index_watch_folder'], './user-folder')
        self.assertEqual(settings['env'], {'BASE_ONLY': '1', 'SHARED': 'base'})

    def test_setting_origin_matches_resolution_for_ignored_and_supported_fields(self):
        overrides = {
            'env': {'IGNORED': '1'}, 'api_server_url': 'http://ignored.invalid',
            'pairofcleats_path': '/project/ignored.js', 'node_path': '/project/ignored-node',
            'api_execution_mode': 'require', 'cli_args': [], 'extra_search_args': [],
            'api_timeout_ms': 6200, 'search_limit': 7,
        }
        for key in ('env', 'api_server_url', 'pairofcleats_path', 'node_path',
                    'api_execution_mode', 'cli_args', 'extra_search_args'):
            self.assertEqual(self.settings_commands._setting_source(key, overrides), 'base')
        self.assertEqual(self.settings_commands._setting_source('api_timeout_ms', overrides), 'project')
        self.assertEqual(self.settings_commands._setting_source('search_limit', overrides), 'project')
        self.assertEqual(self.settings_commands._setting_source('search_limit', None), 'base')

    def test_show_effective_settings_groups_output(self):
        self.window.set_project_data({
            'settings': {
                'pairofcleats': {
                    'api_server_url': 'http://127.0.0.1:7464',
                    'api_execution_mode': 'prefer',
                    'progress_panel_on_start': False,
                    'progress_watchdog_ms': 20000,
                    'map_stream_output': True,
                    'env': {'PAIR': '1'}
                }
            }
        })
        command = self.settings_commands.PairOfCleatsShowEffectiveSettingsCommand(self.window)
        command.run()
        panel = self.window.panels['pairofcleats-settings']
        text = panel.appended
        self.assertIn('Settings precedence:', text)
        self.assertIn('API:', text)
        self.assertIn('Search:', text)
        self.assertIn('Output:', text)
        self.assertIn('Watch:', text)
        self.assertIn('Map:', text)
        self.assertIn('api_server_url = "" [base]', text)
        self.assertIn('api_execution_mode = "cli" [base]', text)
        self.assertIn('progress_panel_on_start = false [project]', text)
        self.assertIn('progress_watchdog_ms = 20000 [project]', text)
        self.assertIn('map_stream_output = true [project]', text)
        self.assertIn('Ignored project keys (use User Settings): api_execution_mode, api_server_url, env', text)
        self.assertIn('env = {"BASE_ONLY": "1", "SHARED": "base"} [base]', text)
        self.assertNotIn('shallow-merged', text)
        self.assertNotIn('http://127.0.0.1:7464', text)
        self.assertNotIn('Project env override keys:', text)

    def test_effective_settings_refreshes_after_project_changes(self):
        command = self.settings_commands.PairOfCleatsShowEffectiveSettingsCommand(self.window)
        self.window.set_project_data({'settings': {'pairofcleats': {
            'env': {'IGNORED': '1'}, 'map_stream_output': True,
        }}})
        command.run()
        self.assertIn('Ignored project keys (use User Settings): env',
                      self.window.panels['pairofcleats-settings'].appended)
        self.window.set_project_data({'settings': {'PairOfCleats': {'search_limit': 7}}})
        command.run()
        text = self.window.panels['pairofcleats-settings'].appended
        self.assertIn('Project override keys: search_limit', text)
        self.assertIn('search_limit = 7 [project]', text)
        self.assertIn('map_stream_output = false [base]', text)
        self.assertNotIn('Ignored project keys', text)

    def test_non_dictionary_project_settings_have_no_project_origin(self):
        self.window.set_project_data({'settings': {'pairofcleats': ['not-settings']}})
        command = self.settings_commands.PairOfCleatsShowEffectiveSettingsCommand(self.window)
        command.run()
        text = self.window.panels['pairofcleats-settings'].appended
        self.assertIn('Project override keys: (none)', text)
        self.assertNotIn('[project]', text)

    def test_unsupported_project_keys_are_not_advertised_as_user_settings(self):
        self.window.set_project_data({'settings': {'pairofcleats': {
            'cli_args': ['--ignored-fixture'], 'extra_search_args': ['--ignored-fixture'],
            'unrecognized_fixture': 'not-a-supported-setting',
        }}})
        command = self.settings_commands.PairOfCleatsShowEffectiveSettingsCommand(self.window)
        command.run()
        text = self.window.panels['pairofcleats-settings'].appended
        self.assertIn('Project override keys: (none)', text)
        self.assertIn('Unsupported project keys: cli_args, extra_search_args, unrecognized_fixture', text)
        self.assertNotIn('Ignored project keys (use User Settings)', text)
        self.assertNotIn('--ignored-fixture', text)


if __name__ == '__main__':
    unittest.main()
