import importlib
import io
import threading
from unittest.mock import patch
from runtime_harness import FakeWindow, install_fake_modules

sublime, _ = install_fake_modules()
operations = importlib.import_module('PairOfCleats.lib.operations')
runner = importlib.import_module('PairOfCleats.lib.runner')
api = importlib.import_module('PairOfCleats.lib.api_client')
search = importlib.import_module('PairOfCleats.commands.search')
operations.activate()
first, other = FakeWindow(), FakeWindow()
callbacks = []


class HeldProcess:
    def __init__(self):
        self.stdout, self.stderr = io.StringIO('{}'), io.StringIO('')
        self.returncode = None
        self.finished = threading.Event()

    def poll(self):
        return self.returncode

    def wait(self, timeout=None):
        assert self.finished.wait(2 if timeout is None else timeout), 'bounded controlled process did not settle'
        return self.returncode

    def finish(self):
        self.returncode = 0
        self.finished.set()


held, independent = HeldProcess(), HeldProcess()
with patch.object(runner, '_terminate_process_tree', side_effect=lambda process, **kwargs: (process.finish() or True)), \
        patch.object(sublime, 'set_timeout', side_effect=lambda callback, _delay=0: callbacks.append(callback)):
    one = runner.run_process('controlled', [], window=first, stream_output=False,
                             spawn_process=lambda *args, **kwargs: held,
                             on_done=lambda result: (_ for _ in ()).throw(AssertionError('late closed-window UI')))
    two = runner.run_process('controlled', [], window=other, stream_output=False,
                             spawn_process=lambda *args, **kwargs: independent)
    assert operations.shutdown(first, timeout=2)
    assert held.poll() == 0
    assert independent.poll() is None, 'one window cannot cancel another'
    for callback in list(callbacks):
        callback()
    independent.finish()
    assert two.wait(2)
    assert all(not thread.is_alive() for thread in one._auxiliary_threads + two._auxiliary_threads), 'confirmed process settlement reaps owned watchdogs'

# Registration precedes Thread.start. Shutdown at that seam is bounded rather
# than raising from join on an unstarted worker.
prestart = runner.ProcessHandle(HeldProcess(), threading.Thread(target=lambda: None))
assert not prestart.wait(0)

# Starting an auxiliary/execution/output worker can fail independently after
# the child exists. The original failure survives bounded child/stream cleanup.
original_start = threading.Thread.start
for failed_target in ('watchdog', 'worker', 'read_stream'):
    operations.activate()
    controlled = HeldProcess()
    completed = []
    def start(thread):
        if getattr(getattr(thread, '_target', None), '__name__', None) == failed_target:
            raise RuntimeError('original ' + failed_target + ' startup fault')
        return original_start(thread)
    with patch.object(threading.Thread, 'start', new=start), \
            patch.object(runner, '_terminate_process_tree', side_effect=lambda process, **kwargs: (process.finish() or True)):
        handle = runner.run_process('controlled', [], window=first, stream_output=False,
            spawn_process=lambda *args, **kwargs: controlled, on_done=completed.append)
        assert handle.wait(2)
    assert len(completed) == 1 and 'original ' + failed_target + ' startup fault' in completed[0].error
    assert completed[0].state in ('failed', 'start_failed')
    assert controlled.stdout.closed and controlled.stderr.closed
    assert all(not thread.is_alive() for thread in handle._auxiliary_threads + handle._reader_threads)

# A response already queued on the UI thread must still recheck authority.
operations.activate()
callbacks[:] = []
completed = []
with patch.object(sublime, 'set_timeout', side_effect=lambda callback, _delay=0: callbacks.append(callback)):
    handle = api.run_async(lambda: ({'ok': True}, {}), lambda value: completed.append(value), window=other)
    assert handle.wait(2)
    assert operations.shutdown(other, timeout=2)
    for callback in callbacks:
        callback()
    assert completed == []

# Different request generations retain independent window state and cancel only
# work belonging to their own superseded interaction.
operations.activate()
old = operations.capture(first, key='foreground-search')
new = operations.capture(first, key='foreground-search')
separate = operations.capture(other, key='foreground-search')
assert not operations.is_current(old)
assert operations.is_current(new) and operations.is_current(separate)
first.set_folders(['changed-project'])
assert not operations.is_current(new), 'project context changes revoke callbacks even before a host hook'
assert operations.is_current(separate)
print('Sublime owned process/HTTP disposal, queued UI fencing and window/request isolation passed')
