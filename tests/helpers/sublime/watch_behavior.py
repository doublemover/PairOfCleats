import importlib
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(__file__))

from runtime_harness import FakeWindow, install_fake_modules


class _FakeProcess:
    def __init__(self):
        self.code = None

    def poll(self):
        return self.code


class _FakeHandle:
    def __init__(self):
        self.process = _FakeProcess()
        self.cancelled = 0

    def cancel(self):
        self.cancelled += 1
        self.process.code = 0


class _FakeResult:
    def __init__(self, returncode=0, output=''):
        self.returncode = returncode
        self.output = output


class WatchBehaviorTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.sublime, _ = install_fake_modules()
        cls.watch = importlib.import_module('PairOfCleats.lib.watch')
        cls.index = importlib.import_module('PairOfCleats.commands.index')

    def setUp(self):
        self.window = FakeWindow()
        self.handles = []
        self.callbacks = []
        self._originals = {
            'get_settings': self.index.config.get_settings,
            'validate_settings': self.index.config.validate_settings,
            'resolve_repo_root': self.index.paths.resolve_repo_root,
            'resolve_watch_root': self.index.paths.resolve_watch_root,
            'resolve_cli': self.index.paths.resolve_cli,
            'build_env': self.index.config.build_env,
            'run_process': self.index.runner.run_process,
            'build_index_args': self.index.indexing.build_index_args,
        }
        self.index.config.get_settings = lambda _window: {'index_watch_mode': 'all'}
        self.index.config.validate_settings = lambda _settings, _repo_root: []
        self.index.paths.resolve_repo_root = (
            lambda _window, return_reason=True, path_hint=None, allow_fallback=True: ('C:/repo', None)
            if return_reason else 'C:/repo'
        )
        self._next_watch_root = 'C:/repo'
        self.index.paths.resolve_watch_root = lambda _window, _settings, repo_root=None: self._next_watch_root
        self.index.paths.resolve_cli = lambda _settings, _repo_root: {
            'command': 'pairofcleats',
            'args_prefix': [],
            'source': 'path',
        }
        self.index.config.build_env = lambda _settings: {}
        self.index.indexing.build_index_args = lambda *args, **kwargs: ['watch']

        def _run_process(command, args, cwd=None, env=None, window=None, title=None, capture_json=None, on_done=None, stream_output=None, panel_name=None):
            handle = _FakeHandle()
            self.handles.append(handle)
            self.callbacks.append(on_done)
            return handle

        self.index.runner.run_process = _run_process

    def tearDown(self):
        self.watch.stop_all(reason='test_teardown')
        for key, value in self._originals.items():
            if key == 'get_settings':
                self.index.config.get_settings = value
            elif key == 'validate_settings':
                self.index.config.validate_settings = value
            elif key == 'resolve_repo_root':
                self.index.paths.resolve_repo_root = value
            elif key == 'resolve_watch_root':
                self.index.paths.resolve_watch_root = value
            elif key == 'resolve_cli':
                self.index.paths.resolve_cli = value
            elif key == 'build_env':
                self.index.config.build_env = value
            elif key == 'run_process':
                self.index.runner.run_process = value
            elif key == 'build_index_args':
                self.index.indexing.build_index_args = value

    def test_restart_on_new_root_keeps_latest_watch(self):
        self.index._run_index_watch(self.window)
        self.assertEqual(self.watch.current_root(self.window), 'C:/repo')
        self._next_watch_root = 'C:/repo-2'
        self.index._run_index_watch(self.window)
        self.assertEqual(self.handles[0].cancelled, 1)
        self.assertEqual(self.watch.current_root(self.window), 'C:/repo-2')

    def test_stale_on_done_does_not_clear_new_watch(self):
        self.index._run_index_watch(self.window)
        self._next_watch_root = 'C:/repo-2'
        self.index._run_index_watch(self.window)
        self.callbacks[0](_FakeResult(returncode=0))
        self.assertEqual(self.watch.current_root(self.window), 'C:/repo-2')
        self.assertTrue(self.watch.is_running(self.window))


if __name__ == '__main__':
    unittest.main()
