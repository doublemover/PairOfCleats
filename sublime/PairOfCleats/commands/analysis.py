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
DEFAULT_IMPACT_DEPTH = 2
DEFAULT_SUGGEST_TESTS_MAX = 10
DEFAULT_WORKSPACE_CONFIG = '.pairofcleats-workspace.jsonc'
DEFAULT_WORKSPACE_BUILD_CONCURRENCY = 2

ANALYSIS_KIND_ALIASES = {
    'context_pack': 'context-pack',
    'risk_explain': 'risk-explain',
    'architecture_check': 'architecture-check',
    'suggest_tests': 'suggest-tests',
}

ANALYSIS_ACTIONS = [
    ('open', 'Open Hit'),
    ('open_new_group', 'Open in New Group'),
    ('copy_path', 'Copy Path'),
]


def _resolve_repo_root(window, path_hint=None, allow_fallback=True):
    return paths.resolve_repo_root(window, return_reason=True, path_hint=path_hint, allow_fallback=allow_fallback)


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


def _normalize_analysis_kind(kind):
    normalized = str(kind or '').strip().lower().replace('_', '-')
    return ANALYSIS_KIND_ALIASES.get(normalized.replace('-', '_'), normalized)


def _resolve_default_changed_path(window):
    view = window.active_view() if window else None
    file_name = view.file_name() if view else None
    if not file_name:
        return '', None
    repo_root, _reason = _resolve_repo_root(window, path_hint=file_name)
    if not repo_root:
        return '', None
    return os.path.relpath(file_name, repo_root).replace('\\', '/'), repo_root


def _resolve_relative_path(repo_root, path_value):
    if not path_value:
        return ''
    value = str(path_value).strip()
    if not value:
        return ''
    if os.path.isabs(value):
        return value
    if repo_root:
        return os.path.normpath(os.path.join(repo_root, value))
    return os.path.normpath(value)


def _prompt_value(window, caption, initial, on_done):
    if window is None or not hasattr(window, 'show_input_panel'):
        ui.show_error('PairOfCleats: this command requires an input-capable window.')
        return
    window.show_input_panel(caption, initial or '', lambda value: on_done((value or '').strip()), None, None)


def _resolve_cli_context(window, path_hint=None, allow_fallback=True):
    settings = config.get_settings(window)
    repo_root, reason = _resolve_repo_root(window, path_hint=path_hint, allow_fallback=allow_fallback)
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


def _with_mutating_cli_context(window, action_label, on_resolved, path_hint=None):
    settings = config.get_settings(window)

    def handle_repo_root(repo_root, reason):
        if not repo_root:
            ui.show_error('PairOfCleats: {0}'.format(reason))
            return
        if reason:
            ui.show_status('PairOfCleats: {0}'.format(reason))
        errors = config.validate_settings(settings, repo_root)
        if errors:
            message = 'PairOfCleats settings need attention:\n- {0}'.format('\n- '.join(errors))
            ui.show_error(message)
            return
        on_resolved({
            'settings': settings,
            'repo_root': repo_root,
            'cli': paths.resolve_cli(settings, repo_root),
            'env': config.build_env(settings),
        })

    paths.resolve_repo_root_interactive(
        window,
        handle_repo_root,
        path_hint=path_hint,
        allow_fallback=False,
        prompt='PairOfCleats repo for {0}'.format(action_label),
    )


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


def _append_file_hit(state, file_path, section, name=None, headline=None, start_line=None, end_line=None):
    if not file_path or not isinstance(file_path, str):
        return
    _append_unique_hit(state, {
        'file': file_path,
        'section': section,
        'name': name or os.path.basename(file_path),
        'headline': headline or '',
        'startLine': start_line,
        'endLine': end_line or start_line,
    })


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


def _collect_architecture_hits(payload):
    state = _new_hit_collector()
    violations = payload.get('violations') if isinstance(payload, dict) else None
    if isinstance(violations, list):
        for violation in violations:
            if not isinstance(violation, dict):
                continue
            rule_id = violation.get('ruleId') or 'rule'
            edge = violation.get('edge') if isinstance(violation.get('edge'), dict) else {}
            from_ref = edge.get('from') if isinstance(edge.get('from'), dict) else {}
            to_ref = edge.get('to') if isinstance(edge.get('to'), dict) else {}
            from_path = from_ref.get('path') if from_ref.get('type') == 'file' else None
            to_path = to_ref.get('path') if to_ref.get('type') == 'file' else None
            if from_path:
                _append_file_hit(state, from_path, 'architecture-source', name=rule_id, headline='source')
            if to_path:
                _append_file_hit(state, to_path, 'architecture-target', name=rule_id, headline='target')
    return _finalize_hits(state)


