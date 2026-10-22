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
