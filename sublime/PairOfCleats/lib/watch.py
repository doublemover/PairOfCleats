_WATCHERS = {}
_NEXT_TOKEN = 1


def _window_key(window):
    if window is None:
        return 'global'
    try:
        return str(window.id())
    except Exception:
        return 'global'


def register(window, handle, root):
    global _NEXT_TOKEN
    key = _window_key(window)
    previous = _WATCHERS.get(key)
    if previous and _is_handle_running(previous.get('handle')):
        _cancel_handle(handle)
        raise RuntimeError('Previous watch still owns process settlement. Inspect/stop it before starting another watch.')
    token = _NEXT_TOKEN
    _NEXT_TOKEN += 1
    _WATCHERS[key] = {
        'handle': handle,
        'root': root,
        'token': token,
        'stopping': False,
        'stopReason': None,
    }
    return token


def snapshot(window):
    key = _window_key(window)
    entry = _WATCHERS.get(key)
    if not entry:
        return None
    if not _is_handle_running(entry.get('handle')):
        _WATCHERS.pop(key, None)
        return None
    snapshot_entry = dict(entry)
    process = getattr(entry.get('handle'), 'process', None)
    try:
        parent_alive = process is not None and process.poll() is None
    except Exception:
        parent_alive = False
    snapshot_entry['running'] = parent_alive
    snapshot_entry['settling'] = not parent_alive
    snapshot_entry['cleanupUnconfirmed'] = bool(getattr(entry.get('handle'), '_cleanup_failures', None))
    return snapshot_entry


def is_running(window):
    return snapshot(window) is not None


def stop(window, reason='user'):
    key = _window_key(window)
    entry = _WATCHERS.get(key)
    if not entry:
        return False
    entry['stopping'] = True
    entry['stopReason'] = reason
    _cancel_handle(entry.get('handle'))
    return True


def stop_all(reason='shutdown'):
    for key, entry in list(_WATCHERS.items()):
        if not entry:
            continue
        entry['stopping'] = True
        entry['stopReason'] = reason
        _cancel_handle(entry.get('handle'))


def clear_if_done(window, token=None):
    key = _window_key(window)
    entry = _WATCHERS.get(key)
    if not entry:
        return
    if token is not None and entry.get('token') != token:
        return
    if _is_handle_running(entry.get('handle')):
        return
    _WATCHERS.pop(key, None)


def current_root(window):
    entry = snapshot(window)
    if not entry:
        return None
    return entry.get('root')


def _is_handle_running(handle):
    process = getattr(handle, 'process', None)
    if process is None:
        return False
    try:
        if process.poll() is None:
            return True
    except Exception:
        return True
    if getattr(handle, '_cleanup_failures', None):
        return True
    for thread in (getattr(handle, 'thread', None), getattr(handle, '_stopper', None)):
        if thread is not None and getattr(thread, 'is_alive', lambda: False)():
            return True
    return False


def _cancel_handle(handle):
    if handle:
        try:
            handle.cancel()
        except Exception:
            pass
