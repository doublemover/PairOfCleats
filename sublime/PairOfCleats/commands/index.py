import sublime
import sublime_plugin

from ..lib import config
from ..lib import index_state
from ..lib import indexing
from ..lib import paths
from ..lib import runner
from ..lib import ui
from ..lib import watch

INDEX_PANEL = 'pairofcleats-index'


def _resolve_repo_root(window):
    return paths.resolve_repo_root(window, return_reason=True)


def _has_repo_root(window):
    return paths.has_repo_root(window)


def _run_index_build(window, mode):
    settings = config.get_settings(window)
    repo_root, reason = _resolve_repo_root(window)
    if not repo_root:
        ui.show_error('PairOfCleats: {0}'.format(reason))
        return
    if reason:
        ui.show_status('PairOfCleats: {0}'.format(reason))

    errors = config.validate_settings(settings, repo_root)
    if errors:
        ui.show_error('PairOfCleats settings need attention:\n- {0}'.format('\n- '.join(errors)))
        return

    args = indexing.build_index_args(mode, repo_root=repo_root)
    cli = paths.resolve_cli(settings, repo_root)
    command = cli['command']
    full_args = list(cli.get('args_prefix') or []) + args
    env = config.build_env(settings)

    ui.show_status('PairOfCleats: index build started ({0}).'.format(mode))

    def on_done(result):
        if result.returncode == 0:
            index_state.record_last_build(window, mode)
            ui.show_status('PairOfCleats: index build complete ({0}).'.format(mode))
            return
        message = result.output.strip() or 'PairOfCleats index build failed.'
        ui.show_error(message)

    runner.run_process(
        command,
        full_args,
        cwd=repo_root,
        env=env,
        window=window,
        title='PairOfCleats index build',
        capture_json=False,
        on_done=on_done,
        stream_output=True,
        panel_name=INDEX_PANEL
    )


def _run_index_watch(window):
    settings = config.get_settings(window)
    repo_root, reason = _resolve_repo_root(window)
    if not repo_root:
        ui.show_error('PairOfCleats: {0}'.format(reason))
        return
    if reason:
        ui.show_status('PairOfCleats: {0}'.format(reason))

    errors = config.validate_settings(settings, repo_root)
    if errors:
        ui.show_error('PairOfCleats settings need attention:\n- {0}'.format('\n- '.join(errors)))
        return

    if watch.is_running(window):
        active_root = watch.current_root(window)
        message = 'PairOfCleats: watch already running.'
        if active_root:
            message = '{0} ({1})'.format(message, active_root)
        ui.show_status(message)
        return

    watch_root = paths.resolve_watch_root(window, settings)
    if not watch_root:
        ui.show_error('PairOfCleats: unable to resolve watch root.')
        return

    mode = settings.get('index_watch_mode') or 'all'
    poll_ms = settings.get('index_watch_poll_ms')
    debounce_ms = settings.get('index_watch_debounce_ms')

    args = indexing.build_index_args(
        mode,
        repo_root=watch_root,
        watch=True,
        watch_poll_ms=poll_ms,
        watch_debounce_ms=debounce_ms
    )

    cli = paths.resolve_cli(settings, repo_root)
    command = cli['command']
    full_args = list(cli.get('args_prefix') or []) + args
    env = config.build_env(settings)

    ui.show_status('PairOfCleats: watch started ({0}).'.format(watch_root))

    def on_done(result):
        watch.clear_if_done(window)
        if result.returncode == 0:
            ui.show_status('PairOfCleats: watch stopped.')
            return
        message = result.output.strip() or 'PairOfCleats watch failed.'
        ui.show_error(message)

    handle = runner.run_process(
        command,
        full_args,
        cwd=watch_root,
        env=env,
        window=window,
        title='PairOfCleats index watch',
        capture_json=False,
        on_done=on_done,
        stream_output=True,
        panel_name=INDEX_PANEL
    )
    watch.register(window, handle, watch_root)


def _run_index_watch_stop(window):
    if watch.stop(window):
        ui.show_status('PairOfCleats: watch stopping...')
    else:
        ui.show_status('PairOfCleats: no watch to stop.')


def _run_index_validate(window):
    settings = config.get_settings(window)
    repo_root, reason = _resolve_repo_root(window)
    if not repo_root:
        ui.show_error('PairOfCleats: {0}'.format(reason))
        return
    if reason:
        ui.show_status('PairOfCleats: {0}'.format(reason))

    errors = config.validate_settings(settings, repo_root)
    if errors:
        ui.show_error('PairOfCleats settings need attention:\n- {0}'.format('\n- '.join(errors)))
        return

    args = indexing.build_validate_args(repo_root=repo_root, json_output=True)
    cli = paths.resolve_cli(settings, repo_root)
    command = cli['command']
    full_args = list(cli.get('args_prefix') or []) + args
    env = config.build_env(settings)

    ui.show_status('PairOfCleats: validating index...')

    def on_done(result):
        if result.error:
            ui.show_error(result.error)
            return
        if result.returncode not in (0, 1):
            message = result.output.strip() or 'PairOfCleats index validate failed.'
            ui.show_error(message)
            return
        payload = result.payload
        if not isinstance(payload, dict):
            ui.show_error('PairOfCleats index validate returned invalid JSON.')
            return
        text = _format_validate_report(payload)
        ui.write_output_panel(window, 'pairofcleats-validate', text)
        if payload.get('ok'):
            ui.show_status('PairOfCleats: index validation ok.')
        else:
            ui.show_error('PairOfCleats: index validation found issues.')

    runner.run_process(
        command,
        full_args,
        cwd=repo_root,
        env=env,
        window=window,
        title='PairOfCleats index validate',
        capture_json=True,
        on_done=on_done,
        stream_output=False
    )


