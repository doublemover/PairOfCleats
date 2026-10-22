"""Bounded, generation-pinned native access to the canonical semantic consumers."""
import json
import os
import tempfile
import math
import re

import sublime
import sublime_plugin

from ..lib import api_client, config, operations, paths, results, runner, ui, service_repository
from ..lib import semantic_discovery
from ..lib.source_authority import read_verified_source

_LAST = {}
LIMITS = {'records': 128, 'bytes': 65536, 'workMs': 250}
TRACE_KINDS = ('flowsTo', 'defines', 'reads', 'writes', 'callTarget', 'constructTarget',
               'argumentToParameter', 'returnToResult')
TRACE_SLOTS = ('input', 'output', 'argument', 'receiver', 'parameter', 'returnValue', 'propertyValue', 'element')


def qualified_binding_seed(payload):
    if not isinstance(payload, dict) or payload.get('status') != 'resolved':
        return None
    binding = payload.get('binding')
    if not isinstance(binding, dict) or binding.get('status') != 'resolved':
        return None
    generation = payload.get('generation') or {}
    if (not isinstance(generation, dict) or not isinstance(generation.get('baseBuildId'), str)
            or not generation['baseBuildId'] or generation.get('semanticRevision') != 0
            or isinstance(generation.get('semanticRevision'), bool)
            or not isinstance(binding.get('targetId'), str) or len(binding['targetId']) > 256):
        return None
    try:
        target = json.loads(payload['binding'].get('targetId'))
    except (ValueError, TypeError):
        return None
    if (not isinstance(target, dict) or set(target) != {'partitionId', 'localId'}
            or not re.match(r'^(?:sy1|sa1):[a-f0-9]{64}\Z', str(target.get('partitionId') or ''))
            or not isinstance(target.get('localId'), int) or isinstance(target.get('localId'), bool)
            or not 0 <= target['localId'] <= 9007199254740991):
        return None
    return {'generation': dict(generation), 'selector': {'target': target}}


def scalar_literal_selector(type_name, value=''):
    representation = str(value)
    if type_name == 'string':
        representation = json.dumps(representation, ensure_ascii=False)
    elif type_name == 'null':
        representation = 'null'
    elif type_name == 'boolean':
        if representation not in ('true', 'false'):
            raise ValueError('Boolean representation must be true or false.')
    elif type_name == 'number':
        if (not re.match(r'^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?\Z', representation)
                or not math.isfinite(float(representation))):
            raise ValueError('Use a finite recorded decimal number representation.')
    elif type_name == 'bigint':
        if not re.match(r'^(?:0|-?[1-9]\d*)\Z', representation):
            raise ValueError('Use a canonical decimal bigint representation without an n suffix.')
    else:
        raise ValueError('Unsupported scalar literal type.')
    if len(representation.encode('utf-8')) > 65536:
        raise ValueError('Scalar representation exceeds the 64 KiB selector bound.')
    return {'literal': {'type': type_name, 'representation': representation}}


def request_for(operation, root, generation, value, direction='upstream', extra=None):
    request = {'repoRoot': root, 'generation': dict(generation), 'limits': dict(LIMITS)}
    if operation == 'enrichment':
        return {'schemaVersion': 1, 'repoRoot': root, 'generation': dict(generation),
                'action': 'plan', 'taskIds': value[:8]}
    if operation == 'find':
        request['selector'] = value
    elif operation == 'detail':
        request.update({'refs': [value], 'fields': ['span', 'scope', 'data'],
                        'include': ['operands', 'names', 'ownership']})
        request['limits']['rows'] = 512
    else:
        extra = extra or {}
        depth = extra.get('depth', 2)
        if not isinstance(depth, int) or isinstance(depth, bool) or not 1 <= depth <= 64:
            raise ValueError('Trace depth must be between 1 and 64.')
        request.update({'seed': value, 'direction': direction})
        request['limits'].update({'edges': 512, 'depth': depth})
        if extra.get('kinds'):
            if any(kind not in TRACE_KINDS for kind in extra['kinds']):
                raise ValueError('Unsupported trace edge kind.')
            request['kinds'] = sorted(set(extra['kinds']))
        if extra.get('slot'):
            slot = extra['slot']
            ordinal = slot.get('ordinal')
            if (slot.get('name') not in TRACE_SLOTS or not isinstance(ordinal, int)
                    or isinstance(ordinal, bool) or not 0 <= ordinal <= 9007199254740991):
                raise ValueError('Trace slot requires a supported name and nonnegative safe ordinal.')
            request['slot'] = dict(slot)
    return request


