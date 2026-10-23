"""Saved-source native adapter for the canonical tooling navigate owner."""
import sublime

from . import config, operations, paths, results, runner, ui
from .source_authority import read_current_source, read_verified_source, source_cursor_position

_QUALIFIED_NAVIGATION = {}


def _copy_navigation_data(value, depth=0):
    """Only ordinary decoded data; copying cannot invoke object copy hooks."""
    if depth > 64:
        raise ValueError('Navigation evidence exceeds the editor nesting admission.')
    if value is None or type(value) in (str, int, float, bool):
        return value
    if type(value) is dict:
        if any(type(key) is not str for key in value):
            raise ValueError('Navigation evidence requires original JSON object keys.')
        return {key: _copy_navigation_data(child, depth + 1) for key, child in value.items()}
    if type(value) is list:
        return [_copy_navigation_data(child, depth + 1) for child in value]
    raise ValueError('Navigation evidence requires original decoded JSON data.')


def _request_view_matches(view, window, captured, require_cursor=False):
    if (not view or not view.is_valid() or not view.window() or view.window().id() != window.id()
            or view.id() != captured['viewId'] or view.buffer_id() != captured['bufferId']
            or view.file_name() != captured['file'] or view.is_dirty()
            or str(view.change_count()) != captured['version']):
        return False
    selections = list(view.sel())
    return not require_cursor or bool(selections and selections[0].begin() == captured['point'])


def _qualified_navigation_packet(window, repo_root):
    captured = _QUALIFIED_NAVIGATION.get(window.id())
    view = window.active_view()
    if (not captured or not operations.is_current(captured['scope'])
            or captured['root'] != repo_root or not _request_view_matches(view, window, captured, require_cursor=True)):
        return None
    try:
        source = read_verified_source(repo_root, captured['file'], captured['payload'].get('sourceHash'))
        if results.qualified_source_buffer(source['sourceText'], view.substr(sublime.Region(0, view.size()))) is None:
            return None
    except (ValueError, OSError, UnicodeError):
        return None
    return captured['payload']


def qualified_navigation_evidence(window, repo_root):
    # Consumers may retain or annotate their packet. Those edits cannot replace
    # the private original cursor-binding/source evidence cached by this owner.
    payload = _qualified_navigation_packet(window, repo_root)
    return _copy_navigation_data(payload) if payload is not None else None



