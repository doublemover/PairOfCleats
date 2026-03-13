import importlib
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(__file__))

from runtime_harness import FakeRegion, FakeView, FakeWindow, install_fake_modules


class _RunningProcess:
    def poll(self):
        return None


class _Handle:
    def __init__(self):
        self.process = _RunningProcess()

    def cancel(self):
        return None


class VisibilityBehaviorTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.sublime, _ = install_fake_modules()
        cls.search = importlib.import_module('PairOfCleats.commands.search')
        cls.map_commands = importlib.import_module('PairOfCleats.commands.map')
        cls.index = importlib.import_module('PairOfCleats.commands.index')
        cls.runtime = importlib.import_module('PairOfCleats.commands.runtime')
        cls.tasks = importlib.import_module('PairOfCleats.lib.tasks')
        cls.watch = importlib.import_module('PairOfCleats.lib.watch')
        cls.map_state = importlib.import_module('PairOfCleats.lib.map_state')

    def setUp(self):
        self.sublime.reset()
        self.window = FakeWindow()
        self.sublime.set_active_window(self.window)

    def tearDown(self):
        self.tasks.clear_all()
        self.watch.stop_all('test')
        self.watch.clear_if_done(self.window)

    def test_text_commands_follow_view_selection_and_symbol_visibility(self):
        view = FakeView('C:/repo/src/app.js', 'const sample = 1;')
        view.set_window(self.window)
        self.window.set_active_view(view)

        selection = self.search.PairOfCleatsSearchSelectionCommand(view)
        symbol = self.search.PairOfCleatsSearchSymbolUnderCursorCommand(view)
        goto_def = self.search.PairOfCleatsGotoDefinitionCommand(view)

        self.assertTrue(selection.is_visible())
        self.assertFalse(selection.is_enabled())
        self.assertTrue(symbol.is_visible())
        self.assertTrue(symbol.is_enabled())
        self.assertTrue(goto_def.is_visible())
        self.assertTrue(goto_def.is_enabled())

        view.sel().clear()
        view.sel().append(FakeRegion(0, 0))
        self.assertFalse(selection.is_enabled())

        view.sel().clear()
        view.sel().append(FakeRegion(0, 6))
        self.assertTrue(symbol.is_enabled())

        view.sel().clear()
        view.sel().append(FakeRegion(13, 13))
        self.assertFalse(symbol.is_enabled())
        self.assertFalse(goto_def.is_enabled())

        view.sel().clear()
        view.sel().append(FakeRegion(6, 12))
        self.assertTrue(selection.is_enabled())

    def test_map_visibility_tracks_active_file_and_map_state(self):
        no_file_view = FakeView(None, 'const sample = 1;')
        no_file_view.set_window(self.window)
        self.window.set_active_view(no_file_view)

        map_file = self.map_commands.PairOfCleatsMapCurrentFileCommand(self.window)
        jump = self.map_commands.PairOfCleatsMapJumpToNodeCommand(self.window)
        report = self.map_commands.PairOfCleatsMapShowLastReportCommand(self.window)
        self.assertFalse(map_file.is_enabled())
        self.assertFalse(map_file.is_visible())
        self.assertFalse(jump.is_visible())
        self.assertFalse(report.is_visible())

        with tempfile.TemporaryDirectory() as tmp:
            node_path = os.path.join(tmp, 'nodes.json')
            with open(node_path, 'w', encoding='utf8') as handle:
                handle.write('{"nodes": []}')
            self.map_state.record_last_map(self.window, {
                'repo': tmp,
                'nodeListPath': node_path,
                'reportText': 'ok',
                'outPath': os.path.join(tmp, 'map.html'),
            })
            self.assertTrue(jump.is_visible())
            self.assertTrue(jump.is_enabled())
            self.assertTrue(report.is_visible())
            self.assertTrue(report.is_enabled())

    def test_index_watch_visibility_tracks_repo_and_running_watch(self):
        start = self.index.PairOfCleatsIndexWatchStartCommand(self.window)
        stop = self.index.PairOfCleatsIndexWatchStopCommand(self.window)
        self.assertFalse(start.is_visible())
        self.assertFalse(stop.is_visible())

        with tempfile.TemporaryDirectory() as tmp:
            repo = os.path.join(tmp, 'repo')
            os.makedirs(os.path.join(repo, '.git'))
            self.window.set_folders([repo])
            self.assertTrue(start.is_visible())
            self.assertTrue(start.is_enabled())
            self.assertFalse(stop.is_visible())
            token = self.watch.register(self.window, _Handle(), repo)
            self.assertFalse(start.is_enabled())
            self.assertTrue(stop.is_visible())
            self.assertTrue(stop.is_enabled())
            self.watch.clear_if_done(self.window, token=token)

    def test_runtime_visibility_tracks_active_and_cancellable_tasks(self):
        show = self.runtime.PairOfCleatsShowProgressCommand(self.window)
        cancel = self.runtime.PairOfCleatsCancelActiveTaskCommand(self.window)
        self.assertFalse(show.is_visible())
        self.assertFalse(cancel.is_visible())

        task = self.tasks.start_task(
            self.window,
            'PairOfCleats search',
            kind='search',
            cancellable=True,
            cancel=lambda: None,
            details='Running...',
            show_panel=False,
        )
        self.assertIsNotNone(task)
        self.assertTrue(show.is_visible())
        self.assertTrue(show.is_enabled())
        self.assertTrue(cancel.is_visible())
        self.assertTrue(cancel.is_enabled())


if __name__ == '__main__':
    unittest.main()
