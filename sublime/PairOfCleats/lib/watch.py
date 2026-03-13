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
    if previous and not previous.get('stopping'):
        _cancel_handle(previous.get('handle'))
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
    snapshot_entry['running'] = True
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
        return process.poll() is None
    except Exception:
        return False


def _cancel_handle(handle):
    if handle:
        try:
            handle.cancel()
        except Exception:
            pass
