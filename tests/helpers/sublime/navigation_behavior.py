import hashlib
import importlib
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(__file__))

from runtime_harness import FakeRegion, FakeView, FakeWindow, install_fake_modules, isolated_temp_directory


class SourceView(FakeView):
    def is_dirty(self):
        return False

    def is_loading(self):
        return False

    def show(self, region):
        self.shown = region


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
        cls.operations = importlib.import_module('PairOfCleats.lib.operations')

    def setUp(self):
        self.operations.activate()
        temporary = isolated_temp_directory()
        self.repo = temporary.__enter__()
        self.addCleanup(temporary.__exit__, None, None, None)
        os.mkdir(os.path.join(self.repo, 'src'))
        source_file = os.path.join(self.repo, 'src', 'current.js')
        with open(source_file, 'wb') as handle:
            handle.write(b'WidgetBuilder')
        self.window = FakeWindow()
        self.window.set_folders([self.repo])
        self.view = SourceView(source_file, 'WidgetBuilder')
        self.view.set_window(self.window)
        self.window.set_active_view(self.view)
        self.view._selection = [FakeRegion(0, 0)]
        self._originals = {
            'get_settings': self.search.config.get_settings,
            'resolve_execution_mode': self.search.config.resolve_execution_mode,
            'validate_settings': self.search.config.validate_settings,
            'resolve_repo_root': self.search.paths.resolve_repo_root,
            'resolve_cli': self.search.paths.resolve_cli,
            'build_env': self.search.config.build_env,
            'run_process': self.search.runner.run_process,
        }
        self.search.config.get_settings = lambda _window: {}
        self.search.config.resolve_execution_mode = lambda _settings, _workflow: {'mode': 'cli'}
        self.search.config.validate_settings = lambda _settings, _repo_root, workflow=None: []
        self.search.paths.resolve_repo_root = (
            lambda _window, return_reason=True, path_hint=None, allow_fallback=True: (self.repo, None)
            if return_reason else self.repo
        )
        self.search.paths.resolve_cli = lambda _settings, _repo_root: {
            'command': 'pairofcleats',
            'args_prefix': [],
            'source': 'path',
        }
        self.search.config.build_env = lambda _settings: {}

        def open_file(encoded_path, flags=0):
            filename = encoded_path.rsplit(':', 1)[0]
            with open(filename, encoding='utf-8') as handle:
                opened = SourceView(filename, handle.read())
            self.window.opened_files.append({'path': encoded_path, 'flags': flags, 'view': opened})
            self.window.set_active_view(opened)
            return opened
        self.window.open_file = open_file

    def tearDown(self):
        for key, value in self._originals.items():
            if key == 'get_settings':
                self.search.config.get_settings = value
            elif key == 'resolve_execution_mode':
                self.search.config.resolve_execution_mode = value
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
            'results': [{'file': 'src/defs.js', 'startLine': 12, 'name': 'WidgetBuilder'}],
        }
        self._install_payload(payload)
        command = self.search.PairOfCleatsGotoDefinitionCommand(self.view)
        command.run(edit=None)
        expected = '{0}:12'.format(os.path.join(self.repo, 'src', 'defs.js'))
        self.assertEqual(self.window.opened_files[0]['path'], expected)

    def test_find_references_shows_picker(self):
        payload = {
            'ok': True,
            'results': [
                {'file': 'src/a.js', 'startLine': 3, 'name': 'WidgetBuilder'},
                {'file': 'src/b.js', 'startLine': 9, 'name': 'WidgetBuilder'},
            ],
        }
        self._install_payload(payload)
        command = self.search.PairOfCleatsFindReferencesCommand(self.view)
        command.run(edit=None)
        self.assertEqual(len(self.window.quick_panel_items), 2)
        self.window.quick_panel_callback(1)
        expected = '{0}:9'.format(os.path.join(self.repo, 'src', 'b.js'))
        self.assertEqual(self.window.opened_files[-1]['path'], expected)

    def test_complete_symbol_applies_selected_completion(self):
        payload = {
            'ok': True,
            'results': [
                {'file': 'src/a.js', 'startLine': 3, 'name': 'WidgetBuilder'},
                {'file': 'src/b.js', 'startLine': 9, 'name': 'WidgetFactory'},
            ],
        }
        self._install_payload(payload, completion=True)
        command = self.search.PairOfCleatsCompleteSymbolCommand(self.view)
        command.run(edit=None)
        self.assertEqual(len(self.window.quick_panel_items), 2)
        self.window.quick_panel_callback(1)
        self.assertEqual(self.view.text, 'WidgetFactory')

    def test_navigation_no_hits_reports_predictable_status(self):
        self._install_payload({'ok': True, 'results': []})
        command = self.search.PairOfCleatsGotoDefinitionCommand(self.view)
        command.run(edit=None)
        self.assertEqual(self.sublime.last_status, 'PairOfCleats: no indexed definitions found.')

    def _install_payload(self, payload, completion=False):
        source_hash = hashlib.sha256(b'WidgetBuilder').hexdigest()
        payload.update(status='resolved', binding={'status': 'resolved'}, sourceHash=source_hash,
                       sourceVersion='0', coordinateUnit='utf16')
        for row in payload['results']:
            content = ('\n' * (row['startLine'] - 1) + row['name'] + '\n').encode('utf-8')
            with open(os.path.join(self.repo, row['file']), 'wb') as handle:
                handle.write(content)
            row.update(sourceHash=hashlib.sha256(content).hexdigest(), coordinateUnit='utf16',
                       startCol=1, endLine=row['startLine'], endCol=len(row['name']) + 1)

        def _run_process(command, args, cwd=None, env=None, window=None, title=None, capture_json=None,
                         on_done=None, stream_output=None, timeout_ms=None, operation_scope=None):
            if completion:
                self.assertEqual(args[:2], ['search', '--json'])
            else:
                self.assertEqual(args[:2], ['tooling', 'navigate'])
                self.assertEqual(args[args.index('--source-hash') + 1], source_hash)
                self.assertEqual(args[args.index('--source-version') + 1], '0')
                self.assertEqual(timeout_ms, 5000)
            self.assertTrue(operation_scope)
            on_done(_FakeResult({'ok': True, 'code': payload['results']} if completion else payload))

        self.search.runner.run_process = _run_process


if __name__ == '__main__':
    unittest.main()
