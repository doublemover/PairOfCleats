"""Window-owned work and publication authority, independent of task display."""
import json
import threading
import time

_STATES = {}
_RECORDS = []
_LOCK = threading.RLock()
_ALIVE = True


def _window_id(window):
    return window.id() if window is not None else None


def _context(window):
    if window is None:
        return ''
    try:
        data = window.project_data() or {}
        settings = data.get('settings') or {}
        overrides = settings.get('pairofcleats') or settings.get('PairOfCleats') \
            or data.get('pairofcleats') or data.get('PairOfCleats')
        project_file = getattr(window, 'project_file_name', lambda: None)()
        return json.dumps([window.folders(), project_file, overrides], sort_keys=True)
    except Exception:
        try:
            return json.dumps(window.folders(), sort_keys=True)
        except Exception:
            return ''


def activate():
    global _ALIVE
    with _LOCK:
        _ALIVE = True
        _STATES.clear()


def capture(window, key=None):
    window_id = _window_id(window)
    with _LOCK:
        state = _STATES.setdefault(window_id, {'epoch': 0, 'closed': False, 'keys': {}})
        if key:
            state['keys'][key] = state['keys'].get(key, 0) + 1
            older = [record['handle'] for record in _RECORDS
                     if record['scope']['windowId'] == window_id
                     and record['scope'].get('key') == key]
        else:
            older = []
        scope = {'windowId': window_id, 'window': window, 'state': state,
                 'epoch': state['epoch'], 'key': key,
                 'generation': state['keys'].get(key)}
    # Editor APIs can synchronously wait for a UI callback. Preserve the issued
    # epoch first, then sample context without blocking that callback's lock.
    scope['context'] = _context(window)
    with _LOCK:
        if _matches_scope_locked(scope) and 'capturedContext' not in state:
            state['capturedContext'] = scope['context']
    if _cancel_handles(older):
        raise RuntimeError('A previous PairOfCleats operation could not be cancelled. Inspect its task before retrying.')
    return scope


def _matches_scope_locked(scope):
    state = scope['state']
    return (_ALIVE and not state['closed']
            and _STATES.get(scope['windowId']) is state
            and state['epoch'] == scope['epoch']
            and (not scope.get('key') or state['keys'].get(scope['key']) == scope['generation']))


def is_current(scope):
    with _LOCK:
        if not _matches_scope_locked(scope):
            return False
    context = _context(scope['window'])
    with _LOCK:
        # An invalidation/reload while the editor call was outstanding cannot
        # promote this invocation into a newer epoch or request generation.
        return _matches_scope_locked(scope) and context == scope['context']


def coalescing_scope(current, previous):
    """Pure merge admission after current's editor context was checked outside
    the caller's lock. This is not a standalone UI publication check.
    """
    with _LOCK:
        if not _matches_scope_locked(current):
            return None
        if (previous and _matches_scope_locked(previous)
                and previous['state'] is current['state']
                and previous['context'] == current['context']):
            return previous
        return current


def track(scope, handle):
    with _LOCK:
        if not any(record['handle'] is handle for record in _RECORDS):
            _RECORDS.append({'scope': dict(scope), 'handle': handle, 'failures': []})
    if not is_current(scope):
        _cancel_handles([handle])
    return handle


def release(handle):
    with _LOCK:
        _RECORDS[:] = [record for record in _RECORDS if record['handle'] is not handle]


def invalidate(window, only_if_context_changed=False):
    window_id = _window_id(window)
    # Native saves also persist unrelated editor state. Read editor APIs before
    # taking our mutex, and preserve work when its source context is unchanged.
    context = _context(window) if only_if_context_changed else None
    with _LOCK:
        state = _STATES.get(window_id)
        if state is not None:
            if only_if_context_changed and context and state.get('capturedContext') == context:
                return
            state['epoch'] += 1
            state.pop('capturedContext', None)
        handles = [record['handle'] for record in _RECORDS if record['scope']['windowId'] == window_id]
    _cancel_handles(handles)


def _record_failure(handle, phase, error):
    message = '{0}: {1}'.format(phase, error)[:1024]
    with _LOCK:
        for record in _RECORDS:
            if record['handle'] is handle:
                record.setdefault('failures', []).append(message)
                del record['failures'][:-8]
    print('PairOfCleats owned operation ' + message)


def _cancel_handles(handles):
    failures = []
    for handle in handles:
        try:
            handle.cancel()
        except Exception as error:
            failures.append(handle)
            _record_failure(handle, 'cancellation failed', error)
    return failures


def shutdown(window=None, timeout=5.0, all_windows=False, close_window=True):
    global _ALIVE
    window_id = _window_id(window)
    with _LOCK:
        if all_windows:
            _ALIVE = False
        for identifier, state in _STATES.items():
            if all_windows or identifier == window_id:
                state['epoch'] += 1
                if all_windows or close_window:
                    state['closed'] = True
        handles = [record['handle'] for record in _RECORDS
                   if all_windows or record['scope']['windowId'] == window_id]
    deadline = time.monotonic() + timeout
    unconfirmed = _cancel_handles(handles)
    for handle in handles:
        wait = getattr(handle, 'wait', None)
        try:
            confirmed = callable(wait) and wait(max(0.0, deadline - time.monotonic()))
        except Exception as error:
            confirmed = False
            _record_failure(handle, 'settlement wait failed', error)
        if not confirmed and handle not in unconfirmed:
            unconfirmed.append(handle)
    if unconfirmed:
        print('PairOfCleats: shutdown has {0} unconfirmed owned operation(s).'.format(len(unconfirmed)))
    return not unconfirmed
