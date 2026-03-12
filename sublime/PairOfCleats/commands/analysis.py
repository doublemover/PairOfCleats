import json
import os
import re

import sublime
import sublime_plugin

from ..lib import config
from ..lib import paths
from ..lib import results
from ..lib import results_state
from ..lib import runner
from ..lib import ui

DEFAULT_CONTEXT_PACK_HOPS = 2
DEFAULT_RISK_EXPLAIN_MAX = 5

ANALYSIS_ACTIONS = [
    ('open', 'Open Hit'),
    ('open_new_group', 'Open in New Group'),
    ('copy_path', 'Copy Path'),
]


def _resolve_repo_root(window, path_hint=None):
    return paths.resolve_repo_root(window, return_reason=True, path_hint=path_hint)


def _extract_selection(view):
    if view is None:
        return ''
    for region in view.sel():
        if getattr(region, 'empty', None):
            if not region.empty():
                return view.substr(region)
        elif getattr(region, 'a', None) != getattr(region, 'b', None):
            return view.substr(region)
    return ''


def _resolve_active_file_seed(window):
    view = window.active_view() if window else None
    file_name = view.file_name() if view else None
    if not file_name:
        return None, None, 'PairOfCleats: no active file to seed context pack.'
    repo_root, reason = _resolve_repo_root(window, path_hint=file_name)
    if not repo_root:
        return None, None, 'PairOfCleats: {0}'.format(reason)
    relative_path = os.path.relpath(file_name, repo_root).replace('\\', '/')
    return 'file:{0}'.format(relative_path), repo_root, reason


def _prompt_value(window, caption, initial, on_done):
    if window is None or not hasattr(window, 'show_input_panel'):
        ui.show_error('PairOfCleats: this command requires an input-capable window.')
        return
    window.show_input_panel(caption, initial or '', lambda value: on_done((value or '').strip()), None, None)


def _resolve_cli_context(window, path_hint=None):
    settings = config.get_settings(window)
    repo_root, reason = _resolve_repo_root(window, path_hint=path_hint)
    if not repo_root:
        ui.show_error('PairOfCleats: {0}'.format(reason))
        return None
    if reason:
        ui.show_status('PairOfCleats: {0}'.format(reason))
    errors = config.validate_settings(settings, repo_root)
    if errors:
        message = 'PairOfCleats settings need attention:\n- {0}'.format('\n- '.join(errors))
        ui.show_error(message)
        return None
    cli = paths.resolve_cli(settings, repo_root)
    env = config.build_env(settings)
    return {
        'settings': settings,
        'repo_root': repo_root,
        'cli': cli,
        'env': env,
    }


def _default_export_path(repo_root, kind, identity):
    safe = re.sub(r'[^A-Za-z0-9._-]+', '-', identity or '').strip('-').lower()
    safe = safe[:80] or kind
    export_root = os.path.join(repo_root, '.pairofcleats', 'sublime')
    return os.path.join(export_root, '{0}-{1}.json'.format(kind, safe))


def _write_json(path_value, payload):
    parent = os.path.dirname(path_value)
    if parent:
        os.makedirs(parent, exist_ok=True)
    with open(path_value, 'w', encoding='utf-8') as handle:
        json.dump(payload, handle, indent=2, sort_keys=False)
        handle.write('\n')


def _append_unique_hit(hits, hit):
    normalized = results.normalize_hit(hit)
    file_path = normalized.get('file')
    if not file_path:
        return
    key = (
        normalized.get('section') or '',
        file_path,
        normalized.get('startLine') or 0,
        normalized.get('endLine') or 0,
        normalized.get('name') or normalized.get('headline') or '',
    )
    if key in hits['_seen']:
        return
    hits['_seen'].add(key)
    hits['_items'].append(normalized)


def _new_hit_collector():
    return {'_items': [], '_seen': set()}


def _finalize_hits(state):
    return state['_items']


def _callsite_details_to_hit(details, section, headline):
    if not isinstance(details, dict):
        return None
    file_path = details.get('file')
    if not file_path:
        return None
    return {
        'file': file_path,
        'startLine': details.get('startLine'),
        'endLine': details.get('endLine') or details.get('startLine'),
        'section': section,
        'name': details.get('calleeNormalized') or details.get('calleeRaw') or 'call site',
        'headline': headline,
    }


