import importlib
import os
import tempfile
from unittest.mock import patch
from runtime_harness import FakeRegion, FakeView, FakeWindow, install_fake_modules

sublime, _ = install_fake_modules()
search = importlib.import_module('PairOfCleats.commands.search')
history = importlib.import_module('PairOfCleats.lib.history')
results = importlib.import_module('PairOfCleats.lib.results')
operations = importlib.import_module('PairOfCleats.lib.operations')
completion = importlib.import_module('PairOfCleats.lib.completion_target')
plugin = importlib.import_module('PairOfCleats.plugin')
operations.activate()

window = FakeWindow()
with tempfile.TemporaryDirectory() as root:
    scope = {'repoRoot': root, 'mode': 'code', 'backend': '', 'limit': 25, 'ann': False,
             'allow_sparse_fallback': True, 'as_of': '', 'snapshot': 'snap-A',
             'advanced': {'file': 'a.py', 'modified_since': 0}}
    history.record_query(window, 'needle', scope, 20)
    scope_b = dict(scope, snapshot='snap-B')
    history.record_query(window, 'needle', scope_b, 20)
    entries = history.load_history(window)
    assert len(entries) == 2
    assert entries[1]['snapshot'] == 'snap-A'
    assert entries[1]['ann'] is False
    assert entries[1]['advanced']['modified_since'] == 0
    changed_settings = {'search_backend_default': 'sqlite', 'search_snapshot_default': 'today',
                        'search_advanced_defaults': {'file': 'wrong.py', 'author': 'wrong'}}
    resolved = search._resolve_defaults(changed_settings, entries[1])
    assert resolved['backend'] == ''
    assert resolved['snapshot'] == 'snap-A'
    assert resolved['advanced'] == scope['advanced']
    session = results.build_session('needle', scope, root, [], 'quick_panel')
    assert session['options']['scopeComplete'] is True
    assert session['options']['advanced'] == scope['advanced']
    legacy = history.normalize_saved_entry({'query': 'old', 'mode': 'code'})
    assert legacy['scopeComplete'] is False
    calls = []
    with patch.object(search, '_execute_search_cli', side_effect=lambda *args: calls.append(args)):
        search._execute_search(window, 'old', legacy)
    assert calls == []

# Every options panel owns cancellation; no successful continuation is invoked.
for prompt, args in [(search._prompt_options, (window, {}, {},)),
                     (search._prompt_backend, (window, {})), (search._prompt_ann, (window, {})),
                     (search._prompt_temporal, (window, {})), (search._prompt_limit, (window, {}))]:
    calls = []
    if prompt is search._prompt_options:
        prompt(*args, on_done=lambda options: calls.append(options), force_prompt=True)
    else:
        prompt(*args, on_done=lambda options: calls.append(options))
    window.quick_panel_callback(-1)
    assert calls == [], prompt.__name__


class PromptWindow(FakeWindow):
    def show_input_panel(self, caption, initial, done, changed, cancelled):
        self.input = {'caption': caption, 'done': done, 'cancelled': cancelled}


# Cancelling a real native step seals it even if a queued done/select callback
# arrives later. Older accepted panels cannot skip ahead or execute twice.
prompt_window = PromptWindow()
for helper, args, is_input in [
        (search._prompt_query, ('',), True), (search._prompt_as_of, ({},), True),
        (search._prompt_snapshot, ({},), True), (search._prompt_limit, ({},), False),
        (search._prompt_backend, ({},), False), (search._prompt_ann, ({},), False),
        (search._prompt_temporal, ({},), False)]:
    accepted = []
    helper(prompt_window, *args, on_done=lambda value: accepted.append(value))
    if is_input:
        captured = dict(prompt_window.input)
        captured['cancelled']()
        captured['done']('queued after cancellation')
    else:
        captured = prompt_window.quick_panel_callback
        captured(-1)
        captured(0)
    assert accepted == [], helper.__name__

