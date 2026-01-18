import os

import sublime

HIGHLIGHT_KEY = 'pairofcleats.search.highlight'
HIGHLIGHT_SCOPE = 'region.yellowish'
RESULTS_PANEL = 'pairofcleats-results'


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


def open_results_view(window, text):
    if window is None:
        return None
    view = window.new_file()
    view.set_name('PairOfCleats Results')
    view.set_scratch(True)
    view.set_read_only(False)
    view.run_command('append', {'characters': text, 'force': True})
    view.set_read_only(True)
    return view


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
