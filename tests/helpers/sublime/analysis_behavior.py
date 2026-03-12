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
        self.sublime.reset()
        self.window = FakeWindow()
        self.view = FakeView(os.path.join(self.fixture_repo, 'src', 'index.js'), 'buildWidget')
        self.view.set_window(self.window)
        self.window.set_active_view(self.view)
        self.runner_calls = []
        self._originals = {
            'get_settings': self.analysis.config.get_settings,
            'validate_settings': self.analysis.config.validate_settings,
            'resolve_repo_root': self.analysis.paths.resolve_repo_root,
            'resolve_cli': self.analysis.paths.resolve_cli,
            'build_env': self.analysis.config.build_env,
            'run_process': self.analysis.runner.run_process,
        }
        self.analysis.config.get_settings = lambda _window: {
            'api_execution_mode': 'cli',
            'api_server_url': '',
            'api_timeout_ms': 5000,
        }
        self.analysis.config.validate_settings = lambda _settings, _repo_root, workflow=None: []
        self.analysis.paths.resolve_repo_root = (
            lambda _window, return_reason=True, path_hint=None, allow_fallback=True: (self.fixture_repo, None)
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

    def test_architecture_impact_and_suggest_tests_commands(self):
        self.analysis.PairOfCleatsArchitectureCheckCommand(self.window).run(
            rules_path=os.path.join('rules', 'architecture.rules.json')
        )
        panel = self.window.panels[self.results.RESULTS_PANEL]
        self.assertIn('PairOfCleats architecture check', panel.appended)
        architecture_session = self.results_state.get_last_analysis(self.window, 'architecture_check')
        self.assertEqual(architecture_session['analysisKind'], 'architecture-check')
        self.analysis.PairOfCleatsAnalysisActionsCommand(self.window).run(
            source='architecture_check',
            hit_index=1,
            action='open',
        )
        opened = self.window.opened_files[-1]['path'].replace('\\', '/')
        self.assertIn('src/util.js', opened)

        self.analysis.PairOfCleatsImpactCommand(self.window).run(
            changed=['src/index.js'],
            direction='downstream',
            depth=2,
        )
        panel = self.window.panels[self.results.RESULTS_PANEL]
        self.assertIn('PairOfCleats impact analysis', panel.appended)
        impact_session = self.results_state.get_last_analysis(self.window, 'impact')
        self.assertEqual(impact_session['analysisKind'], 'impact')
        self.analysis.PairOfCleatsReopenAnalysisCommand(self.window).run(source='impact')
        self.analysis.PairOfCleatsAnalysisActionsCommand(self.window).run(
            source='impact',
            hit_index=0,
            action='open',
        )
        opened = self.window.opened_files[-1]['path'].replace('\\', '/')
        self.assertIn('src/util.js', opened)

        self.analysis.PairOfCleatsSuggestTestsCommand(self.window).run(
            changed=['src/index.js'],
            max=7,
        )
        panel = self.window.panels[self.results.RESULTS_PANEL]
        self.assertIn('PairOfCleats suggest tests', panel.appended)
        suggest_session = self.results_state.get_last_analysis(self.window, 'suggest_tests')
        self.assertEqual(suggest_session['analysisKind'], 'suggest-tests')
        self.analysis.PairOfCleatsAnalysisActionsCommand(self.window).run(
            source='suggest_tests',
            hit_index=0,
            action='copy_path',
        )
        self.assertTrue(self.sublime.clipboard.replace('\\', '/').endswith('tests/app.test.js'))

    def test_workspace_commands_render_and_reopen(self):
        workspace_path = os.path.join(self.fixture_repo, '.pairofcleats-workspace.jsonc')
        self.analysis.PairOfCleatsWorkspaceManifestCommand(self.window).run(workspace_path=workspace_path)
        self.analysis.PairOfCleatsWorkspaceStatusCommand(self.window).run(workspace_path=workspace_path)
        self.analysis.PairOfCleatsWorkspaceBuildCommand(self.window).run(workspace_path=workspace_path, concurrency=3)
        self.analysis.PairOfCleatsWorkspaceCatalogCommand(self.window).run(workspace_path=workspace_path)

        panel = self.window.panels[self.results.RESULTS_PANEL]
        self.assertIn('PairOfCleats workspace catalog', panel.appended)
        catalog_session = self.results_state.get_last_analysis(self.window, 'workspace_catalog')
        self.assertEqual(catalog_session['analysisKind'], 'workspace-catalog')
        self.analysis.PairOfCleatsReopenAnalysisCommand(self.window).run(source='workspace_catalog')
        reopened = self.window.panels[self.results.RESULTS_PANEL]
        self.assertIn('workspace-alpha', reopened.appended)
        self.analysis.PairOfCleatsAnalysisActionsCommand(self.window).run(
            source='workspace_catalog',
            hit_index=0,
            action='copy_path',
        )
        self.assertTrue(self.sublime.clipboard.replace('\\', '/').endswith('.pairofcleats-workspace.jsonc'))

    def test_workspace_build_prompts_for_repo_when_multiple_roots_exist(self):
        with tempfile.TemporaryDirectory() as tmp:
            repo_a = os.path.join(tmp, 'repo-a')
            repo_b = os.path.join(tmp, 'repo-b')
            workspace_path = os.path.join(tmp, '.pairofcleats-workspace.jsonc')
            with open(workspace_path, 'w', encoding='utf-8') as handle:
                handle.write('{}\n')

            original_interactive = self.analysis.paths.resolve_repo_root_interactive

            def _interactive(_window, on_done, path_hint=None, allow_fallback=True, prompt='PairOfCleats repo'):
                self.window.quick_panel_items = [
                    [os.path.abspath(repo_a), 'open folder'],
                    [os.path.abspath(repo_b), 'open folder'],
                ]

                def _select(index):
                    if index < 0:
                        on_done(None, 'Repo selection cancelled.')
                        return
                    chosen = os.path.abspath(repo_b if index == 1 else repo_a)
                    on_done(chosen, 'Using selected repo: {0}'.format(chosen))

                self.window.quick_panel_callback = _select

            self.analysis.paths.resolve_repo_root_interactive = _interactive
            try:
                self.analysis.PairOfCleatsWorkspaceBuildCommand(self.window).run(
                    workspace_path=workspace_path,
                    concurrency=3,
                )

                self.assertEqual(self.runner_calls, [])
                self.assertEqual(len(self.window.quick_panel_items), 2)
                self.window.quick_panel_callback(1)
                self.assertEqual(self.runner_calls[0]['cwd'], os.path.abspath(repo_b))
                self.assertTrue(
                    any('Using selected repo:' in message for message in self.sublime.status_history),
                    'expected explicit selected-repo status message',
                )
            finally:
                self.analysis.paths.resolve_repo_root_interactive = original_interactive

    def test_workspace_build_fails_closed_without_repo_root(self):
        with tempfile.TemporaryDirectory() as tmp:
            workspace_dir = os.path.join(tmp, 'workspace')
            os.makedirs(workspace_dir)
            workspace_path = os.path.join(workspace_dir, '.pairofcleats-workspace.jsonc')
            with open(workspace_path, 'w', encoding='utf-8') as handle:
                handle.write('{}\n')
            self.window.set_active_view(None)
            self.window.set_folders([workspace_dir])

            self.analysis.PairOfCleatsWorkspaceBuildCommand(self.window).run(
                workspace_path=workspace_path,
                concurrency=2,
            )

            self.assertEqual(self.runner_calls, [])
            self.assertIn('require an explicit repo root', self.sublime.last_error)

    def test_workspace_build_prefers_repo_root_from_workspace_path_hint(self):
        with tempfile.TemporaryDirectory() as tmp:
            repo_a = os.path.join(tmp, 'repo-a')
            repo_b = os.path.join(tmp, 'repo-b')
            workspace_path = os.path.join(repo_b, '.pairofcleats-workspace.jsonc')
            os.makedirs(os.path.join(repo_a, '.git'))
            os.makedirs(os.path.join(repo_b, '.git'))
            with open(workspace_path, 'w', encoding='utf-8') as handle:
                handle.write('{}\n')
            self.window.set_folders([repo_a, repo_b])
            self.analysis.paths.resolve_repo_root = self._originals['resolve_repo_root']

            self.analysis.PairOfCleatsWorkspaceBuildCommand(self.window).run(workspace_path=workspace_path, concurrency=3)

            self.assertIsNone(self.window.quick_panel_items)
            panel = self.window.panels[self.results.RESULTS_PANEL]
            self.assertIn('PairOfCleats workspace build', panel.appended)
            self.assertEqual(self.sublime.status_history, [])

    def test_workspace_build_fails_closed_without_repo_root(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder = os.path.join(tmp, 'workspace')
            workspace_path = os.path.join(folder, '.pairofcleats-workspace.jsonc')
            os.makedirs(folder)
            with open(workspace_path, 'w', encoding='utf-8') as handle:
                handle.write('{}\n')
            self.window.set_folders([folder])
            self.analysis.paths.resolve_repo_root = self._originals['resolve_repo_root']

            self.analysis.PairOfCleatsWorkspaceBuildCommand(self.window).run(workspace_path=workspace_path, concurrency=3)

            self.assertIn('Repo root not found for the requested path', self.sublime.last_error)
            self.assertIsNone(self.window.quick_panel_items)

    def test_require_api_fails_closed_for_cli_only_analysis_workflows(self):
        self.analysis.config.get_settings = lambda _window: {
            'api_execution_mode': 'require',
            'api_server_url': 'http://127.0.0.1:7464',
            'api_timeout_ms': 5000,
        }

        self.analysis.PairOfCleatsContextPackCommand(self.window).run(seed='file:src/index.js', hops=1)

        self.assertIn('API mode is not supported for context pack.', self.sublime.last_error)

    def _run_process(self, command, args, cwd=None, env=None, window=None, title=None,
                     capture_json=None, on_done=None, stream_output=None, panel_name='pairofcleats'):
        self.runner_calls.append({
            'command': command,
            'args': list(args or []),
            'cwd': cwd,
            'title': title,
        })
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
        if args and args[0] == 'architecture-check':
            return {
                'rules': [{
                    'id': 'forbidden-import',
                    'type': 'deny',
                    'summary': {'violations': 1},
                }],
                'violations': [{
                    'ruleId': 'forbidden-import',
                    'edge': {
                        'edgeType': 'imports',
                        'from': {'type': 'file', 'path': 'src/index.js'},
                        'to': {'type': 'file', 'path': 'src/util.js'},
                    },
                    'evidence': {'note': 'blocked import'},
                }],
                'warnings': [],
            }
        if args and args[0] == 'impact':
            return {
                'direction': 'downstream',
                'depth': 2,
                'impacted': [{
                    'ref': {'type': 'file', 'path': 'src/util.js'},
                    'distance': 1,
                    'witnessPath': {
                        'nodes': [
                            {'path': 'src/index.js'},
                            {'path': 'src/util.js'},
                        ]
                    },
                }],
                'warnings': [],
                'truncation': [],
            }
        if args and args[0] == 'suggest-tests':
            return {
                'suggestions': [{
                    'testPath': 'tests/app.test.js',
                    'score': 0.9,
                    'reason': 'imports changed module',
                }],
                'warnings': [],
            }
        if len(args) >= 2 and args[0] == 'workspace' and args[1] == 'manifest':
            return {
                'ok': True,
                'workspacePath': args[args.index('--workspace') + 1],
                'manifestPath': os.path.join(self.fixture_repo, '.pairofcleats-workspace.manifest.json'),
                'repoSetId': 'workspace-alpha',
                'manifestHash': 'manifest-hash',
                'diagnostics': {'warnings': 1, 'errors': 0},
            }
        if len(args) >= 2 and args[0] == 'workspace' and args[1] == 'status':
            return {
                'ok': True,
                'workspacePath': args[args.index('--workspace') + 1],
                'manifestPath': os.path.join(self.fixture_repo, '.pairofcleats-workspace.manifest.json'),
                'repoSetId': 'workspace-alpha',
                'repos': [{'repoId': 'sample', 'repoRootCanonical': self.fixture_repo}],
            }
        if len(args) >= 2 and args[0] == 'workspace' and args[1] == 'build':
            return {
                'ok': True,
                'workspacePath': args[args.index('--workspace') + 1],
                'manifestPath': os.path.join(self.fixture_repo, '.pairofcleats-workspace.manifest.json'),
                'repoSetId': 'workspace-alpha',
                'diagnostics': {'total': 1, 'failed': 0, 'entries': []},
            }
        if len(args) >= 2 and args[0] == 'workspace' and args[1] == 'catalog':
            return {
                'ok': True,
                'workspacePath': args[args.index('--workspace') + 1],
                'workspaceName': 'Workspace',
                'repoSetId': 'workspace-alpha',
                'cacheRoots': {
                    'workspaceManifestPath': os.path.join(self.fixture_repo, '.pairofcleats-workspace.manifest.json')
                },
                'repos': [{'repoId': 'sample'}],
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
