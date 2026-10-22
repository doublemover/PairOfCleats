import os
import hashlib
import uuid
import sublime
import sublime_plugin

from ..lib import api_client
from ..lib import config
from ..lib import history
from ..lib import paths
from ..lib import results
from ..lib import results_state
from ..lib import runner
from ..lib import search as search_lib
from ..lib import service_repository
from ..lib import tasks
from ..lib import operations
from ..lib import ui
from ..lib import views
from ..lib.saved_search import normalize_saved_options
from ..lib.completion_target import capture_target, target_is_current, apply_target

LIMIT_CHOICES = [10, 25, 50, 100, 200]


def _resolve_repo_root(window):
    return paths.resolve_repo_root(window, return_reason=True)


def _has_repo_root(window):
    resolution = paths.describe_repo_root(window)
    return bool(resolution.get('selected_root') or resolution.get('repo_roots'))


def _has_selection(view):
    return bool(views.extract_selection(view).strip()) if view else False


def _has_symbol(view):
    return bool(views.extract_symbol(view).strip()) if view else False


def _has_last_results(window):
    return results_state.get_last_results(window) is not None


def _has_last_explain(window):
    return results_state.get_last_explain(window) is not None


def _has_search_history(window):
    return bool(history.load_history(window))


def _has_last_query(window):
    return history.get_last_query(window) is not None


def _resolve_defaults(settings, overrides=None):
    overrides = overrides or {}
    saved_scope = overrides.get('scopeComplete') is True
    mode = overrides.get('mode') or settings.get('index_mode_default') or 'both'
    backend = overrides.get('backend') if saved_scope else overrides.get('backend') or settings.get('search_backend_default') or ''
    limit = overrides.get('limit') or settings.get('search_limit') or 25
    ann = overrides['ann'] if 'ann' in overrides else settings.get('search_ann_default')
    allow_sparse_fallback = overrides.get('allow_sparse_fallback')
    if allow_sparse_fallback is None:
        allow_sparse_fallback = bool(settings.get('search_allow_sparse_fallback'))
    as_of = overrides.get('as_of')
    snapshot = overrides.get('snapshot')
    if as_of is None and snapshot is None:
        as_of = settings.get('search_as_of_default') or ''
        snapshot = settings.get('search_snapshot_default') or ''
    filter_value = overrides.get('filter')
    advanced = {} if saved_scope else search_lib.normalize_advanced_search_defaults(settings.get('search_advanced_defaults'))
    if filter_value is None and not saved_scope:
        filter_value = settings.get('search_filter_default') or ''
    if filter_value:
        advanced['filter'] = str(filter_value)
    advanced.update(search_lib.normalize_advanced_search_defaults(overrides.get('advanced')))
    resolved = {
        'mode': mode,
        'backend': backend,
        'limit': limit,
        'ann': ann if isinstance(ann, bool) else None,
        'allow_sparse_fallback': bool(allow_sparse_fallback),
        'as_of': as_of or '',
        'snapshot': snapshot or '',
        'advanced': advanced,
    }
    if saved_scope:
        resolved.update({'repoRoot': overrides.get('repoRoot'), 'scopeComplete': True, 'schemaVersion': 1})
    return resolved


def _saved_scope_available(options):
    if not isinstance(options, dict):
        return True
    if options.get('scopeComplete') is False:
        ui.show_error('PairOfCleats: this legacy search has incomplete saved scope. Run a new search with explicit options.')
        return False
    root = options.get('repoRoot')
    if root and not os.path.isdir(root):
        ui.show_error('PairOfCleats: saved search repository is unavailable: {0}'.format(root))
        return False
    return True


def _search_transport_kwargs(resolved):
    return {
        'backend': resolved.get('backend') or None,
        'limit': resolved.get('limit'),
        'ann': resolved.get('ann'),
        'allow_sparse_fallback': resolved.get('allow_sparse_fallback'),
        'as_of': resolved.get('as_of') or None,
        'snapshot': resolved.get('snapshot') or None,
        'advanced': resolved.get('advanced'),
        'cursor': resolved.get('cursor'),
    }


def _resolve_results_target(settings, hit_count):
    target = settings.get('open_results_in') or 'quick_panel'
    threshold = settings.get('results_buffer_threshold')
    if target == 'quick_panel' and isinstance(threshold, int) and threshold > 0:
        if hit_count >= threshold:
            return 'output_panel'
    if target in ('quick_panel', 'new_tab', 'output_panel'):
        return target
    return 'quick_panel'


def _prompt_query(window, initial, on_done):
    window.show_input_panel(
        'PairOfCleats search query',
        initial or '',
        lambda value: on_done(value.strip()),
        None,
        None
    )


