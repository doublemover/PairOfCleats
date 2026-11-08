"""Authored real navigation/picker/opening controls with inert host boundaries."""
import hashlib
import importlib
import json
import os
from unittest.mock import patch
from runtime_harness import FakeView, FakeWindow, FakeRegion, install_fake_modules, isolated_temp_directory

sublime, _plugin = install_fake_modules()
navigation = importlib.import_module('PairOfCleats.lib.navigation')
search = importlib.import_module('PairOfCleats.commands.search')
results = importlib.import_module('PairOfCleats.lib.results')
operations = importlib.import_module('PairOfCleats.lib.operations')
operations.activate()


class SourceView(FakeView):
    def __init__(self, filename, text):
        super().__init__(filename, text)
        self.dirty = False
        self.loading = False
        self.shown = []

    def is_dirty(self):
        return self.dirty

    def is_loading(self):
        return self.loading

    def show(self, region):
        self.shown.append(region)


class Result:
    returncode = 0
    error = None
    output = ''

    def __init__(self, payload):
        self.payload = payload


with isolated_temp_directory() as temporary:
    source_file, target_file = os.path.join(temporary, 'source.py'), os.path.join(temporary, 'target.py')
    text = 'Widget\n'
    for filename in (source_file, target_file):
        with open(filename, 'wb') as handle:
            handle.write(text.encode('utf-8'))
    source_hash = hashlib.sha256(text.encode('utf-8')).hexdigest()
    window = FakeWindow()
    window.set_folders([temporary])
    source, target = SourceView(source_file, text), SourceView(target_file, text)
    callbacks, opens = [], []

    def reset():
        window.set_folders([temporary])
        source._file_name, source._valid, source._change_count, source.dirty = source_file, True, 0, False
        source._selection.clear()
        source._selection.add(FakeRegion(3, 3))
        window.set_active_view(source)
        window.quick_panel_items, window.quick_panel_callback = None, None
        target.loading = False
        target.regions.clear()
        target.shown[:] = []
        with open(source_file, 'wb') as handle:
            handle.write(text.encode('utf-8'))

    def open_file(encoded, _flags=0):
        opens.append(encoded)
        opened = source if encoded.rsplit(':', 1)[0] == source_file else target
        window.set_active_view(opened)
        return opened

    def dispatched(_command, _args, **kwargs):
        callbacks.append(kwargs['on_done'])

    def payload(filename='target.py', status='resolved'):
        return {'ok': True, 'status': status, 'binding': {'status': 'resolved'}, 'sourceHash': source_hash,
                'sourceVersion': '0', 'coordinateUnit': 'utf16', 'results': [{
                    'file': filename, 'sourceHash': source_hash, 'coordinateUnit': 'utf16',
                    'startLine': 1, 'startCol': 1, 'endLine': 1, 'endCol': 7, 'name': 'Widget'}]}

    with patch.object(navigation.config, 'get_settings', return_value={}), \
            patch.object(navigation.config, 'resolve_execution_mode', return_value={'mode': 'cli'}), \
            patch.object(navigation.config, 'validate_settings', return_value=[]), \
            patch.object(navigation.config, 'build_env', return_value={}), \
            patch.object(navigation.paths, 'resolve_repo_root', return_value=(temporary, None)), \
            patch.object(navigation.paths, 'resolve_cli', return_value={'command': 'inert-pairofcleats'}), \
            patch.object(navigation.runner, 'run_process', side_effect=dispatched), \
            patch.object(window, 'open_file', side_effect=open_file):
        reset()
        search.PairOfCleatsFindReferencesCommand(source).run(None)
        clone = SourceView(source_file, text)
        clone._selection.clear()
        clone._selection.add(FakeRegion(3, 3))
        window.set_active_view(clone)
        callbacks.pop(0)(Result(payload()))
        assert window.quick_panel_callback is None and opens == []
        assert navigation.qualified_navigation_evidence(window, temporary) is None, 'same-file equal-version sibling view cannot replace original requesting buffer'

        def change_disk():
            with open(source_file, 'wb') as handle:
                handle.write((text + 'external replacement').encode('utf-8'))

        for mutate in (lambda: setattr(source, '_change_count', 1), lambda: setattr(source, 'dirty', True),
                       lambda: setattr(source, '_valid', False), lambda: setattr(source, '_file_name', target_file),
                       lambda: window.set_active_view(clone), lambda: source.set_window(FakeWindow()),
                       lambda: setattr(source, '_selection', type(source.sel())([FakeRegion(0, 0)])), change_disk,
                       lambda: operations.capture(window, key='navigation'), lambda: window.set_folders([temporary, 'changed-context'])):
            reset()
            search.PairOfCleatsFindReferencesCommand(source).run(None)
            callbacks.pop(0)(Result(payload()))
            chosen = window.quick_panel_callback
            assert callable(chosen)
            prior = len(opens)
            mutate()
            chosen(0)
            assert len(opens) == prior, 'stale original request cannot open a result from the still-visible picker'

        # Changing source state while target loading must not erase or publish
        # target selections. Merely focusing the valid opened target is allowed.
        for mutate in (lambda: setattr(source, '_change_count', 1), change_disk, lambda: setattr(source, '_valid', False)):
            reset()
            queued = []
            target.loading = True
            target.regions[results.HIGHLIGHT_KEY] = 'previous target annotation'
            with patch.object(sublime, 'set_timeout', side_effect=lambda callback, delay=0: queued.append(callback)):
                search.PairOfCleatsGotoDefinitionCommand(source).run(None)
                callbacks.pop(0)(Result(payload()))
                assert window.active_view() is target and queued
                mutate()
                target.loading = False
                while queued:
                    queued.pop(0)()
            assert target.shown == [] and target.regions[results.HIGHLIGHT_KEY] == 'previous target annotation'

        reset()
        queued = []
        target.loading = True
        with patch.object(sublime, 'set_timeout', side_effect=lambda callback, delay=0: queued.append(callback)):
            search.PairOfCleatsGotoDefinitionCommand(source).run(None)
            callbacks.pop(0)(Result(payload()))
            with patch.object(navigation, 'read_verified_source', wraps=navigation.read_verified_source) as source_reads:
                queued.pop(0)()
                assert source_reads.call_count == 0 and queued, 'an unsettled target loading poll does not reread original source bytes'
            target.loading = False
            while queued:
                queued.pop(0)()
        assert [(region.a, region.b) for region in target.sel()] == [(0, 6)]
        assert target.shown, 'target focus change does not replace original source version/file authority'

        reset()
        search.PairOfCleatsGotoDefinitionCommand(source).run(None)
        callbacks.pop(0)(Result(payload('source.py')))
        assert [(region.a, region.b) for region in source.sel()] == [(0, 6)], 'same-view target can intentionally move the original cursor after selection admission'

        reset()
        delivered, evidence = payload(), []
        target_id = json.dumps({'partitionId': 'sy1:' + 'a' * 64, 'localId': 1})
        delivered['binding']['targetId'] = target_id
        delivered['generation'] = {'baseBuildId': 'original-generation', 'semanticRevision': 0}
        navigation.execute_qualified_navigation(source, 'Widget', 'definitions', lambda *_args: None, 10, 'Inert captured evidence',
                                                on_evidence=lambda packet, root: evidence.append(packet))
        callbacks.pop(0)(Result(delivered))
        assert len(evidence) == 1
        delivered['binding']['targetId'] = 'foreign original response mutation'
        delivered['results'][0]['file'] = 'foreign-result.py'
        evidence[0]['binding']['targetId'] = 'foreign consumer mutation'
        evidence[0]['generation']['baseBuildId'] = 'foreign-generation'
        captured = navigation.qualified_navigation_evidence(window, temporary)
        assert captured['binding']['targetId'] == target_id and captured['generation']['baseBuildId'] == 'original-generation'
        assert captured['results'][0]['file'] == 'target.py', 'original transport and evidence callback mutations cannot rewrite private navigation evidence'
        captured['binding']['targetId'] = 'foreign returned cursor evidence'
        captured['results'][0]['startLine'] = 99
        repeated = navigation.qualified_navigation_evidence(window, temporary)
        assert repeated['binding']['targetId'] == target_id and repeated['results'][0]['startLine'] == 1

        reset()
        delivered, received = payload(), []
        delivered['results'][0]['ref'] = {'type': 'symbol', 'symbolId': 'original-symbol'}
        navigation.execute_qualified_navigation(source, 'Widget', 'references', lambda hits, *_args: received.extend(hits), 10, 'Inert captured hits')
        callbacks.pop(0)(Result(delivered))
        assert len(received) == 1
        received[0]['ref']['symbolId'] = 'foreign nested result'
        delivered['results'][0]['ref']['symbolId'] = 'foreign nested transport'
        assert navigation.qualified_navigation_evidence(window, temporary)['results'][0]['ref']['symbolId'] == 'original-symbol'
        change_disk()
        assert navigation.qualified_navigation_evidence(window, temporary) is None, 'isolated packet data cannot revive changed original source bytes'

        class Opaque(dict):
            def __deepcopy__(self, _memo):
                raise AssertionError('data capture cannot invoke an unknown object copy hook')

        nested = 'leaf'
        for _index in range(66):
            nested = [nested]
        for unsupported in (Opaque({'generation': 'foreign'}), object(), {1: 'foreign key'}, nested):
            reset()
            delivered, received = payload(), []
            delivered['extra'] = unsupported
            navigation.execute_qualified_navigation(source, 'Widget', 'definitions', lambda *_args: None, 10, 'Inert invalid evidence',
                                                    on_evidence=lambda packet, root: received.append(packet))
            callbacks.pop(0)(Result(delivered))
            assert received == [None] and navigation.qualified_navigation_evidence(window, temporary) is None

print('Sublime original request/picker/deferred target controls authored; execution deferred')