def _collect_context_pack_hits(payload):
    state = _new_hit_collector()
    primary = payload.get('primary') if isinstance(payload, dict) else None
    if isinstance(primary, dict) and primary.get('file'):
        range_info = primary.get('range') or {}
        _append_unique_hit(state, {
            'file': primary.get('file'),
            'startLine': range_info.get('startLine'),
            'endLine': range_info.get('endLine') or range_info.get('startLine'),
            'section': 'primary',
            'name': 'Primary Context',
            'headline': primary.get('excerpt') or '',
        })

    repo_evidence = payload.get('repoEvidence') if isinstance(payload, dict) else None
    queries = repo_evidence.get('queries') if isinstance(repo_evidence, dict) else None
    if isinstance(queries, list):
        for entry in queries:
            query = entry.get('query') if isinstance(entry, dict) else None
            hits = entry.get('hits') if isinstance(entry, dict) else None
            if not isinstance(hits, list):
                continue
            for hit in hits:
                if not isinstance(hit, dict):
                    continue
                merged = dict(hit)
                merged.setdefault('section', 'repo-evidence')
                if query and not merged.get('headline'):
                    merged['headline'] = 'query: {0}'.format(query)
                _append_unique_hit(state, merged)

    risk = payload.get('risk') if isinstance(payload, dict) else None
    flows = risk.get('flows') if isinstance(risk, dict) else None
    if isinstance(flows, list):
        for flow in flows:
            flow_id = flow.get('flowId') if isinstance(flow, dict) else None
            evidence = flow.get('evidence') if isinstance(flow, dict) else None
            steps = evidence.get('callSitesByStep') if isinstance(evidence, dict) else None
            if not isinstance(steps, list):
                continue
            for step_index, step in enumerate(steps, start=1):
                if not isinstance(step, list):
                    continue
                for entry in step:
                    details = entry.get('details') if isinstance(entry, dict) else None
                    hit = _callsite_details_to_hit(
                        details,
                        'risk-evidence',
                        'flow {0} step {1}'.format(flow_id or 'risk', step_index),
                    )
                    if hit:
                        _append_unique_hit(state, hit)

    return _finalize_hits(state)


def _collect_risk_explain_hits(payload):
    state = _new_hit_collector()
    chunk = payload.get('chunk') if isinstance(payload, dict) else None
    if isinstance(chunk, dict) and chunk.get('file'):
        _append_unique_hit(state, {
            'file': chunk.get('file'),
            'section': 'risk-chunk',
            'name': chunk.get('name') or chunk.get('chunkUid') or 'chunk',
            'headline': chunk.get('kind') or '',
        })

    flows = payload.get('flows') if isinstance(payload, dict) else None
    if isinstance(flows, list):
        for flow in flows:
            flow_id = flow.get('flowId') if isinstance(flow, dict) else None
            steps = flow.get('callSitesByStep') if isinstance(flow, dict) else None
            if not isinstance(steps, list):
                continue
            for step_index, step in enumerate(steps, start=1):
                if not isinstance(step, list):
                    continue
                for entry in step:
                    details = entry.get('details') if isinstance(entry, dict) else None
                    hit = _callsite_details_to_hit(
                        details,
                        'risk-step',
                        'flow {0} step {1}'.format(flow_id or 'risk', step_index),
                    )
                    if hit:
                        _append_unique_hit(state, hit)

    return _finalize_hits(state)


