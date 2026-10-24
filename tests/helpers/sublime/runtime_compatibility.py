"""Exercise production owners on Python 3.3 and with its missing-API surface."""
import importlib
import io
import os
import subprocess
import sys
import tempfile
import threading
import types
import unittest
from unittest.mock import patch

sys.path.insert(0, os.path.dirname(__file__))
from runtime_harness import FakeWindow, install_fake_modules


class RunningProcess(object):
    pid = 31415

    def __init__(self):
        self.returncode = None
        self.terminated = 0
        self.killed = 0
        self.stdout = io.StringIO('')
        self.stderr = io.StringIO('')
        self.released = threading.Event()

    def poll(self):
        return self.returncode

    def terminate(self):
        self.terminated += 1

    def kill(self):
        self.killed += 1
        self.returncode = -9
        self.released.set()

    def wait(self):
        if not self.released.wait(4):
            raise AssertionError('force-stop did not settle the owned process')
        return self.returncode


class MinimumPath(object):
    def __getattr__(self, name):
        if name == 'commonpath':
            raise AttributeError('Python 3.3 has no os.path.commonpath')
        return getattr(os.path, name)


def subprocess_33(call):
    values = dict((key, value) for key, value in vars(subprocess).items() if key != 'run')
    values['call'] = call
    return types.SimpleNamespace(**values)


class RuntimeCompatibilityTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.sublime, _ = install_fake_modules()
        cls.paths = importlib.import_module('PairOfCleats.lib.paths')
        cls.runner = importlib.import_module('PairOfCleats.lib.runner')
        cls.tasks = importlib.import_module('PairOfCleats.lib.tasks')

    def setUp(self):
        self.sublime.reset()
        self.window = FakeWindow()
        self.sublime.set_active_window(self.window)
        self.tasks.clear_all()

    def test_folder_containment_without_commonpath(self):
        minimum_os = types.SimpleNamespace(path=MinimumPath(), sep=os.sep, pardir=os.pardir)
        with tempfile.TemporaryDirectory() as temp, patch.object(self.paths, 'os', minimum_os):
            repo = os.path.join(temp, 'repo')
            inside = os.path.join(repo, 'src', 'nested')
            self.assertEqual(self.paths.resolve_path_within_repo(repo, './src/nested'), inside)
            self.assertEqual(self.paths.resolve_path_within_repo(repo, '.'), repo)
            for outside in ('../repo-sibling', '../outside', os.path.join(temp, 'outside')):
                self.assertIsNone(self.paths.resolve_path_within_repo(repo, outside))
            settings = {'index_watch_scope': 'folder', 'index_watch_folder': './src/nested'}
            self.assertEqual(self.paths.resolve_watch_root(self.window, settings, repo_root=repo), inside)
            settings['index_watch_folder'] = '../repo-sibling'
            self.assertEqual(self.paths.resolve_watch_root(self.window, settings, repo_root=repo), repo)
            if os.name == 'nt':
                drive = 'Z:' if os.path.splitdrive(repo)[0].upper() != 'Z:' else 'Y:'
                self.assertIsNone(self.paths.resolve_path_within_repo(repo, drive + '\\outside'))

    def test_windows_stop_uses_bounded_minimum_runtime_api(self):
        calls = []

        def call(command, **kwargs):
            calls.append((command, kwargs))
            return 0

        with patch.object(self.runner, 'os', types.SimpleNamespace(name='nt')), \
                patch.object(self.runner, 'subprocess', subprocess_33(call)):
            for force in (False, True):
                proc = RunningProcess()
                self.runner._terminate_process_tree(proc, force=force)
                command, kwargs = calls[-1]
                self.assertEqual(command, ['taskkill', '/PID', str(proc.pid), '/T'] + (['/F'] if force else []))
                self.assertEqual(kwargs, {'stdout': subprocess.DEVNULL, 'stderr': subprocess.DEVNULL, 'timeout': 2})
                self.assertEqual((proc.terminated, proc.killed), (0, 0))

    def test_windows_helper_failure_preserves_unconfirmed_descendant_settlement(self):
        failures = [1, OSError('fixture taskkill missing'), subprocess.TimeoutExpired('taskkill', 2)]
        for failure in failures:
            calls = []

            def call(command, **kwargs):
                calls.append(command)
                if isinstance(failure, Exception):
                    raise failure
                return failure

            with patch.object(self.runner, 'os', types.SimpleNamespace(name='nt', environ=os.environ)), \
                    patch.object(self.runner, 'subprocess', subprocess_33(call)):
                proc = RunningProcess()
                self.runner._terminate_process_tree(proc)
                self.assertEqual(proc.terminated, 1)
                self.runner._terminate_process_tree(proc, force=True)
                self.assertEqual(proc.killed, 1)

        # The owned stop worker still reaches the direct force fallback when
        # the minimum-runtime tree helper fails. Direct parent closure cannot
        # certify Windows descendants, so settlement remains unconfirmed.
        # No fake PID is sent to the host by this explicit subprocess fixture.
        for timed_out in (False, True):
            proc = RunningProcess()
            done = threading.Event()
            results = []

            def unavailable(*args, **kwargs):
                raise OSError('fixture taskkill missing')

            with patch.object(self.runner, 'os', types.SimpleNamespace(name='nt', environ=os.environ)), \
                    patch.object(self.runner, 'subprocess', subprocess_33(unavailable)):
                handle = self.runner.run_process('explicit-fixture-command', [], window=self.window,
                    stream_output=False, show_progress_panel=False, timeout_ms=20 if timed_out else None,
                    spawn_process=lambda *args, **kwargs: proc,
                    on_done=lambda result: (results.append(result), done.set()))
                if not timed_out:
                    handle.cancel()
                self.assertTrue(done.wait(4), 'cancellation/timeout must reach force-stop settlement')
                handle.thread.join(1)
                self.assertFalse(handle.thread.is_alive())
                self.assertEqual((proc.terminated, proc.killed), (0, 1))
                self.assertEqual(results[0].state, 'cleanup_unconfirmed')
                self.assertIn('settlement remains unconfirmed', results[0].error)
                self.assertEqual(results[0].timed_out, timed_out)
                self.assertEqual(results[0].cancelled, not timed_out)
                handle._cleanup_failures[:] = []
                importlib.import_module('PairOfCleats.lib.operations').release(handle)

    def test_real_owned_child_termination(self):
        # On Windows this exercises actual taskkill; elsewhere it exercises the
        # existing process-group/direct fallback. Only this fixture's child dies.
        proc = subprocess.Popen([sys.executable, '-E', '-S', '-c',
            'import sys,time; print("ready"); sys.stdout.flush(); time.sleep(10)'],
            stdout=subprocess.PIPE, universal_newlines=True, **self.runner._build_spawn_kwargs())
        try:
            self.assertEqual(proc.stdout.readline().strip(), 'ready')
            self.runner._terminate_process_tree(proc, force=True)
            proc.wait(timeout=3)
            self.assertIsNotNone(proc.poll())
            self.assertNotEqual(proc.returncode, 0)
        finally:
            if proc.poll() is None:
                proc.kill()
                proc.wait(timeout=3)
            proc.stdout.close()


if __name__ == '__main__':
    unittest.main()
