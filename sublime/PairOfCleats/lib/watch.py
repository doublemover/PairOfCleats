_WATCHERS = {}


def _window_key(window):
    if window is None:
        return 'global'
    try:
        return str(window.id())
    except Exception:
        return 'global'


def register(window, handle, root):
    key = _window_key(window)
    _WATCHERS[key] = {
        'handle': handle,
        'root': root
    }


def is_running(window):
    key = _window_key(window)
    entry = _WATCHERS.get(key)
    if not entry:
        return False
    handle = entry.get('handle')
    process = getattr(handle, 'process', None)
    if process is None:
        return False
    return process.poll() is None


def stop(window):
    key = _window_key(window)
    entry = _WATCHERS.pop(key, None)
    if not entry:
        return False
    handle = entry.get('handle')
    if handle:
        handle.cancel()
    return True


def stop_all():
    keys = list(_WATCHERS.keys())
    for key in keys:
        entry = _WATCHERS.pop(key, None)
        if not entry:
            continue
        handle = entry.get('handle')
        if handle:
            handle.cancel()


def clear_if_done(window):
    key = _window_key(window)
    entry = _WATCHERS.get(key)
    if not entry:
        return
    handle = entry.get('handle')
    process = getattr(handle, 'process', None)
    if process is None or process.poll() is not None:
        _WATCHERS.pop(key, None)


def current_root(window):
    key = _window_key(window)
    entry = _WATCHERS.get(key)
    if not entry:
        return None
    return entry.get('root')
