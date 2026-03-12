import sublime
import sublime_plugin

from ..lib import config
from ..lib import history
from ..lib import paths
from ..lib import results
from ..lib import results_state
from ..lib import runner
from ..lib import search as search_lib
from ..lib import ui

LIMIT_CHOICES = [10, 25, 50, 100, 200]


def _resolve_repo_root(window):
    return paths.resolve_repo_root(window, return_reason=True)


def _has_repo_root(window):
    return paths.has_repo_root(window)


def _resolve_defaults(settings, overrides=None):
    overrides = overrides or {}
    mode = overrides.get('mode') or settings.get('index_mode_default') or 'both'
    backend = overrides.get('backend') or settings.get('search_backend_default') or ''
    limit = overrides.get('limit') or settings.get('search_limit') or 25
    return {
        'mode': mode,
        'backend': backend,
        'limit': limit
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
    mode_choices = ['code', 'prose', 'both']
    default_mode = options.get('mode')
    mode_index = mode_choices.index(default_mode) if default_mode in mode_choices else 2

    def on_mode_select(index):
        if index < 0:
            on_done(options)
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
        ('lmdb', 'lmdb')
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
            on_done(options)
            return
        options['backend'] = backend_choices[index][0]
        _prompt_limit(window, options, on_done)

    window.show_quick_panel(labels, on_backend_select, selected_index=current_index)


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
            on_done(options)
            return
        if index < len(limit_values):
            options['limit'] = limit_values[index]
            on_done(options)
            return

        def on_custom_done(value):
            value = value.strip()
            if not value:
                on_done(options)
                return
            try:
                parsed = int(value)
            except Exception:
                ui.show_error('Limit must be an integer.')
                on_done(options)
                return
            if parsed < 1:
                ui.show_error('Limit must be at least 1.')
                on_done(options)
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


def _execute_search(window, query, overrides=None, explain=False):
    if not query:
        return

    settings = config.get_settings(window)
    repo_root, reason = _resolve_repo_root(window)
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

    resolved = _resolve_defaults(settings, overrides)
    args = search_lib.build_search_args(
        query,
        repo_root=repo_root,
        mode=resolved.get('mode'),
        backend=resolved.get('backend') or None,
        limit=resolved.get('limit'),
        explain=explain
    )

    cli = paths.resolve_cli(settings, repo_root)
    command = cli['command']
    full_args = list(cli.get('args_prefix') or []) + args
    env = config.build_env(settings)

    ui.show_status('PairOfCleats: searching...')

    def on_done(result):
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

        hits = results.collect_hits(payload)
        history_limit = settings.get('history_limit')
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

        if not hits:
            ui.show_status('PairOfCleats: no results.')
            return

        target = _resolve_results_target(settings, len(hits))
        session = results.build_session(query, resolved, repo_root, hits, target)
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
            if index < 0:
                return
            results.open_hit(window, hits[index], repo_root)

        window.show_quick_panel(items, on_select)

    runner.run_process(
        command,
        full_args,
        cwd=repo_root,
        env=env,
        window=window,
        title='PairOfCleats search',
        capture_json=True,
        on_done=on_done,
        stream_output=False
    )


def _execute_symbol_lookup(window, query, on_hits, limit=25, title='PairOfCleats symbol lookup'):
    if not query:
        return

    settings = config.get_settings(window)
    repo_root, reason = _resolve_repo_root(window)
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

    resolved = _resolve_defaults(settings, {'mode': 'code', 'limit': limit})
    args = search_lib.build_search_args(
        query,
        repo_root=repo_root,
        mode='code',
        backend=resolved.get('backend') or None,
        limit=resolved.get('limit'),
        explain=False,
    )
    cli = paths.resolve_cli(settings, repo_root)
    command = cli['command']
    full_args = list(cli.get('args_prefix') or []) + args
    env = config.build_env(settings)

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
        hits = [hit for hit in results.collect_hits(payload) if hit.get('section') == 'code']
        on_hits(hits, repo_root, resolved)

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


def _show_symbol_hit_picker(window, hits, repo_root):
    items = [results.format_quick_panel_item(hit) for hit in hits]

    def on_select(index):
        if index < 0:
            return
        results.open_hit(window, hits[index], repo_root)

    window.show_quick_panel(items, on_select)


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
        return True

    def is_visible(self):
        return True

    def run(self, query=None):
        if query:
            _search_with_query(self.window, query)
            return
        _search_with_prompt(self.window)


class PairOfCleatsSearchWithOptionsCommand(sublime_plugin.WindowCommand):       
    def is_enabled(self):
        return True

    def is_visible(self):
        return True

    def run(self, query=None):
        if query:
            _search_with_query(self.window, query, force_prompt=True)
            return
        _search_with_prompt(self.window, force_prompt=True)


class PairOfCleatsSearchSelectionCommand(sublime_plugin.TextCommand):
    def is_enabled(self):
        return bool(self.view)

    def is_visible(self):
        return True

    def run(self, edit):
        query = _extract_selection(self.view)
        if not query:
            ui.show_status('PairOfCleats: no selection to search.')
            return
        _search_with_query(self.view.window(), query)


class PairOfCleatsSearchSymbolUnderCursorCommand(sublime_plugin.TextCommand):   
    def is_enabled(self):
        return bool(self.view)

    def is_visible(self):
        return True

    def run(self, edit):
        query = _extract_symbol(self.view)
        if not query:
            ui.show_status('PairOfCleats: no symbol under cursor.')
            return
        _search_with_query(self.view.window(), query)


class PairOfCleatsGotoDefinitionCommand(sublime_plugin.TextCommand):
    def is_enabled(self):
        return bool(self.view)

    def is_visible(self):
        return True

    def run(self, edit):
        query = _extract_symbol(self.view)
        if not query:
            ui.show_status('PairOfCleats: no symbol under cursor.')
            return

        def on_hits(hits, repo_root, _resolved):
            if not hits:
                ui.show_status('PairOfCleats: no indexed definitions found.')
                return
            ranked = _rank_definition_hits(hits, query)
            if len(ranked) == 1:
                results.open_hit(self.view.window(), ranked[0], repo_root)
                return
            _show_symbol_hit_picker(self.view.window(), ranked, repo_root)

        _execute_symbol_lookup(
            self.view.window(),
            query,
            on_hits,
            limit=25,
            title='PairOfCleats goto definition',
        )


class PairOfCleatsFindReferencesCommand(sublime_plugin.TextCommand):
    def is_enabled(self):
        return bool(self.view)

    def is_visible(self):
        return True

    def run(self, edit):
        query = _extract_symbol(self.view)
        if not query:
            ui.show_status('PairOfCleats: no symbol under cursor.')
            return

        def on_hits(hits, repo_root, _resolved):
            if not hits:
                ui.show_status('PairOfCleats: no indexed references found.')
                return
            _show_symbol_hit_picker(self.view.window(), hits, repo_root)

        _execute_symbol_lookup(
            self.view.window(),
            query,
            on_hits,
            limit=50,
            title='PairOfCleats find references',
        )


class PairOfCleatsCompleteSymbolCommand(sublime_plugin.TextCommand):
    def is_enabled(self):
        return bool(self.view)

    def is_visible(self):
        return True

    def run(self, edit):
        query = _extract_symbol(self.view)
        if not query:
            ui.show_status('PairOfCleats: no symbol prefix under cursor.')
            return

        def on_hits(hits, _repo_root, _resolved):
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
                if index < 0:
                    return
                self.view.run_command(
                    'pair_of_cleats_apply_completion',
                    {'text': candidates[index][0]},
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

    def run(self, edit, text=''):
        if not text:
            return
        selection = self.view.sel()
        if not selection:
            return
        region = selection[0]
        word = self.view.word(region)
        self.view.erase(edit, word)
        self.view.insert(edit, word.a, text)


class PairOfCleatsSearchHistoryCommand(sublime_plugin.WindowCommand):
    def is_enabled(self):
        return True

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
        return True

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
        return True

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
        return True

    def is_visible(self):
        return True

    def run(self):
        session = results_state.get_last_results(self.window)
        if not session:
            ui.show_status('PairOfCleats: no previous results to reopen.')
            return
        results.reopen_session(self.window, session)


class PairOfCleatsReopenLastExplainCommand(sublime_plugin.WindowCommand):
    def is_enabled(self):
        return True

    def is_visible(self):
        return True

    def run(self):
        session = results_state.get_last_explain(self.window)
        if not session:
            ui.show_status('PairOfCleats: no previous explain output to reopen.')
            return
        results.reopen_session(self.window, session)


class PairOfCleatsResultActionsCommand(sublime_plugin.WindowCommand):
    def is_enabled(self):
        return True

    def is_visible(self):
        return True

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
    options = session.get('options')

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
