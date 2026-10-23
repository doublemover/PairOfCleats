from .saved_search import normalize_saved_entry, normalize_saved_options


def load_history(window):
    if window is None:
        return []
    _, state = _load_state(window)
    history = state.get('history')
    if isinstance(history, list):
        return [normalized for normalized in (normalize_saved_entry(entry) for entry in history) if normalized]
    return []


def get_last_query(window):
    if window is None:
        return None
    _, state = _load_state(window)
    last = state.get('last_search')
    if isinstance(last, dict) and last.get('query'):
        return normalize_saved_entry(last)
    history = state.get('history')
    if isinstance(history, list) and history:
        entry = history[0]
        if isinstance(entry, dict) and entry.get('query'):
            return normalize_saved_entry(entry)
    return None


def record_query(window, query, options, limit):
    if window is None or not query:
        return
    data, state = _load_state(window)
    data, state = dict(data), dict(state)
    history = state.get('history')
    if not isinstance(history, list):
        history = []
    entry = _build_entry(query, options)
    history = [item for item in history if not _matches_entry(item, entry)]
    history.insert(0, entry)
    if isinstance(limit, int) and limit > 0:
        history = history[:limit]
    state['history'] = history
    state['last_search'] = entry
    data['pairofcleats_state'] = state
    window.set_project_data(data)


def _load_state(window):
    data = window.project_data() or {}
    state = data.get('pairofcleats_state')
    if not isinstance(state, dict):
        state = {}
    return data, state


def _build_entry(query, options):
    entry = normalize_saved_options(options)
    entry['query'] = query
    return entry


def _matches_entry(existing, target):
    if not isinstance(existing, dict):
        return False
    return normalize_saved_entry(existing) == normalize_saved_entry(target)
