import os
import time

import sublime
from .saved_search import normalize_saved_options
from . import operations
from . import results_state
from .filter_pagination import selected_index, capture_selection
from .source_authority import read_verified_source

HIGHLIGHT_KEY = 'pairofcleats.search.highlight'
HIGHLIGHT_SCOPE = 'region.yellowish'
RESULTS_PANEL = 'pairofcleats-results'
RESULTS_SESSION_KEY = 'pairofcleats.results.session'
EXPLAIN_SESSION_KEY = 'pairofcleats.explain.session'

HIT_ACTIONS = [
    ('open', 'Open Hit'),
    ('open_new_group', 'Open in New Group'),
    ('copy_path', 'Copy Path'),
    ('create_context', 'Create Context from This Evidence'),
    ('inspect_semantic', 'Inspect Semantic Evidence (Experimental)'),
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
        session['options'] = normalize_saved_options(options, repo_root)
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
    scope = operations.capture(window, key='result-picker')

    def on_select(index):
        if index < 0 or not operations.is_current(scope):
            return
        capture_selection(session, hits, index)
        if explain:
            results_state.record_last_explain(window, session)
        else:
            results_state.record_last_results(window, session)
        open_hit(window, hits[index], repo_root)

    window.show_quick_panel(items, on_select, selected_index=selected_index(session, hits))
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
    if action == 'inspect_semantic':
        window.run_command('pair_of_cleats_semantic_evidence', {'hit': hit, 'repo_root': repo_root})
        return hit
    if action == 'create_context':
        window.run_command('pair_of_cleats_copy_context', {'hits': [hit], 'repo_root': repo_root})
        return hit
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

    source_hash = hit.get('sourceHash')
    scope = operations.capture(window, key='source-opening')
    if source_hash:
        opened = window.find_open_file(file_path) if hasattr(window, 'find_open_file') else None
        if opened and opened.is_dirty():
            sublime.status_message('PairOfCleats: dirty source; indexed range was not opened.')
            return None
        try:
            read_verified_source(repo_root or os.path.dirname(file_path), file_path, source_hash)
        except (ValueError, OSError, UnicodeError) as error:
            sublime.status_message('PairOfCleats: indexed source was not opened: ' + str(error))
            return None
    start_line = hit.get('startLine')
    encoded_path = file_path
    if isinstance(start_line, int) and start_line > 0:
        encoded_path = '{0}:{1}'.format(file_path, start_line)

    view = window.open_file(encoded_path, sublime.ENCODED_POSITION)
    highlight_hit(view, hit, scope=scope, repo_root=repo_root)
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
    if repo_root:
        root = os.path.realpath(repo_root)
        resolved = os.path.realpath(file_path if os.path.isabs(file_path) else os.path.join(root, file_path))
        try:
            relative = os.path.relpath(resolved, root)
            if relative == os.pardir or relative.startswith(os.pardir + os.sep) or os.path.isabs(relative):
                return None
        except ValueError:
            return None
        return resolved
    if os.path.isabs(file_path):
        return file_path
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


def qualified_source_buffer(source_text, buffer_text):
    """Only actually observed BOM removal/CRLF normalization is reversible."""
    if buffer_text == source_text or buffer_text == source_text.replace('\r\n', '\n'):
        return {'removedBom': False}
    if source_text.startswith('\ufeff') and (buffer_text == source_text[1:]
            or buffer_text == source_text[1:].replace('\r\n', '\n')):
        return {'removedBom': True}
    return None


def highlight_hit(view, hit, scope=None, repo_root=None):
    if view is None or not isinstance(hit, dict):
        return
    start_line = hit.get('startLine')
    end_line = hit.get('endLine') or start_line
    if not isinstance(start_line, int) or start_line <= 0:
        return
    if not isinstance(end_line, int) or end_line <= 0:
        end_line = start_line

    if scope is None and hasattr(view, 'window') and view.window():
        scope = operations.capture(view.window(), key='source-opening')
    deadline = time.monotonic() + 5
    def apply():
        if (scope is not None and not operations.is_current(scope)
                or hasattr(view, 'is_valid') and not view.is_valid()):
            return
        removed_bom = False
        if view.is_loading():
            if time.monotonic() >= deadline:
                sublime.status_message('PairOfCleats: source loading did not settle within the selection deadline.')
                return
            sublime.set_timeout(apply, 10)
            return
        view.erase_regions(HIGHLIGHT_KEY)
        if hit.get('sourceHash') and view.is_dirty():
            sublime.status_message('PairOfCleats: dirty source; indexed selection was not applied.')
            return
        if hit.get('sourceHash'):
            try:
                source = read_verified_source(repo_root or os.path.dirname(view.file_name()), view.file_name(), hit['sourceHash'])
                text = source['sourceText']
                buffer_text = view.substr(sublime.Region(0, view.size()))
                normalization = qualified_source_buffer(text, buffer_text)
                if normalization is None:
                    sublime.status_message('PairOfCleats: source changed; indexed selection was not applied.')
                    return
                removed_bom = normalization['removedBom']
            except (ValueError, OSError, UnicodeError):
                return
        start_col = hit.get('startCol')
        end_col = hit.get('endCol')
        if isinstance(start_col, int) and start_col > 0 and isinstance(end_col, int) and end_col > 0:
            if removed_bom:
                start_col -= 1 if start_line == 1 else 0
                end_col -= 1 if end_line == 1 else 0
                if start_col < 1 or end_col < 1:
                    sublime.status_message('PairOfCleats: indexed span includes a BOM removed by the host; selection unavailable.')
                    return
            try:
                start_pt = _utf16_point(view, start_line - 1, start_col - 1)
                end_pt = _utf16_point(view, end_line - 1, end_col - 1)
                if end_pt < start_pt:
                    raise ValueError('Source range ends before it begins.')
            except ValueError as error:
                sublime.status_message('PairOfCleats: indexed selection unavailable: ' + str(error))
                return
            region = sublime.Region(start_pt, end_pt)
            view.sel().clear()
            view.sel().add(region)
            view.show(region)
        else:
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


def _utf16_point(view, row, units):
    if (not isinstance(row, int) or isinstance(row, bool) or row < 0
            or not isinstance(units, int) or isinstance(units, bool) or units < 0):
        raise ValueError('Invalid UTF-16 source coordinate.')
    start = view.text_point(row, 0)
    if hasattr(view, 'rowcol') and view.rowcol(start)[0] != row:
        raise ValueError('Source line is outside the loaded buffer.')
    line = view.substr(view.line(start))
    consumed = 0
    column = 0
    for character in line:
        width = len(character.encode('utf-16-le')) // 2
        if consumed + width > units:
            break
        consumed += width
        column += 1
    if consumed != units:
        raise ValueError('Source column is outside its line or splits a UTF-16 surrogate pair.')
    return view.text_point(row, column)