def _format_validate_report(payload):
    lines = ['PairOfCleats index validation', '']
    root = payload.get('root') or ''
    if root:
        lines.append('Repo: {0}'.format(root))
    lines.append('Status: {0}'.format('ok' if payload.get('ok') else 'issues'))
    lines.append('')

    modes = payload.get('modes') or {}
    if isinstance(modes, dict):
        for mode, entry in modes.items():
            if not isinstance(entry, dict):
                continue
            status = 'ok' if entry.get('ok') else 'missing'
            path = entry.get('path') or ''
            lines.append('{0}: {1}'.format(mode, status))
            if path:
                lines.append('  {0}'.format(path))
            missing = entry.get('missing')
            if isinstance(missing, list) and missing:
                lines.append('  missing: {0}'.format(', '.join(missing)))
            warnings = entry.get('warnings')
            if isinstance(warnings, list) and warnings:
                lines.append('  warnings: {0}'.format(', '.join(warnings)))
            lines.append('')

    issues = payload.get('issues')
    if isinstance(issues, list) and issues:
        lines.append('Issues:')
        for issue in issues:
            lines.append('- {0}'.format(issue))
        lines.append('')

    warnings = payload.get('warnings')
    if isinstance(warnings, list) and warnings:
        lines.append('Warnings:')
        for warning in warnings:
            lines.append('- {0}'.format(warning))
        lines.append('')

    hints = payload.get('hints')
    if isinstance(hints, list) and hints:
        lines.append('Hints:')
        for hint in hints:
            lines.append('- {0}'.format(hint))
        lines.append('')

    return '\n'.join(lines).rstrip() + '\n'


def _run_open_index_dir(window):
    settings = config.get_settings(window)
    repo_root, reason = _resolve_repo_root(window)
    if not repo_root:
        ui.show_error('PairOfCleats: {0}'.format(reason))
        return
    if reason:
        ui.show_status('PairOfCleats: {0}'.format(reason))

    errors = config.validate_settings(settings, repo_root)
    if errors:
        ui.show_error('PairOfCleats settings need attention:\n- {0}'.format('\n- '.join(errors)))
        return

    args = indexing.build_config_dump_args(repo_root=repo_root, json_output=True)
    cli = paths.resolve_cli(settings, repo_root)
    command = cli['command']
    full_args = list(cli.get('args_prefix') or []) + args
    env = config.build_env(settings)

    def on_done(result):
        if result.error:
            ui.show_error(result.error)
            return
        if result.returncode != 0:
            message = result.output.strip() or 'PairOfCleats config dump failed.'
            ui.show_error(message)
            return
        payload = result.payload
        if not isinstance(payload, dict):
            ui.show_error('PairOfCleats config dump returned invalid JSON.')
            return
        derived = payload.get('derived') or {}
        repo_cache_root = derived.get('repoCacheRoot')
        if not repo_cache_root:
            ui.show_error('PairOfCleats: repo cache root unavailable.')
            return
        window.run_command('open_dir', {'dir': repo_cache_root})

    runner.run_process(
        command,
        full_args,
        cwd=repo_root,
        env=env,
        window=window,
        title='PairOfCleats config dump',
        capture_json=True,
        on_done=on_done,
        stream_output=False
    )


class PairOfCleatsIndexBuildCodeCommand(sublime_plugin.WindowCommand):
    def is_enabled(self):
        return True

    def is_visible(self):
        return True

    def run(self):
        _run_index_build(self.window, 'code')


class PairOfCleatsIndexBuildProseCommand(sublime_plugin.WindowCommand):
    def is_enabled(self):
        return True

    def is_visible(self):
        return True

    def run(self):
        _run_index_build(self.window, 'prose')


class PairOfCleatsIndexBuildAllCommand(sublime_plugin.WindowCommand):
    def is_enabled(self):
        return True

    def is_visible(self):
        return True

    def run(self):
        _run_index_build(self.window, 'all')


class PairOfCleatsIndexWatchStartCommand(sublime_plugin.WindowCommand):
    def is_enabled(self):
        return True

    def is_visible(self):
        return True

    def run(self):
        _run_index_watch(self.window)


class PairOfCleatsIndexWatchStopCommand(sublime_plugin.WindowCommand):
    def is_enabled(self):
        return True

    def is_visible(self):
        return True

    def run(self):
        _run_index_watch_stop(self.window)


class PairOfCleatsIndexValidateCommand(sublime_plugin.WindowCommand):
    def is_enabled(self):
        return True

    def is_visible(self):
        return True

    def run(self):
        _run_index_validate(self.window)


class PairOfCleatsOpenIndexDirectoryCommand(sublime_plugin.WindowCommand):      
    def is_enabled(self):
        return True

    def is_visible(self):
        return True

    def run(self):
        _run_open_index_dir(self.window)
