def get_last_results(window):
    return _get_last_session(window, 'last_results')


def get_last_explain(window):
    return _get_last_session(window, 'last_explain')


def get_last_context_pack(window):
    return _get_last_session(window, 'last_context_pack')


def get_last_risk_explain(window):
    return _get_last_session(window, 'last_risk_explain')


def get_last_analysis(window, kind):
    return _get_last_session(window, _analysis_key(kind))


def record_last_results(window, payload):
    _record_last_session(window, 'last_results', payload)


def record_last_explain(window, payload):
    _record_last_session(window, 'last_explain', payload)


def record_last_context_pack(window, payload):
    _record_last_session(window, 'last_context_pack', payload)


def record_last_risk_explain(window, payload):
    _record_last_session(window, 'last_risk_explain', payload)


def record_last_analysis(window, kind, payload):
    _record_last_session(window, _analysis_key(kind), payload)


def _record_last_session(window, key, payload):
    if window is None or not isinstance(payload, dict):
        return
    data, state = _load_state(window)
    state[key] = dict(payload)
    data['pairofcleats_state'] = state
    window.set_project_data(data)


def _get_last_session(window, key):
    if window is None:
        return None
    _, state = _load_state(window)
    payload = state.get(key)
    if isinstance(payload, dict):
        return dict(payload)
    return None


def _load_state(window):
    data = window.project_data() or {}
    state = data.get('pairofcleats_state')
    if not isinstance(state, dict):
        state = {}
    return data, state


def _analysis_key(kind):
    normalized = str(kind or '').strip().lower().replace('-', '_')
    return 'last_{0}'.format(normalized)
