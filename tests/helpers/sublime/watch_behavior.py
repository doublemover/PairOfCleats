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
    def __init__(self, returncode=0, output='', state='done', error=None, timed_out=False, cancelled=False):
        self.returncode = returncode
        self.output = output
        self.state = state
        self.error = error
        self.timed_out = timed_out
        self.cancelled = cancelled


class _ControlledThread:
    def __init__(self):
        self.alive = True

    def is_alive(self):
        return self.alive


class WatchBehaviorTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.sublime, _ = install_fake_modules()
        cls.watch = importlib.import_module('PairOfCleats.lib.watch')
        cls.index = importlib.import_module('PairOfCleats.commands.index')

    def setUp(self):
        self.sublime.reset()
        self.window = FakeWindow()
        self.handles = []
        self.callbacks = []
        self._originals = {
            'get_settings': self.index.config.get_settings,
            'validate_settings': self.index.config.validate_settings,
            'resolve_repo_root': self.index.paths.resolve_repo_root,
            'resolve_repo_root_interactive': self.index.paths.resolve_repo_root_interactive,
            'resolve_watch_root': self.index.paths.resolve_watch_root,
            'resolve_cli': self.index.paths.resolve_cli,
            'build_env': self.index.config.build_env,
            'run_process': self.index.runner.run_process,
            'build_index_args': self.index.indexing.build_index_args,
        }
        self.index.config.get_settings = lambda _window: {'index_watch_mode': 'all'}
        self.index.config.validate_settings = lambda _settings, _repo_root, workflow=None: []
        self.index.paths.resolve_repo_root = (
            lambda _window, return_reason=True, path_hint=None, allow_fallback=True: ('C:/repo', None)
            if return_reason else 'C:/repo'
        )
        self.index.paths.resolve_repo_root_interactive = (
            lambda _window, on_done, path_hint=None, allow_fallback=True, prompt='PairOfCleats repo':
            on_done('C:/repo', None)
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
        for handle in self.handles:
            handle.process.code = 0
            handle._cleanup_failures = []
            for thread in (getattr(handle, 'thread', None), getattr(handle, '_stopper', None)):
                if thread:
                    thread.alive = False
        self.watch.clear_if_done(self.window)
        for key, value in self._originals.items():
            if key == 'get_settings':
                self.index.config.get_settings = value
            elif key == 'validate_settings':
                self.index.config.validate_settings = value
            elif key == 'resolve_repo_root':
                self.index.paths.resolve_repo_root = value
            elif key == 'resolve_repo_root_interactive':
                self.index.paths.resolve_repo_root_interactive = value
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

    def test_new_root_requires_explicit_stop_and_deliberate_start(self):
        self.index._run_index_watch(self.window)
        self.assertEqual(self.watch.current_root(self.window), 'C:/repo')
        self._next_watch_root = 'C:/repo-2'
        self.index._run_index_watch(self.window)
        self.assertEqual(len(self.handles), 1)
        self.assertEqual(self.handles[0].cancelled, 0)
        self.assertIn('No automatic restart', self.sublime.last_error)
        self.assertEqual(self.watch.current_root(self.window), 'C:/repo')
        self.index._run_index_watch_stop(self.window)
        self.callbacks[0](_FakeResult(cancelled=True, state='cancelled'))
        self.index._run_index_watch(self.window)
        self.assertEqual(self.watch.current_root(self.window), 'C:/repo-2')

    def test_stale_on_done_does_not_clear_new_watch(self):
        self.index._run_index_watch(self.window)
        self.index._run_index_watch_stop(self.window)
        self.callbacks[0](_FakeResult(cancelled=True, state='cancelled'))
        self._next_watch_root = 'C:/repo-2'
        self.index._run_index_watch(self.window)
        statuses = list(self.sublime.status_history)
        self.callbacks[0](_FakeResult(returncode=0))
        self.assertEqual(self.watch.current_root(self.window), 'C:/repo-2')
        self.assertTrue(self.watch.is_running(self.window))
        self.assertEqual(self.sublime.status_history, statuses)

    def test_parent_close_keeps_owned_helper_settlement(self):
        self.index._run_index_watch(self.window)
        handle = self.handles[0]
        handle.process.code = 0
        handle._stopper = _ControlledThread()
        snapshot = self.watch.snapshot(self.window)
        self.assertFalse(snapshot['running'])
        self.assertTrue(snapshot['settling'])
        self.watch.clear_if_done(self.window, token=snapshot['token'])
        self.assertTrue(self.watch.is_running(self.window))
        self._next_watch_root = 'C:/repo-2'
        self.index._run_index_watch(self.window)
        self.assertEqual(len(self.handles), 1, 'a closed parent cannot authorize replacement while its helper is alive')
        handle._stopper.alive = False
        self.assertIsNone(self.watch.snapshot(self.window))
        self.index._run_index_watch(self.window)
        self.assertEqual(self.watch.current_root(self.window), 'C:/repo-2')

    def test_cleanup_unconfirmed_is_failure_even_for_zero_exit_and_stop(self):
        self.index._run_index_watch(self.window)
        self.index._run_index_watch_stop(self.window)
        self.handles[0]._cleanup_failures = ['controlled helper failure']
        self.callbacks[0](_FakeResult(state='cleanup_unconfirmed', cancelled=True))
        self.assertIn('stop remains unconfirmed', self.sublime.last_error)
        self.assertTrue(self.watch.snapshot(self.window)['cleanupUnconfirmed'])
        self.assertFalse(any('cancelled after owned settlement' in message for message in self.sublime.status_history))
        self.index._run_index_watch(self.window)
        self.assertEqual(len(self.handles), 1)

    def test_registration_race_cancels_only_rejected_new_owned_handle(self):
        self.index._run_index_watch(self.window)
        replacement = _FakeHandle()
        with self.assertRaises(RuntimeError):
            self.watch.register(self.window, replacement, 'C:/repo-2')
        self.assertEqual(replacement.cancelled, 1)
        self.assertEqual(self.handles[0].cancelled, 0)
        self.assertEqual(self.watch.current_root(self.window), 'C:/repo')

    def test_terminal_outcome_never_hides_timeout_or_error_with_cancel(self):
        describe = self.index.describe_process_outcome
        for result in (_FakeResult(state='timed_out', timed_out=True, cancelled=True),
                       _FakeResult(error='permission denied', cancelled=True),
                       _FakeResult(state='cleanup_unconfirmed', cancelled=True)):
            self.assertEqual(describe(result, 'Watch', stop_requested=True)['status'], 'failed')
        self.assertEqual(describe(_FakeResult(cancelled=True), 'Watch')['status'], 'cancelled')
        self.assertEqual(describe(_FakeResult(), 'Watch')['status'], 'done')


if __name__ == '__main__':
    unittest.main()
