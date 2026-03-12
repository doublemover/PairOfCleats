import importlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(__file__))

from runtime_harness import FakeView, FakeWindow, install_fake_modules


class _Result:
    def __init__(self, returncode, output, payload=None, error=None):
        self.returncode = returncode
        self.output = output
        self.payload = payload
        self.error = error


class _Handle:
    def cancel(self):
        return None


class PackageHarnessTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.sublime, _ = install_fake_modules()
        cls.search = importlib.import_module('PairOfCleats.commands.search')
        cls.index = importlib.import_module('PairOfCleats.commands.index')
        cls.map_commands = importlib.import_module('PairOfCleats.commands.map')
        cls.index_state = importlib.import_module('PairOfCleats.lib.index_state')
        cls.map_state = importlib.import_module('PairOfCleats.lib.map_state')
        cls.results_state = importlib.import_module('PairOfCleats.lib.results_state')
        cls.node = os.environ['PAIROFCLEATS_SUBLIME_TEST_NODE']
        cls.cli = os.environ['PAIROFCLEATS_SUBLIME_TEST_CLI']
        cls.fixture_repo = os.environ['PAIROFCLEATS_SUBLIME_TEST_FIXTURE_REPO']

    def setUp(self):
        self.sublime.reset()
        self.window = FakeWindow()
        self.sublime.set_active_window(self.window)
        self.tmp = tempfile.TemporaryDirectory()
        self.repo_root = os.path.join(self.tmp.name, 'sample')
        shutil.copytree(self.fixture_repo, self.repo_root)
        self.file_path = os.path.join(self.repo_root, 'src', 'index.js')
        with open(self.file_path, 'r', encoding='utf-8') as handle:
            self.file_text = handle.read()
        self.view = FakeView(self.file_path, self.file_text)
        self.view.set_window(self.window)
        self.window.set_active_view(self.view)
        self.map_dir = os.path.join(self.tmp.name, 'map-out')
        os.makedirs(self.map_dir, exist_ok=True)
        self.map_out = os.path.join(self.map_dir, 'fixture-map.json')
        self.map_model = os.path.join(self.map_dir, 'fixture-map.model.json')
        self.map_nodes = os.path.join(self.map_dir, 'fixture-map.nodes.json')

        self._originals = {
            'search_get_settings': self.search.config.get_settings,
            'search_validate_settings': self.search.config.validate_settings,
            'search_resolve_repo_root': self.search.paths.resolve_repo_root,
            'search_resolve_cli': self.search.paths.resolve_cli,
            'search_build_env': self.search.config.build_env,
            'search_run_process': self.search.runner.run_process,
            'index_get_settings': self.index.config.get_settings,
            'index_validate_settings': self.index.config.validate_settings,
            'index_resolve_repo_root': self.index.paths.resolve_repo_root,
            'index_resolve_watch_root': self.index.paths.resolve_watch_root,
            'index_resolve_cli': self.index.paths.resolve_cli,
            'index_build_env': self.index.config.build_env,
            'index_run_process': self.index.runner.run_process,
            'map_get_settings': self.map_commands.config.get_settings,
            'map_validate_settings': self.map_commands.config.validate_settings,
            'map_resolve_repo_root': self.map_commands.paths.resolve_repo_root,
            'map_resolve_cli': self.map_commands.paths.resolve_cli,
            'map_build_env': self.map_commands.config.build_env,
            'map_run_process': self.map_commands.runner.run_process,
            'map_build_output_paths': self.map_commands.map_lib.build_output_paths,
        }

        base_settings = {
            'index_mode_default': 'code',
            'search_backend_default': 'memory',
            'open_results_in': 'output_panel',
            'results_buffer_threshold': 1,
            'search_limit': 10,
            'search_prompt_options': False,
            'history_limit': 10,
            'index_watch_mode': 'all',
            'index_watch_poll_ms': 2000,
            'index_watch_debounce_ms': 500,
            'map_prompt_options': False,
            'map_show_report_panel': True,
            'map_stream_output': False,
            'map_type_default': 'combined',
            'map_format_default': 'json',
            'map_output_dir': self.map_dir,
            'map_index_mode': 'code',
            'map_collapse_default': 'none',
            'map_open_uri_template': 'subl://open?file={file}&line={line}&column={column}',
        }

        cli_profile = {
            'command': self.node,
            'args_prefix': [self.cli],
            'source': 'path',
        }

        self.search.config.get_settings = lambda _window: dict(base_settings)
        self.index.config.get_settings = lambda _window: dict(base_settings)
        self.map_commands.config.get_settings = lambda _window: dict(base_settings)
        self.search.config.validate_settings = lambda _settings, _repo_root: []
        self.index.config.validate_settings = lambda _settings, _repo_root: []
        self.map_commands.config.validate_settings = lambda _settings, _repo_root: []
        self.search.paths.resolve_repo_root = (
            lambda _window, return_reason=True, path_hint=None: (self.repo_root, None)
            if return_reason else self.repo_root
        )
        self.index.paths.resolve_repo_root = (
            lambda _window, return_reason=True: (self.repo_root, None)
            if return_reason else self.repo_root
        )
        self.index.paths.resolve_watch_root = lambda _window, _settings: self.repo_root
        self.map_commands.paths.resolve_repo_root = (
            lambda _window, return_reason=True, path_hint=None: (self.repo_root, None)
            if return_reason else self.repo_root
        )
        self.search.paths.resolve_cli = lambda _settings, _repo_root: dict(cli_profile)
        self.index.paths.resolve_cli = lambda _settings, _repo_root: dict(cli_profile)
        self.map_commands.paths.resolve_cli = lambda _settings, _repo_root: dict(cli_profile)
        self.search.config.build_env = lambda _settings: {}
        self.index.config.build_env = lambda _settings: {}
        self.map_commands.config.build_env = lambda _settings: {}
        self.map_commands.map_lib.build_output_paths = (
            lambda repo_root, settings, scope, map_type, map_format: (
                self.map_out,
                self.map_model,
                self.map_nodes,
            )
        )

        self.search.runner.run_process = self._run_process
        self.index.runner.run_process = self._run_process
        self.map_commands.runner.run_process = self._run_process

    def tearDown(self):
        for key, value in self._originals.items():
            if key == 'search_get_settings':
                self.search.config.get_settings = value
            elif key == 'search_validate_settings':
                self.search.config.validate_settings = value
            elif key == 'search_resolve_repo_root':
                self.search.paths.resolve_repo_root = value
            elif key == 'search_resolve_cli':
                self.search.paths.resolve_cli = value
            elif key == 'search_build_env':
                self.search.config.build_env = value
            elif key == 'search_run_process':
                self.search.runner.run_process = value
            elif key == 'index_get_settings':
                self.index.config.get_settings = value
            elif key == 'index_validate_settings':
                self.index.config.validate_settings = value
            elif key == 'index_resolve_repo_root':
                self.index.paths.resolve_repo_root = value
            elif key == 'index_resolve_watch_root':
                self.index.paths.resolve_watch_root = value
            elif key == 'index_resolve_cli':
                self.index.paths.resolve_cli = value
            elif key == 'index_build_env':
                self.index.config.build_env = value
            elif key == 'index_run_process':
                self.index.runner.run_process = value
            elif key == 'map_get_settings':
                self.map_commands.config.get_settings = value
            elif key == 'map_validate_settings':
                self.map_commands.config.validate_settings = value
            elif key == 'map_resolve_repo_root':
                self.map_commands.paths.resolve_repo_root = value
            elif key == 'map_resolve_cli':
                self.map_commands.paths.resolve_cli = value
            elif key == 'map_build_env':
                self.map_commands.config.build_env = value
            elif key == 'map_run_process':
                self.map_commands.runner.run_process = value
            elif key == 'map_build_output_paths':
                self.map_commands.map_lib.build_output_paths = value
        self.tmp.cleanup()

    def _run_process(
        self,
        command,
        args,
        cwd=None,
        env=None,
        window=None,
        title=None,
        capture_json=False,
        on_done=None,
        stream_output=True,
        panel_name='pairofcleats',
    ):
        full_env = dict(os.environ)
        if env:
            full_env.update(env)
        completed = subprocess.run(
            [command] + list(args),
            cwd=cwd or None,
            env=full_env,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding='utf-8',
        )
        stdout_output = completed.stdout or ''
        stderr_output = completed.stderr or ''
        output = stdout_output + stderr_output
        if stream_output and window is not None:
            panel = window.create_output_panel(panel_name)
            panel.run_command('append', {
                'characters': output,
                'force': True,
                'scroll_to_end': True,
            })
        payload = None
        error = None
        if capture_json:
            try:
                payload = json.loads(stdout_output or '{}')
            except Exception as exc:
                error = 'Failed to parse JSON output: {0}'.format(exc)
        result = _Result(completed.returncode, output, payload=payload, error=error)
        if on_done:
            on_done(result)
        return _Handle()

    def test_package_harness_exercises_real_search_index_map_and_advanced_workflows(self):
        self.index.PairOfCleatsIndexBuildCodeCommand(self.window).run()
        last_build = self.index_state.get_last_build(self.window)
        self.assertEqual(last_build['last_mode'], 'code')
        index_panel = self.window.panels['pairofcleats-index']
        self.assertIn('indexing', index_panel.appended.lower())

        self.search.PairOfCleatsSearchCommand(self.window).run(query='greet')
        search_panel = self.window.panels['pairofcleats-results']
        self.assertIn('PairOfCleats results', search_panel.appended)
        self.assertIn('src/index.js', search_panel.appended)
        last_results = self.results_state.get_last_results(self.window)
        self.assertEqual(last_results['query'], 'greet')

        self.window.panels['pairofcleats-results'].appended = ''
        self.search.PairOfCleatsReopenLastResultsCommand(self.window).run()
        reopened_panel = self.window.panels['pairofcleats-results']
        self.assertIn('PairOfCleats results', reopened_panel.appended)
        self.assertIn('src/index.js', reopened_panel.appended)

        self.map_commands.PairOfCleatsMapCurrentFileCommand(self.window).run()
        last_map = self.map_state.get_last_map(self.window)
        self.assertEqual(last_map['outPath'], self.map_out)
        self.assertEqual(last_map['modelPath'], self.map_model)
        self.assertEqual(last_map['nodeListPath'], self.map_nodes)
        self.assertTrue(os.path.exists(self.map_out))
        self.assertTrue(os.path.exists(self.map_nodes))
        self.assertIn('Follow-up:', last_map['reportText'])
        self.assertIn('PairOfCleats map report', self.window.panels['pairofcleats-map'].appended)
        self.assertEqual(self.window.opened_files[-1]['path'], self.map_out)

        with open(self.map_nodes, 'r', encoding='utf-8') as handle:
            node_payload = json.load(handle)
        nodes = node_payload.get('nodes') or []
        self.assertTrue(nodes)
        target_index = next(
            (index for index, node in enumerate(nodes) if node.get('file')),
            -1,
        )
        self.assertGreaterEqual(target_index, 0)

        self.map_commands.PairOfCleatsMapJumpToNodeCommand(self.window).run()
        self.window.quick_panel_callback(target_index)
        opened = self.window.opened_files[-1]['path']
        self.assertIn('src/index.js', opened.replace('\\', '/'))


if __name__ == '__main__':
    unittest.main()