def _prompt_options(window, settings, defaults, on_done, force_prompt=False):
    if not force_prompt and not settings.get('search_prompt_options'):
        on_done(defaults)
        return

    options = dict(defaults)
    mode_choices = ['both'] + sorted(config.VALID_INDEX_MODES - {'both'})
    default_mode = options.get('mode')
    mode_index = mode_choices.index(default_mode) if default_mode in mode_choices else 2

    def on_mode_select(index):
        if index < 0:
            return
        options['mode'] = mode_choices[index]
        _prompt_backend(window, options, on_done)

    window.show_quick_panel(
        mode_choices,
        on_mode_select,
        selected_index=mode_index
    )


def _prompt_backend(window, options, on_done):
    backend_choices = [
        ('', 'auto'),
        ('memory', 'memory'),
        ('sqlite', 'sqlite'),
        ('sqlite-fts', 'sqlite-fts'),
        ('lmdb', 'lmdb'),
        ('tantivy', 'tantivy')
    ]
    labels = ['backend: {0}'.format(label) for _, label in backend_choices]
    current = options.get('backend') or ''
    current_index = 0
    for idx, (value, _) in enumerate(backend_choices):
        if value == current:
            current_index = idx
            break

    def on_backend_select(index):
        if index < 0:
            return
        options['backend'] = backend_choices[index][0]
        _prompt_ann(window, options, on_done)

    window.show_quick_panel(labels, on_backend_select, selected_index=current_index)


def _prompt_ann(window, options, on_done):
    ann_choices = [
        (None, 'ann: default'),
        (True, 'ann: on'),
        (False, 'ann: off'),
    ]
    current = options.get('ann')
    current_index = 0
    for idx, (value, _) in enumerate(ann_choices):
        if value is current:
            current_index = idx
            break

    def on_ann_select(index):
        if index < 0:
            return
        options['ann'] = ann_choices[index][0]
        _prompt_temporal(window, options, on_done)

    window.show_quick_panel(
        [label for _, label in ann_choices],
        on_ann_select,
        selected_index=current_index,
    )


def _prompt_temporal(window, options, on_done):
    current_as_of = options.get('as_of') or ''
    current_snapshot = options.get('snapshot') or ''
    items = []
    actions = []

    def add_action(label, callback):
        items.append(label)
        actions.append(callback)

    add_action('search current index', lambda: _set_temporal(options, '', '', on_done, window))
    if current_as_of:
        add_action('as-of: {0}'.format(current_as_of), lambda: _set_temporal(options, current_as_of, '', on_done, window))
    if current_snapshot:
        add_action('snapshot: {0}'.format(current_snapshot), lambda: _set_temporal(options, '', current_snapshot, on_done, window))
    add_action('as-of: custom', lambda: _prompt_as_of(window, options, on_done))
    add_action('snapshot: custom', lambda: _prompt_snapshot(window, options, on_done))

    def on_temporal_select(index):
        if index < 0:
            return
        actions[index]()

    window.show_quick_panel(items, on_temporal_select, selected_index=0)


def _set_temporal(options, as_of_value, snapshot_value, on_done, window):
    options['as_of'] = as_of_value
    options['snapshot'] = snapshot_value
    _prompt_limit(window, options, on_done)


def _prompt_as_of(window, options, on_done):
    current = options.get('as_of') or ''

    def on_done_input(value):
        options['as_of'] = value.strip()
        options['snapshot'] = ''
        _prompt_limit(window, options, on_done)

    window.show_input_panel(
        'PairOfCleats as-of selector',
        current,
        on_done_input,
        None,
        None,
    )


def _prompt_snapshot(window, options, on_done):
    current = options.get('snapshot') or ''

    def on_done_input(value):
        options['snapshot'] = value.strip()
        options['as_of'] = ''
        _prompt_limit(window, options, on_done)

    window.show_input_panel(
        'PairOfCleats snapshot id',
        current,
        on_done_input,
        None,
        None,
    )


def _prompt_limit(window, options, on_done):
    limit_default = options.get('limit')
    limit_values = []
    if isinstance(limit_default, int) and limit_default > 0:
        limit_values.append(limit_default)
    for value in LIMIT_CHOICES:
        if value not in limit_values:
            limit_values.append(value)

    choices = ['limit: {0}'.format(value) for value in limit_values]
    choices.append('limit: custom')

    def on_limit_select(index):
        if index < 0:
            return
        if index < len(limit_values):
            options['limit'] = limit_values[index]
            on_done(options)
            return

        def on_custom_done(value):
            value = value.strip()
            if not value:
                return
            try:
                parsed = int(value)
            except Exception:
                ui.show_error('Limit must be an integer.')
                return
            if parsed < 1:
                ui.show_error('Limit must be at least 1.')
                return
            options['limit'] = parsed
            on_done(options)

        window.show_input_panel(
            'PairOfCleats result limit',
            str(limit_default or ''),
            on_custom_done,
            None,
            None
        )

    window.show_quick_panel(choices, on_limit_select, selected_index=0)