def _collect_impact_hits(payload):
    state = _new_hit_collector()
    impacted = payload.get('impacted') if isinstance(payload, dict) else None
    if isinstance(impacted, list):
        for entry in impacted:
            if not isinstance(entry, dict):
                continue
            ref = entry.get('ref') if isinstance(entry.get('ref'), dict) else {}
            if ref.get('type') == 'file' and ref.get('path'):
                _append_file_hit(
                    state,
                    ref.get('path'),
                    'impact',
                    name='impacted file',
                    headline='distance {0}'.format(entry.get('distance') if entry.get('distance') is not None else '?'),
                )
            witness = entry.get('witnessPath') if isinstance(entry.get('witnessPath'), dict) else {}
            nodes = witness.get('nodes') if isinstance(witness.get('nodes'), list) else []
            for node in nodes:
                if not isinstance(node, dict):
                    continue
                node_path = node.get('path')
                if node_path:
                    _append_file_hit(state, node_path, 'impact-witness', name='witness path')
    return _finalize_hits(state)


def _collect_suggest_tests_hits(payload):
    state = _new_hit_collector()
    suggestions = payload.get('suggestions') if isinstance(payload, dict) else None
    if isinstance(suggestions, list):
        for suggestion in suggestions:
            if not isinstance(suggestion, dict):
                continue
            test_path = suggestion.get('testPath')
            if not test_path:
                continue
            score = suggestion.get('score')
            headline = 'score {0:.3f}'.format(score) if isinstance(score, (int, float)) else (suggestion.get('reason') or '')
            _append_file_hit(state, test_path, 'suggested-test', name=os.path.basename(test_path), headline=headline)
    return _finalize_hits(state)


def _collect_workspace_hits(payload):
    state = _new_hit_collector()
    if not isinstance(payload, dict):
        return _finalize_hits(state)
    _append_file_hit(state, payload.get('workspacePath'), 'workspace', name='workspace config')
    _append_file_hit(state, payload.get('manifestPath'), 'workspace-manifest', name='workspace manifest')
    cache_roots = payload.get('cacheRoots') if isinstance(payload.get('cacheRoots'), dict) else {}
    _append_file_hit(state, cache_roots.get('workspaceManifestPath'), 'workspace-manifest', name='workspace manifest')
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


def _render_architecture_text(payload, hits):
    lines = ['PairOfCleats architecture check', '']
    rules = payload.get('rules') if isinstance(payload, dict) else None
    violations = payload.get('violations') if isinstance(payload, dict) else None
    warnings = payload.get('warnings') if isinstance(payload, dict) else None
    lines.append('Summary')
    lines.append('- rules: {0}'.format(len(rules) if isinstance(rules, list) else 0))
    lines.append('- violations: {0}'.format(len(violations) if isinstance(violations, list) else 0))
    lines.append('- warnings: {0}'.format(len(warnings) if isinstance(warnings, list) else 0))
    if isinstance(violations, list) and violations:
        lines.append('')
        lines.append('Violations')
        for violation in violations[:8]:
            edge = violation.get('edge') if isinstance(violation.get('edge'), dict) else {}
            from_ref = edge.get('from') if isinstance(edge.get('from'), dict) else {}
            to_ref = edge.get('to') if isinstance(edge.get('to'), dict) else {}
            lines.append('- {0}: {1} -> {2}'.format(
                violation.get('ruleId') or 'rule',
                from_ref.get('path') or from_ref.get('chunkUid') or 'unknown',
                to_ref.get('path') or to_ref.get('chunkUid') or 'unknown',
            ))
    lines.append('')
    lines.append('Follow-up')
    lines.append('- PairOfCleats: Architecture Check Actions')
    lines.append('- PairOfCleats: Reopen Last Architecture Check')
    lines.append('- evidence hits: {0}'.format(len(hits)))
    return '\n'.join(lines).rstrip() + '\n'


