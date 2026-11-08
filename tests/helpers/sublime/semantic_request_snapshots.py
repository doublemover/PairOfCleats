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
        trace_snapshot = dict(snapshot, transport='cli')
        semantic.inspect(window, trace_snapshot)
        window.quick_panel_callback(2)
        window.quick_panel_callback(1)
        stale_depth = window.input['done']
        semantic.inspect(window, trace_snapshot)
        before = len(dispatched)
        stale_depth('2')
        assert len(dispatched) == before, 'superseded trace-bound input cannot acquire an operation from an older picker'

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

        # Cancellation seals the actual generation and scalar inputs. Queued
        # done callbacks cannot resume a selector after the user dismissed it.
        window.set_active_view(source)
        command.run(repo_root=root)
        pending[-1][1](api.ApiResult(payload={'capabilities': {'semantic-find': True}}))
        window.quick_panel_callback(1)
        cancelled_generation = dict(window.input)
        old_selector = window.quick_panel_callback
        cancelled_generation['cancel']()
        cancelled_generation['done']('original-generation')
        assert window.quick_panel_callback is old_selector and not executed.called

        command.run(repo_root=root)
        pending[-1][1](api.ApiResult(payload={'capabilities': {'semantic-find': True}}))
        window.quick_panel_callback(1)
        window.input['done']('original-generation')
        window.quick_panel_callback(3)
        window.quick_panel_callback(0)
        cancelled_scalar = dict(window.input)
        cancelled_scalar['cancel']()
        cancelled_scalar['done']('must not submit')
        assert not executed.called

        command.run(repo_root=root)
        pending[-1][1](api.ApiResult(payload={'capabilities': {'semantic-find': True}}))
        menu = window.quick_panel_callback
        menu(1)
        generation_input = dict(window.input)
        generation_input['done']('original-generation')
        selector = window.quick_panel_callback
        generation_input['done']('replacement-generation')
        assert window.quick_panel_callback is selector
        selector(1)
        exact_value = dict(window.input)
        exact_value['done']('call')
        exact_value['done']('replacement-operation')
        assert executed.call_count == 1
        assert executed.call_args[0][2]['generation']['baseBuildId'] == 'original-generation'
        assert executed.call_args[0][2]['selector'] == {'field': 'operation', 'value': 'call'}

# Trace bounds retain the original accepted depth/kinds/slot across their native
# steps, and submit or cancellation is consumed exactly once.
trace_values, trace_cancelled = [], []
semantic.choose_trace_options(window, context(), trace_values.append, lambda: trace_cancelled.append(True))
original_depth = dict(window.input)
original_depth['done']('3')
kind_panel = window.quick_panel_callback
original_depth['done']('63')
assert window.quick_panel_callback is kind_panel
kind_panel(1)
next_kind_panel = window.quick_panel_callback
kind_panel(1)
assert window.quick_panel_callback is next_kind_panel
next_kind_panel(0)
slot_panel = window.quick_panel_callback
slot_panel(0)
slot_panel(0)
assert trace_values == [{'depth': 3, 'kinds': ['flowsTo']}] and trace_cancelled == []
semantic.choose_trace_options(window, context(), trace_values.append, lambda: trace_cancelled.append(True))
cancelled_depth = dict(window.input)
cancelled_depth['cancel']()
cancelled_depth['cancel']()
cancelled_depth['done']('2')
assert len(trace_values) == 1 and trace_cancelled == [True]

# The actual CLI adapter hands one closed, flushed request file to its process
# and lets the canonical runner settlement callback own removal. Cleanup faults
# are visible rather than acknowledged as successful request disposal.
with isolated_temp_directory() as cache_root:
    window.set_folders([cache_root])
    cli_settings = {'api_execution_mode': 'cli', 'env': {}}
    cli_context = {'root': cache_root, 'settings': cli_settings,
                   'scope': operations.capture(window, key='semantic-evidence')}
    cli_request = semantic.request_for('find', cache_root, generation,
                                      {'field': 'sourcePath', 'value': 'original.py'})
    cli_calls = []
    cli_states = []
    with patch.object(sublime, 'cache_path', return_value=cache_root), \
            patch.object(semantic.paths, 'resolve_cli', return_value={'command': 'inert-cli'}), \
            patch.object(semantic.runner, 'run_process', side_effect=lambda *args, **options: cli_calls.append((args, options))):
        semantic.execute(window, 'find', cli_request, cli_context, cli_states.append)
        arguments, options = cli_calls[-1]
        request_path = arguments[1][arguments[1].index('--request') + 1]
        with open(request_path, 'rb') as handle:
            assert json.loads(handle.read().decode('utf-8')) == cli_request
        assert options['operation_scope']['key'] == 'semantic-operation'
        result = semantic.runner.ProcessResult(0, '', payload=payload())
        options['on_settled'](result)
        assert not os.path.exists(request_path)
        options['on_done'](result)
        assert len(cli_states) == 1

        semantic.execute(window, 'find', cli_request, cli_context, cli_states.append)
        arguments, options = cli_calls[-1]
        request_path = arguments[1][arguments[1].index('--request') + 1]
        cleanup_error = OSError('original semantic request removal failure')
        with patch.object(semantic.os, 'remove', side_effect=cleanup_error):
            try:
                options['on_settled'](result)
            except RuntimeError as error:
                assert error.__cause__ is cleanup_error and request_path in str(error)
            else:
                raise AssertionError('request removal failure was acknowledged as settled')
        assert os.path.exists(request_path)
        options['on_settled'](result)

        # A stale response cannot publish, while its independent settlement
        # still removes the request it owns.
        semantic.execute(window, 'find', cli_request, cli_context, cli_states.append)
        arguments, options = cli_calls[-1]
        request_path = arguments[1][arguments[1].index('--request') + 1]
        operations.invalidate(window)
        options['on_settled'](result)
        options['on_done'](result)
        assert len(cli_states) == 1 and not os.path.exists(request_path)

    cli_context['scope'] = operations.capture(window, key='semantic-evidence')
    with patch.object(sublime, 'cache_path', return_value=cache_root), \
            patch.object(semantic.paths, 'resolve_cli', return_value={'command': 'inert-cli'}), \
            patch.object(semantic.runner, 'run_process', side_effect=OSError('original semantic dispatch failure')), \
            patch.object(semantic.os, 'remove', side_effect=OSError('independent request cleanup failure')):
        semantic.execute(window, 'find', cli_request, cli_context, cli_states.append)
    assert 'original semantic dispatch failure' in sublime.last_error
    assert 'independent request cleanup failure' in sublime.last_error
    assert 'semantic-' in sublime.last_error
    storage = os.path.join(cache_root, 'PairOfCleats')
    for filename in os.listdir(storage):
        os.remove(os.path.join(storage, filename))

    with patch.object(sublime, 'cache_path', return_value=cache_root), \
            patch.object(semantic.paths, 'resolve_cli', return_value={'command': 'inert-cli'}), \
            patch.object(semantic.publication, 'stage_text', side_effect=OSError('original staged request failure')), \
            patch.object(semantic.runner, 'run_process') as dispatched:
        semantic.execute(window, 'find', cli_request, cli_context, cli_states.append)
        assert not dispatched.called
    assert 'original staged request failure' in sublime.last_error

print('Sublime semantic requests preserve original source, evidence, cursor and failure authority')