def _execute_search(window, query, overrides=None, explain=False, enumeration=False, append_session=None, service_root=None):
    if not _saved_scope_available(overrides):
        return
    if not query and not enumeration:
        return
    scope = operations.capture(window, key='foreground-search')
    if not operations.is_current(scope):
        return

    settings = config.get_settings(window)
    saved_root = overrides.get('repoRoot') if isinstance(overrides, dict) else None
    repo_root, reason = (saved_root, None) if saved_root else _resolve_repo_root(window)
    if not repo_root:
        paths.resolve_repo_root_interactive(window, lambda chosen, why: (
            _execute_search(window, query, dict(overrides or {}, repoRoot=chosen), explain, enumeration, append_session)
            if chosen else ui.show_status('PairOfCleats: {0}'.format(why))))
        return
    if reason:
        ui.show_status('PairOfCleats: {0}'.format(reason))

    errors = config.validate_settings(settings, repo_root, workflow='search-explain' if explain else 'search')
    if errors:
        message = 'PairOfCleats settings need attention:\n- {0}'.format(
            '\n- '.join(errors)
        )
        ui.show_error(message)
        return

    resolved = _resolve_defaults(settings, overrides)
    resolved = normalize_saved_options(resolved, repo_root)
    if enumeration and not search_lib.has_effective_filter(resolved.get('advanced')):
        ui.show_error('PairOfCleats: indexed browsing requires an effective filter.')
        return
    if isinstance(overrides, dict) and overrides.get('cursor'):
        resolved['cursor'] = overrides['cursor']
    option_errors = search_lib.validate_search_options(resolved)
    if option_errors:
        ui.show_error('PairOfCleats search options need attention:\n- ' + '\n- '.join(option_errors))
        return
    execution = config.resolve_execution_mode(settings, 'search-explain' if explain else 'search')
    if execution.get('error'):
        ui.show_error(execution['error'])
        return

    if append_session and append_session.get('transport') != execution.get('mode'):
        ui.show_error('PairOfCleats: transport changed. Restart indexed browsing with the intended transport.')
        return
    if append_session and service_root and append_session.get('serviceRoot') != service_root:
        ui.show_error('PairOfCleats: service repository mapping changed. Restart indexed browsing.')
        return
    if execution.get('mode') == 'api' and not service_root:
        service_repository.resolve(window, settings, repo_root, lambda selected: _execute_search(
            window, query, overrides, explain, enumeration, append_session, selected))
        return

    def handle_payload(result):
        if not operations.is_current(scope):
            return
        if result.returncode != 0:
            message = result.output.strip() or 'PairOfCleats search failed.'
            ui.show_error(message)
            return
        if result.error:
            ui.show_error(result.error)
            return
        payload = result.payload
        if not isinstance(payload, dict):
            ui.show_error('PairOfCleats search returned invalid JSON.')
            return
        if payload.get('ok') is False:
            ui.show_error(payload.get('message') or 'PairOfCleats search failed.')
            return

        actual_transport = 'api' if getattr(result, 'transport', None) == 'api' else 'cli'
        if append_session and append_session.get('transport') != actual_transport:
            ui.show_error('PairOfCleats: continuation transport changed. Restart indexed browsing.')
            return
        if service_root and actual_transport == 'api':
            try:
                payload = service_repository.map_payload(payload, service_root)
            except ValueError as error:
                ui.show_error(str(error))
                return
        hits = results.collect_hits(payload)
        pagination = payload.get('pagination')
        if append_session:
            previous = append_session.get('pagination') or {}
            current = results_state.get_last_results(window)
            if not current or current.get('sessionId') != append_session.get('sessionId'):
                return
            if not isinstance(pagination, dict) or previous.get('generation') != pagination.get('generation'):
                ui.show_error('PairOfCleats: indexed generation changed. Restart Browse Indexed Matches.')
                return
            previous_hits = append_session.get('hits') or []
            def identity(hit):
                value = hit.get('chunkUid') or hit.get('id')
                return (hit.get('section'), str(value)) if value is not None and value != '' else None
            seen = set(identity(hit) for hit in previous_hits if identity(hit) is not None)
            merged = list(previous_hits)
            for hit in hits:
                key = identity(hit)
                if key is None or key not in seen:
                    merged.append(hit)
                    if key is not None:
                        seen.add(key)
            hits = merged
            if len(hits) > 2000:
                ui.show_error('PairOfCleats: view reached its 2,000 hit bound. Narrow filters and restart.')
                return
        history_limit = settings.get('history_limit')
        if query:
            history.record_query(window, query, resolved, history_limit)

        if explain:
            session = results.build_session(
                query,
                resolved,
                repo_root,
                hits,
                'output_panel',
                explain=True,
            )
            results_state.record_last_explain(window, session)
            results.open_output_panel(
                window,
                session.get('text') or results.format_explain_text(hits),
                explain=True,
                session=session,
            )
            return

        if not hits and not enumeration:
            ui.show_status('PairOfCleats: no results.')
            return

        target = _resolve_results_target(settings, len(hits))
        session = results.build_session(query, resolved, repo_root, hits, target)
        session['pagination'] = pagination if isinstance(pagination, dict) else None
        session['transport'] = actual_transport
        session['serviceRoot'] = service_root if actual_transport == 'api' else None
        session['sessionId'] = append_session.get('sessionId') if append_session else str(uuid.uuid4())
        if isinstance(pagination, dict):
            ui.show_status('PairOfCleats: {0} loaded / {1} indexed matches; more={2}.'.format(
                len(hits), pagination.get('total', 'unknown'), pagination.get('hasMore', False)))
        results_state.record_last_results(window, session)
        if target == 'output_panel':
            results.open_output_panel(
                window,
                session.get('text') or results.format_results_text(hits),
                session=session,
            )
            return
        if target == 'new_tab':
            results.open_results_view(
                window,
                session.get('text') or results.format_results_text(hits),
                session=session,
            )
            return

        items = [results.format_quick_panel_item(hit) for hit in hits]

        def on_select(index):
            if index < 0 or not operations.is_current(scope):
                return
            results.open_hit(window, hits[index], repo_root)

        window.show_quick_panel(items, on_select)

    if execution.get('mode') == 'api':
        ui.show_status('PairOfCleats: searching via API...')
        task = tasks.start_task(
            window,
            'PairOfCleats search',
            kind='search',
            repo_root=repo_root,
            cancellable=False,
            details='Searching via API...',
            show_panel=bool(settings.get('progress_panel_on_start', True)),
        )

        def on_api_done(result):
            if not operations.is_current(scope):
                return
            if result.error:
                tasks.complete_task(window, task, status='failed', details=result.error)
                if execution.get('allow_fallback'):
                    ui.show_status('PairOfCleats: API search failed; falling back to CLI.')
                    _execute_search_cli(window, query, repo_root, settings, resolved, explain, handle_payload, scope=scope)
                    return
                ui.show_error(result.error)
                return
            tasks.complete_task(window, task, status='done', details='Search completed via API.')
            handle_payload(_ApiProcessResult(result.payload))

        api_client.run_async(
            lambda: api_client.search_json(
                execution.get('base_url'),
                service_root or repo_root,
                settings,
                query,
                resolved.get('mode'),
                **_search_transport_kwargs(resolved)
            ),
            on_api_done,
            on_progress=lambda message: tasks.note_progress(window, task, details=message),
            window=window,
            scope=scope,
            task=task,
        )
        return

    ui.show_status('PairOfCleats: searching...')
    _execute_search_cli(window, query, repo_root, settings, resolved, explain, handle_payload, scope=scope)


