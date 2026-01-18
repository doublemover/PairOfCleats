import datetime


def record_last_build(window, mode):
    if window is None:
        return None
    timestamp = datetime.datetime.utcnow().replace(microsecond=0).isoformat() + 'Z'
    data = window.project_data() or {}
    state = data.get('pairofcleats_state')
    if not isinstance(state, dict):
        state = {}
    index_state = state.get('index')
    if not isinstance(index_state, dict):
        index_state = {}
    index_state['last_mode'] = mode
    index_state['last_time'] = timestamp
    state['index'] = index_state
    data['pairofcleats_state'] = state
    window.set_project_data(data)
    return index_state


def get_last_build(window):
    if window is None:
        return None
    data = window.project_data() or {}
    state = data.get('pairofcleats_state')
    if not isinstance(state, dict):
        return None
    index_state = state.get('index')
    if isinstance(index_state, dict):
        return dict(index_state)
    return None
