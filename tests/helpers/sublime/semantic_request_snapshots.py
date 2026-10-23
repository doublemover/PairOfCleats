"""Registered semantic pickers and real dispatch retain original evidence."""
import importlib
import json
import os
from unittest.mock import patch

from runtime_harness import FakeWindow, FakeView, install_fake_modules, isolated_temp_directory

sublime, _plugin = install_fake_modules()
semantic = importlib.import_module('PairOfCleats.commands.semantic')
operations = importlib.import_module('PairOfCleats.lib.operations')
api = importlib.import_module('PairOfCleats.lib.api_client')
discovery = importlib.import_module('PairOfCleats.lib.semantic_discovery')
operations.activate()


class Window(FakeWindow):
    def show_input_panel(self, caption, initial, on_done, on_change, on_cancel):
        self.input = {'caption': caption, 'done': on_done, 'cancel': on_cancel}


generation = {'baseBuildId': 'original-generation', 'semanticRevision': 0}
ref = {'partitionId': 'sy1:' + 'a' * 64, 'localId': 1}
window = Window()
window.set_folders(['/original-local-root'])
sublime.set_active_window(window)
settings = {'api_execution_mode': 'require', 'api_server_url': 'http://localhost:7345',
            'api_timeout_ms': 5000, 'env': {'FIXTURE': 'original'}}


def context():
    return {'root': '/original-local-root', 'settings': settings,
            'scope': operations.capture(window, key='semantic-evidence'),
            'serviceRoot': '/original-service-root', 'capabilities': {'semantic-find': True, 'semantic-detail': True}}


def payload(cursor=None):
    return {'schemaVersion': 1, 'generation': dict(generation), 'status': 'partial',
            'records': [{'ref': dict(ref), 'kind': 'reads', 'span': [0, 1]}], 'edges': [],
            'coverage': {'extraction': [], 'analysis': [], 'response': {'state': 'partial', 'returnedCount': 1}},
            'warnings': ['Original incomplete frontier'], 'frontier': [{'reason': 'analysis_incomplete'}],
            'cursor': cursor}


pending, requests, states, failures = [], [], [], []


def async_request(request, done, **options):
    pending.append((request, done, options))


def request_json(url, **options):
    requests.append((url, options))
    if url.endswith('/capabilities'):
        return {'capabilities': {'semantic-find': True, 'semantic-detail': True}}, {}
    # A transport adapter receives its own request data; annotation must not
    # replace the captured request used for result generation admission.
    options['payload']['generation']['baseBuildId'] = 'transport-mutation'
    return {'ok': True, 'result': payload('cursor-a')}, {}


