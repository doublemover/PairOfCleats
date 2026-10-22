import importlib
import tempfile
from unittest.mock import patch
from runtime_harness import FakeRegion, FakeView, FakeWindow, install_fake_modules

sublime, _ = install_fake_modules()
search = importlib.import_module('PairOfCleats.commands.search')
history = importlib.import_module('PairOfCleats.lib.history')
results = importlib.import_module('PairOfCleats.lib.results')

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

for change in ['move-before-response', 'move-before-accept', 'edit', 'close', 'supersede', 'none']:
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
        original = view.text
        callbacks[0]([{'file': 'a.py', 'name': 'alpha'}], root, {})
        if change in ['edit', 'close', 'supersede']:
            assert view.text == original
            assert not view.command_log
            continue
        if change == 'move-before-accept': view._selection = [FakeRegion(6, 6)]
        window.quick_panel_callback(0)
        assert view.text == 'alpha other', change
        assert view.change_count() == 1, 'one owner edit preserves normal undo grouping'
print('Saved search scope, prompt cancellation and asynchronous completion ownership passed')