def choose_trace_options(window, context, on_done, on_cancel):
    """Native keyboard panels; every trace keeps the shared operation bounds."""
    chosen_kinds = []
    extra = {}
    def current():
        return operations.is_current(context['scope'])
    def cancel():
        if current() and callable(on_cancel):
            on_cancel()
    def depth_done(value):
        if not current():
            return
        if len(value) > 2 or not re.match(r'^\d+\Z', value) or not 1 <= int(value) <= 64:
            ui.show_error('Trace depth must be between 1 and 64. Previous evidence remains available.')
            cancel()
            return
        extra['depth'] = int(value)
        choose_kinds()
    def choose_kinds():
        if not current():
            return
        items = ['Continue with selected kinds (none uses canonical defaults)'] + [
            '[{0}] {1}'.format('x' if kind in chosen_kinds else ' ', kind) for kind in TRACE_KINDS]
        def selected(index):
            if not current():
                return
            if index < 0:
                cancel()
            elif index == 0:
                if chosen_kinds:
                    extra['kinds'] = list(chosen_kinds)
                choose_slot()
            else:
                kind = TRACE_KINDS[index - 1]
                if kind in chosen_kinds:
                    chosen_kinds.remove(kind)
                else:
                    chosen_kinds.append(kind)
                choose_kinds()
        window.show_quick_panel(items, selected)
    def choose_slot():
        if not current():
            return
        def selected(index):
            if not current():
                return
            if index < 0:
                cancel()
            elif index == 0:
                on_done(extra)
            else:
                name = TRACE_SLOTS[index - 1]
                def ordinal_done(value):
                    if not current():
                        return
                    if len(value) > 16 or not re.match(r'^\d+\Z', value) or int(value) > 9007199254740991:
                        ui.show_error('Slot ordinal must be a nonnegative safe integer.')
                        cancel()
                        return
                    extra['slot'] = {'name': name, 'ordinal': int(value)}
                    on_done(extra)
                window.show_input_panel(name + ' ordinal (zero based)', '0', ordinal_done, None, cancel)
        window.show_quick_panel(['Any slot'] + list(TRACE_SLOTS), selected)
    window.show_input_panel('Trace depth 1-64; records 128 / edges 512 / 64 KiB / 250 ms',
                            '2', depth_done, None, cancel)


def describe(payload, generation_source=None):
    coverage = payload.get('coverage') or {}
    return '\n'.join([
        'PairOfCleats semantic evidence (experimental; qualification pending)',
        'Generation: {0}'.format(payload.get('generation')),
        'Seed generation source: {0}'.format(generation_source or 'explicit immutable generation'),
        'Status: {0}'.format(payload.get('status', 'unknown')),
        'Extraction: {0}'.format(json.dumps(coverage.get('extraction', []))),
        'Analysis: {0}'.format(json.dumps(coverage.get('analysis', []))),
        'Response: {0}'.format(json.dumps(coverage.get('response', {}))),
        'Frontier: {0}'.format(json.dumps(payload.get('frontier', []))),
        'Warnings: {0}'.format(json.dumps(payload.get('warnings', []))),
        'An empty/partial response does not prove absence of flow.', '',
        json.dumps(payload, indent=2, ensure_ascii=False)])