with patch.object(api, 'run_async', side_effect=async_request), \
        patch.object(api, 'request_json', side_effect=request_json):
    original_context = context()
    request = semantic.request_for('find', original_context['root'], generation,
                                   {'field': 'sourcePath', 'value': 'original.py'})
    semantic.execute(window, 'find', request, original_context, states.append, lambda: failures.append('failed'))
    request['generation']['baseBuildId'] = 'caller-mutation'
    request['selector']['value'] = 'replacement.py'
    original_context['root'] = '/replacement-local-root'
    original_context['serviceRoot'] = '/replacement-service-root'
    original_context['settings']['api_server_url'] = 'http://replacement.invalid'
    original_context['settings']['env']['FIXTURE'] = 'replacement'
    raw, headers = pending[-1][0]()
    pending[-1][1](api.ApiResult(payload=raw, headers=headers))
    assert failures == [] and len(states) == 1
    assert requests[-1][0] == 'http://localhost:7345/analysis/semantic-find'
    assert requests[-1][1]['payload']['repoRoot'] == '/original-service-root'
    assert states[0]['request']['generation'] == generation
    assert states[0]['request']['selector']['value'] == 'original.py'
    assert states[0]['context']['root'] == '/original-local-root'
    assert states[0]['context']['settings']['env']['FIXTURE'] == 'original'
    raw['records'][0]['ref']['localId'] = 99
    assert states[0]['payload']['records'][0]['ref'] == ref
    states[0]['payload']['warnings'].append('caller mutation')
    assert semantic._LAST[window.id()]['payload']['warnings'] == ['Original incomplete frontier']

    # A stale operation failure cannot restore its older evidence after the
    # user deliberately requested another bounded operation.
    settings['api_server_url'] = 'http://localhost:7345'
    shared_context = context()
    accepted, restored = [], []
    request = semantic.request_for('detail', shared_context['root'], generation, ref)
    semantic.execute(window, 'detail', request, shared_context, accepted.append, lambda: restored.append('old'))
    old_done = pending[-1][1]
    semantic.execute(window, 'detail', request, shared_context, accepted.append, lambda: restored.append('new'))
    latest_done = pending[-1][1]
    latest_done(api.ApiResult(payload=payload()))
    sublime.last_error = ''
    old_done(api.ApiResult(error='stale failure'))
    assert len(accepted) == 1 and restored == [] and sublime.last_error == ''

    # More retains original request/generation and refuses multi-page cycles.
    selected_context = context()
    request = semantic.request_for('find', selected_context['root'], generation,
                                   {'field': 'sourcePath', 'value': 'original.py'})
    pages = []
    semantic.execute(window, 'find', request, selected_context, pages.append)
    pending[-1][1](api.ApiResult(payload=payload('cursor-a')))
    first = pages[-1]
    semantic.inspect(window, first)
    first['request']['selector']['value'] = 'changed-after-display.py'
    first['payload']['cursor'] = 'changed-after-display'
    window.quick_panel_callback(2)
    wire, _headers = pending[-1][0]()
    assert requests[-1][1]['payload']['selector']['value'] == 'original.py'
    assert requests[-1][1]['payload']['cursor'] == 'cursor-a'
    pending[-1][1](api.ApiResult(payload=payload('cursor-b')))
    assert window.quick_panel_items[2][0] == 'More'
    window.quick_panel_callback(2)
    pending[-1][1](api.ApiResult(payload=payload('cursor-a')))
    assert 'continuation repeated' in sublime.last_error
    assert 'cursor-b' in window.panels['pairofcleats-semantic'].appended
    assert window.quick_panel_items[2][0] == 'More', 'failed More restores the original frontier/picker'

    # Back deliberately restores previous immutable evidence despite the old
    # picker having been superseded by a later successful page.
    window.quick_panel_callback(0)
    assert 'cursor-a' in window.panels['pairofcleats-semantic'].appended

    # Picker mutations cannot replace original record refs, capabilities or
    # settings. An older picker cannot activate after another picker opens.
    snapshot = {'operation': 'find', 'request': request, 'payload': payload(),
                'context': selected_context, 'transport': 'api'}
    dispatched = []
    with patch.object(semantic, 'execute', side_effect=lambda *args, **kwargs: dispatched.append((args, kwargs))):
        semantic.inspect(window, snapshot)
        stale_picker = window.quick_panel_callback
        snapshot['payload']['records'][0]['ref']['localId'] = 42
        window.quick_panel_callback(2)
        window.quick_panel_callback(0)
        assert dispatched[-1][0][2]['refs'] == [ref]
        semantic.inspect(window, snapshot)
        before = len(dispatched)
        stale_picker(2)
        assert len(dispatched) == before

# Registered command seeding keeps the original source across repo and
# capabilities prompts; equal-text sibling views do not adopt that request.
with isolated_temp_directory() as root:
    source = FakeView(os.path.join(root, 'original.py'), 'same text')
    sibling = FakeView(os.path.join(root, 'sibling.py'), 'same text')
    window.set_folders([root])
    window.set_active_view(source)
    repo_callbacks = []
    with patch.object(semantic.paths, 'resolve_repo_root_interactive', side_effect=lambda target, done: repo_callbacks.append(done)), \
            patch.object(semantic.config, 'get_settings', return_value=settings), \
            patch.object(semantic.config, 'validate_settings', return_value=[]), \
            patch.object(api, 'run_async', side_effect=async_request):
        command = semantic.PairOfCleatsSemanticEvidenceCommand(window)
        command.run()
        command.run()
        before = len(pending)
        repo_callbacks[0](root, None)
        assert len(pending) == before, 'superseded repo picker cannot acquire a new semantic operation'
        repo_callbacks[1](root, None)
        window.set_active_view(sibling)
        pending[-1][1](api.ApiResult(payload={'capabilities': {'semantic-find': True}}))
        assert 'Original semantic source changed' in sublime.last_error

    # The exact selector remains bound after explicit generation input.
    window.set_active_view(source)
    with patch.object(semantic.config, 'get_settings', return_value=settings), \
            patch.object(semantic.config, 'validate_settings', return_value=[]), \
            patch.object(api, 'run_async', side_effect=async_request), \
            patch.object(semantic, 'execute') as executed:
        command.run(repo_root=root)
        pending[-1][1](api.ApiResult(payload={'capabilities': {'semantic-find': True}}))
        window.quick_panel_callback(1)
        window.input['done']('original-generation')
        window.set_active_view(sibling)
        window.quick_panel_callback(0)
        assert not executed.called
        assert 'Original semantic source view changed' in sublime.last_error

print('Sublime semantic requests preserve original source, evidence, cursor and failure authority')
