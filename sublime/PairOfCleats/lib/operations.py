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
                 'epoch': state['epoch'], 'context': _context(window), 'key': key,
                 'generation': state['keys'].get(key)}
    for handle in older:
        handle.cancel()
    return scope


def is_current(scope):
    with _LOCK:
        state = scope['state']
        return (_ALIVE and not state['closed']
                and _STATES.get(scope['windowId']) is state
                and state['epoch'] == scope['epoch']
                and (not scope.get('key') or state['keys'].get(scope['key']) == scope['generation'])
                and _context(scope['window']) == scope['context'])


def track(scope, handle):
    with _LOCK:
        _RECORDS.append({'scope': scope, 'handle': handle})
    if not is_current(scope):
        handle.cancel()
    return handle


def release(handle):
    with _LOCK:
        _RECORDS[:] = [record for record in _RECORDS if record['handle'] is not handle]


def invalidate(window):
    window_id = _window_id(window)
    with _LOCK:
        state = _STATES.get(window_id)
        if state is not None:
            state['epoch'] += 1
        handles = [record['handle'] for record in _RECORDS if record['scope']['windowId'] == window_id]
    for handle in handles:
        handle.cancel()


def shutdown(window=None, timeout=5.0, all_windows=False):
    global _ALIVE
    window_id = _window_id(window)
    with _LOCK:
        if all_windows:
            _ALIVE = False
        for identifier, state in _STATES.items():
            if all_windows or identifier == window_id:
                state['epoch'] += 1
                state['closed'] = True
        handles = [record['handle'] for record in _RECORDS
                   if all_windows or record['scope']['windowId'] == window_id]
    deadline = time.monotonic() + timeout
    for handle in handles:
        handle.cancel()
    unconfirmed = []
    for handle in handles:
        wait = getattr(handle, 'wait', None)
        if not callable(wait) or not wait(max(0.0, deadline - time.monotonic())):
            unconfirmed.append(handle)
    if unconfirmed:
        print('PairOfCleats: shutdown has {0} unconfirmed owned operation(s).'.format(len(unconfirmed)))
    return not unconfirmed
