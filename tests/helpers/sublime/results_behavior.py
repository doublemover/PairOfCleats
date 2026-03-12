import importlib
import os
import sys
import unittest

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
PACKAGE_ROOT = os.path.join(REPO_ROOT, 'sublime')
if PACKAGE_ROOT not in sys.path:
    sys.path.insert(0, PACKAGE_ROOT)


class _FakeSettings:
    def __init__(self):
        self._data = {}

    def get(self, key, default=None):
        return self._data.get(key, default)

    def set(self, key, value):
        self._data[key] = value


class _FakeRegion:
    def __init__(self, a, b):
        self.a = a
        self.b = b


class _FakeView:
    def __init__(self, file_name=None):
        self._file_name = file_name
        self._settings = _FakeSettings()
        self.appended = ''
        self.read_only = False
        self.name = ''
        self.scratch = False
        self.regions = {}

    def file_name(self):
        return self._file_name

    def settings(self):
        return self._settings

    def set_name(self, value):
        self.name = value

    def set_scratch(self, value):
        self.scratch = value

    def set_read_only(self, value):
        self.read_only = value

    def run_command(self, name, args=None):
        if name == 'append':
            self.appended += (args or {}).get('characters', '')
        elif name == 'right_delete':
            self.appended = ''

    def erase_regions(self, key):
        self.regions.pop(key, None)

    def add_regions(self, key, regions, scope, flags=0):
        self.regions[key] = {'regions': regions, 'scope': scope, 'flags': flags}

    def text_point(self, row, col):
        return row * 1000 + col

    def full_line(self, region):
        return region

    def is_loading(self):
        return False


class _FakeWindow:
    def __init__(self):
        self._project_data = {}
        self.quick_panel_items = None
        self.quick_panel_callback = None
        self.panels = {}
        self.new_views = []
        self.opened_files = []
        self.group_count = 1
        self.current_group = 0
        self.commands = []

    def project_data(self):
        return self._project_data

    def set_project_data(self, value):
        self._project_data = value

    def show_quick_panel(self, items, on_select, selected_index=-1):
        self.quick_panel_items = items
        self.quick_panel_callback = on_select

    def create_output_panel(self, name):
        panel = self.panels.get(name)
        if panel is None:
            panel = _FakeView()
            self.panels[name] = panel
        return panel

    def new_file(self):
        view = _FakeView()
        self.new_views.append(view)
        return view

    def open_file(self, encoded_path, flags=0):
        view = _FakeView(encoded_path.split(':', 1)[0])
        self.opened_files.append({'path': encoded_path, 'flags': flags, 'view': view})
        return view

    def run_command(self, name, args=None):
        self.commands.append({'name': name, 'args': args})
        if name == 'new_pane':
            self.group_count += 1

    def num_groups(self):
        return self.group_count

    def active_group(self):
        return self.current_group

    def focus_group(self, index):
        self.current_group = index

    def folders(self):
        return []


class _FakeWindowCommand:
    def __init__(self, window=None):
        self.window = window


class _FakeTextCommand:
    def __init__(self, view=None):
        self.view = view


class _FakeEventListener:
    pass


class ResultsBehaviorTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls._install_fake_modules()
        cls.results = importlib.import_module('PairOfCleats.lib.results')
        cls.results_state = importlib.import_module('PairOfCleats.lib.results_state')
        cls.search = importlib.import_module('PairOfCleats.commands.search')

    @classmethod
    def _install_fake_modules(cls):
        class _FakeSublimeModule:
            ENCODED_POSITION = 1
            Region = _FakeRegion
            clipboard = ''

            @staticmethod
            def set_timeout(callback, delay=0):
                callback()

            @staticmethod
            def set_clipboard(value):
                _FakeSublimeModule.clipboard = value

            @staticmethod
            def status_message(message):
                _FakeSublimeModule.last_status = message

            @staticmethod
            def error_message(message):
                _FakeSublimeModule.last_error = message

            @staticmethod
            def active_window():
                return None

        class _FakeSublimePluginModule:
            WindowCommand = _FakeWindowCommand
            TextCommand = _FakeTextCommand
            EventListener = _FakeEventListener

        sys.modules['sublime'] = _FakeSublimeModule
        sys.modules['sublime_plugin'] = _FakeSublimePluginModule

    def test_reopen_last_results_replays_quick_panel_and_open_hit(self):
        window = _FakeWindow()
        hits = [{'file': 'src/app.js', 'startLine': 7, 'name': 'Thing', 'section': 'code'}]
        session = self.results.build_session(
            'Thing',
            {'mode': 'code', 'backend': '', 'limit': 25},
            'C:/repo',
            hits,
            'quick_panel',
        )
        self.results_state.record_last_results(window, session)
        command = self.search.PairOfCleatsReopenLastResultsCommand(window)
        command.run()
        self.assertEqual(len(window.quick_panel_items), 1)
        window.quick_panel_callback(0)
        expected_path = '{0}:7'.format(os.path.join('C:/repo', 'src/app.js'))
        self.assertEqual(window.opened_files[0]['path'], expected_path)
        view = window.opened_files[0]['view']
        self.assertIn(self.results.HIGHLIGHT_KEY, view.regions)

    def test_reopen_last_explain_restores_output_panel(self):
        window = _FakeWindow()
        hits = [{'file': 'src/app.js', 'startLine': 5, 'scoreBreakdown': {'bm25': 1.2}}]
        session = self.results.build_session(
            'query',
            {'mode': 'code', 'backend': '', 'limit': 25},
            'C:/repo',
            hits,
            'output_panel',
            explain=True,
        )
        self.results_state.record_last_explain(window, session)
        command = self.search.PairOfCleatsReopenLastExplainCommand(window)
        command.run()
        panel = window.panels[self.results.RESULTS_PANEL]
        self.assertIn('PairOfCleats explain', panel.appended)
        stored = panel.settings().get(self.results.EXPLAIN_SESSION_KEY)
        self.assertEqual(stored.get('query'), 'query')

    def test_result_actions_copy_path_open_group_and_rerun(self):
        window = _FakeWindow()
        hits = [
            {
                'file': 'src/app.js',
                'startLine': 9,
                'name': 'WidgetBuilder',
                'headline': 'build widget',
                'section': 'code',
            }
        ]
        session = self.results.build_session(
            'WidgetBuilder',
            {'mode': 'code', 'backend': '', 'limit': 25},
            'C:/repo',
            hits,
            'quick_panel',
        )
        self.results_state.record_last_results(window, session)
        captured = {}
        original = self.search._search_with_query

        def _capture(_window, query, overrides=None, force_prompt=False):
            captured['query'] = query
            captured['overrides'] = overrides

        self.search._search_with_query = _capture
        try:
            command = self.search.PairOfCleatsResultActionsCommand(window)
            command.run(hit_index=0, action='copy_path')
            self.assertEqual(
                sys.modules['sublime'].clipboard,
                os.path.join('C:/repo', 'src/app.js'),
            )

            command.run(hit_index=0, action='open_new_group')
            self.assertEqual(window.current_group, 1)
            expected_path = '{0}:9'.format(os.path.join('C:/repo', 'src/app.js'))
            self.assertEqual(window.opened_files[-1]['path'], expected_path)

            command.run(hit_index=0, action='rerun_context')
            self.assertEqual(captured.get('query'), 'WidgetBuilder')
            self.assertEqual(captured.get('overrides', {}).get('mode'), 'code')
        finally:
            self.search._search_with_query = original


if __name__ == '__main__':
    unittest.main()