def _render_impact_text(payload, hits):
    lines = ['PairOfCleats impact analysis', '']
    impacted = payload.get('impacted') if isinstance(payload, dict) else None
    warnings = payload.get('warnings') if isinstance(payload, dict) else None
    truncation = payload.get('truncation') if isinstance(payload, dict) else None
    lines.append('Summary')
    lines.append('- direction: {0}'.format(payload.get('direction') if isinstance(payload, dict) else 'unknown'))
    lines.append('- depth: {0}'.format(payload.get('depth') if isinstance(payload, dict) else 'unknown'))
    lines.append('- impacted: {0}'.format(len(impacted) if isinstance(impacted, list) else 0))
    lines.append('- warnings: {0}'.format(len(warnings) if isinstance(warnings, list) else 0))
    lines.append('- truncation: {0}'.format(len(truncation) if isinstance(truncation, list) else 0))
    if isinstance(impacted, list) and impacted:
        lines.append('')
        lines.append('Impacted')
        for entry in impacted[:8]:
            ref = entry.get('ref') if isinstance(entry.get('ref'), dict) else {}
            label = ref.get('path') or ref.get('chunkUid') or ref.get('symbolId') or 'unknown'
            lines.append('- {0}'.format(label))
    lines.append('')
    lines.append('Follow-up')
    lines.append('- PairOfCleats: Impact Actions')
    lines.append('- PairOfCleats: Reopen Last Impact')
    lines.append('- evidence hits: {0}'.format(len(hits)))
    return '\n'.join(lines).rstrip() + '\n'


def _render_suggest_tests_text(payload, hits):
    lines = ['PairOfCleats suggest tests', '']
    suggestions = payload.get('suggestions') if isinstance(payload, dict) else None
    warnings = payload.get('warnings') if isinstance(payload, dict) else None
    lines.append('Summary')
    lines.append('- suggestions: {0}'.format(len(suggestions) if isinstance(suggestions, list) else 0))
    lines.append('- warnings: {0}'.format(len(warnings) if isinstance(warnings, list) else 0))
    if isinstance(suggestions, list) and suggestions:
        lines.append('')
        lines.append('Top Suggestions')
        for suggestion in suggestions[:8]:
            lines.append('- {0}'.format(suggestion.get('testPath') or 'unknown'))
    lines.append('')
    lines.append('Follow-up')
    lines.append('- PairOfCleats: Suggest Tests Actions')
    lines.append('- PairOfCleats: Reopen Last Suggest Tests')
    lines.append('- evidence hits: {0}'.format(len(hits)))
    return '\n'.join(lines).rstrip() + '\n'


def _render_workspace_text(kind, payload, hits):
    label = kind.replace('-', ' ')
    title_label = label.title()
    lines = ['PairOfCleats {0}'.format(label), '']
    if isinstance(payload, dict):
        lines.append('Summary')
        if payload.get('workspacePath'):
            lines.append('- workspace: {0}'.format(payload.get('workspacePath')))
        if payload.get('workspaceName'):
            lines.append('- workspace name: {0}'.format(payload.get('workspaceName')))
        if payload.get('manifestPath'):
            lines.append('- manifest: {0}'.format(payload.get('manifestPath')))
        cache_roots = payload.get('cacheRoots') if isinstance(payload.get('cacheRoots'), dict) else {}
        if cache_roots.get('workspaceManifestPath') and not payload.get('manifestPath'):
            lines.append('- manifest: {0}'.format(cache_roots.get('workspaceManifestPath')))
        if payload.get('repoSetId'):
            lines.append('- repoSetId: {0}'.format(payload.get('repoSetId')))
        diagnostics = payload.get('diagnostics') if isinstance(payload.get('diagnostics'), dict) else {}
        if diagnostics:
            lines.append('- diagnostics: total={0}, failed={1}'.format(
                diagnostics.get('total') if diagnostics.get('total') is not None else 0,
                diagnostics.get('failed') if diagnostics.get('failed') is not None else 0,
            ))
        repos = payload.get('repos') if isinstance(payload.get('repos'), list) else []
        if repos:
            lines.append('- repos: {0}'.format(len(repos)))
    lines.append('')
    lines.append('Follow-up')
    lines.append('- PairOfCleats: {0} Actions'.format(title_label))
    lines.append('- PairOfCleats: Reopen Last {0}'.format(title_label))
    lines.append('- evidence hits: {0}'.format(len(hits)))
    return '\n'.join(lines).rstrip() + '\n'


def _build_analysis_session(kind, repo_root, hits, text, payload, json_path=None):
    kind = _normalize_analysis_kind(kind)
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
    kind = _normalize_analysis_kind(kind)
    if kind == 'context-pack':
        results_state.record_last_context_pack(window, session)
        return
    if kind == 'risk-explain':
        results_state.record_last_risk_explain(window, session)
        return
    results_state.record_last_analysis(window, kind, session)


