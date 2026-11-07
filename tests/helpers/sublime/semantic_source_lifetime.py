"""Authored actual semantic/opening controls; no editor-host acceptance."""
import hashlib
import importlib
import os
from types import SimpleNamespace
from unittest.mock import patch
from runtime_harness import FakeView, FakeWindow, FakeRegion, install_fake_modules, isolated_temp_directory

sublime, _plugin = install_fake_modules()
semantic = importlib.import_module('PairOfCleats.commands.semantic')
operations = importlib.import_module('PairOfCleats.lib.operations')
results = importlib.import_module('PairOfCleats.lib.results')
navigation = importlib.import_module('PairOfCleats.lib.navigation')
operations.activate()


class Selection(list):
    def add(self, region):
        self.append(region)


class SourceView(FakeView):
    def __init__(self, filename, text):
        super().__init__(filename, text)
        self.loading = False
        self.shown = []
        self._selection = Selection([FakeRegion(1, 1)])

    def is_dirty(self):
        return False

    def is_loading(self):
        return self.loading

    def show(self, region):
        self.shown.append(region)


with isolated_temp_directory() as temporary:
    text = 'Widget\n'
    filename = os.path.join(temporary, 'target.py')
    with open(filename, 'wb') as handle:
        handle.write(text.encode('utf-8'))
    source_hash = hashlib.sha256(text.encode('utf-8')).hexdigest()
    window = FakeWindow()
    window.set_folders([temporary])
    target = SourceView(filename, text)
    target.set_window(window)
    queued, opens = [], []

    def state(scoped=True):
        context = {'root': temporary}
        if scoped:
            context['scope'] = operations.capture(window, key='semantic-evidence')
        record = {'ref': 'original-ref', 'kind': 'defines', 'span': [0, 6]}
        return {'context': context, 'transport': 'cli',
                'payload': {'records': [record], 'sourceRefs': [{'ref': 'original-ref',
                    'path': 'target.py', 'sourceHash': source_hash, 'coordinateUnit': 'utf16'}]}}, record

    def reset():
        window.set_folders([temporary])
        window.set_active_view(FakeView(os.path.join(temporary, 'request.py'), text))
        target.loading = False
        target.shown[:] = []
        target.regions.clear()
        target._selection = Selection([FakeRegion(1, 1)])
        queued[:] = []
        opens[:] = []

    def open_file(encoded, _flags=0):
        opens.append(encoded)
        window.set_active_view(target)
        return target

    def drain():
        while queued:
            queued.pop(0)()

    def unchanged():
        assert target.shown == [] and target.regions == {}
        assert [(region.a, region.b) for region in target.sel()] == [(1, 1)]

    with patch.object(window, 'open_file', side_effect=open_file), \
            patch.object(sublime, 'set_timeout', side_effect=lambda callback, delay=0: queued.append(callback)):
        # The actual semantic record/action picker reaches the original opener.
        reset()
        original, record = state()
        semantic.inspect(window, original)
        window.quick_panel_callback(2)
        window.quick_panel_callback(4)
        drain()
        assert opens and target.shown and target.regions
        assert [(region.a, region.b) for region in target.sel()] == [(0, 6)]

        reset()
        original, record = state()
        target.loading = True
        semantic.inspect(window, original)
        window.quick_panel_callback(2)
        window.quick_panel_callback(4)
        queued.pop(0)()
        assert queued and opens, 'the actual target is deferred while loading'
        original['context']['scope'] = operations.capture(window, key='semantic-evidence')
        target.loading = False
        drain()
        unchanged()

        # A replacement context cannot rewrite the opener's original scope.
        reset()
        original, record = state()
        semantic.open_source(window, original, record)
        original['context'] = {'root': temporary, 'scope': operations.capture(window, key='semantic-evidence')}
        drain()
        unchanged()

        reset()
        original, record = state()
        with patch.object(semantic, 'read_verified_source', wraps=semantic.read_verified_source) as read:
            operations.capture(window, key='semantic-evidence')
            assert semantic.open_source(window, original, record) is None
        assert not read.called and opens == []

        # Captured source fields survive mutations during the file observation.
        reset()
        original, record = state()
        real_read = semantic.read_verified_source
        def mutate_during_read(root, source_file, digest):
            verified = real_read(root, source_file, digest)
            record['span'][:] = [1, 2]
            original['payload']['sourceRefs'][0].update({'path': 'sibling.py', 'sourceHash': 'f' * 64})
            original['context']['root'] = temporary + '-replacement'
            return verified
        with patch.object(semantic, 'read_verified_source', side_effect=mutate_during_read):
            semantic.open_source(window, original, record)
        drain()
        assert opens == [filename + ':1'] and target.shown
        assert [(region.a, region.b) for region in target.sel()] == [(0, 6)]

        reset()
        original, record = state()
        def supersede_during_read(root, source_file, digest):
            verified = real_read(root, source_file, digest)
            operations.capture(window, key='semantic-evidence')
            return verified
        with patch.object(semantic, 'read_verified_source', side_effect=supersede_during_read):
            assert semantic.open_source(window, original, record) is None
        assert opens == [] and queued == []

        # The optional parent is checked throughout the actual deferred opener.
        reset()
        original, record = state(scoped=False)
        parent = {'current': True, 'calls': 0}
        def parent_current():
            parent['calls'] += 1
            return parent['current']
        semantic.open_source(window, original, record, request_current=parent_current)
        parent['current'] = False
        drain()
        unchanged()
        parent['current'] = True
        assert opens, 'opening was admitted before revocation'

        # Revocation is latched; neither a later True nor a new state is authority.
        reset()
        original, record = state()
        with patch.object(semantic.results, 'open_hit') as opened:
            semantic.open_source(window, original, record, request_current=parent_current)
            captured_current = opened.call_args[1]['request_current']
        parent['current'] = False
        assert captured_current() is False
        parent['current'] = True
        before = parent['calls']
        assert captured_current() is False and parent['calls'] == before

        reset()
        original, record = state()
        def reentrant_parent():
            operations.capture(window, key='semantic-evidence')
            return True
        assert semantic.open_source(window, original, record, request_current=reentrant_parent) is None
        assert opens == [] and queued == []

        for unsupported in (False, {}, 1, lambda: 1, lambda: None):
            reset()
            original, record = state()
            assert semantic.open_source(window, original, record, request_current=unsupported) is None
            assert opens == [] and queued == []

        reset()
        original, record = state()
        inspection = RuntimeError('original parent observation failed')
        parent['current'] = True
        def failing_parent():
            if parent['current']:
                return True
            raise inspection
        with patch.object(semantic.results, 'open_hit') as opened:
            semantic.open_source(window, original, record, request_current=failing_parent)
            captured_current = opened.call_args[1]['request_current']
        parent['current'] = False
        try:
            captured_current()
            raise AssertionError('original observation failure was lost')
        except RuntimeError as error:
            assert error is inspection
        parent['current'] = True
        assert captured_current() is False

        reset()
        original, record = state()
        foreign = FakeWindow()
        original['context']['scope'] = operations.capture(foreign, key='semantic-evidence')
        assert semantic.open_source(window, original, record) is None
        original['context']['scope'] = None
        assert semantic.open_source(window, original, record) is None
        assert opens == []

        # Legacy direct helper calls without a parent scope remain supported.
        reset()
        original, record = state(scoped=False)
        semantic.open_source(window, original, record)
        drain()
        assert target.shown and target.regions

        source_filename = os.path.join(temporary, 'request.py')
        source = SourceView(source_filename, text)
        callbacks = []
        def reset_navigation():
            reset()
            with open(source_filename, 'wb') as handle:
                handle.write(text.encode('utf-8'))
            source._file_name, source._valid, source._change_count = source_filename, True, 0
            source._selection = Selection([FakeRegion(3, 3)])
            window.set_active_view(source)
            window.quick_panel_callback = None
            callbacks[:] = []

        def navigation_dispatched(_command, _args, **kwargs):
            callbacks.append(kwargs['on_done'])

        def dispatch_candidate():
            navigation.execute_qualified_navigation(source, 'Widget', 'definitions',
                lambda *_args: None, 25, 'ambiguous original-source control')
            callbacks.pop(0)(SimpleNamespace(error=None, returncode=0, payload={
                'status': 'ambiguous', 'sourceHash': source_hash, 'sourceVersion': '0',
                'coordinateUnit': 'utf16', 'binding': {'status': 'ambiguous', 'candidates': [{
                    'targetId': 'captured-candidate', 'file': 'target.py', 'ref': 'original-ref',
                    'span': [0, 6], 'sourceHash': source_hash, 'coordinateUnit': 'utf16'}]}}))
            assert callable(window.quick_panel_callback)
            window.quick_panel_callback(0)

        def replace_source_bytes():
            with open(source_filename, 'wb') as handle:
                handle.write(b'changed requesting source')

        with patch.object(navigation.config, 'get_settings', return_value={}), \
                patch.object(navigation.config, 'resolve_execution_mode', return_value={'mode': 'cli'}), \
                patch.object(navigation.config, 'validate_settings', return_value=[]), \
                patch.object(navigation.config, 'build_env', return_value={}), \
                patch.object(navigation.paths, 'resolve_repo_root', return_value=(temporary, None)), \
                patch.object(navigation.paths, 'resolve_cli', return_value={'command': 'inert-pairofcleats'}), \
                patch.object(navigation.runner, 'run_process', side_effect=navigation_dispatched):
            reset_navigation()
            target.loading = True
            dispatch_candidate()
            assert opens and window.active_view() is target
            queued.pop(0)()
            source._selection = Selection([FakeRegion(0, 0)])
            target.loading = False
            drain()
            assert target.shown and target.regions, 'accepted candidate inspection permits intended focus and cursor movement'
            assert 'binding remains ambiguous' in sublime.last_status

            for mutate in (lambda: setattr(source, '_change_count', 1),
                           lambda: setattr(source, '_valid', False),
                           lambda: setattr(source, '_file_name', filename),
                           lambda: source.set_window(FakeWindow()), replace_source_bytes,
                           lambda: operations.capture(window, key='navigation'),
                           lambda: window.set_folders([temporary + '-replacement'])):
                reset_navigation()
                target.loading = True
                dispatch_candidate()
                queued.pop(0)()
                assert queued
                mutate()
                target.loading = False
                drain()
                unchanged()

print('Sublime semantic original scope and deferred source opening controls passed')
