import hashlib
import json

from . import operations
from .filter_pagination import carry_filter_page_history, has_filter_page_history, normalize_filter_pagination

_FILTER_PROGRESS = object()


def _filter_binding(payload):
    page = normalize_filter_pagination(payload.get('pagination'))
    hits = payload.get('hits')
    if (not page or not page['hasMore'] or not isinstance(hits, list)
            or not isinstance(payload.get('sessionId'), str) or not payload['sessionId']
            or not isinstance(payload.get('repoRoot'), str) or not payload['repoRoot']):
        return None
    membership = [[hit.get('section'), hit.get('chunkUid'), hit.get('id'), hit.get('file')]
        for hit in hits if isinstance(hit, dict)]
    value = [payload.get('sessionId'), payload.get('repoRoot'), page.get('generation'), page.get('nextCursor'), membership]
    try:
        return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=True, separators=(',', ':')).encode('utf-8')).hexdigest()
    except (TypeError, ValueError):
        return None


def _prepare_filter_progress(window, payload):
    scope = operations.capture(window)
    if not operations.is_current(scope):
        return None
    binding = _filter_binding(payload)
    if not binding or not has_filter_page_history(payload.get('hits')):
        return scope, None
    return scope, {'epoch': scope['epoch'], 'context': scope['context'],
        'binding': binding, 'hits': payload['hits']}


def _commit_filter_progress(prepared):
    if prepared is None:
        return
    scope, progress = prepared
    if not operations.is_current(scope):
        return
    if progress is None:
        scope['state'].pop(_FILTER_PROGRESS, None)
    else:
        scope['state'][_FILTER_PROGRESS] = progress


def _restore_filter_progress(window, payload):
    scope = operations.capture(window)
    progress = scope['state'].get(_FILTER_PROGRESS)
    if (operations.is_current(scope) and progress and progress['epoch'] == scope['epoch']
            and progress['context'] == scope['context'] and progress['binding'] == _filter_binding(payload)):
        payload['hits'] = carry_filter_page_history(progress['hits'], payload.get('hits'))


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
    data, state = dict(data), dict(state)
    progress = _prepare_filter_progress(window, payload) if key == 'last_results' else None
    state[key] = dict(payload)
    data['pairofcleats_state'] = state
    window.set_project_data(data)
    _commit_filter_progress(progress)


def _get_last_session(window, key):
    if window is None:
        return None
    _, state = _load_state(window)
    payload = state.get(key)
    if isinstance(payload, dict):
        copied = dict(payload)
        if key == 'last_results':
            _restore_filter_progress(window, copied)
        return copied
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