def _load_analysis_session(window, source):
    source = _normalize_analysis_kind(source)
    if source == 'risk-explain':
        return results_state.get_last_risk_explain(window)
    if source == 'context-pack':
        return results_state.get_last_context_pack(window)
    return results_state.get_last_analysis(window, source)


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


def _run_cli_json(window, title, repo_root, args, on_done, context=None):
    context = context or _resolve_cli_context(window, path_hint=repo_root)
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


def _execute_analysis_command(window, title, kind, repo_root, args, collect_hits, render_text,
                              export_json=False, out_path=None, export_identity=None, context=None):
    context = context or _resolve_cli_context(window, path_hint=repo_root)
    if not context:
        return
    execution = config.resolve_execution_mode(context.get('settings') or {}, kind, supports_api=False)
    if execution.get('error'):
        ui.show_error(execution['error'])
        return

    def on_done(result):
        if result.error:
            ui.show_error(result.error)
            return
        payload = result.payload
        if not isinstance(payload, dict):
            ui.show_error(result.output.strip() or '{0} returned invalid JSON.'.format(title))
            return
        failed = result.returncode != 0 or payload.get('ok') is False
        hits = collect_hits(payload)
        text = render_text(payload, hits)
        json_path = None
        if export_json:
            export_name = export_identity or kind
            json_path = out_path or _default_export_path(repo_root, kind, export_name)
            _write_json(json_path, payload)
        session = _build_analysis_session(kind, repo_root, hits, text, payload, json_path=json_path)
        _record_analysis_session(window, kind, session)
        results.open_output_panel(window, text, session=session)
        if json_path:
            window.open_file(json_path)
            ui.show_status('PairOfCleats: exported {0} JSON.'.format(kind.replace('-', ' ')))
        if failed:
            ui.show_error((payload or {}).get('message') or result.output.strip() or '{0} failed.'.format(title))

    _run_cli_json(window, title, repo_root, args, on_done, context=context)


def _parse_path_list(value):
    if not value:
        return []
    pieces = []
    for item in re.split(r'[\r\n,]+', str(value)):
        normalized = item.strip()
        if normalized:
            pieces.append(normalized)
    return pieces


def _prompt_direction(window, on_done):
    items = ['Downstream', 'Upstream']

    def on_select(index):
        if index < 0:
            return
        on_done('downstream' if index == 0 else 'upstream')

    window.show_quick_panel(items, on_select)


def _default_changed_paths(window):
    view = window.active_view() if window else None
    file_name = view.file_name() if view else None
    if not file_name:
        return ''
    repo_root, _reason = _resolve_repo_root(window, path_hint=file_name)
    if not repo_root:
        return ''
    try:
        return os.path.relpath(file_name, repo_root).replace('\\', '/')
    except Exception:
        return ''


def _default_workspace_path(window):
    view = window.active_view() if window else None
    path_hint = view.file_name() if view else None
    repo_root, _reason = _resolve_repo_root(window, path_hint=path_hint)
    if not repo_root:
        return ''
    return os.path.join(repo_root, '.pairofcleats-workspace.jsonc')


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
        execution = config.resolve_execution_mode(context.get('settings') or {}, 'context-pack', supports_api=False)
        if execution.get('error'):
            ui.show_error(execution['error'])
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

        _run_cli_json(self.window, 'PairOfCleats context pack', repo_root, args, on_done, context=context)


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
        execution = config.resolve_execution_mode(context.get('settings') or {}, 'risk-explain', supports_api=False)
        if execution.get('error'):
            ui.show_error(execution['error'])
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

        _run_cli_json(self.window, 'PairOfCleats risk explain', repo_root, args, on_done, context=context)


class PairOfCleatsArchitectureCheckCommand(sublime_plugin.WindowCommand):
    def is_enabled(self):
        return True

    def is_visible(self):
        return True

    def run(self, rules_path=None, export_json=False, out_path=None):
        if rules_path:
            self._execute(rules_path, export_json, out_path)
            return
        _prompt_value(
            self.window,
            'PairOfCleats architecture rules path',
            os.path.join('rules', 'architecture.rules.json'),
            lambda value: self._execute(value, export_json, out_path) if value else None,
        )

    def _execute(self, rules_path, export_json, out_path):
        context = _resolve_cli_context(self.window)
        if not context:
            return
        repo_root = context['repo_root']
        args = ['architecture-check', '--repo', repo_root, '--rules', rules_path, '--json']
        _execute_analysis_command(
            self.window,
            'PairOfCleats architecture check',
            'architecture-check',
            repo_root,
            args,
            _collect_architecture_hits,
            _render_architecture_text,
            export_json=export_json,
            out_path=out_path,
            export_identity=rules_path,
        )