def _render_context_pack_text(payload, hits):
    lines = ['PairOfCleats context pack', '']
    primary = payload.get('primary') if isinstance(payload, dict) else None
    if isinstance(primary, dict):
        lines.append('Primary')
        lines.append('- file: {0}'.format(primary.get('file') or 'unknown'))
        excerpt = primary.get('excerpt')
        if excerpt:
            lines.append('- excerpt: {0}'.format(str(excerpt).splitlines()[0]))
        lines.append('')

    repo_evidence = payload.get('repoEvidence') if isinstance(payload, dict) else None
    queries = repo_evidence.get('queries') if isinstance(repo_evidence, dict) else None
    if isinstance(queries, list):
        lines.append('Repo Evidence')
        for entry in queries[:10]:
            query = entry.get('query') if isinstance(entry, dict) else ''
            hit_count = len(entry.get('hits') or []) if isinstance(entry, dict) else 0
            lines.append('- {0}: {1} hit(s)'.format(query or '(unknown)', hit_count))
        if len(queries) > 10:
            lines.append('- ... {0} more queries'.format(len(queries) - 10))
        lines.append('')

    risk = payload.get('risk') if isinstance(payload, dict) else None
    if isinstance(risk, dict):
        lines.append('Risk')
        lines.append('- status: {0}'.format(risk.get('status') or 'unknown'))
        summary = risk.get('summary') or {}
        totals = summary.get('totals') or {}
        if totals:
            lines.append('- summary: sources {0}, sinks {1}, sanitizers {2}, localFlows {3}'.format(
                totals.get('sources') or 0,
                totals.get('sinks') or 0,
                totals.get('sanitizers') or 0,
                totals.get('localFlows') or 0,
            ))
        flows = risk.get('flows') or []
        lines.append('- flows: {0}'.format(len(flows)))
        lines.append('')

    lines.append('Follow-up')
    lines.append('- PairOfCleats: Context Pack Actions')
    lines.append('- PairOfCleats: Reopen Last Context Pack')
    lines.append('- evidence hits: {0}'.format(len(hits)))
    return '\n'.join(lines).rstrip() + '\n'


def _render_risk_explain_text(payload, hits):
    lines = ['PairOfCleats risk explain', '']
    chunk = payload.get('chunk') if isinstance(payload, dict) else None
    if isinstance(chunk, dict):
        lines.append('Chunk')
        lines.append('- uid: {0}'.format(chunk.get('chunkUid') or 'unknown'))
        lines.append('- file: {0}'.format(chunk.get('file') or 'unknown'))
        if chunk.get('name'):
            lines.append('- symbol: {0}'.format(chunk.get('name')))
        if chunk.get('kind'):
            lines.append('- kind: {0}'.format(chunk.get('kind')))
        lines.append('')

    summary = payload.get('summary') if isinstance(payload, dict) else None
    if isinstance(summary, dict):
        lines.append('Summary')
        lines.append('- sources: {0}'.format(summary.get('sources', {}).get('count') or 0))
        lines.append('- sinks: {0}'.format(summary.get('sinks', {}).get('count') or 0))
        lines.append('- local flows: {0}'.format(summary.get('localFlows', {}).get('count') or 0))
        lines.append('')

    flows = payload.get('flows') if isinstance(payload, dict) else None
    if isinstance(flows, list):
        lines.append('Flows')
        for flow in flows[:8]:
            confidence = flow.get('confidence')
            label = flow.get('flowId') or 'flow'
            if isinstance(confidence, (int, float)):
                lines.append('- [{0:.2f}] {1}'.format(confidence, label))
            else:
                lines.append('- {0}'.format(label))
            source_rule = flow.get('source', {}).get('ruleId') if isinstance(flow.get('source'), dict) else None
            sink_rule = flow.get('sink', {}).get('ruleId') if isinstance(flow.get('sink'), dict) else None
            if source_rule or sink_rule:
                lines.append('  rules: {0} -> {1}'.format(source_rule or 'source', sink_rule or 'sink'))
        if len(flows) > 8:
            lines.append('- ... {0} more flows'.format(len(flows) - 8))
        lines.append('')

    lines.append('Follow-up')
    lines.append('- PairOfCleats: Risk Explain Actions')
    lines.append('- PairOfCleats: Reopen Last Risk Explain')
    lines.append('- evidence hits: {0}'.format(len(hits)))
    return '\n'.join(lines).rstrip() + '\n'


def _build_analysis_session(kind, repo_root, hits, text, payload, json_path=None):
    session = {
        'query': kind,
        'repoRoot': repo_root,
        'target': 'output_panel',
        'explain': False,
        'analysisKind': kind,
        'hits': [results.normalize_hit(hit) for hit in hits],
        'text': text,
        'payload': payload,
    }
    if json_path:
        session['jsonPath'] = json_path
    return session