class _ApiProcessResult(object):
    def __init__(self, payload):
        self.returncode = 0
        self.output = ''
        self.error = None
        self.payload = payload
        self.transport = 'api'


def _execute_search_cli(window, query, repo_root, settings, resolved, explain, on_done, scope=None):
    args = search_lib.build_search_args(
        query,
        repo_root=repo_root,
        mode=resolved.get('mode'),
        explain=explain,
        **_search_transport_kwargs(resolved)
    )
    cli = paths.resolve_cli(settings, repo_root)
    command = cli['command']
    full_args = list(cli.get('args_prefix') or []) + args
    env = config.build_env(settings)
    return runner.run_process(
        command,
        full_args,
        cwd=repo_root,
        env=env,
        window=window,
        title='PairOfCleats search',
        capture_json=True,
        on_done=on_done,
        stream_output=False,
        operation_scope=scope,
    )


def _execute_symbol_lookup(window, query, on_hits, limit=25, title='PairOfCleats symbol lookup', service_root=None):
    if not query:
        return

    settings = config.get_settings(window)
    repo_root, reason = _resolve_repo_root(window)
    if not repo_root:
        ui.show_error('PairOfCleats: {0}'.format(reason))
        return
    if reason:
        ui.show_status('PairOfCleats: {0}'.format(reason))

    errors = config.validate_settings(settings, repo_root, workflow='search-symbol')
    if errors:
        message = 'PairOfCleats settings need attention:\n- {0}'.format(
            '\n- '.join(errors)
        )
        ui.show_error(message)
        return

    resolved = _resolve_defaults(settings, {
        'mode': 'code',
        'limit': limit,
        'as_of': '',
        'snapshot': '',
    })
    execution = config.resolve_execution_mode(settings, 'search-symbol')
    if execution.get('error'):
        ui.show_error(execution['error'])
        return

    if execution.get('mode') == 'api' and not service_root:
        service_repository.resolve(window, settings, repo_root, lambda selected: _execute_symbol_lookup(
            window, query, on_hits, limit, title, selected))
        return

    def on_done(result):
        if result.returncode != 0:
            message = result.output.strip() or '{0} failed.'.format(title)
            ui.show_error(message)
            return
        if result.error:
            ui.show_error(result.error)
            return
        payload = result.payload
        if not isinstance(payload, dict):
            ui.show_error('{0} returned invalid JSON.'.format(title))
            return
        if payload.get('ok') is False:
            ui.show_error(payload.get('message') or '{0} failed.'.format(title))
            return
        if service_root and getattr(result, 'transport', None) == 'api':
            try:
                payload = service_repository.map_payload(payload, service_root)
            except ValueError as error:
                ui.show_error(str(error))
                return
        hits = [hit for hit in results.collect_hits(payload) if hit.get('section') == 'code']
        on_hits(hits, repo_root, resolved)

    if execution.get('mode') == 'api':
        task = tasks.start_task(
            window,
            title,
            kind='search',
            repo_root=repo_root,
            cancellable=False,
            details='Symbol lookup via API...',
            show_panel=bool(settings.get('progress_panel_on_start', True)),
        )
        def on_api_done(result):
            if result.error:
                tasks.complete_task(window, task, status='failed', details=result.error)
                if execution.get('allow_fallback'):
                    _execute_symbol_lookup_cli(window, query, repo_root, settings, resolved, title, on_done)
                    return
                ui.show_error(result.error)
                return
            tasks.complete_task(window, task, status='done', details='Symbol lookup completed via API.')
            on_done(_ApiProcessResult(result.payload))

        api_client.run_async(
            lambda: api_client.search_json(
                execution.get('base_url'),
                service_root or repo_root,
                settings,
                query,
                'code',
                **_search_transport_kwargs(resolved)
            ),
            on_api_done,
            on_progress=lambda message: tasks.note_progress(window, task, details=message),
            window=window,
            task=task,
        )
        return

    _execute_symbol_lookup_cli(window, query, repo_root, settings, resolved, title, on_done)


