import importlib
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(__file__))

from runtime_harness import FakeRegion, FakeView, FakeWindow, install_fake_modules


class _FakeResult:
    def __init__(self, payload):
        self.returncode = 0
        self.output = ''
        self.error = None
        self.payload = payload


class NavigationBehaviorTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.sublime, _ = install_fake_modules()
        cls.search = importlib.import_module('PairOfCleats.commands.search')

    def setUp(self):
        self.window = FakeWindow()
        self.view = FakeView('C:/repo/src/current.js', 'WidgetBuilder')
        self.view.set_window(self.window)
        self.window.set_active_view(self.view)
        self.view._selection = [FakeRegion(0, 0)]
        self._originals = {
            'get_settings': self.search.config.get_settings,
            'validate_settings': self.search.config.validate_settings,
            'resolve_repo_root': self.search.paths.resolve_repo_root,
            'resolve_cli': self.search.paths.resolve_cli,
            'build_env': self.search.config.build_env,
            'run_process': self.search.runner.run_process,
        }
        self.search.config.get_settings = lambda _window: {}
        self.search.config.validate_settings = lambda _settings, _repo_root, workflow=None: []
        self.search.paths.resolve_repo_root = (
            lambda _window, return_reason=True, path_hint=None, allow_fallback=True: ('C:/repo', None)
            if return_reason else 'C:/repo'
        )
        self.search.paths.resolve_cli = lambda _settings, _repo_root: {
            'command': 'pairofcleats',
            'args_prefix': [],
            'source': 'path',
        }
        self.search.config.build_env = lambda _settings: {}

    def tearDown(self):
        for key, value in self._originals.items():
            if key == 'get_settings':
                self.search.config.get_settings = value
            elif key == 'validate_settings':
                self.search.config.validate_settings = value
            elif key == 'resolve_repo_root':
                self.search.paths.resolve_repo_root = value
            elif key == 'resolve_cli':
                self.search.paths.resolve_cli = value
            elif key == 'build_env':
                self.search.config.build_env = value
            elif key == 'run_process':
                self.search.runner.run_process = value

    def test_goto_definition_opens_exact_hit(self):
        payload = {
            'ok': True,
            'code': [{'file': 'src/defs.js', 'startLine': 12, 'name': 'WidgetBuilder'}],
        }
        self._install_payload(payload)
        command = self.search.PairOfCleatsGotoDefinitionCommand(self.view)
        command.run(edit=None)
        expected = '{0}:12'.format(os.path.join('C:/repo', 'src/defs.js'))
        self.assertEqual(self.window.opened_files[0]['path'], expected)

    def test_find_references_shows_picker(self):
        payload = {
            'ok': True,
            'code': [
                {'file': 'src/a.js', 'startLine': 3, 'name': 'WidgetBuilder'},
                {'file': 'src/b.js', 'startLine': 9, 'name': 'WidgetBuilder'},
            ],
        }
        self._install_payload(payload)
        command = self.search.PairOfCleatsFindReferencesCommand(self.view)
        command.run(edit=None)
        self.assertEqual(len(self.window.quick_panel_items), 2)
        self.window.quick_panel_callback(1)
        expected = '{0}:9'.format(os.path.join('C:/repo', 'src/b.js'))
        self.assertEqual(self.window.opened_files[-1]['path'], expected)

    def test_complete_symbol_applies_selected_completion(self):
        payload = {
            'ok': True,
            'code': [
                {'file': 'src/a.js', 'startLine': 3, 'name': 'WidgetBuilder'},
                {'file': 'src/b.js', 'startLine': 9, 'name': 'WidgetFactory'},
            ],
        }
        self._install_payload(payload)
        command = self.search.PairOfCleatsCompleteSymbolCommand(self.view)
        command.run(edit=None)
        self.assertEqual(len(self.window.quick_panel_items), 2)
        self.window.quick_panel_callback(1)
        self.assertEqual(self.view.text, 'WidgetFactory')

    def test_navigation_no_hits_reports_predictable_status(self):
        self._install_payload({'ok': True, 'code': []})
        command = self.search.PairOfCleatsGotoDefinitionCommand(self.view)
        command.run(edit=None)
        self.assertEqual(self.sublime.last_status, 'PairOfCleats: no indexed definitions found.')

    def _install_payload(self, payload):
        def _run_process(command, args, cwd=None, env=None, window=None, title=None, capture_json=None, on_done=None, stream_output=None):
            on_done(_FakeResult(payload))

        self.search.runner.run_process = _run_process


if __name__ == '__main__':
    unittest.main()
