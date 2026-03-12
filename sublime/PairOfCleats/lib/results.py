import os

import sublime

HIGHLIGHT_KEY = 'pairofcleats.search.highlight'
HIGHLIGHT_SCOPE = 'region.yellowish'
RESULTS_PANEL = 'pairofcleats-results'
RESULTS_SESSION_KEY = 'pairofcleats.results.session'
EXPLAIN_SESSION_KEY = 'pairofcleats.explain.session'

HIT_ACTIONS = [
    ('open', 'Open Hit'),
    ('open_new_group', 'Open in New Group'),
    ('copy_path', 'Copy Path'),
    ('rerun_context', 'Rerun from Hit Context'),
]


def collect_hits(payload):
    hits = []
    if not isinstance(payload, dict):
        return hits

    def add(section, items):
        if not isinstance(items, list):
            return
        for hit in items:
            if not isinstance(hit, dict):
                continue
            merged = dict(hit)
            merged['section'] = section
            hits.append(merged)

    add('code', payload.get('code'))
    add('prose', payload.get('prose'))
    add('extracted-prose', payload.get('extractedProse'))
    add('records', payload.get('records'))
    return hits


def collect_hits_from_session(session):
    hits = session.get('hits')
    if not isinstance(hits, list):
        return []
    return [dict(hit) for hit in hits if isinstance(hit, dict)]


def build_session(query, options, repo_root, hits, target, explain=False):
    session = {
        'query': query,
        'repoRoot': repo_root,
        'target': target,
        'explain': bool(explain),
        'hits': [normalize_hit(hit) for hit in hits],
    }
    if isinstance(options, dict):
        session['options'] = {
            'mode': options.get('mode'),
            'backend': options.get('backend'),
            'limit': options.get('limit'),
        }
    if explain:
        session['text'] = format_explain_text(session['hits'])
    elif target in ('new_tab', 'output_panel'):
        session['text'] = format_results_text(session['hits'])
    return session


def reopen_session(window, session):
    if window is None or not isinstance(session, dict):
        return None
    hits = collect_hits_from_session(session)
    target = session.get('target') or 'quick_panel'
    repo_root = session.get('repoRoot')
    explain = bool(session.get('explain'))
    text = session.get('text')
    if not isinstance(text, str) or not text:
        text = format_explain_text(hits) if explain else format_results_text(hits)

    if target == 'output_panel':
        panel = open_output_panel(window, text, explain=explain, session=session)
        return {'target': target, 'view': panel}
    if target == 'new_tab':
        view = open_results_view(window, text, explain=explain, session=session)
        return {'target': target, 'view': view}

    items = [format_quick_panel_item(hit) for hit in hits]

    def on_select(index):
        if index < 0:
            return
        open_hit(window, hits[index], repo_root)

    window.show_quick_panel(items, on_select)
    return {'target': 'quick_panel', 'count': len(items)}


def format_quick_panel_item(hit):
    file_label = format_file_label(hit)
    score_label = format_score_label(hit)
    section = hit.get('section') or ''
    name = hit.get('name') or hit.get('symbol') or ''
    headline = hit.get('headline') or hit.get('preview') or ''

    label = name or headline or file_label
    detail_parts = [file_label]
    if section:
        detail_parts.append(section)
    if score_label:
        detail_parts.append(score_label)
    detail = ' | '.join([part for part in detail_parts if part])

    if headline and headline != label:
        return [label, detail, headline]
    return [label, detail]


def format_hit_action_items(hit):
    file_label = format_file_label(hit)
    context = resolve_hit_context_query(hit) or file_label or 'current result'
    items = []
    for action, label in HIT_ACTIONS:
        detail = context if action == 'rerun_context' else file_label
        items.append([label, detail])
    return items


def format_results_text(hits):
    lines = ['PairOfCleats results ({0})'.format(len(hits)), '']
    for idx, hit in enumerate(hits, start=1):
        file_label = format_file_label(hit)
        section = hit.get('section') or ''
        score_label = format_score_label(hit)
        name = hit.get('name') or hit.get('symbol') or ''
        headline = hit.get('headline') or hit.get('preview') or ''

        header_parts = ['{0}.'.format(idx), file_label]
        if section:
            header_parts.append('[{0}]'.format(section))
        if score_label:
            header_parts.append(score_label)
        lines.append(' '.join([part for part in header_parts if part]))

        if name:
            lines.append('  {0}'.format(name))
        if headline and headline != name:
            lines.append('  {0}'.format(headline))
        lines.append('')
    return '\n'.join(lines).rstrip() + '\n'


def format_explain_text(hits):
    lines = ['PairOfCleats explain ({0})'.format(len(hits)), '']
    for idx, hit in enumerate(hits, start=1):
        file_label = format_file_label(hit)
        section = hit.get('section') or ''
        score_label = format_score_label(hit)
        lines.append('{0}. {1}'.format(idx, file_label))
        if section or score_label:
            detail = ' '.join([part for part in [section, score_label] if part])
            if detail:
                lines.append('  {0}'.format(detail))

        breakdown = hit.get('scoreBreakdown')
        if isinstance(breakdown, dict) and breakdown:
            for key in sorted(breakdown.keys()):
                value = breakdown[key]
                lines.append('  {0}: {1}'.format(key, value))
        else:
            lines.append('  (no score breakdown)')
        lines.append('')
    return '\n'.join(lines).rstrip() + '\n'


