def get_last_map(window):
    if window is None:
        return None
    _, state = _load_state(window)
    entry = state.get('last_map')
    if isinstance(entry, dict):
        return dict(entry)
    return None


def record_last_map(window, payload):
    if window is None or not isinstance(payload, dict):
        return
    data, state = _load_state(window)
    state['last_map'] = dict(payload)
    data['pairofcleats_state'] = state
    window.set_project_data(data)


def _load_state(window):
    data = window.project_data() or {}
    state = data.get('pairofcleats_state')
    if not isinstance(state, dict):
        state = {}
    return data, state