with tempfile.TemporaryDirectory() as prompt_root:
    prompt_window.set_folders([prompt_root])
    user = sublime.load_settings(search.config.SETTINGS_FILE)
    user.update({'api_execution_mode': 'cli', 'search_advanced_defaults': {'file': ['original.py']},
                 'env': {'ORIGINAL_RUNTIME': 'captured'}, 'search_prompt_options': True})
    dispatched = []
    replacement_root = os.path.join(prompt_root, 'replacement')
    os.makedirs(replacement_root)
    current_root = [prompt_root]
    with patch.object(search, '_resolve_repo_root', side_effect=lambda _window: (current_root[0], None)), \
            patch.object(search.config, 'validate_settings', return_value=[]), \
            patch.object(search, '_execute_search_cli', side_effect=lambda *args, **kwargs: dispatched.append((args, kwargs))):
        search.PairOfCleatsSearchWithOptionsCommand(prompt_window).run(query='native options')
        mode_callback = prompt_window.quick_panel_callback
        mode_callback(0)
        backend_callback = prompt_window.quick_panel_callback
        mode_callback(1)
        assert prompt_window.quick_panel_callback is backend_callback
        current_root[0] = replacement_root
        user.set('env', {'ORIGINAL_RUNTIME': 'replacement'})
        user.get('search_advanced_defaults')['file'].append('replacement.py')
        backend_callback(0)
        prompt_window.quick_panel_callback(0)  # ANN default
        prompt_window.quick_panel_callback(0)  # current index
        final_callback = prompt_window.quick_panel_callback
        final_callback(0)
        final_callback(0)
        assert len(dispatched) == 1
        invocation = dispatched[0][0]
        assert invocation[2] == prompt_root
        assert invocation[3]['env'] == {'ORIGINAL_RUNTIME': 'captured'}
        assert invocation[4]['advanced']['file'] == ['original.py']
        current_root[0] = prompt_root

        # Query cancellation and a project replacement both prevent a queued
        # original native callback from executing with today's repository.
        search.PairOfCleatsSearchCommand(prompt_window).run()
        cancelled_query = dict(prompt_window.input)
        cancelled_query['cancelled']()
        cancelled_query['done']('cancelled query')
        assert len(dispatched) == 1
        search.PairOfCleatsSearchWithOptionsCommand(prompt_window).run(query='revoked options')
        revoked_mode = prompt_window.quick_panel_callback
        prompt_window.set_folders([])
        revoked_mode(0)
        assert prompt_window.quick_panel_callback is revoked_mode and len(dispatched) == 1

    prompt_window.set_folders([prompt_root])
    current_root[0] = prompt_root
    with patch.object(search, '_resolve_repo_root', side_effect=lambda _window: (current_root[0], None)), \
            patch.object(search, '_execute_search') as execute:
        search.PairOfCleatsBrowseIndexedMatchesCommand(prompt_window).run()
        original_filter = dict(prompt_window.input)
        current_root[0] = replacement_root
        original_filter['done']('file:original.py')
        original_filter['done']('file:replacement.py')
        assert execute.call_count == 1
        assert execute.call_args[0][2]['repoRoot'] == prompt_root
        assert execute.call_args[0][2]['filter'] == 'file:original.py'

    analysis = importlib.import_module('PairOfCleats.commands.analysis')
    analysis_values = []
    analysis._prompt_value(prompt_window, 'Original analysis seed', '', analysis_values.append)
    cancelled = dict(prompt_window.input)
    cancelled['cancelled']()
    cancelled['done']('must not run')
    assert analysis_values == []

    # The real command result retains a valid search when unrelated history
    # persistence fails, while a project replacement during that callback
    # revokes its result publication. A primary owned failure beats exit text.
    prompt_window.set_folders([prompt_root])
    options = {'repoRoot': prompt_root, 'mode': 'code', 'backend': '', 'limit': 25,
               'ann': None, 'allow_sparse_fallback': False, 'as_of': '', 'snapshot': '', 'advanced': {},
               'scopeComplete': True, 'schemaVersion': 1}
    actual_calls = []
    cli_settings = {'api_execution_mode': 'cli', 'history_limit': 25, 'open_results_in': 'quick_panel'}
    with patch.object(search.config, 'get_settings', return_value=cli_settings), \
            patch.object(search.config, 'validate_settings', return_value=[]), \
            patch.object(search.paths, 'resolve_cli', return_value={'command': 'inert-cli'}), \
            patch.object(search.runner, 'run_process', side_effect=lambda *args, **kwargs: actual_calls.append(kwargs)):
        search._execute_search(prompt_window, 'valid search', options)
        with patch.object(history, 'record_query', side_effect=OSError('original history persistence failure')):
            actual_calls[-1]['on_done'](search.runner.ProcessResult(0, '', payload={'code': [{'file': 'original.py'}]}))
        state = importlib.import_module('PairOfCleats.lib.results_state')
        assert state.get_last_results(prompt_window)['query'] == 'valid search'
        assert 'search completed, but history save failed' in sublime.last_error
        assert 'original history persistence failure' in sublime.last_error

        search._execute_search(prompt_window, 'revoked search', options)
        with patch.object(history, 'record_query', side_effect=lambda *args: prompt_window.set_folders([])):
            actual_calls[-1]['on_done'](search.runner.ProcessResult(0, '', payload={'code': [{'file': 'replacement.py'}]}))
        assert state.get_last_results(prompt_window)['query'] == 'valid search'
        prompt_window.set_folders([prompt_root])
        search._execute_search(prompt_window, 'failed search', options)
        actual_calls[-1]['on_done'](search.runner.ProcessResult(2, 'secondary process exit output',
            error='original owned read failure'))
        assert sublime.last_error == 'original owned read failure'

