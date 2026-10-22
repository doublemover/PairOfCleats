"""Deferred controls against typed watch projection and the real process owner."""
import importlib
import io
import json
import threading
from runtime_harness import FakeWindow, install_fake_modules

sublime, _plugin = install_fake_modules()
tasks = importlib.import_module('PairOfCleats.lib.tasks')
operations = importlib.import_module('PairOfCleats.lib.operations')
runner = importlib.import_module('PairOfCleats.lib.runner')
watch = importlib.import_module('PairOfCleats.lib.watch')
projection = importlib.import_module('PairOfCleats.lib.watch_progress')
operations.activate()
window = FakeWindow()
window.set_folders(['/owned-watch-root'])
frame = {'proto': 'poc.progress@2', 'event': 'task:progress', 'ts': '2026-10-22T12:00:00.000Z',
    'taskId': 'watch:monitor', 'stage': 'watch', 'phase': 'monitoring', 'state': 'idle', 'status': 'running',
    'watchReady': True, 'quiescent': True, 'backlogDepth': 0, 'pendingReplay': False, 'publicationCommitted': False,
    'readiness': {'watcher': True, 'publishedGeneration': False, 'searchReady': None}}
idle = projection.read_watch_progress(frame)
assert idle['phase'] == 'idle-watch' and idle['searchReady'] is None
for invalid in (dict(frame, quiescent=False), dict(frame, backlogDepth=1), dict(frame, watchReady=False),
                dict(frame, ts='invented timestamp'), dict(frame, readiness=dict(frame['readiness'], searchReady=True))):
    assert projection.read_watch_progress(invalid) is None
published = projection.read_watch_progress(dict(frame, publicationCommitted=True,
    readiness=dict(frame['readiness'], publishedGeneration=True),
    lastConsistentGeneration={'buildId': 'committed-watch-build', 'publicationCommitted': True}))
assert published['publishedBuildId'] == 'committed-watch-build' and published['searchReady'] is None
task = tasks.start_task(window, 'PairOfCleats index watch', repo_root='/owned-watch-root', show_panel=False)
assert tasks.note_structured_progress(window, task, json.dumps(frame))
assert task['status'] == 'idle-watch'
assert 'search/backend readiness: unknown' in window.panels[tasks.TASK_PANEL].appended
failed = dict(frame, event='task:end', phase='degraded', state='degraded', status='failed', watchReady=False,
    ownershipPending=True, degradedReason='teardown', errorCode='EACCES',
    readiness={'watcher': False, 'publishedGeneration': False, 'searchReady': None})
tasks.mark_cancelling(window, task)
assert tasks.note_structured_progress(window, task, json.dumps(failed))
assert task['status'] == 'cancelling' and task['watchFailure'] and task['watch']['ownershipPending']
tasks.complete_task(window, task, status='failed')

entered, release = threading.Event(), threading.Event()
settled, published_results = [], []


class ControlledStream:
    def __iter__(self):
        entered.set()
        assert release.wait(2), 'controlled terminal watch evidence was not released'
        yield json.dumps(failed) + '\n'

    def close(self):
        pass


class Process:
    def __init__(self):
        self.stdout = io.StringIO('')
        self.stderr = ControlledStream()
        self.returncode = None

    def poll(self):
        return self.returncode

    def wait(self):
        self.returncode = 0
        return 0

    def kill(self):
        self.returncode = 0

    def terminate(self):
        self.returncode = 0


process = Process()
handle = runner.run_process('owned-cli', ['index', 'watch'], window=window, cwd='/owned-watch-root',
    title='PairOfCleats index watch', stream_output=False, spawn_process=lambda *args, **kwargs: process,
    on_done=published_results.append, on_settled=settled.append)
try:
    assert entered.wait(2)
    watch.register(window, handle, '/owned-watch-root')
    operations.invalidate(window)
    release.set()
    handle.thread.join(3)
    assert not handle.thread.is_alive(), 'controlled real runner must settle its worker'
    assert len(settled) == 1 and settled[0].returncode == 0
    assert settled[0].state == 'cleanup_unconfirmed' and settled[0].error
    assert published_results == [], 'revoked publication does not suppress owned resource failure observation'
    assert not handle.wait(0), 'canonical pending ownership is not confirmed by parent closure'
    assert watch.snapshot(window)['cleanupUnconfirmed']
finally:
    release.set()
    handle.thread.join(3)
    # Only the controlled fake owner is settled here; production never clears
    # unconfirmed cleanup merely to release a registry slot.
    handle._cleanup_failures[:] = []
    operations.release(handle)
    watch.clear_if_done(window)

print('Sublime typed watch readiness and terminal failure survive cancellation and revoked UI publication')