def _execute_symbol_lookup_cli(window, query, repo_root, settings, resolved, title, on_done):
    args = search_lib.build_search_args(
        query,
        repo_root=repo_root,
        mode='code',
        explain=False,
        **_search_transport_kwargs(resolved)
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
        title=title,
        capture_json=True,
        on_done=on_done,
        stream_output=False
    )


def _show_symbol_hit_picker(window, hits, repo_root):
    items = [results.format_quick_panel_item(hit) for hit in hits]

    def on_select(index):
        if index < 0:
            return
        results.open_hit(window, hits[index], repo_root)

    window.show_quick_panel(items, on_select)


def _has_file_symbol(view):
    return bool(view and view.file_name() and _has_symbol(view))


def _has_active_file(view):
    return bool(view and view.file_name())


class _FileSymbolLookupMixin(object):
    lookup_limit = 25
    lookup_title = 'PairOfCleats symbol lookup'

    def is_enabled(self):
        return _has_file_symbol(self.view)

    def is_visible(self):
        return _has_active_file(self.view)

    def run(self, edit):
        query = views.extract_symbol(self.view)
        if not query:
            ui.show_status('PairOfCleats: no symbol under cursor.')
            return

        def on_hits(hits, repo_root, resolved):
            self.handle_symbol_hits(query, hits, repo_root, resolved)

        _execute_qualified_navigation(self.view, query, self.lookup_kind, on_hits,
                                      self.lookup_limit, self.lookup_title)

    def handle_symbol_hits(self, query, hits, repo_root, resolved):
        raise NotImplementedError()