for change in ['move-before-response', 'move-before-accept', 'edit', 'close', 'supersede', 'rename',
               'move-window', 'invalidate-before-response', 'invalidate-before-accept', 'unload-before-accept', 'none']:
    operations.activate()
    completion.clear_all()
    view = FakeView(text='alp other')
    view.set_window(window)
    view._selection = [FakeRegion(1, 1)]
    callbacks = []
    with patch.object(search, '_execute_symbol_lookup', side_effect=lambda _window, _query, callback, **kwargs: callbacks.append(callback)):
        command = search.PairOfCleatsCompleteSymbolCommand(view)
        command.run(None)
        if change == 'move-before-response': view._selection = [FakeRegion(6, 6)]
        if change == 'edit': view.replace(None, FakeRegion(0, 3), 'changed')
        if change == 'close': view._valid = False
        if change == 'supersede': command.run(None)
        if change == 'rename': view._file_name = '/replacement-file.py'
        if change == 'move-window': view.set_window(FakeWindow())
        if change == 'invalidate-before-response': operations.invalidate(window)
        original = view.text
        callbacks[0]([{'file': 'a.py', 'name': 'alpha'}], root, {})
        if change in ['edit', 'close', 'supersede', 'rename', 'move-window', 'invalidate-before-response']:
            assert view.text == original
            assert not view.command_log
            continue
        if change == 'move-before-accept': view._selection = [FakeRegion(6, 6)]
        if change == 'invalidate-before-accept': operations.invalidate(window)
        if change == 'unload-before-accept': plugin.plugin_unloaded()
        window.quick_panel_callback(0)
        if change in ('invalidate-before-accept', 'unload-before-accept'):
            assert view.text == original and view.change_count() == 0
            continue
        assert view.text == 'alpha other', change
        assert view.change_count() == 1, 'one owner edit preserves normal undo grouping'

operations.activate()
view = FakeView(text='alp other')
view.set_window(window)
view._selection = [FakeRegion(1, 1)]
target = completion.capture_target(view)
tampered = dict(target, end=target['end'] + 1, expected_text='alp ')
assert not completion.apply_target(view, None, 'wrong', tampered)
assert completion.apply_target(view, None, 'alpha', target)
assert not completion.apply_target(view, None, 'duplicate', target)
assert view.text == 'alpha other' and view.change_count() == 1

# The native history and result-action pickers keep their original foreground
# lifetime, and invalid saved controls cannot silently become today's defaults.
with tempfile.TemporaryDirectory() as root:
    options = {'repoRoot': root, 'mode': 'code', 'backend': '', 'limit': 25, 'ann': False,
               'allow_sparse_fallback': False, 'as_of': '', 'snapshot': '', 'advanced': {'file': ['original.py']},
               'scopeComplete': True, 'schemaVersion': 1}
    window.set_folders([root])
    history.record_query(window, 'original-query', options, 25)
    dispatched = []
    with patch.object(search, '_execute_search', side_effect=lambda *args, **kwargs: dispatched.append((args, kwargs))):
        search.PairOfCleatsSearchHistoryCommand(window).run()
        stale_history = window.quick_panel_callback
        operations.capture(window, key='foreground-search')
        stale_history(0)
        assert dispatched == []
        search.PairOfCleatsSearchHistoryCommand(window).run()
        window.quick_panel_callback(0)
        assert len(dispatched) == 1 and dispatched[0][0][2]['advanced']['file'] == ['original.py']

    invalid = [('limit', 0), ('limit', False), ('ann', 'true'), ('mode', []), ('backend', {}),
               ('allow_sparse_fallback', 'false'), ('as_of', 0), ('advanced', {'modified_since': True}),
               ('advanced', {'file': [7]}), ('advanced', {'unknown_filter': 'value'})]
    for key, value in invalid:
        selected = dict(options, **{key: value})
        with patch.object(search.config, 'get_settings', return_value={}), \
                patch.object(search.config, 'validate_settings', return_value=[]), \
                patch.object(search, '_execute_search_cli') as cli, \
                patch.object(search.api_client, 'run_async') as api:
            search._execute_search(window, 'invalid', selected)
            assert not cli.called and not api.called, (key, value)

    oversized = dict(options, advanced={'file': ['a' * 20000]})
    window.set_project_data({'pairofcleats_state': {'history': [dict(oversized, query='oversized')]}})
    saved = history.load_history(window)
    assert len(saved) == 1 and saved[0]['scopeComplete'] is False and saved[0]['scopeErrors']

    history.record_query(window, 'original-query', options, 25)
    before = window.project_data()['pairofcleats_state'].copy()
    with patch.object(window, 'set_project_data', side_effect=OSError('original history save failure')):
        try:
            history.record_query(window, 'not-published', options, 25)
            raise AssertionError('history save failure was discarded')
        except OSError as error:
            assert 'original history save failure' in str(error)
    assert window.project_data()['pairofcleats_state'] == before

    session = results.build_session('original-query', options, root,
        [{'file': 'original.py', 'name': 'Original'}], 'quick_panel')
    state = importlib.import_module('PairOfCleats.lib.results_state')
    state.record_last_results(window, session)
    with patch.object(results, 'apply_hit_action') as action:
        search.PairOfCleatsResultActionsCommand(window).run()
        stale_hit = window.quick_panel_callback
        operations.capture(window, key='foreground-search')
        stale_hit(0)
        assert not action.called
        search.PairOfCleatsResultActionsCommand(window).run()
        session['hits'][0]['file'] = 'replacement.py'
        window.quick_panel_callback(0)
        stale_action = window.quick_panel_callback
        operations.capture(window, key='foreground-search')
        stale_action(0)
        assert not action.called
print('Saved search scope, prompt cancellation and asynchronous completion ownership passed')