def _record_analysis_session(window, kind, session):
    if kind == 'context-pack':
        results_state.record_last_context_pack(window, session)
        return
    if kind == 'risk-explain':
        results_state.record_last_risk_explain(window, session)


def _load_analysis_session(window, source):
    if source == 'risk_explain':
        return results_state.get_last_risk_explain(window)
    return results_state.get_last_context_pack(window)


def _run_analysis_action(window, session, hit, action):
    repo_root = session.get('repoRoot')
    return results.apply_hit_action(window, hit, repo_root=repo_root, action=action)


def _show_analysis_action_choices(window, session, hit):
    items = []
    file_label = results.format_file_label(hit)
    for action, label in ANALYSIS_ACTIONS:
        items.append([label, file_label])

    def on_action(index):
        if index < 0:
            return
        action = ANALYSIS_ACTIONS[index][0]
        _run_analysis_action(window, session, hit, action)

    window.show_quick_panel(items, on_action)


def _run_cli_json(window, title, repo_root, args, on_done):
    context = _resolve_cli_context(window, path_hint=repo_root)
    if not context:
        return None
    cli = context['cli']
    full_args = list(cli.get('args_prefix') or []) + args
    return runner.run_process(
        cli['command'],
        full_args,
        cwd=repo_root,
        env=context['env'],
        window=window,
        title=title,
        capture_json=True,
        on_done=on_done,
        stream_output=False,
        panel_name='pairofcleats-analysis',
    )


def _resolve_risk_index_dir(repo_root):
    return os.path.join(repo_root, 'index-code')


class PairOfCleatsContextPackCommand(sublime_plugin.WindowCommand):
    def is_enabled(self):
        return True

    def is_visible(self):
        return True

    def run(self, seed=None, hops=DEFAULT_CONTEXT_PACK_HOPS, include_risk=True, include_types=False,
            include_paths=False, export_json=False, out_path=None):
        if seed:
            self._execute(seed, hops, include_risk, include_types, include_paths, export_json, out_path)
            return
        default_seed, _repo_root, reason = _resolve_active_file_seed(self.window)
        if default_seed:
            self._execute(default_seed, hops, include_risk, include_types, include_paths, export_json, out_path)
            return
        if reason:
            ui.show_status(reason)
        _prompt_value(
            self.window,
            'PairOfCleats context pack seed',
            default_seed or '',
            lambda value: self._execute(value, hops, include_risk, include_types, include_paths, export_json, out_path) if value else None,
        )

    def _execute(self, seed, hops, include_risk, include_types, include_paths, export_json, out_path):
        if not seed:
            return
        context = _resolve_cli_context(self.window)
        if not context:
            return
        repo_root = context['repo_root']
        args = [
            'context-pack',
            '--repo', repo_root,
            '--seed', seed,
            '--hops', str(int(hops) if str(hops).isdigit() else DEFAULT_CONTEXT_PACK_HOPS),
            '--json',
        ]
        if include_risk:
            args.append('--include-risk')
        if include_types:
            args.append('--include-types')
        if include_paths:
            args.append('--include-paths')

        def on_done(result):
            if result.returncode != 0:
                ui.show_error(result.output.strip() or 'PairOfCleats context pack failed.')
                return
            if result.error:
                ui.show_error(result.error)
                return
            payload = result.payload
            if not isinstance(payload, dict) or payload.get('ok') is False:
                ui.show_error((payload or {}).get('message') or 'PairOfCleats context pack returned invalid JSON.')
                return
            hits = _collect_context_pack_hits(payload)
            text = _render_context_pack_text(payload, hits)
            json_path = None
            if export_json:
                json_path = out_path or _default_export_path(repo_root, 'context-pack', seed)
                _write_json(json_path, payload)
            session = _build_analysis_session('context-pack', repo_root, hits, text, payload, json_path=json_path)
            _record_analysis_session(self.window, 'context-pack', session)
            results.open_output_panel(self.window, text, session=session)
            if json_path:
                self.window.open_file(json_path)
                ui.show_status('PairOfCleats: exported context pack JSON.')

        _run_cli_json(self.window, 'PairOfCleats context pack', repo_root, args, on_done)


