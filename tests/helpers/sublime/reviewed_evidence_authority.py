"""Actual reviewed collection keeps displayed membership and packet authority."""
import copy
import importlib
import json
import os
from unittest.mock import patch

from runtime_harness import FakeWindow, install_fake_modules, isolated_temp_directory

sublime, _plugin = install_fake_modules()
commands = importlib.import_module('PairOfCleats.commands.evidence')
operations = importlib.import_module('PairOfCleats.lib.operations')
runner = importlib.import_module('PairOfCleats.lib.runner')
operations.activate()


class Window(FakeWindow):
    def show_input_panel(self, caption, initial, on_done, on_change, on_cancel):
        self.input = {'done': on_done, 'cancel': on_cancel}


def packet(filename):
    return {'version': '1.0.0', 'seed': {'type': 'file', 'path': filename},
        'primary': {'file': filename, 'ref': {'type': 'file', 'path': filename},
                    'excerpt': '[inspect](command:untrusted_payload_text)'},
        'provenance': {'repo': '/original', 'indexSignature': 'original-generation',
                       'generatedAt': '2026-10-23T00:00:00.000Z', 'capsUsed': {}},
        'evidence': {'schemaVersion': 2, 'complete': False},
        'warnings': [{'code': 'partial_frontier', 'message': 'Original incomplete evidence'}]}


with isolated_temp_directory() as root:
    window = Window()
    window.set_folders([root])
    sublime.set_active_window(window)
    command = commands.PairOfCleatsCopyContextCommand(window)
    hits = [{'file': 'first.py', 'name': 'First'}, {'file': 'second.py', 'name': 'Second'}]
    calls = []

    def invoke(command_name, args, **options):
        calls.append((command_name, args, options))

    def complete(call, payload=None, error=None):
        call[2]['on_done'](runner.ProcessResult(0, '', payload=payload, error=error))

    with patch.object(commands.runner, 'run_process', side_effect=invoke), \
            patch.object(commands.paths, 'resolve_cli', return_value={'command': 'inert-cli', 'args_prefix': []}):
        command.run(hits=hits, repo_root=root)
        old_toggle = window.quick_panel_callback
        window.quick_panel_callback(2)
        old_toggle(3)
        window.quick_panel_callback(0)
        purpose = window.input['done']
        hits[0]['file'] = 'replacement.py'
        old_toggle(3)
        purpose('Original reviewed purpose')
        assert len(calls) == 1
        assert calls[0][1][calls[0][1].index('--seed') + 1] == 'file:first.py'
        source_packet = packet('first.py')
        original_packet = copy.deepcopy(source_packet)
        complete(calls[0], source_packet)
        original_review = window.quick_panel_callback
        source_packet['primary']['file'] = 'transport-mutation.py'
        source_packet['provenance']['indexSignature'] = 'transport-generation'
        source_packet['warnings'].clear()
        window.quick_panel_callback(0)
        publish = window.quick_panel_callback
        publish(0)
        assert json.loads(sublime.clipboard) == [original_packet]
        captured_clipboard = sublime.clipboard
        publish(1)
        assert sublime.clipboard == captured_clipboard, 'the old native action cannot publish twice'
        assert not any(value['name'] == 'untrusted_payload_text' for value in window.commands)

        # New collection revokes every old review/action/purpose callback.
        command.run(hits=[{'file': 'first.py'}, {'file': 'second.py'}], repo_root=root)
        original_review(0)
        assert sublime.clipboard == captured_clipboard
        window.quick_panel_callback(2)
        window.quick_panel_callback(3)
        window.quick_panel_callback(0)
        window.input['done']('Two reviewed seeds')
        first_call = calls[-1]
        complete(first_call, packet('first.py'))
        second_call = calls[-1]
        before = len(calls)
        sublime.last_error = ''
        complete(first_call, error='duplicate old callback failure')
        assert len(calls) == before and sublime.last_error == ''
        unresolved = packet('second.py')
        unresolved['primary'] = {'ref': None, 'file': None, 'excerpt': ''}
        complete(second_call, unresolved)
        assert 'unresolved context' in window.quick_panel_items[2][0]
        window.quick_panel_callback(0)
        window.quick_panel_callback(0)
        copied = json.loads(sublime.clipboard)
        assert len(copied) == 2 and copied[1]['primary']['ref'] is None and copied[1]['primary']['file'] is None
        assert copied[0]['warnings'][0]['code'] == 'partial_frontier'

        # Purpose cancellation seals its captured membership instead of letting
        # a queued done callback start collection afterward.
        command.run(hits=[{'file': 'first.py'}], repo_root=root)
        window.quick_panel_callback(2)
        window.quick_panel_callback(0)
        cancelled_input = dict(window.input)
        cancelled_input['cancel']()
        before = len(calls)
        cancelled_input['done']('must not collect')
        assert len(calls) == before

    # Explicit save keeps the reviewed string; cancelled/revoked destinations
    # cannot write, and the original filesystem failure remains visible.
    scope = operations.capture(window, key='evidence-collection')
    command._publish('["original"]', '# Original', scope)
    window.quick_panel_callback(2)
    save = dict(window.input)
    save['cancel']()
    destination = os.path.join(root, 'cancelled.json')
    save['done'](destination)
    assert not os.path.exists(destination)

    command._publish('["original"]', '# Original', scope)
    window.quick_panel_callback(2)
    destination = os.path.join(root, 'reviewed.json')
    window.input['done'](destination)
    with open(destination, encoding='utf-8') as handle:
        assert handle.read() == '["original"]'

    command._publish('["original"]', '# Original', scope)
    window.quick_panel_callback(2)
    with patch.object(commands.publication.tempfile, 'mkstemp', side_effect=OSError('original reviewed save failure')):
        window.input['done'](os.path.join(root, 'failed.json'))
    assert 'original reviewed save failure' in sublime.last_error

for hit in ({'ref': []}, {'chunkUid': 7}, {'ref': {'symbolId': {}}}, {'file': []}):
    assert commands.evidence_seed(hit) is None
print('Sublime reviewed evidence retains original membership, packets and native callback authority')
