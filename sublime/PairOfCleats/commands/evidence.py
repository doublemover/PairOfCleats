"""Reviewed local copy/export of bounded, unchanged canonical context packets."""
import json
import os
import copy

import sublime
import sublime_plugin

from ..lib import api_client, config, operations, paths, publication, results, results_state, runner, service_repository, ui
from .analysis import _render_context_pack_text, _collect_context_pack_hits

MAX_SELECTED = 8
MAX_BYTES = 262144


def evidence_seed(hit):
    if not isinstance(hit, dict):
        return None
    ref = hit.get('ref')
    ref = ref if isinstance(ref, dict) else {}
    for kind, value in (('chunk', hit.get('chunkUid') or ref.get('chunkUid')),
                        ('symbol', ref.get('symbolId')), ('file', hit.get('file'))):
        if isinstance(value, str) and value and len(value) <= 4096:
            return kind + ':' + value
    return None


def render_preview(packets, purpose, omitted=None):
    encoded = json.dumps(packets, indent=2, ensure_ascii=False) + '\n'
    if len(encoded.encode('utf-8')) > MAX_BYTES:
        raise ValueError('Selected context exceeds the 256 KiB export bound. Exclude items or narrow the budget.')
    lines = ['# Selected Source Evidence', '', 'Purpose: ' + purpose.replace('\n', ' ')[:512],
             'Selected: {0} canonical packets. JSON bytes: {1}. Token estimate unavailable.'.format(
                 len(packets), len(encoded.encode('utf-8'))),
             'JSON exports contain unchanged canonical packets. Purpose and omissions appear in this preview/Markdown.',
             'Source/current distinctions, generation provenance, confidence and incomplete-frontier warnings are retained.',
             'This deliberate collection captures current indexed context for selected seeds; the original search generation is not refreshed or certified.']
    lines.extend('Omitted: ' + str(reason) for reason in (omitted or []))
    for packet in packets:
        lines.append(_render_context_pack_text(packet, _collect_context_pack_hits(packet)))
    lines.extend(['', 'Full canonical evidence:', '```json', encoded, '```'])
    markdown = '\n\n'.join(lines)
    if len(markdown.encode('utf-8')) > MAX_BYTES:
        raise ValueError('Rendered Markdown exceeds the 256 KiB export bound. Exclude items before export.')
    return encoded, markdown