def apply_hit_action(window, hit, repo_root=None, action='open', rerun=None):
    if action == 'open':
        return open_hit(window, hit, repo_root)
    if action == 'open_new_group':
        return open_hit_in_new_group(window, hit, repo_root)
    if action == 'copy_path':
        file_path = resolve_hit_path(hit, repo_root)
        if file_path:
            sublime.set_clipboard(file_path)
        return file_path
    if action == 'rerun_context':
        query = resolve_hit_context_query(hit)
        if query and callable(rerun):
            rerun(query)
        return query
    return None


def open_hit(window, hit, repo_root=None):
    file_path = resolve_hit_path(hit, repo_root)
    if not file_path:
        return None

    start_line = hit.get('startLine')
    encoded_path = file_path
    if isinstance(start_line, int) and start_line > 0:
        encoded_path = '{0}:{1}'.format(file_path, start_line)

    view = window.open_file(encoded_path, sublime.ENCODED_POSITION)
    highlight_hit(view, hit)
    return view


def open_hit_in_new_group(window, hit, repo_root=None):
    if window is None:
        return None
    active_group = _safe_active_group(window)
    target_group = active_group + 1
    group_count = _safe_num_groups(window)
    if target_group >= group_count:
        try:
            window.run_command('new_pane')
        except Exception:
            pass
        group_count = _safe_num_groups(window)
        if target_group >= group_count:
            target_group = max(group_count - 1, 0)
    try:
        window.focus_group(target_group)
    except Exception:
        pass
    return open_hit(window, hit, repo_root)


def open_results_view(window, text, explain=False, session=None):
    if window is None:
        return None
    view = window.new_file()
    view.set_name('PairOfCleats Explain' if explain else 'PairOfCleats Results')
    view.set_scratch(True)
    view.set_read_only(False)
    view.run_command('append', {'characters': text, 'force': True})
    view.set_read_only(True)
    _attach_session(view, explain=explain, session=session)
    return view


def open_output_panel(window, text, explain=False, session=None):
    if window is None:
        return None
    panel = window.create_output_panel(RESULTS_PANEL)
    panel.set_read_only(False)
    panel.run_command('select_all')
    panel.run_command('right_delete')
    panel.run_command(
        'append',
        {'characters': text, 'force': True, 'scroll_to_end': False},
    )
    panel.set_read_only(True)
    _attach_session(panel, explain=explain, session=session)
    window.run_command('show_panel', {'panel': 'output.{0}'.format(RESULTS_PANEL)})
    return panel


def resolve_hit_path(hit, repo_root):
    if not isinstance(hit, dict):
        return None
    file_path = hit.get('file')
    if not file_path:
        return None
    if os.path.isabs(file_path):
        return file_path
    if repo_root:
        return os.path.join(repo_root, file_path)
    return file_path


def resolve_hit_context_query(hit):
    for key in ('name', 'symbol', 'headline', 'preview'):
        value = hit.get(key) if isinstance(hit, dict) else None
        if isinstance(value, str):
            value = value.strip()
            if value:
                return value
    file_path = hit.get('file') if isinstance(hit, dict) else None
    if isinstance(file_path, str) and file_path.strip():
        return os.path.basename(file_path)
    return ''


def highlight_hit(view, hit):
    if view is None or not isinstance(hit, dict):
        return
    start_line = hit.get('startLine')
    end_line = hit.get('endLine') or start_line
    if not isinstance(start_line, int) or start_line <= 0:
        return
    if not isinstance(end_line, int) or end_line <= 0:
        end_line = start_line

    def apply():
        if view.is_loading():
            sublime.set_timeout(apply, 10)
            return
        view.erase_regions(HIGHLIGHT_KEY)
        start_pt = view.text_point(start_line - 1, 0)
        end_pt = view.text_point(end_line - 1, 0)
        region = view.full_line(sublime.Region(start_pt, end_pt))
        view.add_regions(HIGHLIGHT_KEY, [region], HIGHLIGHT_SCOPE, flags=0)

    sublime.set_timeout(apply, 0)


def format_file_label(hit):
    file_path = hit.get('file') or ''
    start_line = hit.get('startLine')
    end_line = hit.get('endLine')
    if isinstance(start_line, int) and start_line > 0:
        if isinstance(end_line, int) and end_line > start_line:
            return '{0}:{1}-{2}'.format(file_path, start_line, end_line)
        return '{0}:{1}'.format(file_path, start_line)
    return file_path


def format_score_label(hit):
    score = hit.get('score')
    score_type = hit.get('scoreType') or ''
    if isinstance(score, (int, float)):
        label = '{0:.2f}'.format(score)
        if score_type:
            label = '{0} {1}'.format(label, score_type)
        return 'score {0}'.format(label)
    return ''


def normalize_hit(hit):
    normalized = {}
    if not isinstance(hit, dict):
        return normalized
    for key, value in hit.items():
        if isinstance(value, (str, int, float, bool)) or value is None:
            normalized[key] = value
        elif isinstance(value, dict):
            normalized[key] = dict(value)
        elif isinstance(value, list):
            normalized[key] = list(value)
    return normalized


def _attach_session(view, explain=False, session=None):
    if view is None or session is None:
        return
    settings = view.settings()
    key = EXPLAIN_SESSION_KEY if explain else RESULTS_SESSION_KEY
    settings.set(key, dict(session))


def _safe_num_groups(window):
    try:
        return max(int(window.num_groups()), 1)
    except Exception:
        return 1


def _safe_active_group(window):
    try:
        return max(int(window.active_group()), 0)
    except Exception:
        return 0