def execute(window, operation, request, context, on_done, on_error=None):
    scope = context['scope']
    if not operations.is_current(scope):
        return
    def failed(message):
        if not operations.is_current(scope):
            return
        ui.show_error(message + '\nPrevious evidence remains available.')
        if callable(on_error):
            on_error()
    settings = context['settings']
    execution = config.resolve_execution_mode(settings, 'semantic-' + operation)
    if execution.get('error'):
        failed(execution['error'])
        return

    def accept(payload):
        if not operations.is_current(scope):
            return
        if not isinstance(payload, dict) or payload.get('generation') != request['generation']:
            failed('PairOfCleats: semantic generation mismatch. Restart from the seed.')
            return
        if len(json.dumps(payload, ensure_ascii=False).encode('utf-8')) > 131072:
            failed('PairOfCleats: semantic response exceeds the editor evidence bound.')
            return
        state = {'operation': operation, 'request': request, 'payload': payload, 'context': context,
                 'transport': execution.get('mode')}
        _LAST[window.id()] = state
        ui.write_output_panel(window, 'pairofcleats-semantic', describe(payload, context.get('generationSource')))
        on_done(state)

    if execution.get('mode') == 'api':
        if not context.get('serviceRoot'):
            def selected(root):
                context['serviceRoot'] = root
                execute(window, operation, request, context, on_done, on_error)
            service_repository.resolve(window, settings, context['root'], selected)
            return
        wire_request = dict(request, repoRoot=context['serviceRoot'])
        base = execution['base_url']
        def call():
            capability, _headers = api_client.request_json(api_client.build_url(base, '/capabilities'),
                timeout_ms=settings.get('api_timeout_ms', 5000), headers=api_client._api_headers(base))
            context['capabilities'] = api_client.read_workflow_capabilities(capability)
            if context['capabilities'].get('semantic-' + operation) is not True:
                raise ValueError('Service does not advertise this semantic operation.')
            response, headers = api_client.request_json(api_client.build_url(base, '/analysis/semantic-' + operation),
                timeout_ms=settings.get('api_timeout_ms', 5000), method='POST', payload=wire_request,
                headers=api_client._api_headers(base))
            if response.get('ok') is False:
                raise ValueError(response.get('message') or 'Semantic request failed.')
            return response.get('result'), headers
        def api_done(response):
            if response.error:
                failed(response.error)
            else:
                accept(response.payload)
        api_client.run_async(call, api_done, window=window, scope=scope)
        return

    storage = os.path.join(sublime.cache_path(), 'PairOfCleats')
    os.makedirs(storage, exist_ok=True)
    descriptor, request_path = tempfile.mkstemp(prefix='semantic-', suffix='.json', dir=storage)
    with os.fdopen(descriptor, 'w', encoding='utf-8') as handle:
        json.dump(request, handle)
    cli = paths.resolve_cli(settings, context['root'])
    def cleanup(_response):
        try:
            os.remove(request_path)
        except OSError:
            pass
    def done(response):
        try:
            if response.error or response.returncode != 0:
                failed(response.error or response.output or 'Semantic operation failed.')
                return
            payload = response.payload
            if isinstance(payload, dict) and payload.get('cursor'):
                payload['warnings'] = list(payload.get('warnings') or []) + [
                    'CLI continuation expires with its process. Use a persistent API session for More.']
            accept(payload)
        finally:
            try:
                os.remove(request_path)
            except OSError:
                pass
    runner.run_process(cli['command'], list(cli.get('args_prefix') or []) + [
        'semantic', operation, '--request', request_path], cwd=context['root'], env=config.build_env(settings),
        window=window, title='PairOfCleats semantic ' + operation, capture_json=True,
        stream_output=False, timeout_ms=5000, on_done=done, operation_scope=scope, on_settled=cleanup)


def open_source(window, state, record):
    source = next((row for row in state['payload'].get('sourceRefs', [])
                   if row.get('ref') == record.get('ref')), None)
    if not source or source.get('coordinateUnit') != 'utf16':
        raise ValueError('Exact opening requires a captured UTF-16 source mapping. Use Explain first; byte/generated mappings remain unavailable.')
    relative = source.get('path') or ''
    if (not relative or relative.startswith('/') or ':' in relative or '\\' in relative
            or any(part in ('.', '..') for part in relative.split('/'))):
        raise ValueError('Source is outside the selected repository.')
    root = os.path.realpath(state['context']['root'])
    filename = os.path.realpath(os.path.join(root, relative))
    verified = read_verified_source(root, filename, source.get('sourceHash'))
    text = verified['sourceText']
    span = record.get('span')
    if (not isinstance(span, list) or len(span) != 2 or any(not isinstance(value, int) or isinstance(value, bool) for value in span)
            or span[0] < 0 or span[1] < span[0]):
        raise ValueError('Record has no exact source span.')
    encoded = text.encode('utf-16-le')
    if span[1] * 2 > len(encoded):
        raise ValueError('Record span exceeds its qualified source.')
    for offset in span:
        if encoded[max(0, offset * 2 - 2):offset * 2 + 2] == b'\r\x00\n\x00':
            raise ValueError('Record boundary intersects a CRLF pair that the host may normalize.')
    def position(offset):
        before = encoded[:offset * 2].decode('utf-16-le')
        line = before.count('\n') + 1
        column = len(before.rsplit('\n', 1)[-1].encode('utf-16-le')) // 2 + 1
        return line, column
    start_line, start_col = position(span[0])
    end_line, end_col = position(span[1])
    results.open_hit(window, {'file': relative, 'sourceHash': source['sourceHash'],
        'startLine': start_line, 'startCol': start_col, 'endLine': end_line, 'endCol': end_col,
        'coordinateUnit': 'utf16'}, root)