def _execute_qualified_navigation(view, query, kind, on_hits, limit, title, include_declaration=True):
    window = view.window()
    if view.is_dirty():
        ui.show_error('PairOfCleats: save the source before indexed navigation. Related Search remains approximate.')
        return
    file_name = view.file_name()
    repo_root, reason = paths.resolve_repo_root(window, return_reason=True, path_hint=file_name)
    if not repo_root:
        ui.show_error(reason)
        return
    settings = config.get_settings(window)
    execution = config.resolve_execution_mode(settings, 'navigation')
    if execution.get('error'):
        ui.show_error(execution['error'])
        return
    errors = config.validate_settings(settings, repo_root, workflow='navigation')
    if errors:
        ui.show_error('PairOfCleats settings need attention:\n- ' + '\n- '.join(errors))
        return
    with open(file_name, 'rb') as handle:
        raw = handle.read(4 * 1024 * 1024 + 1)
    if len(raw) > 4 * 1024 * 1024:
        ui.show_error('PairOfCleats: source exceeds the bounded navigation verifier.')
        return
    text = view.substr(sublime.Region(0, view.size()))
    disk = raw.decode('utf-8')
    if text != disk and not (disk.startswith('\ufeff') and text == disk[1:]):
        ui.show_error('PairOfCleats: source buffer differs from disk. Save before indexed navigation.')
        return
    selections = list(view.sel())
    if not selections:
        return
    point = selections[0].begin()
    row, _column = view.rowcol(point)
    prefix = view.substr(sublime.Region(view.text_point(row, 0), point))
    column = len(prefix.encode('utf-16-le')) // 2
    source_hash = hashlib.sha256(raw).hexdigest()
    version = str(view.change_count())
    args = ['tooling', 'navigate', '--json', '--repo', repo_root, '--kind', kind,
            '--top', str(limit), '--file', file_name, '--symbol', query,
            '--source-hash', source_hash, '--source-version', version,
            '--line', str(row + 1), '--column', str(column + 1), '--coordinate-unit', 'utf16',
            '--include-declaration', str(bool(include_declaration)).lower()]
    scope = operations.capture(window, key='navigation')
    def done(result):
        if not operations.is_current(scope) or view.change_count() != int(version) or view.is_dirty():
            return
        if result.error or result.returncode != 0:
            ui.show_error(result.error or result.output or 'Indexed navigation failed.')
            return
        payload = result.payload or {}
        if payload.get('status') == 'ambiguous' and (payload.get('binding') or {}).get('candidates'):
            candidates = payload['binding']['candidates']
            def chosen(index):
                if index < 0 or not operations.is_current(scope):
                    return
                candidate = candidates[index]
                from . import semantic
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


def _rank_definition_hits(hits, query):
    normalized_query = (query or '').strip()
    lowered_query = normalized_query.lower()

    def key(hit):
        symbol_name = (hit.get('name') or hit.get('symbol') or '').strip()
        headline = (hit.get('headline') or '').strip()
        exact = int(symbol_name == normalized_query)
        exact_ci = int(symbol_name.lower() == lowered_query if symbol_name else False)
        headline_ci = int(headline.lower() == lowered_query if headline else False)
        line = hit.get('startLine') or 0
        return (-exact, -exact_ci, -headline_ci, line, hit.get('file') or '')

    return sorted(hits, key=key)


def _resolve_completion_text(hit):
    value = hit.get('name') or hit.get('symbol') or hit.get('headline') or ''
    return value.strip() if isinstance(value, str) else ''


def _search_with_query(window, query, overrides=None, force_prompt=False):
    if not _saved_scope_available(overrides):
        return
    if not query:
        ui.show_status('PairOfCleats: empty query.')
        return
    settings = config.get_settings(window)
    defaults = _resolve_defaults(settings, overrides)

    def after_options(options):
        _execute_search(window, query, options)

    _prompt_options(window, settings, defaults, after_options, force_prompt=force_prompt)


def _search_with_prompt(window, overrides=None, force_prompt=False):
    settings = config.get_settings(window)
    defaults = _resolve_defaults(settings, overrides)
    last = history.get_last_query(window)
    initial = last.get('query') if isinstance(last, dict) else ''

    def on_query(value):
        if not value:
            return
        def after_options(options):
            _execute_search(window, value, options)
        _prompt_options(window, settings, defaults, after_options, force_prompt=force_prompt)

    _prompt_query(window, initial, on_query)


class PairOfCleatsSearchCommand(sublime_plugin.WindowCommand):
    def is_enabled(self):
        return _has_repo_root(self.window)

    def is_visible(self):
        return True

    def run(self, query=None):
        if query:
            _search_with_query(self.window, query)
            return
        _search_with_prompt(self.window)


