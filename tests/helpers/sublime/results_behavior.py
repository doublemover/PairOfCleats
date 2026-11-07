import importlib
import os
import sys
import unittest
from unittest.mock import patch

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
        expected_path = '{0}:7'.format(os.path.abspath(os.path.join('C:/repo', 'src/app.js')))
        self.assertEqual(window.opened_files[0]['path'], expected_path)
        view = window.opened_files[0]['view']
        self.assertIn(self.results.HIGHLIGHT_KEY, view.regions)

    def test_saved_sessions_and_reopen_keep_original_nested_evidence(self):
        window = FakeWindow()
        hit = {'file': 'original.py', 'startLine': 1, 'ref': {'symbol': {'id': 'original-symbol'}},
               'sourceEvidence': {'warnings': [{'code': 'original-frontier'}]}}
        payload = {'code': [hit]}
        collected = self.results.collect_hits(payload)
        hit['ref']['symbol']['id'] = 'transport-replacement'
        self.assertEqual(collected[0]['ref']['symbol']['id'], 'original-symbol')
        session = self.results.build_session('original', {}, 'C:/repo', collected, 'quick_panel')
        self.results_state.record_last_results(window, session)
        session['hits'][0]['sourceEvidence']['warnings'][0]['code'] = 'caller-replacement'
        saved = self.results_state.get_last_results(window)
        self.assertEqual(saved['hits'][0]['sourceEvidence']['warnings'][0]['code'], 'original-frontier')
        saved['hits'][0]['ref']['symbol']['id'] = 'reader-replacement'
        current = self.results_state.get_last_results(window)
        self.assertEqual(current['hits'][0]['ref']['symbol']['id'], 'original-symbol')

        with patch.object(self.results, 'open_hit') as opened:
            self.results.reopen_session(window, current)
            current['hits'][0]['ref']['symbol']['id'] = 'native-wait-replacement'
            selected = window.quick_panel_callback
            selected(0)
            selected(0)
            self.assertEqual(opened.call_count, 1)
            self.assertEqual(opened.call_args[0][1]['ref']['symbol']['id'], 'original-symbol')
            self.results.reopen_session(window, self.results_state.get_last_results(window))
            cancelled = window.quick_panel_callback
            cancelled(-1)
            cancelled(0)
            self.assertEqual(opened.call_count, 1)

        panel_session = self.results_state.get_last_results(window)
        panel = self.results.open_output_panel(window, 'original evidence', session=panel_session)
        panel_session['hits'][0]['ref']['symbol']['id'] = 'panel-caller-replacement'
        self.assertEqual(panel.settings().get(self.results.RESULTS_SESSION_KEY)['hits'][0]['ref']['symbol']['id'],
                         'original-symbol')

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

        def _capture(_window, query, overrides=None, force_prompt=False, operation_scope=None):
            captured['query'] = query
            captured['overrides'] = overrides
            self.assertIsNotNone(operation_scope)

        self.search._search_with_query = _capture
        try:
            command = self.search.PairOfCleatsResultActionsCommand(window)
            command.run(hit_index=0, action='copy_path')
            self.assertEqual(
                sys.modules['sublime'].clipboard,
                os.path.abspath(os.path.join('C:/repo', 'src/app.js')),
            )

            command.run(hit_index=0, action='open_new_group')
            self.assertEqual(window.current_group, 1)
            expected_path = '{0}:9'.format(os.path.abspath(os.path.join('C:/repo', 'src/app.js')))
            self.assertEqual(window.opened_files[-1]['path'], expected_path)

            command.run(hit_index=0, action='rerun_context')
            self.assertEqual(captured.get('query'), 'WidgetBuilder')
            self.assertEqual(captured.get('overrides', {}).get('mode'), 'code')
        finally:
            self.search._search_with_query = original


if __name__ == '__main__':
    unittest.main()
