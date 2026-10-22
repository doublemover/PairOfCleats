"""Deferred real-file and native callback controls; no editor host acceptance."""
import hashlib
import importlib
import os
from unittest.mock import patch
from runtime_harness import FakeWindow, FakeView, FakeRegion, install_fake_modules, isolated_temp_directory

sublime, _plugin = install_fake_modules()
operations = importlib.import_module('PairOfCleats.lib.operations')
results = importlib.import_module('PairOfCleats.lib.results')
authority = importlib.import_module('PairOfCleats.lib.source_authority')
evidence = importlib.import_module('PairOfCleats.commands.evidence')
semantic = importlib.import_module('PairOfCleats.commands.semantic')
navigation = importlib.import_module('PairOfCleats.lib.navigation')
operations.activate()


class Selection(list):
    def add(self, region):
        self.append(region)


class SourceView(FakeView):
    def __init__(self, filename, text):
        super().__init__(filename, text)
        self._selection = Selection()
        self.loading = False
        self.shown = []

    def is_dirty(self):
        return False

    def is_loading(self):
        return self.loading

    def rowcol(self, point):
        before = self.text[:point]
        return before.count('\n'), len(before.rsplit('\n', 1)[-1])

    def text_point(self, row, column):
        lines = self.text.splitlines(True)
        if row >= len(lines):
            return len(self.text)
        return sum(len(line) for line in lines[:row]) + min(column, len(lines[row].rstrip('\r\n')))

    def line(self, point):
        start = self.text.rfind('\n', 0, point) + 1
        end = self.text.find('\n', point)
        return FakeRegion(start, len(self.text) if end < 0 else end)

    def show(self, region):
        self.shown.append(region)


class InputWindow(FakeWindow):
    def show_input_panel(self, caption, initial, on_done, on_change, on_cancel):
        self.input = {'caption': caption, 'done': on_done, 'cancel': on_cancel}


