import importlib
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(__file__))

from runtime_harness import FakeView, FakeWindow, install_fake_modules


class _FakeCliResult:
    def __init__(self, payload):
        self.returncode = 0
        self.output = ''
        self.error = None
        self.payload = payload


class _FakeApiResult:
    def __init__(self, payload, headers=None, error=None):
        self.payload = payload
        self.headers = headers or {}
        self.error = error


class OperatorBehaviorTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.sublime, _ = install_fake_modules()
        cls.operator = importlib.import_module('PairOfCleats.commands.operator')
        cls.fixture_repo = os.path.abspath(
            os.path.join(os.path.dirname(__file__), '..', '..', 'fixtures', 'sample')
        )

    def setUp(self):
        self.sublime.reset()
        self.window = FakeWindow()
        self.view = FakeView(os.path.join(self.fixture_repo, 'src', 'index.js'), 'const sample = 1;')
        self.view.set_window(self.window)
        self.window.set_active_view(self.view)
        self.window.set_folders([self.fixture_repo])
        self.sublime.set_active_window(self.window)
        self.runner_calls = []
        self.api_calls = []
        self._originals = {
            'get_settings': self.operator.config.get_settings,
            'validate_settings': self.operator.config.validate_settings,
            'resolve_repo_root_interactive': self.operator.paths.resolve_repo_root_interactive,
            'resolve_cli': self.operator.paths.resolve_cli,
            'build_env': self.operator.config.build_env,
            'run_process': self.operator.runner.run_process,
            'run_async': self.operator.api_client.run_async,
            'health_json': self.operator.api_client.health_json,
            'status_json': self.operator.api_client.status_json,
        }
        self.operator.config.get_settings = lambda _window: {
            'api_server_url': 'http://127.0.0.1:7464',
            'api_timeout_ms': 5000,
            'api_execution_mode': 'prefer',
        }
        self.operator.config.validate_settings = lambda _settings, _repo_root: []
        self.operator.paths.resolve_repo_root_interactive = self._resolve_repo_root_interactive
        self.operator.paths.resolve_cli = lambda _settings, _repo_root: {
            'command': 'pairofcleats',
            'args_prefix': [],
            'source': 'path',
        }
        self.operator.config.build_env = lambda _settings: {}
        self.operator.runner.run_process = self._run_process
        self.operator.api_client.run_async = self._run_async
        self.operator.api_client.health_json = self._health_json
        self.operator.api_client.status_json = self._status_json

    def tearDown(self):
        for key, value in self._originals.items():
            if key == 'get_settings':
                self.operator.config.get_settings = value
            elif key == 'validate_settings':
                self.operator.config.validate_settings = value
            elif key == 'resolve_repo_root_interactive':
                self.operator.paths.resolve_repo_root_interactive = value
            elif key == 'resolve_cli':
                self.operator.paths.resolve_cli = value
            elif key == 'build_env':
                self.operator.config.build_env = value
            elif key == 'run_process':
                self.operator.runner.run_process = value
            elif key == 'run_async':
                self.operator.api_client.run_async = value
            elif key == 'health_json':
                self.operator.api_client.health_json = value
            elif key == 'status_json':
                self.operator.api_client.status_json = value

    def test_config_dump_runs_cli_and_renders_panel(self):
        command = self.operator.PairOfCleatsShowConfigDumpCommand(self.window)
        self.assertTrue(command.is_enabled())
        command.run()

        self.assertEqual(self.runner_calls[0]['args'], ['config', 'dump', '--json', '--repo', self.fixture_repo])
        panel = self.window.panels[self.operator.CONFIG_PANEL]
        self.assertIn('PairOfCleats config dump', panel.appended)
        self.assertIn('"repoCacheRoot"', panel.appended)

    def test_tooling_doctor_runs_cli_and_renders_panel(self):
        command = self.operator.PairOfCleatsToolingDoctorCommand(self.window)
        self.assertTrue(command.is_enabled())
        command.run()

        self.assertEqual(self.runner_calls[0]['args'], ['tooling', 'doctor', '--json', '--repo', self.fixture_repo])
        panel = self.window.panels[self.operator.DOCTOR_PANEL]
        self.assertIn('PairOfCleats tooling doctor', panel.appended)
        self.assertIn('clangd', panel.appended)

    def test_server_health_and_status_render_panels(self):
        self.operator.PairOfCleatsServerHealthCommand(self.window).run()
        self.operator.PairOfCleatsServerStatusCommand(self.window).run()

        self.assertEqual(self.api_calls[0]['kind'], 'health')
        self.assertEqual(self.api_calls[1]['kind'], 'status')
        health_panel = self.window.panels[self.operator.HEALTH_PANEL]
        status_panel = self.window.panels[self.operator.STATUS_PANEL]
        self.assertIn('PairOfCleats server health', health_panel.appended)
        self.assertIn('Uptime:', health_panel.appended)
        self.assertIn('PairOfCleats server status', status_panel.appended)
        self.assertIn(self.fixture_repo, status_panel.appended)

    def test_index_health_renders_health_focus(self):
        self.operator.PairOfCleatsIndexHealthCommand(self.window).run()

        panel = self.window.panels[self.operator.INDEX_HEALTH_PANEL]
        self.assertIn('PairOfCleats index health', panel.appended)
        self.assertIn('sqlite prose db missing', panel.appended)
        self.assertIn('Run `PairOfCleats: Index Build (All)`', panel.appended)

    def test_operator_enablement_gates_on_repo_and_api_context(self):
        self.operator.config.get_settings = lambda _window: {
            'api_server_url': '',
            'api_timeout_ms': 5000,
            'api_execution_mode': 'cli',
        }
        self.window.set_active_view(None)
        self.window.set_folders([])

        self.assertFalse(self.operator.PairOfCleatsShowConfigDumpCommand(self.window).is_enabled())
        self.assertFalse(self.operator.PairOfCleatsToolingDoctorCommand(self.window).is_enabled())
        self.assertFalse(self.operator.PairOfCleatsServerHealthCommand(self.window).is_enabled())
        self.assertFalse(self.operator.PairOfCleatsServerStatusCommand(self.window).is_enabled())
        self.assertFalse(self.operator.PairOfCleatsIndexHealthCommand(self.window).is_enabled())

    def _resolve_repo_root_interactive(self, _window, on_done, path_hint=None, allow_fallback=True, prompt='PairOfCleats repo'):
        on_done(self.fixture_repo, None)

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
            on_done(_FakeCliResult(payload))

    def _run_async(self, request_fn, on_done, on_progress=None):
        if callable(on_progress):
            on_progress('Request started.')
        payload, headers = request_fn()
        on_done(_FakeApiResult(payload=payload, headers=headers))
        return object()

    def _health_json(self, base_url, settings):
        self.api_calls.append({'kind': 'health', 'base_url': base_url})
        return ({'ok': True, 'uptimeMs': 12345}, {})

    def _status_json(self, base_url, repo_root, settings):
        self.api_calls.append({'kind': 'status', 'base_url': base_url, 'repo_root': repo_root})
        return ({
            'ok': True,
            'repo': {
                'root': repo_root,
                'cacheRoot': os.path.join(repo_root, '.pairofcleats', 'cache'),
                'totalBytes': 42,
                'artifacts': {
                    'indexCode': 10,
                    'indexProse': 20,
                    'indexExtractedProse': 5,
                    'indexRecords': 7,
                },
                'sqlite': {
                    'code': {'path': os.path.join(repo_root, 'code.sqlite')},
                    'prose': None,
                    'extractedProse': None,
                    'records': None,
                },
                'lmdb': {
                    'code': None,
                    'prose': None,
                },
            },
            'overall': {
                'cacheRoot': os.path.join(repo_root, '.pairofcleats', 'cache'),
                'totalBytes': 420,
            },
            'health': {
                'issues': ['sqlite prose db missing'],
                'hints': ['Run `pairofcleats index build --stage 4` to rebuild SQLite indexes.'],
            },
        }, {})

    def _payload_for_args(self, args):
        args = list(args or [])
        if len(args) >= 2 and args[0] == 'config' and args[1] == 'dump':
            return {
                'repoRoot': self.fixture_repo,
                'derived': {
                    'repoCacheRoot': os.path.join(self.fixture_repo, '.pairofcleats', 'cache'),
                    'indexCodeDir': os.path.join(self.fixture_repo, '.pairofcleats', 'index-code'),
                },
            }
        if len(args) >= 2 and args[0] == 'tooling' and args[1] == 'doctor':
            return {
                'repoRoot': self.fixture_repo,
                'summary': {'status': 'warn'},
                'identity': {'chunkUid': {'available': True}},
                'xxhash': {'backend': 'wasm'},
                'providers': [
                    {
                        'id': 'clangd',
                        'enabled': True,
                        'status': 'ok',
                        'checks': [{'name': 'command-profile', 'message': 'available'}],
                    }
                ],
            }
        return {}


if __name__ == '__main__':
    unittest.main()