class PairOfCleatsSearchWithOptionsCommand(sublime_plugin.WindowCommand):       
    def is_enabled(self):
        return _has_repo_root(self.window)

    def is_visible(self):
        return True

    def run(self, query=None):
        if query:
            _search_with_query(self.window, query, force_prompt=True)
            return
        _search_with_prompt(self.window, force_prompt=True)


class PairOfCleatsSearchSelectionCommand(sublime_plugin.TextCommand):
    def is_enabled(self):
        return _has_selection(self.view)

    def is_visible(self):
        return bool(self.view)

    def run(self, edit):
        query = views.extract_selection(self.view)
        if not query:
            ui.show_status('PairOfCleats: no selection to search.')
            return
        _search_with_query(self.view.window(), query)


class PairOfCleatsSearchSymbolUnderCursorCommand(sublime_plugin.TextCommand):   
    def is_enabled(self):
        return _has_symbol(self.view)

    def is_visible(self):
        return bool(self.view)

    def run(self, edit):
        query = views.extract_symbol(self.view)
        if not query:
            ui.show_status('PairOfCleats: no symbol under cursor.')
            return
        _search_with_query(self.view.window(), query)


class PairOfCleatsGotoDefinitionCommand(_FileSymbolLookupMixin, sublime_plugin.TextCommand):
    lookup_kind = 'definitions'
    lookup_limit = 25
    lookup_title = 'PairOfCleats goto definition'

    def handle_symbol_hits(self, query, hits, repo_root, _resolved):
        if not hits:
            ui.show_status('PairOfCleats: no indexed definitions found.')
            return
        ranked = hits
        if len(ranked) == 1:
            results.open_hit(self.view.window(), ranked[0], repo_root)
            return
        _show_symbol_hit_picker(self.view.window(), ranked, repo_root)


class PairOfCleatsFindReferencesCommand(_FileSymbolLookupMixin, sublime_plugin.TextCommand):
    lookup_kind = 'references'
    lookup_limit = 50
    lookup_title = 'PairOfCleats find references'

    def handle_symbol_hits(self, _query, hits, repo_root, _resolved):
        if not hits:
            ui.show_status('PairOfCleats: no indexed references found.')
            return
        _show_symbol_hit_picker(self.view.window(), hits, repo_root)


class PairOfCleatsCompleteSymbolCommand(sublime_plugin.TextCommand):
    def is_enabled(self):
        return bool(self.view and _has_symbol(self.view))

    def is_visible(self):
        return bool(self.view)

    def run(self, edit):
        query = views.extract_symbol(self.view)
        if not query:
            ui.show_status('PairOfCleats: no symbol prefix under cursor.')
            return
        target = capture_target(self.view)
        if target is None:
            return

        def on_hits(hits, _repo_root, _resolved):
            if not target_is_current(self.view, target) or not self.view.window():
                return
            if not hits:
                ui.show_status('PairOfCleats: no indexed completions found.')
                return
            seen = set()
            candidates = []
            for hit in hits:
                text = _resolve_completion_text(hit)
                if not text or text in seen:
                    continue
                seen.add(text)
                candidates.append((text, hit))
            if not candidates:
                ui.show_status('PairOfCleats: no indexed completions found.')
                return
            items = [results.format_quick_panel_item(hit) for _, hit in candidates]

            def on_select(index):
                if index < 0 or index >= len(candidates) or not target_is_current(self.view, target):
                    return
                self.view.run_command(
                    'pair_of_cleats_apply_completion',
                    {'text': candidates[index][0], 'target': target},
                )

            self.view.window().show_quick_panel(items, on_select)

        _execute_symbol_lookup(
            self.view.window(),
            query,
            on_hits,
            limit=50,
            title='PairOfCleats symbol completion',
        )


class PairOfCleatsApplyCompletionCommand(sublime_plugin.TextCommand):
    def is_enabled(self):
        return bool(self.view)

    def is_visible(self):
        return False

    def run(self, edit, text='', target=None):
        if not apply_target(self.view, edit, text, target):
            ui.show_status('PairOfCleats: completion target changed; request a new completion.')


class PairOfCleatsSearchHistoryCommand(sublime_plugin.WindowCommand):
    def is_enabled(self):
        return _has_repo_root(self.window) and _has_search_history(self.window)

    def is_visible(self):
        return True

    def run(self):
        entries = history.load_history(self.window)
        if not entries:
            ui.show_status('PairOfCleats: no history yet.')
            return

        items = []
        for entry in entries:
            query = entry.get('query') or ''
            mode = entry.get('mode') or 'both'
            backend = entry.get('backend') or 'auto'
            limit = entry.get('limit') or ''
            detail = 'mode {0} | backend {1} | limit {2}'.format(mode, backend, limit)
            items.append([query, detail])

        def on_select(index):
            if index < 0:
                return
            entry = entries[index]
            _execute_search(self.window, entry.get('query'), entry)

        self.window.show_quick_panel(items, on_select)