def inspect(window, state, on_back=None):
    payload = state['payload']
    records = payload.get('records') or []
    items = [['Back to seed / previous evidence', 'Captured evidence is retained'],
             ['Copy captured evidence JSON', 'No external transmission']]
    more = bool(payload.get('cursor') and state.get('transport') == 'api')
    if more:
        items.append(['More', 'Same generation; bounded page'])
    for record in records:
        items.append(['{0}: {1}'.format(record.get('kind'), record.get('ref')),
                      'Inspect detail or trace; experimental indexed evidence'])
    base = 3 if more else 2
    suggestions = (payload.get('enrichment') or {}).get('suggestions') or []
    supported = lambda operation: state.get('transport') != 'api' or (state['context'].get('capabilities') or {}).get('semantic-' + operation) is True
    plan_index = None
    if suggestions and supported('enrichment'):
        plan_index = len(items)
        items.append(['Inspect Proposed Enrichment Plan', 'Planning only; no enqueue/drain or runtime capture'])
    def selected(index):
        if not operations.is_current(state['context']['scope']):
            return
        if index <= 0:
            if index == 0 and callable(on_back):
                on_back()
            return
        if index == 1:
            sublime.set_clipboard(json.dumps(payload, indent=2, ensure_ascii=False))
            inspect(window, state, on_back)
            return
        if more and index == 2:
            request = dict(state['request'], cursor=payload['cursor'])
            execute(window, state['operation'], request, state['context'], lambda next_state: inspect(window, next_state, restore), restore)
            return
        if index == plan_index:
            request = request_for('enrichment', state['context']['root'], state['request']['generation'],
                                  [suggestion['taskId'] for suggestion in suggestions])
            execute(window, 'enrichment', request, state['context'], lambda next_state: inspect(window, next_state, restore), restore)
            return
        record = records[index - base]
        actions = ['Detail', 'Trace upstream (choose bounds)', 'Trace downstream (choose bounds)', 'Explain proposed evidence',
                   'Open Exact Source (requires captured source mapping)']
        offered = [index for index, operation in enumerate(('detail', 'trace', 'trace', 'explain', None))
                   if operation is None or supported(operation)]
        def action(chosen):
            if not operations.is_current(state['context']['scope']):
                return
            if chosen < 0:
                inspect(window, state, on_back)
                return
            chosen = offered[chosen]
            if chosen == 4:
                try:
                    open_source(window, state, record)
                except (ValueError, OSError, UnicodeError) as error:
                    ui.show_error(str(error))
                    restore()
                return
            operation = 'detail' if chosen == 0 else 'explain' if chosen == 3 else 'trace'
            def submit(extra=None):
                request = request_for(operation, state['context']['root'], state['request']['generation'],
                                      record['ref'], 'downstream' if chosen == 2 else 'upstream', extra)
                execute(window, operation, request, state['context'], lambda next_state: inspect(window, next_state, restore), restore)
            if operation in ('trace', 'explain'):
                choose_trace_options(window, state['context'], submit, restore)
            else:
                submit()
        window.show_quick_panel([actions[index] for index in offered], action)
    def restore():
        ui.write_output_panel(window, 'pairofcleats-semantic', describe(state['payload'], state['context'].get('generationSource')))
        inspect(window, state, on_back)
    window.show_quick_panel(items, selected)