class PairOfCleatsRiskExplainCommand(sublime_plugin.WindowCommand):
    def is_enabled(self):
        return True

    def is_visible(self):
        return True

    def run(self, chunk=None, max=DEFAULT_RISK_EXPLAIN_MAX, source_rule=None, sink_rule=None,
            export_json=False, out_path=None):
        if chunk:
            self._execute(chunk, max, source_rule, sink_rule, export_json, out_path)
            return
        view = self.window.active_view() if self.window else None
        selection = _extract_selection(view)
        initial = selection.strip()
        _prompt_value(
            self.window,
            'PairOfCleats risk explain chunkUid',
            initial,
            lambda value: self._execute(value, max, source_rule, sink_rule, export_json, out_path) if value else None,
        )

    def _execute(self, chunk_uid, max_flows, source_rule, sink_rule, export_json, out_path):
        if not chunk_uid:
            return
        context = _resolve_cli_context(self.window)
        if not context:
            return
        repo_root = context['repo_root']
        index_dir = _resolve_risk_index_dir(repo_root)
        args = [
            'risk', 'explain',
            '--index', index_dir,
            '--chunk', chunk_uid,
            '--max', str(int(max_flows) if str(max_flows).isdigit() else DEFAULT_RISK_EXPLAIN_MAX),
            '--json',
        ]
        if source_rule:
            args.extend(['--source-rule', source_rule])
        if sink_rule:
            args.extend(['--sink-rule', sink_rule])

        def on_done(result):
            if result.returncode != 0:
                ui.show_error(result.output.strip() or 'PairOfCleats risk explain failed.')
                return
            if result.error:
                ui.show_error(result.error)
                return
            payload = result.payload
            if not isinstance(payload, dict):
                ui.show_error('PairOfCleats risk explain returned invalid JSON.')
                return
            hits = _collect_risk_explain_hits(payload)
            text = _render_risk_explain_text(payload, hits)
            json_path = None
            if export_json:
                json_path = out_path or _default_export_path(repo_root, 'risk-explain', chunk_uid)
                _write_json(json_path, payload)
            session = _build_analysis_session('risk-explain', repo_root, hits, text, payload, json_path=json_path)
            _record_analysis_session(self.window, 'risk-explain', session)
            results.open_output_panel(self.window, text, session=session)
            if json_path:
                self.window.open_file(json_path)
                ui.show_status('PairOfCleats: exported risk explain JSON.')

        _run_cli_json(self.window, 'PairOfCleats risk explain', repo_root, args, on_done)


class PairOfCleatsReopenLastContextPackCommand(sublime_plugin.WindowCommand):
    def is_enabled(self):
        return True

    def is_visible(self):
        return True

    def run(self):
        session = results_state.get_last_context_pack(self.window)
        if not session:
            ui.show_status('PairOfCleats: no previous context pack to reopen.')
            return
        results.reopen_session(self.window, session)


class PairOfCleatsReopenLastRiskExplainCommand(sublime_plugin.WindowCommand):
    def is_enabled(self):
        return True

    def is_visible(self):
        return True

    def run(self):
        session = results_state.get_last_risk_explain(self.window)
        if not session:
            ui.show_status('PairOfCleats: no previous risk explain output to reopen.')
            return
        results.reopen_session(self.window, session)


class PairOfCleatsAnalysisActionsCommand(sublime_plugin.WindowCommand):
    def is_enabled(self):
        return True

    def is_visible(self):
        return True

    def run(self, source='context_pack', hit_index=None, action=None):
        session = _load_analysis_session(self.window, source)
        if not session:
            ui.show_status('PairOfCleats: no stored analysis results for actions.')
            return
        hits = results.collect_hits_from_session(session)
        if not hits:
            ui.show_status('PairOfCleats: stored analysis results have no navigable hits.')
            return
        if isinstance(hit_index, int) and 0 <= hit_index < len(hits):
            selected = hits[hit_index]
            if action:
                _run_analysis_action(self.window, session, selected, action)
                return
            _show_analysis_action_choices(self.window, session, selected)
            return

        items = [results.format_quick_panel_item(hit) for hit in hits]

        def on_hit(index):
            if index < 0:
                return
            _show_analysis_action_choices(self.window, session, hits[index])

        self.window.show_quick_panel(items, on_hit)
