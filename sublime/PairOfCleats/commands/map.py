import json
import os
import webbrowser
from urllib.parse import quote, urlparse

import sublime
import sublime_plugin

from ..lib import api_client
from ..lib import config
from ..lib import map as map_lib
from ..lib import map_state
from ..lib import paths
from ..lib import results
from ..lib import runner
from ..lib import tasks
from ..lib import ui

MAP_TYPE_CHOICES = [
    ('combined', 'combined (imports + calls + usages + dataflow)'),
    ('imports', 'imports only'),
    ('calls', 'calls only'),
    ('usages', 'usages only'),
    ('dataflow', 'dataflow only')
]

MAP_FORMAT_CHOICES = [
    ('html-iso', 'isometric HTML (three.js)'),
    ('html', 'graphviz HTML'),
    ('svg', 'graphviz SVG'),
    ('dot', 'graphviz DOT'),
    ('json', 'map model JSON')
]


def _resolve_repo_root(window, path_hint=None, allow_fallback=True):
    return paths.resolve_repo_root(window, return_reason=True, path_hint=path_hint, allow_fallback=allow_fallback)


def _has_repo_root(window, path_hint=None, allow_fallback=True):
    return paths.has_repo_root(window, path_hint=path_hint, allow_fallback=allow_fallback)


def _with_map_repo_root(window, on_resolved, path_hint=None):
    def handle_repo_root(repo_root, reason):
        if not repo_root:
            ui.show_error('PairOfCleats: {0}'.format(reason))
            return
        if reason:
            ui.show_status('PairOfCleats: {0}'.format(reason))
        on_resolved(repo_root)

    paths.resolve_repo_root_interactive(
        window,
        handle_repo_root,
        path_hint=path_hint,
        allow_fallback=False,
        prompt='PairOfCleats repo for map',
    )


def _extract_selection(view):
    if view is None:
        return ''
    for region in view.sel():
        if not region.empty():
            return view.substr(region)
    return ''


def _extract_symbol(view):
    if view is None:
        return ''
    selection = view.sel()
    if not selection:
        return ''
    region = selection[0]
    word = view.word(region)
    return view.substr(word)


def _relative_focus(repo_root, path_value):
    if not path_value:
        return ''
    if os.path.isabs(path_value):
        try:
            rel = os.path.relpath(path_value, repo_root)
            return rel.replace('\\', '/')
        except Exception:
            return path_value.replace('\\', '/')
    return path_value.replace('\\', '/')


def _open_in_browser(path_value):
    if not path_value:
        return False
    parsed = _parse_browser_target(path_value)
    if parsed.get('url'):
        url = parsed['url']
    else:
        local_path = parsed.get('path')
        if not local_path or not os.path.exists(local_path):
            ui.show_error('PairOfCleats: map output not found: {0}'.format(local_path or path_value))
            return False
        try:
            resolved = os.path.abspath(local_path)
            url = 'file:///{0}'.format(quote(resolved.replace('\\', '/')))
        except Exception:
            url = 'file:///{0}'.format(local_path.replace('\\', '/'))
    try:
        webbrowser.open_new_tab(url)
        return True
    except Exception:
        ui.show_error('PairOfCleats: failed to open browser.')
        return False


def _render_report(payload):
    lines = ['PairOfCleats map report', '']
    if not isinstance(payload, dict):
        return '\n'.join(lines)
    summary = payload.get('summary') or {}
    counts = summary.get('counts') or {}
    lines.append('source: {0}'.format(payload.get('source') or 'cli'))
    lines.append('format: {0}'.format(payload.get('format') or 'unknown'))
    repo = payload.get('repo') or ''
    if repo:
        lines.append('repo: {0}'.format(repo))
    lines.append('files: {0}'.format(counts.get('files') or 0))
    lines.append('members: {0}'.format(counts.get('members') or 0))
    lines.append('edges: {0}'.format(counts.get('edges') or 0))
    if payload.get('outPath'):
        lines.append('output: {0}'.format(payload.get('outPath')))
    if payload.get('modelPath'):
        lines.append('model: {0}'.format(payload.get('modelPath')))
    if payload.get('nodeListPath'):
        lines.append('nodes: {0}'.format(payload.get('nodeListPath')))
    if payload.get('cacheKey'):
        lines.append('cache: {0}'.format(payload.get('cacheKey')))
    warnings = payload.get('warnings') or []
    if warnings:
        lines.append('')
        lines.append('Warnings:')
        for warning in warnings:
            lines.append('- {0}'.format(warning))
    lines.append('')
    lines.append('Follow-up:')
    lines.append('- PairOfCleats: Map Open Last Viewer')
    lines.append('- PairOfCleats: Map Jump to Node')
    lines.append('- PairOfCleats: Map Show Last Report')
    return '\n'.join(lines) + '\n'


