"""Deferred direct and actual serialized-project continuation controls."""
import importlib
import json
from unittest.mock import patch
from runtime_harness import FakeWindow, install_fake_modules, isolated_temp_directory

sublime, _plugin = install_fake_modules()
pagination = importlib.import_module('PairOfCleats.lib.filter_pagination')
commands = importlib.import_module('PairOfCleats.commands.search')
operations = importlib.import_module('PairOfCleats.lib.operations')
results = importlib.import_module('PairOfCleats.lib.results')
state = importlib.import_module('PairOfCleats.lib.results_state')
runner = importlib.import_module('PairOfCleats.lib.runner')
operations.activate()

generation = 'a' * 64


def page(cursor, **overrides):
    value = {'kind': 'filter', 'order': 'indexed-order', 'generation': generation,
        'returned': 1, 'total': 10, 'hasMore': True, 'nextCursor': cursor}
    value.update(overrides)
    return value


def hit(identity):
    return {'section': 'code', 'file': identity + '.py', 'chunkUid': identity}


def refused(callback, text):
    try:
        callback()
        raise AssertionError('invalid continuation was admitted')
    except ValueError as error:
        assert text in str(error), str(error)


previous = {'pagination': page('cursor-a'), 'hits': [hit('one')]}
merged = pagination.merge_filter_page(previous, page('cursor-b'), [hit('two')])
assert [value['chunkUid'] for value in merged] == ['one', 'two']
normalized = pagination.carry_filter_page_history(merged, [dict(value) for value in merged])
retained = {'pagination': page('cursor-b'), 'hits': normalized}
refused(lambda: pagination.merge_filter_page(retained, page('cursor-a'), [hit('three')]), 'earlier cursor')
refused(lambda: pagination.merge_filter_page(retained, page('cursor-c'), [hit('one')]), 'no new source identities')
assert pagination.merge_filter_page(retained, page(None, hasMore=False, returned=0), []) == retained['hits']
unknown = pagination.merge_filter_page(previous, page('cursor-b'), [{'file': 'unknown.py'}])
refused(lambda: pagination.merge_filter_page({'pagination': page('cursor-b'), 'hits': unknown},
    page('cursor-a'), [{'file': 'another-unknown.py'}]), 'earlier cursor')
refused(lambda: pagination.merge_filter_page({'pagination': page('cursor-a', total=2), 'hits': [hit('one')]},
    page(None, total=2, returned=2, hasMore=False), [hit('two'), hit('three')]), 'loaded membership exceeds')
serialized = json.loads(json.dumps(retained))
assert not pagination.has_filter_page_history(serialized['hits'])
refused(lambda: pagination.merge_filter_page(serialized, page('cursor-c'), [hit('one')]), 'no new source identities')
assert len(pagination.merge_filter_page(serialized, page('cursor-a'), [hit('three')])) == 3


class SerializationWindow(FakeWindow):
    refuse_save = False

    def set_project_data(self, value):
        if self.refuse_save:
            raise RuntimeError('controlled original project save failure')
        self._project_data = json.loads(json.dumps(value))

    def show_quick_panel(self, items, callback, selected_index=-1):
        self.selected_index = selected_index
        super().show_quick_panel(items, callback, selected_index=selected_index)


