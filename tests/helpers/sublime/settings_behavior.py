import importlib
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
        self.base_settings = self.sublime.load_settings(self.config.SETTINGS_FILE)
        self.base_settings.update(self.config.DEFAULT_SETTINGS)

    def test_validate_settings_covers_api_watch_map_and_output(self):
        settings = dict(self.config.DEFAULT_SETTINGS)
        settings.update({
            'api_server_url': 'ftp://bad-host',
            'api_timeout_ms': 0,
            'search_prompt_options': 'yes',
            'map_stream_output': 'sometimes',
            'map_show_report_panel': 'maybe',
        })
        errors = self.config.validate_settings(settings, 'C:/repo')
        self.assertIn('api_server_url must be an http:// or https:// URL.', errors)
        self.assertIn('api_timeout_ms must be 1 or higher.', errors)
        self.assertIn('search_prompt_options must be true or false.', errors)
        self.assertIn('map_stream_output must be true or false.', errors)
        self.assertIn('map_show_report_panel must be true, false, or null.', errors)

    def test_project_overrides_are_explicit_and_env_is_shallow_merged(self):
        self.base_settings.set('open_results_in', 'output_panel')
        self.base_settings.set('search_limit', 30)
        self.base_settings.set('env', {'BASE': '1', 'SHARED': 'base'})
        self.window.set_project_data({
            'settings': {
                'pairofcleats': {
                    'open_results_in': 'new_tab',
                    'api_timeout_ms': 9000,
                    'env': {'SHARED': 'project', 'ONLY': '2'}
                }
            }
        })
        merged = self.config.get_settings(self.window)
        self.assertEqual(merged['open_results_in'], 'new_tab')
        self.assertEqual(merged['search_limit'], 30)
        self.assertEqual(merged['api_timeout_ms'], 9000)
        self.assertEqual(merged['env'], {'BASE': '1', 'SHARED': 'project', 'ONLY': '2'})

    def test_open_project_settings_seeds_project_block(self):
        command = self.settings_commands.PairOfCleatsOpenProjectSettingsCommand(self.window)
        command.run()
        project_data = self.window.project_data()
        self.assertIsInstance(project_data.get('settings', {}).get('pairofcleats'), dict)
        self.assertEqual(self.window.commands[-1]['name'], 'edit_project')

    def test_show_effective_settings_renders_sections_and_sources(self):
        self.base_settings.set('api_server_url', 'http://127.0.0.1:4152')
        self.base_settings.set('env', {'BASE': '1'})
        self.window.set_project_data({
            'settings': {
                'pairofcleats': {
                    'open_results_in': 'output_panel',
                    'map_stream_output': True,
                    'env': {'TOKEN': 'abc'}
                }
            }
        })
        command = self.settings_commands.PairOfCleatsShowEffectiveSettingsCommand(self.window)
        command.run()
        panel = self.window.panels['pairofcleats-settings']
        text = panel.appended
        self.assertIn('Merge semantics:', text)
        self.assertIn('Project override keys: env, map_stream_output, open_results_in', text)
        self.assertIn('Project env override keys: TOKEN', text)
        self.assertIn('API:', text)
        self.assertIn('Output:', text)
        self.assertIn('Watch:', text)
        self.assertIn('Map:', text)
        self.assertIn('- api_server_url = "http://127.0.0.1:4152" [base]', text)
        self.assertIn('- open_results_in = "output_panel" [project]', text)
        self.assertIn('- env = {"BASE": "1", "TOKEN": "abc"} [base+project]', text)


if __name__ == '__main__':
    unittest.main()