class PairOfCleatsImpactCommand(sublime_plugin.WindowCommand):
    def is_enabled(self):
        return True

    def is_visible(self):
        return True

    def run(self, seed=None, changed=None, direction=None, depth=DEFAULT_IMPACT_DEPTH, export_json=False, out_path=None):
        if seed or changed:
            self._execute(seed, changed, direction or 'downstream', depth, export_json, out_path)
            return

        def on_seed(value):
            seed_value = value.strip() if isinstance(value, str) else ''
            if seed_value:
                _prompt_direction(self.window, lambda selected_direction: self._prompt_depth(seed_value, [], selected_direction, export_json, out_path))
                return
            _prompt_value(
                self.window,
                'PairOfCleats impact changed paths (comma or newline separated)',
                _default_changed_paths(self.window),
                lambda changed_value: self._on_changed(changed_value, export_json, out_path),
            )

        _prompt_value(
            self.window,
            'PairOfCleats impact seed (leave blank to use changed paths)',
            '',
            on_seed,
        )

    def _on_changed(self, changed_value, export_json, out_path):
        changed = _parse_path_list(changed_value)
        if not changed:
            return
        _prompt_direction(self.window, lambda selected_direction: self._prompt_depth('', changed, selected_direction, export_json, out_path))

    def _prompt_depth(self, seed, changed, direction, export_json, out_path):
        _prompt_value(
            self.window,
            'PairOfCleats impact depth',
            str(DEFAULT_IMPACT_DEPTH),
            lambda depth_value: self._execute(seed, changed, direction, depth_value or DEFAULT_IMPACT_DEPTH, export_json, out_path),
        )

    def _execute(self, seed, changed, direction, depth, export_json, out_path):
        context = _resolve_cli_context(self.window)
        if not context:
            return
        repo_root = context['repo_root']
        depth_value = int(depth) if str(depth).isdigit() else DEFAULT_IMPACT_DEPTH
        args = ['impact', '--repo', repo_root, '--direction', direction or 'downstream', '--depth', str(depth_value), '--json']
        if seed:
            args.extend(['--seed', seed])
        else:
            for entry in changed or []:
                args.extend(['--changed', entry])
        identity = seed or ','.join(changed or []) or 'impact'
        _execute_analysis_command(
            self.window,
            'PairOfCleats impact analysis',
            'impact',
            repo_root,
            args,
            _collect_impact_hits,
            _render_impact_text,
            export_json=export_json,
            out_path=out_path,
            export_identity=identity,
        )


class PairOfCleatsSuggestTestsCommand(sublime_plugin.WindowCommand):
    def is_enabled(self):
        return True

    def is_visible(self):
        return True

    def run(self, changed=None, max=DEFAULT_SUGGEST_TESTS_MAX, export_json=False, out_path=None):
        if changed:
            self._execute(changed, max, export_json, out_path)
            return
        _prompt_value(
            self.window,
            'PairOfCleats suggest-tests changed paths (comma or newline separated)',
            _default_changed_paths(self.window),
            lambda changed_value: self._prompt_max(changed_value, export_json, out_path),
        )

    def _prompt_max(self, changed_value, export_json, out_path):
        changed = _parse_path_list(changed_value)
        if not changed:
            return
        _prompt_value(
            self.window,
            'PairOfCleats suggest-tests max suggestions',
            str(DEFAULT_SUGGEST_TESTS_MAX),
            lambda max_value: self._execute(changed, max_value or DEFAULT_SUGGEST_TESTS_MAX, export_json, out_path),
        )

    def _execute(self, changed, max_suggestions, export_json, out_path):
        context = _resolve_cli_context(self.window)
        if not context:
            return
        repo_root = context['repo_root']
        max_value = int(max_suggestions) if str(max_suggestions).isdigit() else DEFAULT_SUGGEST_TESTS_MAX
        args = ['suggest-tests', '--repo', repo_root, '--max', str(max_value), '--json']
        for entry in changed or []:
            args.extend(['--changed', entry])
        identity = ','.join(changed or []) or 'suggest-tests'
        _execute_analysis_command(
            self.window,
            'PairOfCleats suggest tests',
            'suggest-tests',
            repo_root,
            args,
            _collect_suggest_tests_hits,
            _render_suggest_tests_text,
            export_json=export_json,
            out_path=out_path,
            export_identity=identity,
        )


