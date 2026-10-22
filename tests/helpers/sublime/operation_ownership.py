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

    def wait(self):
        assert self.finished.wait(2), 'bounded controlled process did not settle'
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