def _offer_rebuild(window, warnings):
    if not warnings or window is None:
        return
    needs = any(
        'dataflow metadata missing' in warning or 'controlFlow metadata missing' in warning
        for warning in warnings
    )
    if not needs:
        return

    def on_select(index):
        if index == 0:
            window.run_command('pair_of_cleats_index_build_all')

    window.show_quick_panel(
        ['Rebuild index with dataflow/control-flow enabled', 'Dismiss'],
        on_select
    )

def _parse_browser_target(path_value):
    try:
        parsed = urlparse(str(path_value))
    except Exception:
        parsed = None
    if parsed and parsed.scheme in ('http', 'https', 'file'):
        return {'url': path_value, 'path': None}
    return {'url': None, 'path': path_value}


def _should_show_report_panel(settings, payload):
    preference = settings.get('map_show_report_panel')
    if preference is True:
        return True
    if preference is False:
        return False
    warnings = payload.get('warnings') or []
    return bool(warnings)


def _open_map_output(window, payload):
    resolved_path = payload.get('outPath') or ''
    resolved_format = payload.get('format') or ''
    if not resolved_path:
        ui.show_status('PairOfCleats: no map output to reopen.')
        return False
    if resolved_format in ('html', 'html-iso', 'svg'):
        return _open_in_browser(resolved_path)
    parsed = _parse_browser_target(resolved_path)
    local_path = parsed.get('path')
    if parsed.get('url'):
        return _open_in_browser(resolved_path)
    if not local_path or not os.path.exists(local_path):
        ui.show_error('PairOfCleats: map output not found: {0}'.format(local_path or resolved_path))
        return False
    window.open_file(local_path)
    return True


def _prompt_map_type(window, settings, on_done):
    default_type = map_lib.resolve_map_type(settings)
    labels = [entry[1] for entry in MAP_TYPE_CHOICES]
    selected_index = 0
    for idx, (value, _) in enumerate(MAP_TYPE_CHOICES):
        if value == default_type:
            selected_index = idx
            break

    def on_select(index):
        if index < 0:
            return
        on_done(MAP_TYPE_CHOICES[index][0])

    window.show_quick_panel(labels, on_select, selected_index=selected_index)


def _prompt_map_format(window, settings, on_done):
    default_format = map_lib.resolve_map_format(settings)
    labels = [entry[1] for entry in MAP_FORMAT_CHOICES]
    selected_index = 0
    for idx, (value, _) in enumerate(MAP_FORMAT_CHOICES):
        if value == default_format:
            selected_index = idx
            break

    def on_select(index):
        if index < 0:
            return
        on_done(MAP_FORMAT_CHOICES[index][0])

    window.show_quick_panel(labels, on_select, selected_index=selected_index)


