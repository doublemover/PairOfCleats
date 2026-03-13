import importlib
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(__file__))

from runtime_harness import FakeWindow, install_fake_modules


class ResultsBehaviorTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        install_fake_modules()
        cls.results = importlib.import_module('PairOfCleats.lib.results')
        cls.results_state = importlib.import_module('PairOfCleats.lib.results_state')
        cls.search = importlib.import_module('PairOfCleats.commands.search')

    def test_reopen_last_results_replays_quick_panel_and_open_hit(self):
        window = FakeWindow()
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
        window = FakeWindow()
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
        window = FakeWindow()
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