def execute_qualified_navigation(view, query, kind, on_hits, limit, title, include_declaration=True,
                                  on_evidence=None, operation_scope=None):
    if not view or not view.is_valid() or not view.window():
        return
    window = view.window()
    scope = operation_scope or operations.capture(window, key='navigation')
    def failed(message):
        if not operations.is_current(scope):
            return
        if callable(on_evidence):
            ui.show_status(message)
            on_evidence(None, None)
        else:
            ui.show_error(message)
    if view.is_dirty():
        failed('PairOfCleats: save the source before indexed navigation. Related Search remains approximate.')
        return
    file_name = view.file_name()
    repo_root, reason = paths.resolve_repo_root(window, return_reason=True, path_hint=file_name)
    if not repo_root:
        failed(reason)
        return
    settings = config.get_settings(window)
    execution = config.resolve_execution_mode(settings, 'navigation')
    if execution.get('error'):
        failed(execution['error'])
        return
    errors = config.validate_settings(settings, repo_root, workflow='navigation')
    if errors:
        failed('PairOfCleats settings need attention:\n- ' + '\n- '.join(errors))
        return
    try:
        source = read_current_source(repo_root, file_name)
        disk = source['sourceText']
    except (ValueError, OSError, UnicodeError) as error:
        failed('PairOfCleats: source bytes could not be qualified: ' + str(error))
        return
    text = view.substr(sublime.Region(0, view.size()))
    normalization = results.qualified_source_buffer(disk, text)
    if normalization is None:
        failed('PairOfCleats: source buffer differs from disk. Save before indexed navigation.')
        return
    selections = list(view.sel())
    if not selections:
        failed('PairOfCleats: no current source cursor is available.')
        return
    point = selections[0].begin()
    try:
        line, column = source_cursor_position(disk, text, point)
    except (ValueError, UnicodeError) as error:
        failed('PairOfCleats: source cursor could not be qualified: ' + str(error))
        return
    source_hash = source['sourceHash']
    version = str(view.change_count())
    captured = {'scope': scope, 'root': repo_root, 'file': file_name, 'version': version, 'point': point,
                'viewId': view.id(), 'bufferId': view.buffer_id()}
    def source_current(require_cursor=False):
        if (not operations.is_current(scope) or _QUALIFIED_NAVIGATION.get(window.id()) is not captured
                or not _request_view_matches(view, window, captured, require_cursor=require_cursor)
                or require_cursor and not _request_view_matches(window.active_view(), window, captured, require_cursor=True)):
            return False
        try:
            verified = read_verified_source(repo_root, file_name, source_hash)
            return results.qualified_source_buffer(verified['sourceText'], view.substr(sublime.Region(0, view.size()))) is not None
        except (ValueError, OSError, UnicodeError):
            return False
    args = ['tooling', 'navigate', '--json', '--repo', repo_root, '--kind', kind,
            '--top', str(limit), '--file', file_name, '--symbol', query,
            '--source-hash', source_hash, '--source-version', version,
            '--line', str(line), '--column', str(column), '--coordinate-unit', 'utf16',
            '--include-declaration', str(bool(include_declaration)).lower()]
    def done(result):
        if not operations.is_current(scope) or not _request_view_matches(view, window, captured, require_cursor=True):
            return
        if result.error or result.returncode != 0:
            failed(result.error or 'Indexed navigation did not complete. Inspect its task diagnostics.')
            return
        payload = result.payload
        if not isinstance(payload, dict):
            failed('PairOfCleats: indexed navigation returned an invalid response.')
            return
        try:
            payload = _copy_navigation_data(payload)
        except ValueError as error:
            failed('PairOfCleats: ' + str(error))
            return
        if not operations.is_current(scope) or not _request_view_matches(view, window, captured, require_cursor=True):
            return
        if (payload.get('sourceHash') != source_hash or payload.get('sourceVersion') != version
                or payload.get('coordinateUnit') != 'utf16'):
            failed('PairOfCleats: navigation did not retain the requested source identity/version.')
            return
        captured['payload'] = payload
        _QUALIFIED_NAVIGATION[window.id()] = captured
        if _qualified_navigation_packet(window, repo_root) is None:
            failed('PairOfCleats: the saved source or cursor changed before indexed navigation completed.')
            return
        if callable(on_evidence):
            on_evidence(_copy_navigation_data(payload), repo_root)
            return
        if payload.get('status') == 'ambiguous' and (payload.get('binding') or {}).get('candidates'):
            candidates = payload['binding']['candidates']
            def chosen(index):
                if index < 0 or index >= len(candidates) or not source_current(require_cursor=True):
                    return
                candidate = candidates[index]
                from ..commands import semantic
                state = {'context': {'root': repo_root, 'scope': scope}, 'payload': {'sourceRefs': [
                    dict(candidate, path=candidate.get('file'))]}}
                try:
                    opened = semantic.open_source(window, state,
                        {'ref': candidate.get('ref'), 'span': candidate.get('span')}, request_current=source_current)
                    if opened is not None and source_current():
                        ui.show_status('PairOfCleats: candidate evidence opened; binding remains ambiguous and references were not pooled.')
                except (ValueError, OSError, UnicodeError) as error:
                    ui.show_error(str(error))
            window.show_quick_panel([[candidate.get('targetId'), candidate.get('file') or 'external source',
                'Inspect one candidate; binding remains ambiguous'] for candidate in candidates], chosen)
            return
        if payload.get('status') not in ('resolved', 'partial') or (payload.get('binding') or {}).get('status') == 'ambiguous':
            ui.write_output_panel(window, 'pairofcleats-navigation',
                                  'Indexed navigation: {0}\n{1}\nUse Related Search for approximate matches.'.format(
                                      payload.get('status', 'unqualified'), payload.get('message', '')))
            return
        if payload.get('status') == 'partial':
            ui.show_status('PairOfCleats: partial indexed navigation; missing occurrences remain unknown.')
        hits = [dict(row, section='indexed-' + kind + '-' + payload.get('status', 'unknown')) for row in payload.get('results', []) if row.get('coordinateUnit') == 'utf16'
                and isinstance(row.get('sourceHash'), str) and len(row['sourceHash']) == 64]
        on_hits(_copy_navigation_data(hits), repo_root, {'navigation_current': lambda: source_current(require_cursor=True),
                                'navigation_source_current': source_current})
    cli = paths.resolve_cli(settings, repo_root)
    runner.run_process(cli['command'], list(cli.get('args_prefix') or []) + args,
                       cwd=repo_root, env=config.build_env(settings), window=window, title=title,
                       capture_json=True, on_done=done, stream_output=False, timeout_ms=5000,
                       operation_scope=scope)