def _dispatch_map(window, scope, focus, repo_root, map_type=None, map_format=None):
    settings = config.get_settings(window)

    errors = config.validate_settings(settings, repo_root)
    if errors:
        message = 'PairOfCleats settings need attention:\n- {0}'.format(
            '\n- '.join(errors)
        )
        ui.show_error(message)
        return

    map_type = map_type or map_lib.resolve_map_type(settings)
    map_format = map_format or map_lib.resolve_map_format(settings)
    output_path, model_path, node_list_path = map_lib.build_output_paths(
        repo_root, settings, scope, map_type, map_format
    )
    execution = config.resolve_execution_mode(settings, 'map', supports_api=True)
    if execution.get('error'):
        ui.show_error(execution['error'])
        return

    def handle_payload(result):
        if result.returncode != 0:
            message = result.output.strip() or 'PairOfCleats map failed.'
            ui.show_error(message)
            return
        if result.error:
            ui.show_error(result.error)
            return
        payload = result.payload
        if not isinstance(payload, dict) or not payload.get('ok'):
            ui.show_error('PairOfCleats map returned invalid JSON.')
            return

        resolved_payload = dict(payload)
        resolved_payload.setdefault('repo', repo_root)
        resolved_payload.setdefault('format', map_format)
        resolved_payload.setdefault('outPath', output_path)
        resolved_payload.setdefault('modelPath', model_path)
        resolved_payload.setdefault('nodeListPath', node_list_path)
        report_text = _render_report(resolved_payload)
        map_state.record_last_map(window, resolved_payload, report_text=report_text)
        if _should_show_report_panel(settings, resolved_payload):
            ui.write_output_panel(window, 'pairofcleats-map', report_text)
        _offer_rebuild(window, resolved_payload.get('warnings') or [])
        _open_map_output(window, resolved_payload)

    if execution.get('mode') == 'api':
        ui.show_status('PairOfCleats: generating map via API...')
        task = tasks.start_task(
            window,
            'PairOfCleats map',
            kind='map',
            repo_root=repo_root,
            cancellable=False,
            details='Generating map via API...',
            show_panel=bool(settings.get('progress_panel_on_start', True)),
        )

        def on_api_done(result):
            if result.error:
                tasks.complete_task(window, task, status='failed', details=result.error)
                if execution.get('allow_fallback'):
                    ui.show_status('PairOfCleats: API map failed; falling back to CLI.')
                    _dispatch_map_cli(window, repo_root, settings, scope, focus, map_type, map_format, output_path, model_path, node_list_path, handle_payload)
                    return
                ui.show_error(result.error)
                return
            tasks.complete_task(window, task, status='done', details='Map completed via API.')
            handle_payload(_ApiProcessResult(result.payload))

        api_client.run_async(
            lambda: api_client.generate_map_report(
                execution.get('base_url'),
                repo_root,
                settings,
                scope,
                focus,
                map_type,
                map_format,
                output_path,
                model_path,
                node_list_path,
            ),
            on_api_done,
            on_progress=lambda message: tasks.note_progress(window, task, details=message),
        )
        return

    ui.show_status('PairOfCleats: generating map...')
    _dispatch_map_cli(window, repo_root, settings, scope, focus, map_type, map_format, output_path, model_path, node_list_path, handle_payload)


class _ApiProcessResult(object):
    def __init__(self, payload):
        self.returncode = 0
        self.output = ''
        self.error = None
        self.payload = payload


def _dispatch_map_cli(window, repo_root, settings, scope, focus, map_type, map_format, output_path, model_path, node_list_path, on_done):
    args = map_lib.build_map_args(
        repo_root,
        settings,
        scope,
        focus,
        map_type,
        map_format,
        output_path,
        model_path,
        node_list_path
    )

    cli = paths.resolve_cli(settings, repo_root)
    command = cli['command']
    full_args = list(cli.get('args_prefix') or []) + args
    env = config.build_env(settings)
    runner.run_process(
        command,
        full_args,
        cwd=repo_root,
        env=env,
        window=window,
        title='PairOfCleats map',
        capture_json=True,
        on_done=on_done,
        stream_output=settings.get('map_stream_output') is True,
        panel_name='pairofcleats-map'
    )


def _run_with_options(window, scope, focus, map_type=None, map_format=None, path_hint=None):
    settings = config.get_settings(window)

    def on_repo_root(repo_root):
        if not settings.get('map_prompt_options'):
            _dispatch_map(window, scope, focus, repo_root, map_type=map_type, map_format=map_format)
            return

        def after_type(selected_type):
            def after_format(selected_format):
                _dispatch_map(window, scope, focus, repo_root, map_type=selected_type, map_format=selected_format)
            _prompt_map_format(window, settings, after_format)

        _prompt_map_type(window, settings, after_type)

    _with_map_repo_root(window, on_repo_root, path_hint=path_hint)


class PairOfCleatsMapRepoCommand(sublime_plugin.WindowCommand):
    def is_enabled(self):
        return True

    def is_visible(self):
        return True

    def run(self):
        _run_with_options(self.window, 'repo', '', path_hint=None)


class PairOfCleatsMapCurrentFolderCommand(sublime_plugin.WindowCommand):        
    def is_enabled(self):
        return True

    def is_visible(self):
        return True

    def run(self):
        view = self.window.active_view()
        folder = None
        if view and view.file_name():
            folder = os.path.dirname(view.file_name())
        if not folder and len(self.window.folders()) == 1:
            folder = self.window.folders()[0]
        if not folder:
            ui.show_error('PairOfCleats: current folder map requires an active file or a single open folder.')
            return
        repo_root, reason = _resolve_repo_root(self.window, path_hint=folder, allow_fallback=False)
        if not repo_root:
            ui.show_error('PairOfCleats: {0}'.format(reason))
            return
        focus = _relative_focus(repo_root, folder) if folder else ''
        _run_with_options(self.window, 'dir', focus, path_hint=folder)