class PairOfCleatsSemanticEvidenceCommand(sublime_plugin.WindowCommand):
    def run(self, hit=None, repo_root=None):
        def chosen(root, reason):
            if not root:
                ui.show_status(reason or 'Repository selection cancelled.')
                return
            settings = config.get_settings(self.window)
            errors = config.validate_settings(settings, root)
            if errors:
                ui.show_error('\n'.join(errors))
                return
            context = {'root': root, 'settings': settings,
                       'scope': operations.capture(self.window, key='semantic-evidence')}
            def generation(value, origin='explicit immutable generation'):
                if not operations.is_current(context['scope']):
                    return
                if not value.strip():
                    return
                if value in ('.', '..') or any(char in value for char in '/\\:\0'):
                    ui.show_error('Use a single immutable semantic build identifier.')
                    return
                pinned = {'baseBuildId': value.strip(), 'semanticRevision': 0}
                context['generationSource'] = origin
                selectors = ['Current source file', 'Structural operation', 'Exact type expression', 'Scalar literal']
                if hit and hit.get('chunkUid'):
                    selectors.append('Selected chunk ownership')
                def selector(index):
                    if index < 0 or not operations.is_current(context['scope']):
                        return
                    if index == 4:
                        submit({'field': 'chunkUid', 'value': hit['chunkUid']})
                    elif index == 0:
                        view = self.window.active_view()
                        file_name = view.file_name() if view else None
                        relative = os.path.relpath(file_name, root).replace('\\', '/') if file_name else ''
                        if not relative or relative.startswith('../') or os.path.isabs(relative):
                            ui.show_error('Focus a saved file in the selected repository.')
                            return
                        submit({'field': 'sourcePath', 'value': relative})
                    elif index == 3:
                        def scalar_type(chosen_type):
                            if chosen_type < 0 or not operations.is_current(context['scope']):
                                return
                            type_name = ['string', 'boolean', 'null', 'number', 'bigint'][chosen_type]
                            def scalar_value(text):
                                if not operations.is_current(context['scope']):
                                    return
                                try:
                                    submit(scalar_literal_selector(type_name, text))
                                except ValueError as error:
                                    ui.show_error(str(error))
                            if type_name == 'null':
                                scalar_value('')
                            elif type_name == 'boolean':
                                self.window.show_quick_panel(['true', 'false'], lambda choice: (
                                    scalar_value(['true', 'false'][choice]) if choice >= 0 else None))
                            else:
                                prompt = ('String value (empty is valid)' if type_name == 'string' else
                                    'Exact recorded {0} representation (decimal; bigint has no n suffix)'.format(type_name))
                                self.window.show_input_panel(prompt, '', scalar_value, None, None)
                        self.window.show_quick_panel(['string', 'boolean', 'null', 'number', 'bigint'], scalar_type)
                    else:
                        def value_done(text):
                            if not text or not operations.is_current(context['scope']):
                                return
                            selected = {'field': 'operation', 'value': text}
                            if index == 2:
                                selected = {'typeExpression': {'expression': text, 'match': 'exact-expression',
                                    'sources': ['declared'], 'roles': ['local', 'parameter', 'field', 'return']}}
                            if index == 2:
                                def source(chosen_source):
                                    if chosen_source < 0 or not operations.is_current(context['scope']):
                                        return
                                    selected['typeExpression']['sources'] = [['declared'], ['compiler'], ['declared', 'compiler']][chosen_source]
                                    def role(chosen_role):
                                        if chosen_role < 0 or not operations.is_current(context['scope']):
                                            return
                                        selected['typeExpression']['roles'] = (['local', 'parameter', 'field', 'return'] if chosen_role == 0
                                            else [['local'], ['parameter'], ['field'], ['return']][chosen_role - 1])
                                        submit(selected)
                                    self.window.show_quick_panel(['All supported roles', 'Local', 'Parameter', 'Field', 'Return'], role)
                                self.window.show_quick_panel(['Declared source', 'Compiler source', 'Declared and compiler'], source)
                            else:
                                submit(selected)
                        self.window.show_input_panel(selectors[index] + ': exact value', '', value_done, None, None)
                def submit(selected):
                    if not operations.is_current(context['scope']):
                        return
                    execute(self.window, 'find', request_for('find', root, pinned, selected), context,
                            lambda state: inspect(self.window, state))
                self.window.show_quick_panel(selectors, selector)
            def manual():
                self.window.show_input_panel('Exact semantic baseBuildId (from indexed evidence/manifest)', '', generation, None, None)
            from . import search
            execution = config.resolve_execution_mode(settings, 'semantic-find')
            if execution.get('error'):
                ui.show_error(execution['error'])
                return
            def generation_menu():
                if not operations.is_current(context['scope']):
                    return
                def choice(index):
                    if not operations.is_current(context['scope']):
                        return
                    if index == 1:
                        manual()
                    elif index == 0:
                        seed = 'chunk:' + hit['chunkUid'] if hit and hit.get('chunkUid') else None
                        file_name = hit.get('file') if hit else None
                        if not file_name:
                            view = self.window.active_view()
                            file_name = view.file_name() if view else None
                        if not seed and file_name:
                            relative = os.path.relpath(file_name, root).replace('\\', '/') if os.path.isabs(file_name) else file_name
                            if (relative and not relative.startswith('../') and not os.path.isabs(relative)
                                    and ':' not in relative and not any(part in ('.', '..') for part in relative.split('/'))):
                                seed = 'file:' + relative
                        def discover(value):
                            if not operations.is_current(context['scope']):
                                return
                            def accepted(witness):
                                generation(witness['generation']['baseBuildId'], witness['source'])
                            def unavailable(message):
                                if not operations.is_current(context['scope']):
                                    return
                                ui.show_status('PairOfCleats: ' + message)
                                self.window.show_quick_panel(['Enter Immutable Generation Explicitly', 'Return to Previous Evidence'],
                                    lambda correction: manual() if correction == 0 and operations.is_current(context['scope']) else None)
                            semantic_discovery.discover_generation(self.window, context, value, accepted, unavailable)
                        if seed:
                            discover(seed)
                        else:
                            def source_entered(value):
                                if (not value or value.startswith('/') or ':' in value
                                        or any(part in ('.', '..') for part in value.replace('\\', '/').split('/'))):
                                    ui.show_error('Use a repository-relative retained source path.')
                                    return
                                discover('file:' + value.replace('\\', '/'))
                            self.window.show_input_panel('Retained source for canonical semantic generation discovery', '',
                                                         source_entered, None, None)
                self.window.show_quick_panel(['Discover Published Semantic Generation for Selected Source / Hit',
                                              'Enter Immutable Semantic Generation'], choice)
            def cursor_route(captured):
                if not operations.is_current(context['scope']):
                    return
                if not captured:
                    generation_menu()
                    return
                def route(index):
                    if not operations.is_current(context['scope']):
                        return
                    if index == 0:
                        fresh = qualified_binding_seed(search.qualified_navigation_evidence(self.window, root))
                        if not fresh or fresh != captured:
                            ui.show_error('Qualified cursor identity changed. Navigate again or choose an explicit selector.')
                            return
                        context['generationSource'] = 'canonical current cursor navigation'
                        execute(self.window, 'find', request_for('find', root, captured['generation'], captured['selector']),
                            context, lambda state: inspect(self.window, state))
                    elif index == 1:
                        generation_menu()
                self.window.show_quick_panel(['Use Current Source-qualified Cursor Binding',
                                              'Choose Selector / Immutable Generation'], route)
            def begin_seed_selection():
                if not operations.is_current(context['scope']):
                    return
                captured = qualified_binding_seed(search.qualified_navigation_evidence(self.window, root)) if not hit and execution.get('mode') == 'cli' else None
                if captured:
                    cursor_route(captured)
                elif not hit and execution.get('mode') == 'cli' and self.window.active_view() and self.window.active_view().file_name():
                    def received(payload, evidence_root):
                        if evidence_root != root:
                            cursor_route(None)
                            return
                        seed = qualified_binding_seed(payload)
                        if not seed:
                            ui.show_status('PairOfCleats: current indexed cursor is {0}; choose an explicit source/structural selector.'.format(
                                payload.get('status', 'unavailable') if isinstance(payload, dict) else 'unavailable'))
                        cursor_route(seed)
                    search._execute_qualified_navigation(self.window.active_view(), '', 'definitions', lambda *_args: None,
                        25, 'PairOfCleats semantic cursor seed', on_evidence=received, operation_scope=context['scope'])
                else:
                    generation_menu()
            if execution.get('mode') == 'api':
                base_url = execution['base_url']
                def capabilities():
                    return api_client.request_json(api_client.build_url(base_url, '/capabilities'),
                        timeout_ms=settings.get('api_timeout_ms', 5000), headers=api_client._api_headers(base_url))
                def admitted(response):
                    if not operations.is_current(context['scope']):
                        return
                    if response.error:
                        ui.show_error('Semantic capabilities unavailable: ' + response.error)
                        return
                    context['capabilities'] = api_client.read_workflow_capabilities(response.payload)
                    if context['capabilities'].get('semantic-find') is not True:
                        ui.show_error('Service does not advertise semantic find. Select an explicitly supported transport in User Settings.')
                        return
                    begin_seed_selection()
                api_client.run_async(capabilities, admitted, window=self.window, scope=context['scope'])
            else:
                begin_seed_selection()
        if repo_root:
            chosen(repo_root, None)
        else:
            paths.resolve_repo_root_interactive(self.window, chosen)
