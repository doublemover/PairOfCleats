"""Inert actual HTTP owners: authentication, elapsed bounds and teardown."""
import importlib
import threading
from unittest.mock import patch

from runtime_harness import FakeWindow, install_fake_modules

sublime, _plugin = install_fake_modules()
api = importlib.import_module('PairOfCleats.lib.api_client')
config = importlib.import_module('PairOfCleats.lib.config')
operations = importlib.import_module('PairOfCleats.lib.operations')
tasks = importlib.import_module('PairOfCleats.lib.tasks')
operations.activate()
window = FakeWindow()
window.set_folders(['/http-owner'])
sublime.set_active_window(window)


class Response(object):
    headers = {}

    def __init__(self, read_error=None, close_error=None):
        self.read_error, self.close_error = read_error, close_error
        self.read_count = 0
        self.close_count = 0

    def getcode(self):
        return 200

    def read(self, amount):
        self.read_count += 1
        if self.read_error:
            raise self.read_error
        return b'{"ok":true}' if self.read_count == 1 else b''

    def close(self):
        self.close_count += 1
        if self.close_error:
            raise self.close_error


# An elapsed deadline cannot be refreshed indefinitely by small body chunks.
clock = [0.0]
response = Response()
original_read = response.read


def elapsed_read(amount):
    value = original_read(amount)
    clock[0] += 2.0
    return value


response.read = elapsed_read
with patch.object(api.time, 'monotonic', side_effect=lambda: clock[0]):
    try:
        api._read_response(response, deadline=1.0)
        raise AssertionError('elapsed deadline was refreshed by body activity')
    except api.ApiDeadlineExceeded as error:
        assert error.code == 'api-deadline-exceeded'
assert response.read_count == 1

# Original typed byte-budget/read failures survive an independent close fault.
for originating in (OSError('original HTTP read fault'), api.ApiResponseTooLarge(16)):
    response = Response(read_error=originating, close_error=OSError('independent HTTP close fault'))
    completed = []
    with patch.object(api.urllib.request, 'build_opener') as opener:
        opener.return_value.open.return_value = response
        task = tasks.start_task(window, 'HTTP original fault', show_panel=False)
        handle = api.run_async(lambda: api.request_json('http://localhost:7345/health'), completed.append,
                               window=window, task=task)
        handle.thread.join(2)
    try:
        assert not handle.thread.is_alive() and len(completed) == 1
        result = completed[0]
        assert result.cause is originating
        assert 'independent HTTP close fault' in result.cause.pairofcleats_cleanup_errors[0]
        assert str(originating) in result.error and result.cleanup_pending
        assert any('independent HTTP close fault' in item for item in result.cleanup_errors)
        assert not handle.wait(0), 'a failed close remains owned after the worker settles'
        assert task['status'] == 'failed' and str(originating) in task['details']
    finally:
        handle.cleanup_errors[:] = []
        operations.release(handle)

# Cancel returns while close is deliberately held. Both reader and closer are
# retained, and no terminal success/cancellation is published before settlement.
reading, close_entered = threading.Event(), threading.Event()
release_read, release_close = threading.Event(), threading.Event()


class HeldResponse(Response):
    def read(self, amount):
        reading.set()
        assert release_read.wait(2), 'controlled HTTP reader was not released'
        return b''

    def close(self):
        close_entered.set()
        assert release_close.wait(2), 'controlled HTTP closer was not released'


completed = []
with patch.object(api.urllib.request, 'build_opener') as opener:
    opener.return_value.open.return_value = HeldResponse()
    task = tasks.start_task(window, 'HTTP cancel owner', show_panel=False)
    handle = api.run_async(lambda: api.request_json('http://localhost:7345/health'), completed.append,
                           window=window, task=task)
    try:
        assert reading.wait(1)
        handle.cancel()
        assert close_entered.wait(1), 'cancellation started its owned closer'
        assert not release_close.is_set(), 'cancel returned without synchronously waiting on close'
        assert task['status'] == 'cancelling' and task.get('completedAt') is None
        assert not handle.wait(0) and completed == []
        release_close.set()
        release_read.set()
        assert handle.wait(2)
        assert task['status'] == 'cancelled' and task.get('completedAt') is not None
        assert completed == [] and not handle.cleanup_pending
    finally:
        release_close.set()
        release_read.set()
        handle.wait(2)

# Waiting at the pre-start registration seam is bounded and never joins an
# unstarted thread. A failed start has no live HTTP resource to invent/reap.
handle = api.ApiHandle(threading.Thread(target=lambda: None))
assert not handle.wait(0)
task = tasks.start_task(window, 'HTTP startup fault', show_panel=False)
completed = []
with patch.object(api.threading.Thread, 'start', side_effect=RuntimeError('original thread start fault')):
    handle = api.run_async(lambda: (_ for _ in ()).throw(AssertionError('request must not run')),
                           completed.append, window=window, task=task)
assert handle.wait(0) and task['status'] == 'failed'
assert len(completed) == 1 and 'original thread start fault' in completed[0].error

# One faulty cancellation/wait implementation cannot prevent healthy siblings
# from receiving cancellation and their remaining bounded settlement wait.
events = []


class FaultyHandle(object):
    def cancel(self):
        events.append('faulty cancel')
        raise OSError('original cancel fault')

    def wait(self, timeout):
        events.append('faulty wait')
        raise OSError('original wait fault')


class HealthyHandle(object):
    def cancel(self):
        events.append('healthy cancel')

    def wait(self, timeout):
        events.append('healthy wait')
        assert 0 <= timeout <= 1
        return True


faulty, healthy = FaultyHandle(), HealthyHandle()
for item in (faulty, healthy):
    operations.track(operations.capture(window), item)
try:
    assert not operations.shutdown(window, timeout=1)
    assert events == ['faulty cancel', 'healthy cancel', 'faulty wait', 'healthy wait']
finally:
    operations.release(faulty)
    operations.release(healthy)
    operations.activate()

# Malformed successful envelopes fail with a workflow error rather than a
# secondary AttributeError that obscures the original service failure surface.
for workflow, args in [(api.search_json, ('http://localhost:7345', '/repo', {}, 'needle', 'code')),
                       (api.health_json, ('http://localhost:7345', {})),
                       (api.status_json, ('http://localhost:7345', '/repo', {}))]:
    with patch.object(api, 'request_json', return_value=(['malformed envelope'], {})):
        try:
            workflow(*args)
            raise AssertionError('malformed response envelope was admitted')
        except RuntimeError as error:
            assert 'API ' in str(error)

for endpoint in ('http://user:secret@localhost:7345', 'http://localhost:7345?token=secret',
                 'http://localhost:7345/#fragment', 'http://localhost:invalid', 'http://localhost:0',
                 'http://localhost:7345\n/other'):
    assert not config._is_valid_base_url(endpoint)
assert config._is_valid_base_url('https://localhost:7345/prefix')
print('Sublime HTTP original errors, bounded cancellation and request settlement authority are preserved')