class PairOfCleatsMapCurrentFileCommand(sublime_plugin.WindowCommand):
    def is_enabled(self):
        view = self.window.active_view()
        return bool(view and view.file_name())

    def is_visible(self):
        return True

    def run(self):
        view = self.window.active_view()
        if not view or not view.file_name():
            ui.show_status('PairOfCleats: no active file.')
            return
        repo_root, reason = _resolve_repo_root(self.window, path_hint=view.file_name(), allow_fallback=False)
        if not repo_root:
            ui.show_error('PairOfCleats: {0}'.format(reason))
            return
        focus = _relative_focus(repo_root, view.file_name())
        _run_with_options(self.window, 'file', focus, path_hint=view.file_name())


class PairOfCleatsMapSymbolUnderCursorCommand(sublime_plugin.TextCommand):
    def is_enabled(self):
        return bool(self.view and self.view.file_name())

    def is_visible(self):
        return True

    def run(self, edit):
        symbol = _extract_symbol(self.view)
        if not symbol:
            ui.show_status('PairOfCleats: no symbol under cursor.')
            return
        file_name = self.view.file_name() if self.view else None
        repo_root, reason = _resolve_repo_root(self.view.window(), path_hint=file_name, allow_fallback=False)
        if not repo_root:
            ui.show_error('PairOfCleats: {0}'.format(reason))
            return
        focus = '{0}::{1}'.format(_relative_focus(repo_root, file_name), symbol) if file_name else symbol
        _run_with_options(self.view.window(), 'symbol', focus, path_hint=file_name)


class PairOfCleatsMapSelectionCommand(sublime_plugin.TextCommand):
    def is_enabled(self):
        return bool(self.view)

    def is_visible(self):
        return True

    def run(self, edit):
        selection = _extract_selection(self.view)
        if not selection:
            ui.show_status('PairOfCleats: no selection.')
            return
        file_name = self.view.file_name() if self.view else None
        _run_with_options(self.view.window(), 'symbol', selection.strip(), path_hint=file_name)


class PairOfCleatsMapJumpToNodeCommand(sublime_plugin.WindowCommand):
    def is_enabled(self):
        return True

    def is_visible(self):
        return True

    def run(self):
        state = map_state.get_last_map(self.window)
        if not state:
            ui.show_status('PairOfCleats: no map history yet.')
            return
        node_list_path = state.get('nodeListPath')
        if not node_list_path or not os.path.exists(node_list_path):
            ui.show_status('PairOfCleats: node list unavailable.')
            return
        try:
            with open(node_list_path, 'r') as handle:
                payload = json.load(handle)
        except Exception:
            ui.show_error('PairOfCleats: failed to read node list.')
            return
        nodes = payload.get('nodes') if isinstance(payload, dict) else None
        if not isinstance(nodes, list) or not nodes:
            ui.show_status('PairOfCleats: node list empty.')
            return

        items = []
        for node in nodes:
            label = node.get('label') or node.get('id') or '(unnamed node)'
            file_label = node.get('file') or '(no file)'
            start_line = node.get('startLine')
            if isinstance(start_line, int) and start_line > 0:
                file_label = '{0}:{1}'.format(file_label, start_line)
            items.append([label, file_label])

        repo_root = state.get('repo')
        if not repo_root:
            repo_root, reason = _resolve_repo_root(self.window, allow_fallback=False)
            if not repo_root:
                ui.show_error('PairOfCleats: {0}'.format(reason))
                return

        def on_select(index):
            if index < 0:
                return
            node = nodes[index]
            if not node.get('file'):
                ui.show_status('PairOfCleats: selected node has no source location.')
                return
            hit = {
                'file': node.get('file'),
                'startLine': node.get('startLine'),
                'endLine': node.get('endLine')
            }
            results.open_hit(self.window, hit, repo_root=repo_root)

        self.window.show_quick_panel(items, on_select)


class PairOfCleatsMapOpenLastViewerCommand(sublime_plugin.WindowCommand):
    def is_enabled(self):
        return True

    def is_visible(self):
        return True

    def run(self):
        state = map_state.get_last_map(self.window)
        if not state:
            ui.show_status('PairOfCleats: no map history yet.')
            return
        _open_map_output(self.window, state)


class PairOfCleatsMapShowLastReportCommand(sublime_plugin.WindowCommand):
    def is_enabled(self):
        return True

    def is_visible(self):
        return True

    def run(self):
        state = map_state.get_last_map(self.window)
        if not state:
            ui.show_status('PairOfCleats: no map history yet.')
            return
        report_text = state.get('reportText') or _render_report(state)
        ui.write_output_panel(self.window, 'pairofcleats-map', report_text)
        ui.show_status('PairOfCleats: showing last map report.')
