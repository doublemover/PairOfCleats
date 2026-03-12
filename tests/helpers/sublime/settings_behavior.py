import importlib
import json
import os
import sys
import unittest

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

    def test_project_overrides_merge_env_and_override_scalars(self):
        self.window.set_project_data({
            'settings': {
                'pairofcleats': {
                    'api_server_url': 'http://127.0.0.1:7464',
                    'api_execution_mode': 'prefer',
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
        self.assertEqual(settings['api_server_url'], 'http://127.0.0.1:7464')
        self.assertEqual(settings['api_execution_mode'], 'prefer')
        self.assertEqual(settings['open_results_in'], 'output_panel')
        self.assertEqual(settings['progress_panel_on_start'], False)
        self.assertEqual(settings['progress_watchdog_ms'], 20000)
        self.assertEqual(settings['env']['BASE_ONLY'], '1')
        self.assertEqual(settings['env']['PROJECT_ONLY'], '1')
        self.assertEqual(settings['env']['SHARED'], 'project')

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
        self.assertEqual(override['api_server_url'], 'http://127.0.0.1:7464')
        self.assertEqual(override['api_execution_mode'], 'cli')
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
        self.assertIn('Merge semantics:', text)
        self.assertIn('API:', text)
        self.assertIn('Search:', text)
        self.assertIn('Output:', text)
        self.assertIn('Watch:', text)
        self.assertIn('Map:', text)
        self.assertIn('api_server_url = "http://127.0.0.1:7464" [project]', text)
        self.assertIn('api_execution_mode = "prefer" [project]', text)
        self.assertIn('progress_panel_on_start = false [project]', text)
        self.assertIn('progress_watchdog_ms = 20000 [project]', text)
        self.assertIn('map_stream_output = true [project]', text)
        self.assertIn('Project env override keys: PAIR', text)


if __name__ == '__main__':
    unittest.main()