class PairOfCleatsRepeatLastSearchCommand(sublime_plugin.WindowCommand):        
    def is_enabled(self):
        return _has_repo_root(self.window) and _has_last_query(self.window)

    def is_visible(self):
        return True

    def run(self):
        entry = history.get_last_query(self.window)
        if not entry:
            ui.show_status('PairOfCleats: no previous search to repeat.')       
            return
        _execute_search(self.window, entry.get('query'), entry)


class PairOfCleatsExplainSearchCommand(sublime_plugin.WindowCommand):
    def is_enabled(self):
        return _has_repo_root(self.window)

    def is_visible(self):
        return True

    def run(self):
        entry = history.get_last_query(self.window)
        if entry and entry.get('query'):
            _execute_search(self.window, entry.get('query'), entry, explain=True)
            return

        def on_query(value):
            if not value:
                return
            _execute_search(self.window, value, explain=True)

        _prompt_query(self.window, '', on_query)


class PairOfCleatsReopenLastResultsCommand(sublime_plugin.WindowCommand):
    def is_enabled(self):
        return _has_last_results(self.window)

    def is_visible(self):
        return self.is_enabled()

    def run(self):
        session = results_state.get_last_results(self.window)
        if not session:
            ui.show_status('PairOfCleats: no previous results to reopen.')
            return
        results.reopen_session(self.window, session)


class PairOfCleatsReopenLastExplainCommand(sublime_plugin.WindowCommand):
    def is_enabled(self):
        return _has_last_explain(self.window)

    def is_visible(self):
        return self.is_enabled()

    def run(self):
        session = results_state.get_last_explain(self.window)
        if not session:
            ui.show_status('PairOfCleats: no previous explain output to reopen.')
            return
        results.reopen_session(self.window, session)


class PairOfCleatsResultActionsCommand(sublime_plugin.WindowCommand):
    def is_enabled(self):
        return _has_last_results(self.window)

    def is_visible(self):
        return self.is_enabled()

    def run(self, source='results', hit_index=None, action=None):
        session = _load_action_session(self.window, source)
        if not session:
            ui.show_status('PairOfCleats: no stored results for actions.')
            return
        hits = results.collect_hits_from_session(session)
        if not hits:
            ui.show_status('PairOfCleats: stored results have no hits.')
            return
        if isinstance(hit_index, int) and 0 <= hit_index < len(hits):
            _run_result_action(self.window, session, hits[hit_index], action)
            return

        items = [results.format_quick_panel_item(hit) for hit in hits]

        def on_hit(index):
            if index < 0:
                return
            hit = hits[index]
            _show_result_action_choices(self.window, session, hit)

        self.window.show_quick_panel(items, on_hit)


def _load_action_session(window, source):
    if source == 'explain':
        return results_state.get_last_explain(window)
    return results_state.get_last_results(window)


def _show_result_action_choices(window, session, hit):
    items = results.format_hit_action_items(hit)

    def on_action(index):
        if index < 0:
            return
        action = results.HIT_ACTIONS[index][0]
        _run_result_action(window, session, hit, action)

    window.show_quick_panel(items, on_action)


def _run_result_action(window, session, hit, action):
    repo_root = session.get('repoRoot')
    options = normalize_saved_options(session.get('options'), repo_root)

    def rerun(query):
        _search_with_query(window, query, overrides=options)

    outcome = results.apply_hit_action(
        window,
        hit,
        repo_root=repo_root,
        action=action or 'open',
        rerun=rerun,
    )
    if action == 'copy_path' and outcome:
        ui.show_status('PairOfCleats: copied path.')


class PairOfCleatsBrowseIndexedMatchesCommand(sublime_plugin.WindowCommand):
    def run(self):
        def execute(value):
            if value.strip():
                _execute_search(self.window, '', {'filter': value.strip()}, enumeration=True)
        self.window.show_input_panel('PairOfCleats indexed metadata filter', '', execute, None, None)


class PairOfCleatsLoadMoreResultsCommand(sublime_plugin.WindowCommand):
    def run(self):
        session = results_state.get_last_results(self.window)
        pagination = (session or {}).get('pagination') or {}
        if not pagination.get('hasMore') or not pagination.get('nextCursor'):
            ui.show_status('PairOfCleats: no indexed continuation. Ranked text search is top-k.')
            return
        options = dict(session.get('options') or {})
        options['cursor'] = pagination['nextCursor']
        _execute_search(self.window, '', options, enumeration=True, append_session=session)