class PairOfCleatsCopyContextCommand(sublime_plugin.WindowCommand):
    def run(self, source=None, hits=None, repo_root=None):
        scope = operations.capture(self.window, key='evidence-collection')
        if hits is not None and repo_root:
            self._select({'hits': hits, 'repoRoot': repo_root}, scope)
            return
        choices = [('Search Results', results_state.get_last_results(self.window)),
                   ('Context Pack Evidence', results_state.get_last_context_pack(self.window)),
                   ('Risk Explain Evidence', results_state.get_last_risk_explain(self.window))]
        available = [(label, copy.deepcopy(session)) for label, session in choices if session and session.get('hits')]
        if not available:
            ui.show_status('PairOfCleats: capture search/context/risk evidence first.')
            return
        if source:
            session = next((session for label, session in available if label == source), None)
            if session:
                self._select(session, scope)
            return
        self.window.show_quick_panel([[label, session.get('repoRoot')] for label, session in available],
            lambda index: self._select(available[index][1], scope)
                if 0 <= index < len(available) and operations.is_current(scope) else None)

    def _select(self, session, scope=None):
        scope = scope or operations.capture(self.window, key='evidence-collection')
        session = copy.deepcopy(session)
        candidates = [hit for hit in session.get('hits', [])[:128] if isinstance(hit, dict)]
        selected = set()
        revision = [0]
        def show():
            if not operations.is_current(scope):
                return
            revision[0] += 1
            displayed_revision = revision[0]
            items = [['Create Context / Preview Selection', '{0}/{1} selected; 24 KiB per canonical packet'.format(len(selected), MAX_SELECTED)],
                     ['Cancel', 'No clipboard, export or external transmission']]
            items.extend([('[x] ' if index in selected else '[ ] ') + str(hit.get('name') or hit.get('file') or 'evidence'),
                          results.format_file_label(hit)] for index, hit in enumerate(candidates))
            def choose(index):
                if (displayed_revision != revision[0] or index >= len(items)
                        or not operations.is_current(scope)):
                    return
                if index < 0 or index == 1:
                    revision[0] += 1
                    return
                if index == 0:
                    if not selected:
                        ui.show_status('Select at least one item.')
                        show()
                    else:
                        revision[0] += 1
                        membership = copy.deepcopy([candidates[i] for i in sorted(selected)])
                        prompt_revision = revision[0]
                        def purpose_done(purpose):
                            if revision[0] != prompt_revision or not operations.is_current(scope):
                                return
                            revision[0] += 1
                            self._collect(session, membership, purpose, scope)
                        self.window.show_input_panel('Purpose for this source context', '',
                            purpose_done, None, lambda: revision.__setitem__(0, revision[0] + 1))
                    return
                hit_index = index - 2
                if hit_index in selected:
                    selected.remove(hit_index)
                elif len(selected) < MAX_SELECTED:
                    selected.add(hit_index)
                else:
                    ui.show_status('Select at most eight evidence items.')
                show()
            self.window.show_quick_panel(items, choose)
        show()

    def _collect(self, session, selected, purpose, scope=None):
        scope = scope or operations.capture(self.window, key='evidence-collection')
        if not operations.is_current(scope):
            return
        session, selected = copy.deepcopy(session), copy.deepcopy(selected)
        if not isinstance(selected, list) or not 1 <= len(selected) <= MAX_SELECTED:
            ui.show_error('Select between one and eight original evidence items.')
            return
        if not isinstance(purpose, str):
            ui.show_error('Context purpose must be text.')
            return
        root = session.get('repoRoot')
        if not isinstance(root, str) or not root or not os.path.isdir(root):
            ui.show_error('Selected repository is unavailable.')
            return
        settings = config.get_settings(self.window)
        errors = config.validate_settings(settings, root, workflow='context-collection')
        if errors:
            ui.show_error('\n'.join(errors))
            return
        execution = config.resolve_execution_mode(settings, 'context-collection')
        if execution.get('error'):
            ui.show_error(execution['error'])
            return
        packets, omitted = [], []
        context = {'serviceRoot': None, 'serial': 0}
        def accept(packet, index, serial):
            if not operations.is_current(scope) or context['serial'] != serial:
                return
            context['serial'] += 1
            if (not isinstance(packet, dict) or not isinstance(packet.get('version'), str)
                    or not packet['version'] or not isinstance(packet.get('seed'), dict)
                    or not isinstance(packet.get('primary'), dict)
                    or not isinstance(packet.get('provenance'), dict) or not isinstance(packet.get('evidence'), dict)):
                ui.show_error('Context owner returned no canonical packet. Previous evidence is retained.')
                return
            if len(json.dumps(packet, ensure_ascii=False).encode('utf-8')) > MAX_BYTES:
                omitted.append('Selected context packet exceeds the 256 KiB review bound; its contents were not retained.')
                collect(index + 1)
                return
            packets.append(copy.deepcopy(packet))
            collect(index + 1)
        def collect(index):
            if not operations.is_current(scope):
                return
            context['serial'] += 1
            serial = context['serial']
            if index >= len(selected):
                self._preview(packets, purpose, omitted, scope)
                return
            seed = evidence_seed(selected[index])
            if not seed:
                omitted.append('Selected item has no canonical file/chunk/symbol seed.')
                collect(index + 1)
                return
            ui.show_status('PairOfCleats: collecting selected context {0}/{1}.'.format(index + 1, len(selected)))
            if execution.get('mode') == 'api':
                if not context['serviceRoot']:
                    def mapped(value):
                        if not operations.is_current(scope) or context['serial'] != serial:
                            return
                        context['serviceRoot'] = value
                        collect(index)
                    service_repository.resolve(self.window, settings, root, mapped)
                    return
                base = execution['base_url']
                def request():
                    capability, _headers = api_client.request_json(api_client.build_url(base, '/capabilities'),
                        headers=api_client._api_headers(base), timeout_ms=settings.get('api_timeout_ms', 5000))
                    if api_client.read_workflow_capabilities(capability).get('context-pack') is not True:
                        raise ValueError('Service does not advertise context-pack.')
                    response, headers = api_client.request_json(api_client.build_url(base, '/analysis/context-pack'),
                        method='POST', payload={'repo': context['serviceRoot'], 'seed': seed, 'hops': 0,
                            'maxBytes': 24576, 'maxNodes': 16, 'maxEdges': 32, 'includeRisk': True},
                        headers=api_client._api_headers(base), timeout_ms=settings.get('api_timeout_ms', 5000))
                    if not isinstance(response, dict):
                        raise ValueError('Context collection returned an invalid response object.')
                    if response.get('ok') is False:
                        raise ValueError(response.get('message') or 'Context collection failed.')
                    return response.get('result'), headers
                def received(response):
                    if not operations.is_current(scope) or context['serial'] != serial:
                        return
                    if response.error:
                        context['serial'] += 1
                        ui.show_error(response.error)
                    else:
                        accept(response.payload, index, serial)
                api_client.run_async(request, received, window=self.window, scope=scope)
                return
            cli = paths.resolve_cli(settings, root)
            def done(response):
                if not operations.is_current(scope) or context['serial'] != serial:
                    return
                if response.error or response.returncode != 0:
                    context['serial'] += 1
                    ui.show_error(response.error or response.output or 'Context collection failed.')
                else:
                    accept(response.payload, index, serial)
            runner.run_process(cli['command'], list(cli.get('args_prefix') or []) + [
                'context-pack', '--repo', root, '--seed', seed, '--hops', '0', '--includeRisk',
                '--maxBytes', '24576', '--maxNodes', '16', '--maxEdges', '32', '--json'],
                cwd=root, env=config.build_env(settings), window=self.window, title='PairOfCleats selected context',
                capture_json=True, on_done=done, stream_output=False, timeout_ms=5000, operation_scope=scope)
        collect(0)

    def _preview(self, packets, purpose, omitted, scope):
        if not packets or not operations.is_current(scope):
            return
        packets, omitted = copy.deepcopy(packets), list(omitted or [])
        try:
            encoded, markdown = render_preview(packets, purpose, omitted)
        except ValueError:
            markdown = 'Selection exceeds the export bound. Exclude packets below; final bounded output will be previewed before copying or saving.'
        results.open_results_view(self.window, markdown)
        retained = set(range(len(packets)))
        revision = [0]
        def review():
            if not operations.is_current(scope):
                return
            revision[0] += 1
            displayed_revision = revision[0]
            items = [['Copy / Export Reviewed Context', '{0} selected; no external transmission'.format(len(retained))]]
            items.extend([('[x] ' if index in retained else '[ ] ') + str(
                              (packet['primary'].get('file') if isinstance(packet['primary'], dict) else None)
                              or 'unresolved context {0}'.format(index + 1)),
                          '{0} JSON bytes'.format(len(json.dumps(packet, ensure_ascii=False).encode('utf-8')))]
                         for index, packet in enumerate(packets))
            def selected(index):
                if displayed_revision != revision[0] or index >= len(items) or not operations.is_current(scope):
                    return
                if index < 0:
                    revision[0] += 1
                    return
                if index == 0:
                    final_packets = [packet for i, packet in enumerate(packets) if i in retained]
                    if not final_packets:
                        return
                    try:
                        final_json, final_markdown = render_preview(final_packets, purpose,
                            omitted + ['{0} packet(s) excluded by user'.format(len(packets) - len(retained))])
                    except ValueError as error:
                        ui.show_error(str(error))
                        return
                    revision[0] += 1
                    results.open_results_view(self.window, final_markdown)
                    self._publish(final_json, final_markdown, scope)
                else:
                    item = index - 1
                    retained.remove(item) if item in retained else retained.add(item)
                    review()
            self.window.show_quick_panel(items, selected)
        review()

    def _publish(self, encoded, markdown, scope):
        chosen = [False]
        def selected(index):
            if chosen[0] or not operations.is_current(scope) or index >= 4:
                return
            chosen[0] = True
            if index < 0:
                return
            text = encoded if index in (0, 2) else markdown
            if index < 2:
                try:
                    sublime.set_clipboard(text)
                except Exception as error:
                    ui.show_error('Evidence copy failed: ' + str(error))
                return
            pending = [True]
            def save(destination):
                if not pending[0] or not destination or not operations.is_current(scope):
                    return
                pending[0] = False
                if not os.path.isabs(destination):
                    ui.show_error('Choose an absolute export destination.')
                    return
                try:
                    publication.write_text(destination, text, is_current=lambda: operations.is_current(scope))
                except publication.PublicationCancelled as error:
                    if getattr(error, 'pairofcleats_cleanup_errors', None):
                        print(publication.describe_failure('Cancelled evidence export cleanup failed: ', error))
                    return
                except Exception as error:
                    ui.show_error(publication.describe_failure('Evidence save failed: ', error))
                    return
                if operations.is_current(scope):
                    publication.notify_saved(self.window, destination, 'reviewed evidence')
            self.window.show_input_panel('Absolute evidence export destination (.json or .md)', '', save, None,
                lambda: pending.__setitem__(0, False))
        self.window.show_quick_panel(['Copy JSON', 'Copy Markdown', 'Export JSON', 'Export Markdown'], selected)
