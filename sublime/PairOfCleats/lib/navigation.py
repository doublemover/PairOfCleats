"""Saved-source native adapter for the canonical tooling navigate owner."""
import hashlib

import sublime

from . import config, operations, paths, results, runner, ui

_QUALIFIED_NAVIGATION = {}


def qualified_navigation_evidence(window, repo_root):
    captured = _QUALIFIED_NAVIGATION.get(window.id())
    view = window.active_view()
    if (not captured or not view or not operations.is_current(captured['scope'])
            or captured['root'] != repo_root or view.file_name() != captured['file']
            or view.is_dirty() or str(view.change_count()) != captured['version']
            or not list(view.sel()) or view.sel()[0].begin() != captured['point']):
        return None
    try:
        with open(captured['file'], 'rb') as handle:
            raw = handle.read(4194305)
        if (len(raw) > 4194304 or hashlib.sha256(raw).hexdigest() != captured['payload'].get('sourceHash')
                or results.qualified_source_buffer(raw.decode('utf-8'), view.substr(sublime.Region(0, view.size()))) is None):
            return None
    except (OSError, UnicodeError):
        return None
    return captured['payload']



def execute_qualified_navigation(view, query, kind, on_hits, limit, title, include_declaration=True,
                                  on_evidence=None, operation_scope=None):
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
        with open(file_name, 'rb') as handle:
            raw = handle.read(4 * 1024 * 1024 + 1)
        disk = raw.decode('utf-8')
    except (OSError, UnicodeError) as error:
        failed('PairOfCleats: source bytes could not be qualified: ' + str(error))
        return
    if len(raw) > 4 * 1024 * 1024:
        failed('PairOfCleats: source exceeds the bounded navigation verifier.')
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
    row, _column = view.rowcol(point)
    prefix = view.substr(sublime.Region(view.text_point(row, 0), point))
    column = len(prefix.encode('utf-16-le')) // 2
    if row == 0 and normalization['removedBom']:
        column += 1
    source_hash = hashlib.sha256(raw).hexdigest()
    version = str(view.change_count())
    args = ['tooling', 'navigate', '--json', '--repo', repo_root, '--kind', kind,
            '--top', str(limit), '--file', file_name, '--symbol', query,
            '--source-hash', source_hash, '--source-version', version,
            '--line', str(row + 1), '--column', str(column + 1), '--coordinate-unit', 'utf16',
            '--include-declaration', str(bool(include_declaration)).lower()]
    def done(result):
        if not operations.is_current(scope) or view.change_count() != int(version) or view.is_dirty():
            return
        if result.error or result.returncode != 0:
            failed(result.error or 'Indexed navigation did not complete. Inspect its task diagnostics.')
            return
        payload = result.payload or {}
        if (payload.get('sourceHash') != source_hash or payload.get('sourceVersion') != version
                or payload.get('coordinateUnit') != 'utf16'):
            failed('PairOfCleats: navigation did not retain the requested source identity/version.')
            return
        _QUALIFIED_NAVIGATION[window.id()] = {'payload': payload, 'scope': scope, 'root': repo_root,
            'file': file_name, 'version': version, 'point': point}
        if callable(on_evidence):
            on_evidence(payload, repo_root)
            return
        if payload.get('status') == 'ambiguous' and (payload.get('binding') or {}).get('candidates'):
            candidates = payload['binding']['candidates']
            def chosen(index):
                if index < 0 or not operations.is_current(scope):
                    return
                candidate = candidates[index]
                from ..commands import semantic
                state = {'context': {'root': repo_root}, 'payload': {'sourceRefs': [
                    dict(candidate, path=candidate.get('file'))]}}
                try:
                    semantic.open_source(window, state, {'ref': candidate.get('ref'), 'span': candidate.get('span')})
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
        on_hits(hits, repo_root, {})
    cli = paths.resolve_cli(settings, repo_root)
    runner.run_process(cli['command'], list(cli.get('args_prefix') or []) + args,
                       cwd=repo_root, env=config.build_env(settings), window=window, title=title,
                       capture_json=True, on_done=done, stream_output=False, timeout_ms=5000,
                       operation_scope=scope)

