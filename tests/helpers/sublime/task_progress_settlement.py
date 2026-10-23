"""Real task/runner ownership with bounded inert streams and queued UI."""
import importlib
import io
from unittest.mock import patch

from runtime_harness import FakeWindow, install_fake_modules

sublime, _plugin = install_fake_modules()
tasks = importlib.import_module('PairOfCleats.lib.tasks')
operations = importlib.import_module('PairOfCleats.lib.operations')
runtime = importlib.import_module('PairOfCleats.commands.runtime')
runner = importlib.import_module('PairOfCleats.lib.runner')
outcome = importlib.import_module('PairOfCleats.lib.process_outcome')
operations.activate()
window = FakeWindow()
window.set_folders(['/original-task-root'])
sublime.set_active_window(window)
queued, rendered = [], []


def drain():
    while queued:
        queued.pop(0)()


with patch.object(sublime, 'set_timeout', side_effect=lambda callback, delay=0: queued.append(callback)), \
        patch.object(tasks.ui, 'write_output_panel', side_effect=lambda *args, **kwargs: rendered.append((args, kwargs))):
    scope = operations.capture(window, key='controlled-task')
    task = tasks.start_task(window, 'Coalesced original task', repo_root='/original-task-root',
                            operation_scope=scope, show_panel=False)
    for index in range(200):
        tasks.note_progress(window, task, details='Latest useful message {0}'.format(index))
    tasks.note_watchdog(window, task, details='Quiet phase remains indeterminate')
    assert len(queued) == 1 and rendered == [], 'output bursts schedule one native render, never direct worker UI'
    drain()
    assert len(rendered) == 1 and rendered[0][1]['show_panel'] is True
    assert 'Quiet phase remains indeterminate' in rendered[0][0][2]
    assert 'stage: indeterminate; counters: unknown/unknown' in rendered[0][0][2]

    tasks.note_progress(window, task, details='queued before supersession')
    assert len(queued) == 1
    operations.capture(window, key='controlled-task')
    before = len(rendered)
    tasks.complete_task(window, task, status='cancelled', details='Owned teardown settled')
    drain()
    assert len(rendered) == before, 'settlement cannot reacquire a fresh UI scope'
    tasks.show_progress(window)
    drain()
    assert len(rendered) == before + 1, 'explicit inspection can show historical terminal observations'

    old = tasks.start_task(window, 'old context task', show_panel=False)
    stale_publish = queued[0]
    window.set_folders(['/replacement-task-root'])
    tasks.start_task(window, 'new context task', show_panel=False)
    assert len(queued) == 2
    before = len(rendered)
    stale_publish()
    assert len(rendered) == before
    drain()
    assert len(rendered) == before + 1 and 'new context task' in rendered[-1][0][2]

# An exact native cancellation picker cannot be revived after replacement, and
# repeated delivery cannot request stop twice for the same operation.
cancelled = []
first = tasks.start_task(window, 'first exact task', cancellable=True,
    cancel=lambda: cancelled.append('first'), show_panel=False)
second = tasks.start_task(window, 'second exact task', cancellable=True,
    cancel=lambda: cancelled.append('second'), show_panel=False)
command = runtime.PairOfCleatsCancelActiveTaskCommand(window)
command.run()
stale_choice = window.quick_panel_callback
command.run()
stale_choice(1)
assert cancelled == []
window.quick_panel_callback(0)
assert cancelled == ['first'] and first['status'] == 'cancelling'
assert tasks.cancel_task(window, first['id']) is None and cancelled == ['first']
assert second['status'] == 'starting'


class Stream(object):
    def __init__(self, read_error=False, close_error=False):
        self.read_error = read_error
        self.close_error = close_error
        self.closed = False

    def __iter__(self):
        yield '{"ok": true}\n'
        if self.read_error:
            raise OSError('original read failure')

    def close(self):
        self.closed = True
        if self.close_error:
            raise OSError('original close failure')


class Process(object):
    def __init__(self, stdout):
        self.stdout, self.stderr = stdout, io.StringIO('')
        self.returncode = None

    def wait(self):
        self.returncode = 0
        return 0

    def poll(self):
        return self.returncode


operations.activate()
window.set_folders(['/original-task-root'])
for read_error, close_error, settlement_error in [(True, False, False), (True, True, True), (False, False, True)]:
    stream = Stream(read_error, close_error)
    process = Process(stream)
    completed, settled = [], []

    def on_settled(result):
        settled.append(result)
        if settlement_error:
            raise OSError('original settlement failure')

    handle = runner.run_process('inert-owned-process', [], window=window, cwd='/original-task-root',
        capture_json=True, stream_output=False, spawn_process=lambda *args, **kwargs: process,
        on_done=completed.append, on_settled=on_settled)
    try:
        handle.thread.join(2)
        assert not handle.thread.is_alive() and stream.closed
        assert len(settled) == 1 and len(completed) == 1
        result = completed[0]
        if read_error:
            assert result.primary_state == 'failed' and 'original read failure' in result.primary_error
            assert 'original read failure' in result.error, 'cleanup cannot replace the first output failure'
        if close_error:
            assert any('original close failure' in error for error in result.cleanup_errors)
        if settlement_error:
            assert 'original settlement failure' in result.error
            assert any('Settlement callback failed' in error for error in result.cleanup_errors)
        if close_error or settlement_error:
            assert result.state == 'cleanup_unconfirmed' and not handle.wait(0)
            assert outcome.describe_process_outcome(result, 'controlled')['status'] == 'failed'
            assert result.error.splitlines()[0] in outcome.describe_process_outcome(result, 'controlled')['summary']
        else:
            assert result.state == 'failed' and handle.wait(0)
        recent = tasks.recent_tasks(window)[0]
        assert recent['status'] == 'failed'
    finally:
        # Only the inert fixture's resource owner is released. Production
        # retains unresolved cleanup and its initiating diagnostic.
        handle._cleanup_failures[:] = []
        operations.release(handle)

# Spawn failure keeps its original launch diagnostic if local cleanup also
# fails, and still delivers the terminal result instead of throwing on the UI.
completed = []
with patch.object(runner.subprocess, 'Popen', side_effect=OSError('original spawn failure')):
    failed_handle = runner.run_process('missing-inert-process', [], window=window, stream_output=False,
        on_settled=lambda _result: (_ for _ in ()).throw(OSError('spawn settlement failure')),
        on_done=completed.append)
assert len(completed) == 1 and completed[0].primary_state == 'spawn_failed'
assert 'original spawn failure' in completed[0].error and 'spawn settlement failure' in completed[0].error
assert not failed_handle.wait(0)
failed_handle._cleanup_failures[:] = []
operations.release(failed_handle)
print('Sublime task rendering, exact cancellation and original settlement failures retain their owners')