class PairOfCleatsWorkspaceManifestCommand(sublime_plugin.WindowCommand):
    def is_enabled(self):
        return True

    def is_visible(self):
        return True

    def run(self, workspace_path=None, export_json=False, out_path=None):
        self._prompt_and_execute('workspace-manifest', 'manifest', workspace_path, export_json, out_path)

    def _prompt_and_execute(self, kind, *command_parts):
        workspace_path = command_parts[-3]
        export_json = command_parts[-2]
        out_path = command_parts[-1]
        command_tokens = list(command_parts[:-3])
        if workspace_path:
            self._execute(kind, command_tokens, workspace_path, export_json, out_path)
            return
        _prompt_value(
            self.window,
            'PairOfCleats workspace path',
            _default_workspace_path(self.window),
            lambda value: self._execute(kind, command_tokens, value, export_json, out_path) if value else None,
        )

    def _execute(self, kind, command_tokens, workspace_path, export_json, out_path):
        context = _resolve_cli_context(self.window, path_hint=workspace_path)
        if not context:
            return
        repo_root = context['repo_root']
        args = ['workspace'] + list(command_tokens) + ['--workspace', workspace_path, '--json']
        _execute_analysis_command(
            self.window,
            'PairOfCleats {0}'.format(kind.replace('-', ' ')),
            kind,
            repo_root,
            args,
            _collect_workspace_hits,
            lambda payload, hits: _render_workspace_text(kind, payload, hits),
            export_json=export_json,
            out_path=out_path,
            export_identity=workspace_path,
        )


class PairOfCleatsWorkspaceStatusCommand(PairOfCleatsWorkspaceManifestCommand):
    def run(self, workspace_path=None, export_json=False, out_path=None):
        self._prompt_and_execute('workspace-status', 'status', workspace_path, export_json, out_path)


class PairOfCleatsWorkspaceBuildCommand(PairOfCleatsWorkspaceManifestCommand):
    def run(self, workspace_path=None, concurrency=DEFAULT_WORKSPACE_BUILD_CONCURRENCY, export_json=False, out_path=None):
        if workspace_path:
            self._execute_build(workspace_path, concurrency, export_json, out_path)
            return
        _prompt_value(
            self.window,
            'PairOfCleats workspace path',
            _default_workspace_path(self.window),
            lambda value: self._prompt_concurrency(value, export_json, out_path) if value else None,
        )

    def _prompt_concurrency(self, workspace_path, export_json, out_path):
        _prompt_value(
            self.window,
            'PairOfCleats workspace build concurrency',
            str(DEFAULT_WORKSPACE_BUILD_CONCURRENCY),
            lambda value: self._execute_build(workspace_path, value or DEFAULT_WORKSPACE_BUILD_CONCURRENCY, export_json, out_path),
        )

    def _execute_build(self, workspace_path, concurrency, export_json, out_path):
        def on_context(context):
            repo_root = context['repo_root']
            concurrency_value = int(concurrency) if str(concurrency).isdigit() else DEFAULT_WORKSPACE_BUILD_CONCURRENCY
            args = ['workspace', 'build', '--workspace', workspace_path, '--concurrency', str(concurrency_value), '--json']
            _execute_analysis_command(
                self.window,
                'PairOfCleats workspace build',
                'workspace-build',
                repo_root,
                args,
                _collect_workspace_hits,
                lambda payload, hits: _render_workspace_text('workspace-build', payload, hits),
                export_json=export_json,
                out_path=out_path,
                export_identity=workspace_path,
                context=context,
            )

        _with_mutating_cli_context(
            self.window,
            'workspace build',
            on_context,
            path_hint=workspace_path,
        )


class PairOfCleatsWorkspaceCatalogCommand(PairOfCleatsWorkspaceManifestCommand):
    def run(self, workspace_path=None, export_json=False, out_path=None):
        self._prompt_and_execute('workspace-catalog', 'catalog', workspace_path, export_json, out_path)


class PairOfCleatsReopenAnalysisCommand(sublime_plugin.WindowCommand):
    def is_enabled(self):
        return True

    def is_visible(self):
        return True

    def run(self, source=None):
        session = _load_analysis_session(self.window, source or '')
        if not session:
            ui.show_status('PairOfCleats: no previous {0} output to reopen.'.format((source or 'analysis').replace('_', ' ')))
            return
        results.reopen_session(self.window, session)


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
