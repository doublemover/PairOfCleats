import importlib
import json
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(__file__))

from runtime_harness import FakeView, FakeWindow, install_fake_modules


class _FakeResult:
    def __init__(self, payload):
        self.returncode = 0
        self.output = ''
        self.error = None
        self.payload = payload


class AnalysisBehaviorTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.sublime, _ = install_fake_modules()
        cls.analysis = importlib.import_module('PairOfCleats.commands.analysis')
        cls.results = importlib.import_module('PairOfCleats.lib.results')
        cls.results_state = importlib.import_module('PairOfCleats.lib.results_state')
        cls.fixture_repo = os.path.abspath(
            os.path.join(os.path.dirname(__file__), '..', '..', 'fixtures', 'sample')
        )

    def setUp(self):
        self.window = FakeWindow()
        self.view = FakeView(os.path.join(self.fixture_repo, 'src', 'index.js'), 'buildWidget')
        self.view.set_window(self.window)
        self.window.set_active_view(self.view)
        self._originals = {
            'get_settings': self.analysis.config.get_settings,
            'validate_settings': self.analysis.config.validate_settings,
            'resolve_repo_root': self.analysis.paths.resolve_repo_root,
            'resolve_cli': self.analysis.paths.resolve_cli,
            'build_env': self.analysis.config.build_env,
            'run_process': self.analysis.runner.run_process,
        }
        self.analysis.config.get_settings = lambda _window: {}
        self.analysis.config.validate_settings = lambda _settings, _repo_root: []
        self.analysis.paths.resolve_repo_root = (
            lambda _window, return_reason=True, path_hint=None: (self.fixture_repo, None)
            if return_reason else self.fixture_repo
        )
        self.analysis.paths.resolve_cli = lambda _settings, _repo_root: {
            'command': 'pairofcleats',
            'args_prefix': [],
            'source': 'path',
        }
        self.analysis.config.build_env = lambda _settings: {}
        self.analysis.runner.run_process = self._run_process

    def tearDown(self):
        for key, value in self._originals.items():
            if key == 'get_settings':
                self.analysis.config.get_settings = value
            elif key == 'validate_settings':
                self.analysis.config.validate_settings = value
            elif key == 'resolve_repo_root':
                self.analysis.paths.resolve_repo_root = value
            elif key == 'resolve_cli':
                self.analysis.paths.resolve_cli = value
            elif key == 'build_env':
                self.analysis.config.build_env = value
            elif key == 'run_process':
                self.analysis.runner.run_process = value

    def test_context_pack_panel_export_reopen_and_actions(self):
        with tempfile.TemporaryDirectory() as temp_root:
            out_path = os.path.join(temp_root, 'context-pack.json')
            command = self.analysis.PairOfCleatsContextPackCommand(self.window)
            command.run(seed='file:src/index.js', export_json=True, out_path=out_path)

            panel = self.window.panels[self.results.RESULTS_PANEL]
            self.assertIn('PairOfCleats context pack', panel.appended)
            self.assertIn('Repo Evidence', panel.appended)
            self.assertTrue(os.path.exists(out_path))

            with open(out_path, 'r', encoding='utf-8') as handle:
                payload = json.load(handle)
            self.assertEqual(payload['primary']['file'], 'src/index.js')

            session = self.results_state.get_last_context_pack(self.window)
            self.assertEqual(session['analysisKind'], 'context-pack')
            self.assertEqual(session['jsonPath'], out_path)

            self.analysis.PairOfCleatsReopenLastContextPackCommand(self.window).run()
            reopened = self.window.panels[self.results.RESULTS_PANEL]
            self.assertIn('PairOfCleats context pack', reopened.appended)

            action_command = self.analysis.PairOfCleatsAnalysisActionsCommand(self.window)
            action_command.run(source='context_pack', hit_index=0, action='copy_path')
            self.assertTrue(self.sublime.clipboard.replace('\\', '/').endswith('src/index.js'))

            action_command.run(source='context_pack', hit_index=2, action='open')
            opened = self.window.opened_files[-1]['path'].replace('\\', '/')
            self.assertIn('src/util.js:7', opened)

    def test_risk_explain_panel_reopen_and_actions(self):
        command = self.analysis.PairOfCleatsRiskExplainCommand(self.window)
        command.run(chunk='chunk-risk')

        panel = self.window.panels[self.results.RESULTS_PANEL]
        self.assertIn('PairOfCleats risk explain', panel.appended)
        self.assertIn('Flows', panel.appended)

        session = self.results_state.get_last_risk_explain(self.window)
        self.assertEqual(session['analysisKind'], 'risk-explain')

        self.analysis.PairOfCleatsReopenLastRiskExplainCommand(self.window).run()
        reopened = self.window.panels[self.results.RESULTS_PANEL]
        self.assertIn('PairOfCleats risk explain', reopened.appended)

        action_command = self.analysis.PairOfCleatsAnalysisActionsCommand(self.window)
        action_command.run(source='risk_explain', hit_index=2, action='open_new_group')
        opened = self.window.opened_files[-1]['path'].replace('\\', '/')
        self.assertIn('src/util.js:7', opened)
        self.assertEqual(self.window.current_group, 1)

    def _run_process(self, command, args, cwd=None, env=None, window=None, title=None,
                     capture_json=None, on_done=None, stream_output=None, panel_name='pairofcleats'):
        payload = self._payload_for_args(args)
        if on_done:
            on_done(_FakeResult(payload))

    def _payload_for_args(self, args):
        args = list(args or [])
        if args and args[0] == 'context-pack':
            return {
                'primary': {
                    'file': 'src/index.js',
                    'range': {'startLine': 1, 'endLine': 8},
                    'excerpt': 'export function buildWidget() {'
                },
                'repoEvidence': {
                    'queries': [
                        {
                            'query': 'buildWidget',
                            'hits': [
                                {
                                    'file': 'src/index.js',
                                    'startLine': 1,
                                    'endLine': 3,
                                    'name': 'buildWidget',
                                    'section': 'code',
                                },
                                {
                                    'file': 'src/util.js',
                                    'startLine': 7,
                                    'endLine': 9,
                                    'headline': 'helper use',
                                    'section': 'code',
                                },
                            ],
                        }
                    ]
                },
                'risk': {
                    'status': 'ok',
                    'summary': {
                        'totals': {
                            'sources': 1,
                            'sinks': 1,
                            'sanitizers': 0,
                            'localFlows': 1,
                        }
                    },
                    'flows': [
                        {
                            'flowId': 'flow-1',
                            'evidence': {
                                'callSitesByStep': [
                                    [
                                        {
                                            'details': {
                                                'file': 'src/util.js',
                                                'startLine': 7,
                                                'endLine': 7,
                                                'calleeNormalized': 'helper',
                                            }
                                        }
                                    ]
                                ]
                            }
                        }
                    ]
                }
            }
        return {
            'chunk': {
                'chunkUid': 'chunk-risk',
                'file': 'src/index.js',
                'name': 'buildWidget',
                'kind': 'function',
            },
            'summary': {
                'sources': {'count': 1},
                'sinks': {'count': 1},
                'localFlows': {'count': 1},
            },
            'flows': [
                {
                    'flowId': 'flow-risk-1',
                    'confidence': 0.95,
                    'source': {'ruleId': 'source.input'},
                    'sink': {'ruleId': 'sink.exec'},
                    'callSitesByStep': [
                        [
                            {
                                'callSiteId': 'cs-1',
                                'details': {
                                    'file': 'src/index.js',
                                    'startLine': 3,
                                    'endLine': 3,
                                    'calleeNormalized': 'buildWidget',
                                }
                            }
                        ],
                        [
                            {
                                'callSiteId': 'cs-2',
                                'details': {
                                    'file': 'src/util.js',
                                    'startLine': 7,
                                    'endLine': 7,
                                    'calleeNormalized': 'helper',
                                }
                            }
                        ]
                    ]
                }
            ]
        }


if __name__ == '__main__':
    unittest.main()