with isolated_temp_directory() as temporary:
    filename = os.path.join(temporary, 'snow 雪.py')
    retained = '\ufeffa😀z\r\nsecond\r\n'
    with open(filename, 'wb') as handle:
        handle.write(retained.encode('utf-8'))
    source_hash = hashlib.sha256(retained.encode('utf-8')).hexdigest()
    assert authority.read_verified_source(temporary, filename, source_hash)['sourceText'] == retained
    for invalid in ('a' * 63, source_hash + '\n'):
        try:
            authority.read_verified_source(temporary, filename, invalid)
            raise AssertionError('malformed byte identity was admitted')
        except ValueError:
            pass
    window = FakeWindow()
    window.set_folders([temporary])
    view = SourceView(filename, 'a😀z\nsecond\n')
    window.set_active_view(view)
    hit = {'sourceHash': source_hash, 'startLine': 2, 'startCol': 1, 'endLine': 2, 'endCol': 7}
    results.highlight_hit(view, hit, repo_root=temporary)
    assert [(row.a, row.b) for row in view.sel()] == [(4, 10)], 'Sublime maps normalized UTF-16 ranges to code-point buffer coordinates'
    for row, column in ((0, 2), (1, 99), (99, 0)):
        try:
            results._utf16_point(view, row, column)
            raise AssertionError('invalid UTF-16 point was silently clamped')
        except ValueError:
            pass
    mixed = 'one\r😀second\r\nthird\nfourth\r'
    normalized_mixed = 'one\n😀second\nthird\nfourth\n'
    assert authority.utf16_source_position(mixed, 20) == (4, 1)
    assert authority.utf16_source_position(mixed, 26) == (4, 7)
    assert authority.utf16_source_position(mixed, 27) == (5, 1)
    for invalid_offset in (5, 13, 28, -1, True):
        try:
            authority.utf16_source_position(mixed, invalid_offset)
            raise AssertionError('invalid/CRLF-interior/surrogate UTF-16 boundary was admitted')
        except (ValueError, UnicodeError):
            pass
    assert results.qualified_source_buffer(mixed, normalized_mixed) == {'removedBom': False}
    assert results.qualified_source_buffer('\ufeff' + mixed, normalized_mixed) == {'removedBom': True}
    assert results.qualified_source_buffer(mixed, normalized_mixed + 'unrelated edit') is None
    with open(filename, 'wb') as handle:
        handle.write(mixed.encode('utf-8'))
    mixed_hash = hashlib.sha256(mixed.encode('utf-8')).hexdigest()
    assert authority.read_current_source(temporary, filename)['byteLength'] == len(mixed.encode('utf-8'))
    mixed_view = SourceView(filename, normalized_mixed)
    window.set_active_view(mixed_view)
    results.highlight_hit(mixed_view, {'sourceHash': mixed_hash, 'startLine': 4, 'startCol': 1,
        'endLine': 4, 'endCol': 7, 'coordinateUnit': 'utf16'}, repo_root=temporary)
    assert [(row.a, row.b) for row in mixed_view.sel()] == [(18, 24)], 'actual normalized target selection uses protocol bare-CR lines'
    semantic_state = {'context': {'root': temporary}, 'payload': {'sourceRefs': [{'ref': 'source-ref',
        'path': 'snow 雪.py', 'sourceHash': mixed_hash, 'coordinateUnit': 'utf16'}]}}
    with patch.object(semantic.results, 'open_hit') as opened:
        semantic.open_source(window, semantic_state, {'ref': 'source-ref', 'span': [20, 26]})
        exact_hit = opened.call_args[0][1]
        assert (exact_hit['startLine'], exact_hit['startCol'], exact_hit['endLine'], exact_hit['endCol']) == (4, 1, 4, 7)
    mixed_view._selection = Selection([FakeRegion(18, 18)])
    with patch.object(navigation.config, 'get_settings', return_value={}), \
            patch.object(navigation.config, 'resolve_execution_mode', return_value={'mode': 'cli'}), \
            patch.object(navigation.config, 'validate_settings', return_value=[]), \
            patch.object(navigation.config, 'build_env', return_value={}), \
            patch.object(navigation.paths, 'resolve_repo_root', return_value=(temporary, None)), \
            patch.object(navigation.paths, 'resolve_cli', return_value={'command': 'pairofcleats'}), \
            patch.object(navigation.runner, 'run_process') as invoked:
        navigation.execute_qualified_navigation(mixed_view, 'fourth', 'definitions', lambda *_args: None, 25, 'fixture')
        requested = invoked.call_args[0][1]
        assert requested[requested.index('--line') + 1] == '4'
        assert requested[requested.index('--column') + 1] == '1'
        assert requested[requested.index('--source-hash') + 1] == mixed_hash
    with open(filename, 'wb') as handle:
        handle.write(retained.encode('utf-8'))
    window.set_active_view(view)
    queued = []
    view.regions.clear()
    view.shown[:] = []
    with patch.object(sublime, 'set_timeout', side_effect=lambda callback, delay=0: queued.append(callback)):
        results.highlight_hit(view, hit, repo_root=temporary)
        operations.invalidate(window)
        while queued:
            queued.pop(0)()
    assert view.regions == {} and view.shown == [], 'queued source selection cannot publish after its window scope is invalidated'
    with open(filename, 'wb') as handle:
        handle.write(b'replaced on disk')
    results.highlight_hit(view, hit, repo_root=temporary)
    assert view.regions == {}, 'retained old buffer text does not hide disk replacement'

    collector = InputWindow()
    collector.set_folders([temporary])
    command = evidence.PairOfCleatsCopyContextCommand(collector)
    command.run(hits=[{'file': 'snow 雪.py'}], repo_root=temporary)
    collector.quick_panel_callback(2)
    collector.quick_panel_callback(0)
    stale_purpose = collector.input['done']
    collector.set_folders([temporary + '-replacement'])
    with patch.object(evidence.runner, 'run_process') as invoked:
        stale_purpose('late purpose input')
    assert not invoked.called and collector.new_views == [], 'old selection/input cannot acquire a fresh collection scope'

    scope = operations.capture(collector, key='evidence-collection')
    command._publish('[]', '# unchanged', scope)
    collector.quick_panel_callback(2)
    late_save = collector.input['done']
    collector.set_folders([temporary])
    destination = os.path.join(temporary, 'must-not-write.json')
    late_save(destination)
    assert not os.path.exists(destination), 'late export input cannot write after context replacement'

    failures, accepted = [], []
    context = {'root': temporary, 'settings': {}, 'scope': operations.capture(collector)}
    with patch.object(semantic.config, 'resolve_execution_mode', return_value={'error': 'controlled capability unavailable'}):
        semantic.execute(collector, 'detail', {'generation': {'baseBuildId': 'a', 'semanticRevision': 0}},
            context, accepted.append, lambda: failures.append('returned-to-previous-evidence'))
    assert failures == ['returned-to-previous-evidence'] and accepted == []

print('Sublime source identity, delayed selection and evidence input preserve operation lifetime')
