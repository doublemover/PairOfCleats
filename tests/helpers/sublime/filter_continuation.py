"""Deferred canonical page and actual editor continuation-dispatch controls."""
import importlib
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
page = {'kind': 'filter', 'generation': generation, 'returned': 1, 'total': 5,
    'hasMore': True, 'nextCursor': 'page-two'}
assert pagination.normalize_filter_pagination(page)['generation'] == generation
assert pagination.normalize_filter_pagination(dict(page, generation=generation + '\n')) is None
assert pagination.normalize_filter_pagination(dict(page, kind='ranked')) is None
assert pagination.normalize_filter_pagination(dict(page, hasMore='true')) is None
assert pagination.normalize_filter_pagination(dict(page, nextCursor=None)) is None
previous = {'pagination': page, 'hits': [{'section': 'records', 'id': 0, 'name': 'same'}]}
next_page = dict(page, hasMore=False, nextCursor=None)
merged = pagination.merge_filter_page(previous, dict(next_page, returned=4), [
    {'section': 'records', 'id': 0, 'name': 'same'},
    {'section': 'records', 'id': '0', 'name': 'same'},
    {'section': 'records', 'chunkUid': '0', 'name': 'same'},
    {'section': 'code', 'id': 0, 'name': 'same'}])
assert len(merged) == 4, 'only exact namespace/type/domain identities deduplicate'
for invalid in (dict(page, returned=0), dict(page, returned='1'), dict(page, total=0),
        dict(page, order='ranked-score'), dict(page, hasMore=False)):
    try:
        pagination.admit_filter_page(invalid, previous['hits'])
        raise AssertionError('invalid initial page was admitted')
    except ValueError:
        pass
assert pagination.admit_filter_page(dict(page, returned=0, total=0, hasMore=False, nextCursor=None), [])['returned'] == 0
pagination.capture_selection(previous, merged, 1)
assert pagination.selected_index(previous, [merged[-1]] + merged) == 2, 'selected exact identity survives section/insertion ordering'
for invalid in (dict(page, generation='b' * 64), page):
    try:
        pagination.merge_filter_page(previous, invalid, [])
        raise AssertionError('changed generation or nonadvancing cursor was accepted')
    except ValueError:
        pass

class SelectionWindow(FakeWindow):
    def show_quick_panel(self, items, callback, selected_index=-1):
        self.selected_index = selected_index
        super().show_quick_panel(items, callback, selected_index=selected_index)


with isolated_temp_directory() as root:
    window = SelectionWindow()
    window.set_folders([root])
    options = {'repoRoot': root, 'mode': 'records', 'backend': 'memory', 'limit': 1, 'ann': None,
        'allow_sparse_fallback': False, 'as_of': '', 'snapshot': '', 'advanced': {'type': 'function'},
        'scopeComplete': True, 'schemaVersion': 1, 'cursor': 'page-two'}
    session = results.build_session('', options, root, previous['hits'], 'quick_panel')
    session.update({'sessionId': 'captured-enumeration', 'pagination': page,
        'transport': 'api', 'endpoint': 'http://127.0.0.1:7345', 'serviceRoot': '/service/repo'})
    state.record_last_results(window, session)
    execution = {'mode': 'api', 'base_url': 'http://127.0.0.1:7345', 'allow_fallback': True}
    captured = []
    def asynchronous(request, done, **kwargs):
        captured.append((request, done, kwargs))
    with patch.object(commands.config, 'get_settings', return_value={}), \
            patch.object(commands.config, 'validate_settings', return_value=[]), \
            patch.object(commands.config, 'resolve_execution_mode', return_value=dict(execution, base_url='http://127.0.0.1:9999')), \
            patch.object(commands.api_client, 'run_async', side_effect=asynchronous), \
            patch.object(commands, '_execute_search_cli') as cli:
        commands._execute_search(window, '', options, enumeration=True, append_session=session, service_root='/service/repo')
        assert captured == [] and not cli.called, 'endpoint change cannot dispatch an opaque cursor to another destination'
    assert 'endpoint changed' in sublime.last_error
    with patch.object(commands.config, 'get_settings', return_value={}), \
            patch.object(commands.config, 'validate_settings', return_value=[]), \
            patch.object(commands.config, 'resolve_execution_mode', return_value=execution), \
            patch.object(commands.api_client, 'run_async', side_effect=asynchronous), \
            patch.object(commands, '_execute_search_cli') as cli:
        commands._execute_search(window, '', options, enumeration=True, append_session=session, service_root='/service/repo')
        assert len(captured) == 1
        captured[-1][1](runner.ProcessResult(1, '', error='controlled API cursor expiry'))
        assert not cli.called, 'prefer policy cannot send an API continuation cursor to CLI after failure'
    assert state.get_last_results(window)['hits'] == session['hits'], 'failed continuation retains the previous selection/evidence'
    assert state.get_last_results(window)['pagination'] == page
    pagination.capture_selection(session, session['hits'], 0)
    state.record_last_results(window, session)
    with patch.object(commands.config, 'get_settings', return_value={}), \
            patch.object(commands.config, 'validate_settings', return_value=[]), \
            patch.object(commands.config, 'resolve_execution_mode', return_value=execution), \
            patch.object(commands.api_client, 'run_async', side_effect=asynchronous):
        commands._execute_search(window, '', options, enumeration=True, append_session=session, service_root='/service/repo')
        captured[-1][1](runner.ProcessResult(0, '', payload={'records': [
            {'file': 'new.py', 'id': '0', 'name': 'same'}], 'pagination': next_page}))
    assert window.selected_index == 0, 'native quick panel retains selected identity when a page appends'
    assert state.get_last_results(window)['sessionId'] == session['sessionId']
    reopened = state.get_last_results(window)
    with patch.object(results, 'open_hit') as opened:
        results.reopen_session(window, reopened)
        callback = window.quick_panel_callback
        operations.invalidate(window)
        callback(0)
        assert not opened.called, 'late cached-result selection cannot open a source in a replacement context'

    class InputWindow(SelectionWindow):
        def show_input_panel(self, caption, initial, on_done, on_change, on_cancel):
            self.input_done = on_done

    prompting = InputWindow()
    prompting.set_folders([root])
    commands.PairOfCleatsBrowseIndexedMatchesCommand(prompting).run()
    stale_filter = prompting.input_done
    prompting.set_folders([root + '-replacement'])
    with patch.object(commands, '_execute_search') as dispatch:
        stale_filter('type:function')
        assert not dispatch.called, 'late browse input cannot start a new foreground search in replacement context'
    prompting.set_folders([root])
    with patch.object(commands.config, 'get_settings', return_value={}), patch.object(commands, '_execute_search') as dispatch:
        commands._search_with_prompt(prompting)
        stale_query = prompting.input_done
        operations.capture(prompting, key='foreground-search')
        stale_query('superseded query')
        assert not dispatch.called, 'a newer foreground request owns query prompt completion'
    option_callbacks = []
    with patch.object(commands.config, 'get_settings', return_value={}), \
            patch.object(commands, '_prompt_options', side_effect=lambda _window, _settings, _defaults, done, **kwargs: option_callbacks.append(done)), \
            patch.object(commands, '_execute_search') as dispatch:
        commands._search_with_query(prompting, 'older query', force_prompt=True)
        operations.capture(prompting, key='foreground-search')
        option_callbacks[0](options)
        assert not dispatch.called, 'late options cannot acquire a fresh request scope after a newer search'

print('Sublime indexed continuation pins endpoint, generation and exact hit identity without cross-transport replay')