with isolated_temp_directory() as root:
    window = SerializationWindow()
    window.set_folders([root])
    options = {'repoRoot': root, 'mode': 'code', 'backend': 'memory', 'limit': 1,
        'ann': None, 'allow_sparse_fallback': False, 'as_of': '', 'snapshot': '',
        'advanced': {'lang': 'python'}, 'scopeComplete': True, 'schemaVersion': 1, 'cursor': 'cursor-a'}
    session = results.build_session('', options, root, [hit('one')], 'quick_panel')
    session.update({'sessionId': 'original-serialized-enumeration', 'pagination': page('cursor-a'),
        'transport': 'api', 'endpoint': 'http://127.0.0.1:7345', 'serviceRoot': '/service/repo'})
    pagination.capture_selection(session, session['hits'], 0)
    state.record_last_results(window, session)
    execution = {'mode': 'api', 'base_url': 'http://127.0.0.1:7345', 'allow_fallback': False}
    captured = []

    def asynchronous(request, done, **kwargs):
        captured.append((request, done, kwargs))

    def dispatch(identity, cursor):
        prior = state.get_last_results(window)
        selected = dict(prior['options'], cursor=prior['pagination']['nextCursor'])
        with patch.object(commands.config, 'get_settings', return_value={}), \
                patch.object(commands.config, 'validate_settings', return_value=[]), \
                patch.object(commands.config, 'resolve_execution_mode', return_value=execution), \
                patch.object(commands.api_client, 'run_async', side_effect=asynchronous):
            commands._execute_search(window, '', selected, enumeration=True, append_session=prior, service_root='/service/repo')
            captured[-1][1](runner.ProcessResult(0, '', payload={'code': [hit(identity)], 'pagination': page(cursor)}))

    dispatch('two', 'cursor-b')
    saved = state.get_last_results(window)
    assert pagination.has_filter_page_history(saved['hits']), 'actual window-operation state restores private receipt after JSON storage'
    assert not pagination.has_filter_page_history(window.project_data()['pairofcleats_state']['last_results']['hits'])
    assert [value['chunkUid'] for value in saved['hits']] == ['one', 'two']
    assert window.selected_index == 0
    failed_hits = pagination.merge_filter_page(saved, page('cursor-c'), [hit('not-published')])
    failed_session = results.build_session('', options, root, failed_hits, 'quick_panel')
    failed_session.update({'sessionId': session['sessionId'], 'pagination': page('cursor-c')})
    window.refuse_save = True
    try:
        state.record_last_results(window, failed_session)
        raise AssertionError('controlled project save failure was discarded')
    except RuntimeError as error:
        assert 'original project save failure' in str(error)
    finally:
        window.refuse_save = False
    after_failed_save = state.get_last_results(window)
    assert after_failed_save['pagination']['nextCursor'] == 'cursor-b'
    assert pagination.has_filter_page_history(after_failed_save['hits']), 'failed project save preserves prior original progress receipt'
    for identity, cursor, diagnostic in [('three', 'cursor-a', 'earlier cursor'), ('one', 'cursor-c', 'no new source identities')]:
        sublime.last_error = ''
        dispatch(identity, cursor)
        assert diagnostic in sublime.last_error
        current = state.get_last_results(window)
        assert current['sessionId'] == session['sessionId']
        assert current['pagination']['nextCursor'] == 'cursor-b'
        assert [value['chunkUid'] for value in current['hits']] == ['one', 'two']
        assert window.selected_index == 0
    dispatch('three', 'cursor-c')
    dispatch('four', 'cursor-a')
    assert 'earlier cursor' in sublime.last_error
    assert [value['chunkUid'] for value in state.get_last_results(window)['hits']] == ['one', 'two', 'three']

    public = json.loads(json.dumps(window.project_data()))
    window.project_data()['pairofcleats_state']['last_results']['hits'][0]['file'] = 'changed-membership.py'
    assert not pagination.has_filter_page_history(state.get_last_results(window)['hits']), 'public membership edits cannot adopt the private receipt'
    window.set_project_data(public)
    assert pagination.has_filter_page_history(state.get_last_results(window)['hits'])
    sibling = SerializationWindow()
    sibling.set_folders([root])
    sibling.set_project_data(public)
    assert not pagination.has_filter_page_history(state.get_last_results(sibling)['hits']), 'sibling window cannot borrow original progress owner'
    window.set_folders([root + '-replacement'])
    assert not pagination.has_filter_page_history(state.get_last_results(window)['hits']), 'replacement context does not adopt old progress'
    window.set_folders([root])
    operations.invalidate(window)
    assert not pagination.has_filter_page_history(state.get_last_results(window)['hits']), 'invalidated epoch cannot restore original progress'
    operations.activate()
    assert not pagination.has_filter_page_history(state.get_last_results(window)['hits']), 'restart does not reconstruct private prior cursor observations'
    window.project_data()['pairofcleats_state']['last_results']['pagination'] = []
    assert state.get_last_results(window) is not None, 'malformed saved progress metadata cannot break ordinary saved-result access'

print('Sublime serialized-project continuation progress preserves original window/context/membership and rejects cycles')
