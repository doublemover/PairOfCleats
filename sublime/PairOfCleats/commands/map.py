import json
import os
import threading
import webbrowser
from urllib.parse import quote

import sublime
import sublime_plugin

from ..lib import config
from ..lib import api_client
from ..lib import map as map_lib
from ..lib import map_state
from ..lib import paths
from ..lib import results
from ..lib import runner
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


def _resolve_repo_root(window, path_hint=None):
    return paths.resolve_repo_root(window, return_reason=True, path_hint=path_hint)


def _has_repo_root(window, path_hint=None):
    return paths.has_repo_root(window, path_hint=path_hint)


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
        return
    if isinstance(path_value, str):
        lowered = path_value.lower()
        if lowered.startswith('http://') or lowered.startswith('https://') or lowered.startswith('file://'):
            try:
                webbrowser.open_new_tab(path_value)
            except Exception:
                ui.show_error('PairOfCleats: failed to open browser.')
            return
    try:
        resolved = os.path.abspath(path_value)
        url = 'file:///{0}'.format(quote(resolved.replace('\\', '/')))
    except Exception:
        url = 'file:///{0}'.format(path_value.replace('\\', '/'))
    try:
        webbrowser.open_new_tab(url)
    except Exception:
        ui.show_error('PairOfCleats: failed to open browser.')


def _render_report(payload):
    lines = ['PairOfCleats map report', '']
    if not isinstance(payload, dict):
        return '\n'.join(lines)
    summary = payload.get('summary') or {}
    counts = summary.get('counts') or {}
    lines.append('files: {0}'.format(counts.get('files') or 0))
    lines.append('members: {0}'.format(counts.get('members') or 0))
    lines.append('edges: {0}'.format(counts.get('edges') or 0))
    warnings = payload.get('warnings') or []
    if warnings:
        lines.append('')
        lines.append('Warnings:')
        for warning in warnings:
            lines.append('- {0}'.format(warning))
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


def _dispatch_map(window, scope, focus, map_type=None, map_format=None, path_hint=None):
    settings = config.get_settings(window)
    repo_root, reason = _resolve_repo_root(window, path_hint=path_hint)
    if not repo_root:
        ui.show_error('PairOfCleats: {0}'.format(reason))
        return
    if reason:
        ui.show_status('PairOfCleats: {0}'.format(reason))

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

    api_url = settings.get('api_server_url') or ''

    def run_cli():
        ui.show_status('PairOfCleats: generating map...')
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

    def on_done(result):
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

        map_state.record_last_map(window, payload)
        report_text = _render_report(payload)
        if settings.get('map_show_report_panel'):
            ui.write_output_panel(window, 'pairofcleats-map', report_text)
        _offer_rebuild(window, payload.get('warnings') or [])

        resolved_path = payload.get('outPath') or output_path
        resolved_format = payload.get('format') or map_format

        if resolved_format in ('html', 'html-iso', 'svg'):
            _open_in_browser(resolved_path)
        elif resolved_path:
            window.open_file(resolved_path)

    def run_api():
        ui.show_status('PairOfCleats: generating map (API server)...')

        def worker():
            try:
                include = map_lib.MAP_TYPES.get(map_type)
                payload = api_client.generate_map_report(
                    api_url,
                    repo_root,
                    settings,
                    scope,
                    focus,
                    include,
                    map_format,
                    output_path,
                    model_path,
                    node_list_path
                )
                result = runner.ProcessResult(0, '', payload=payload, error=None)
            except Exception as exc:
                result = runner.ProcessResult(1, str(exc), payload=None, error=str(exc))

            def done_callback():
                if result.returncode != 0 or result.error:
                    ui.show_status('PairOfCleats: API map failed; falling back to CLI.')
                    run_cli()
                    return
                on_done(result)

            sublime.set_timeout(done_callback, 0)

        thread = threading.Thread(target=worker)
        thread.daemon = True
        thread.start()

    if api_url:
        run_api()
    else:
        run_cli()


def _run_with_options(window, scope, focus, map_type=None, map_format=None, path_hint=None):
    settings = config.get_settings(window)
    if not settings.get('map_prompt_options'):
        _dispatch_map(window, scope, focus, map_type=map_type, map_format=map_format, path_hint=path_hint)
        return

    def after_type(selected_type):
        def after_format(selected_format):
            _dispatch_map(window, scope, focus, map_type=selected_type, map_format=selected_format, path_hint=path_hint)
        _prompt_map_format(window, settings, after_format)

    _prompt_map_type(window, settings, after_type)


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
        if not folder and self.window.folders():
            folder = self.window.folders()[0]
        repo_root, reason = _resolve_repo_root(self.window, path_hint=folder)
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
        repo_root, reason = _resolve_repo_root(self.window, path_hint=view.file_name())
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
        repo_root, reason = _resolve_repo_root(self.view.window(), path_hint=file_name)
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
            label = node.get('label') or node.get('id')
            detail = node.get('file') or ''
            items.append([label, detail])

        repo_root, reason = _resolve_repo_root(self.window)
        if not repo_root:
            ui.show_error('PairOfCleats: {0}'.format(reason))
            return

        def on_select(index):
            if index < 0:
                return
            node = nodes[index]
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
        path_value = state.get('outPath')
        if not path_value:
            ui.show_status('PairOfCleats: no map output yet.')
            return
        format_value = state.get('format') or ''
        if format_value in ('html', 'html-iso', 'svg'):
            _open_in_browser(path_value)
        else:
            self.window.open_file(path_value)
