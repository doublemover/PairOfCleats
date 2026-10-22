"""Reviewed local copy/export of bounded, unchanged canonical context packets."""
import json
import os

import sublime
import sublime_plugin

from ..lib import api_client, config, operations, paths, results, results_state, runner, service_repository, ui
from .analysis import _render_context_pack_text, _collect_context_pack_hits

MAX_SELECTED = 8
MAX_BYTES = 262144


def evidence_seed(hit):
    ref = hit.get('ref') or {}
    if hit.get('chunkUid') or ref.get('chunkUid'):
        return 'chunk:' + (hit.get('chunkUid') or ref['chunkUid'])
    if ref.get('symbolId'):
        return 'symbol:' + ref['symbolId']
    return 'file:' + hit['file'] if hit.get('file') else None


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
        if hits is not None and repo_root:
            self._select({'hits': hits, 'repoRoot': repo_root})
            return
        choices = [('Search Results', results_state.get_last_results(self.window)),
                   ('Context Pack Evidence', results_state.get_last_context_pack(self.window)),
                   ('Risk Explain Evidence', results_state.get_last_risk_explain(self.window))]
        available = [(label, session) for label, session in choices if session and session.get('hits')]
        if not available:
            ui.show_status('PairOfCleats: capture search/context/risk evidence first.')
            return
        if source:
            session = next((session for label, session in available if label == source), None)
            if session:
                self._select(session)
            return
        self.window.show_quick_panel([[label, session.get('repoRoot')] for label, session in available],
            lambda index: self._select(available[index][1]) if index >= 0 else None)

    def _select(self, session):
        candidates = session['hits'][:128]
        selected = set()
        def show():
            items = [['Create Context / Preview Selection', '{0}/{1} selected; 24 KiB per canonical packet'.format(len(selected), MAX_SELECTED)],
                     ['Cancel', 'No clipboard, export or external transmission']]
            items.extend([('[x] ' if index in selected else '[ ] ') + (hit.get('name') or hit.get('file') or 'evidence'),
                          results.format_file_label(hit)] for index, hit in enumerate(candidates))
            def choose(index):
                if index < 0 or index == 1:
                    return
                if index == 0:
                    if not selected:
                        ui.show_status('Select at least one item.')
                        show()
                    else:
                        self.window.show_input_panel('Purpose for this source context', '',
                            lambda purpose: self._collect(session, [candidates[i] for i in sorted(selected)], purpose), None, None)
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

    def _collect(self, session, selected, purpose):
        root = session['repoRoot']
        if not os.path.isdir(root):
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
        scope = operations.capture(self.window, key='evidence-collection')
        packets, omitted = [], []
        context = {'serviceRoot': None}
        def accept(packet, index):
            if not operations.is_current(scope):
                return
            if not isinstance(packet, dict) or not all(key in packet for key in ('version', 'primary', 'provenance', 'evidence')):
                ui.show_error('Context owner returned no canonical packet. Previous evidence is retained.')
                return
            packets.append(packet)
            collect(index + 1)
        def collect(index):
            if not operations.is_current(scope):
                return
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
                        context['serviceRoot'] = value
                        collect(index)
                    service_repository.resolve(self.window, settings, root, mapped)
                    return
                base = execution['base_url']
                def request():
                    capability, _headers = api_client.request_json(api_client.build_url(base, '/capabilities'),
                        headers=api_client._api_headers(base), timeout_ms=settings.get('api_timeout_ms', 5000))
                    if (capability.get('capabilities') or {}).get('context-pack') is not True:
                        raise ValueError('Service does not advertise context-pack.')
                    response, headers = api_client.request_json(api_client.build_url(base, '/analysis/context-pack'),
                        method='POST', payload={'repo': context['serviceRoot'], 'seed': seed, 'hops': 0,
                            'maxBytes': 24576, 'maxNodes': 16, 'maxEdges': 32, 'includeRisk': True},
                        headers=api_client._api_headers(base), timeout_ms=settings.get('api_timeout_ms', 5000))
                    if response.get('ok') is False:
                        raise ValueError(response.get('message') or 'Context collection failed.')
                    return response.get('result'), headers
                api_client.run_async(request, lambda response: ui.show_error(response.error) if response.error
                    else accept(response.payload, index), window=self.window, scope=scope)
                return
            cli = paths.resolve_cli(settings, root)
            def done(response):
                if response.error or response.returncode != 0:
                    ui.show_error(response.error or response.output or 'Context collection failed.')
                else:
                    accept(response.payload, index)
            runner.run_process(cli['command'], list(cli.get('args_prefix') or []) + [
                'context-pack', '--repo', root, '--seed', seed, '--hops', '0', '--includeRisk',
                '--maxBytes', '24576', '--maxNodes', '16', '--maxEdges', '32', '--json'],
                cwd=root, env=config.build_env(settings), window=self.window, title='PairOfCleats selected context',
                capture_json=True, on_done=done, stream_output=False, timeout_ms=5000, operation_scope=scope)
        collect(0)

    def _preview(self, packets, purpose, omitted, scope):
        if not packets or not operations.is_current(scope):
            return
        try:
            encoded, markdown = render_preview(packets, purpose, omitted)
        except ValueError:
            markdown = 'Selection exceeds the export bound. Exclude packets below; final bounded output will be previewed before copying or saving.'
        results.open_results_view(self.window, markdown)
        retained = set(range(len(packets)))
        def review():
            items = [['Copy / Export Reviewed Context', '{0} selected; no external transmission'.format(len(retained))]]
            items.extend([('[x] ' if index in retained else '[ ] ') + str(packet['primary'].get('file') or index),
                          '{0} JSON bytes'.format(len(json.dumps(packet, ensure_ascii=False).encode('utf-8')))]
                         for index, packet in enumerate(packets))
            def selected(index):
                if index < 0 or not operations.is_current(scope):
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
                    results.open_results_view(self.window, final_markdown)
                    self._publish(final_json, final_markdown, scope)
                else:
                    item = index - 1
                    retained.remove(item) if item in retained else retained.add(item)
                    review()
            self.window.show_quick_panel(items, selected)
        review()

    def _publish(self, encoded, markdown, scope):
        def selected(index):
            if index < 0 or not operations.is_current(scope):
                return
            text = encoded if index in (0, 2) else markdown
            if index < 2:
                sublime.set_clipboard(text)
                return
            def save(destination):
                if not destination or not operations.is_current(scope):
                    return
                if not os.path.isabs(destination):
                    ui.show_error('Choose an absolute export destination.')
                    return
                try:
                    with open(destination, 'w', encoding='utf-8') as handle:
                        handle.write(text)
                    self.window.open_file(destination)
                except OSError as error:
                    ui.show_error('Evidence save failed: ' + str(error))
            self.window.show_input_panel('Absolute evidence export destination (.json or .md)', '', save, None, None)
        self.window.show_quick_panel(['Copy JSON', 'Copy Markdown', 'Export JSON', 'Export Markdown'], selected)
