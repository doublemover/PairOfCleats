import json

import sublime_plugin

from ..lib import api_client
from ..lib import config
from ..lib import indexing
from ..lib import paths
from ..lib import runner
from ..lib import tasks
from ..lib import ui

CONFIG_PANEL = 'pairofcleats-config-dump'
DOCTOR_PANEL = 'pairofcleats-tooling-doctor'
STATUS_PANEL = 'pairofcleats-status'
HEALTH_PANEL = 'pairofcleats-health'
INDEX_HEALTH_PANEL = 'pairofcleats-index-health'


def _has_api_base_url(settings):
    base_url = api_client.normalize_base_url((settings or {}).get('api_server_url'))
    return base_url.startswith('http://') or base_url.startswith('https://')


def _has_repo_context(window, allow_fallback=True):
    resolution = paths.describe_repo_root(window, allow_fallback=allow_fallback)
    return bool(resolution.get('selected_root') or resolution.get('repo_roots'))


def _validate_repo_settings(window, settings, repo_root):
    errors = config.validate_settings(settings, repo_root)
    if errors:
        ui.show_error('PairOfCleats settings need attention:\n- {0}'.format('\n- '.join(errors)))
        return False
    return True


def _with_repo_context(window, action_label, on_done, path_hint=None, allow_fallback=True, validate_repo_settings=True):
    settings = config.get_settings(window)

    def handle_repo_root(repo_root, reason):
        if not repo_root:
            ui.show_error('PairOfCleats: {0}'.format(reason))
            return
        if reason:
            ui.show_status('PairOfCleats: {0}'.format(reason))
        if validate_repo_settings and not _validate_repo_settings(window, settings, repo_root):
            return
        on_done({
            'settings': settings,
            'repo_root': repo_root,
            'cli': paths.resolve_cli(settings, repo_root),
            'env': config.build_env(settings),
        })

    paths.resolve_repo_root_interactive(
        window,
        handle_repo_root,
        path_hint=path_hint,
        allow_fallback=allow_fallback,
        prompt='PairOfCleats repo for {0}'.format(action_label),
    )


def _start_api_task(window, title, repo_root=None, details=None):
    return tasks.start_task(
        window,
        title,
        kind='api',
        repo_root=repo_root,
        cancellable=False,
        details=details or 'Request started.',
        show_panel=True,
    )


def _run_api(window, title, panel_name, request_fn, render_fn, success_message, repo_root=None):
    task = _start_api_task(window, title, repo_root=repo_root, details='Request started.')

    def on_done(result):
        if result.error:
            tasks.complete_task(window, task, status='failed', details=result.error)
            ui.show_error(result.error)
            return
        text = render_fn(result.payload)
        ui.write_output_panel(window, panel_name, text)
        tasks.complete_task(window, task, status='done', details=success_message)
        ui.show_status('PairOfCleats: {0}'.format(success_message))

    api_client.run_async(
        request_fn,
        on_done,
        on_progress=lambda message: tasks.note_progress(window, task, details=message),
    )


def _run_cli_json(window, context, title, panel_name, args, render_fn, success_message):
    command = context['cli']['command']
    full_args = list(context['cli'].get('args_prefix') or []) + list(args or [])

    def on_done(result):
        if result.error:
            ui.show_error(result.error)
            return
        if result.returncode != 0:
            message = result.output.strip() or '{0} failed.'.format(title)
            ui.show_error(message)
            return
        payload = result.payload
        if not isinstance(payload, dict):
            ui.show_error('PairOfCleats: invalid JSON returned from {0}.'.format(title))
            return
        ui.write_output_panel(window, panel_name, render_fn(payload))
        ui.show_status('PairOfCleats: {0}'.format(success_message))

    runner.run_process(
        command,
        full_args,
        cwd=context['repo_root'],
        env=context['env'],
        window=window,
        title=title,
        capture_json=True,
        on_done=on_done,
        stream_output=False,
    )


def _render_json_report(title, payload, follow_up=None):
    lines = [title, '']
    if follow_up:
        lines.append('Follow-up: {0}'.format(follow_up))
        lines.append('')
    lines.append(json.dumps(payload, indent=2, sort_keys=True))
    lines.append('')
    return '\n'.join(lines)


def _render_server_health(payload):
    uptime_ms = payload.get('uptimeMs')
    lines = [
        'PairOfCleats server health',
        '',
        'Status: ok' if payload.get('ok') else 'Status: error',
    ]
    if isinstance(uptime_ms, (int, float)):
        lines.append('Uptime: {0:.1f}s'.format(float(uptime_ms) / 1000.0))
    lines.extend([
        '',
        'Follow-up:',
        '- Run `PairOfCleats: Server Status` for repo status and index health.',
        '',
    ])
    return '\n'.join(lines)


def _append_health_block(lines, health):
    issues = list(health.get('issues') or []) if isinstance(health, dict) else []
    hints = list(health.get('hints') or []) if isinstance(health, dict) else []
    lines.append('Health:')
    if not issues:
        lines.append('- issues: none')
    else:
        lines.append('- issues:')
        for issue in issues:
            lines.append('  - {0}'.format(issue))
    if hints:
        lines.append('- hints:')
        for hint in hints:
            lines.append('  - {0}'.format(hint))
    lines.append('')


def _render_server_status(payload):
    repo = payload.get('repo') or {}
    overall = payload.get('overall') or {}
    lines = [
        'PairOfCleats server status',
        '',
        'Repo root: {0}'.format(repo.get('root') or '(unknown)'),
        'Repo cache: {0}'.format(repo.get('cacheRoot') or '(unknown)'),
        'Repo bytes: {0}'.format(repo.get('totalBytes') or 0),
        'Overall cache root: {0}'.format(overall.get('cacheRoot') or '(unknown)'),
        'Overall bytes: {0}'.format(overall.get('totalBytes') or 0),
        '',
    ]
    _append_health_block(lines, payload.get('health') or {})
    lines.extend([
        'Follow-up:',
        '- Run `PairOfCleats: Index Health` for a focused artifact health view.',
        '- Run `PairOfCleats: Open Index Directory` or `PairOfCleats: Index Validate` for direct repair workflows.',
        '',
    ])
    return '\n'.join(lines)


def _render_index_health(payload):
    repo = payload.get('repo') or {}
    sqlite = repo.get('sqlite') or {}
    lmdb = repo.get('lmdb') or {}
    artifacts = repo.get('artifacts') or {}
    lines = [
        'PairOfCleats index health',
        '',
        'Repo root: {0}'.format(repo.get('root') or '(unknown)'),
        'Code artifact bytes: {0}'.format(artifacts.get('indexCode') or 0),
        'Prose artifact bytes: {0}'.format(artifacts.get('indexProse') or 0),
        'Extracted prose bytes: {0}'.format(artifacts.get('indexExtractedProse') or 0),
        'Records artifact bytes: {0}'.format(artifacts.get('indexRecords') or 0),
        '',
        'SQLite:',
        '- code: {0}'.format('present' if sqlite.get('code') else 'missing'),
        '- prose: {0}'.format('present' if sqlite.get('prose') else 'missing'),
        '- extracted-prose: {0}'.format('present' if sqlite.get('extractedProse') else 'missing'),
        '- records: {0}'.format('present' if sqlite.get('records') else 'missing'),
        '',
        'LMDB:',
        '- code: {0}'.format('present' if lmdb.get('code') else 'missing'),
        '- prose: {0}'.format('present' if lmdb.get('prose') else 'missing'),
        '',
    ]
    _append_health_block(lines, payload.get('health') or {})
    lines.extend([
        'Follow-up:',
        '- Run `PairOfCleats: Index Build (All)` to rebuild file-backed artifacts.',
        '- Run `PairOfCleats: Index Validate` for a per-mode validation report.',
        '',
    ])
    return '\n'.join(lines)


def _render_tooling_doctor(payload):
    summary = payload.get('summary') or {}
    lines = [
        'PairOfCleats tooling doctor',
        '',
        'Repo: {0}'.format(payload.get('repoRoot') or '(unknown)'),
        'Status: {0}'.format(summary.get('status') or 'unknown'),
        'chunkUid backend: {0}'.format('ok' if (payload.get('identity') or {}).get('chunkUid', {}).get('available') else 'missing'),
        'xxhash backend: {0}'.format((payload.get('xxhash') or {}).get('backend') or 'unknown'),
        '',
        'Providers:',
    ]
    for provider in payload.get('providers') or []:
        enabled = 'enabled' if provider.get('enabled') else 'disabled'
        lines.append('- {0}: {1} / {2}'.format(
            provider.get('id') or 'unknown',
            provider.get('status') or 'unknown',
            enabled,
        ))
        for check in provider.get('checks') or []:
            lines.append('  - {0}: {1}'.format(check.get('name') or 'check', check.get('message') or ''))
    lines.extend([
        '',
        'Follow-up:',
        '- Use this report to confirm provider availability before API-backed or indexing workflows.',
        '',
    ])
    return '\n'.join(lines)


class _RepoContextCommand(sublime_plugin.WindowCommand):
    def is_enabled(self):
        return _has_repo_context(self.window)

    def is_visible(self):
        return self.is_enabled()


class _ApiCommand(sublime_plugin.WindowCommand):
    def is_enabled(self):
        return _has_api_base_url(config.get_settings(self.window))

    def is_visible(self):
        return self.is_enabled()


class _RepoApiCommand(_ApiCommand):
    def is_enabled(self):
        return super().is_enabled() and _has_repo_context(self.window)


class PairOfCleatsShowConfigDumpCommand(_RepoContextCommand):
    def run(self):
        def on_context(context):
            execution = config.resolve_execution_mode(context['settings'], 'config-dump', requested_mode='cli')
            if execution.get('error'):
                ui.show_error(execution['error'])
                return
            args = indexing.build_config_dump_args(repo_root=context['repo_root'], json_output=True)
            _run_cli_json(
                self.window,
                context,
                'PairOfCleats config dump',
                CONFIG_PANEL,
                args,
                lambda payload: _render_json_report(
                    'PairOfCleats config dump',
                    payload,
                    follow_up='Use `PairOfCleats: Show Effective Settings` for editor-layer overrides and `PairOfCleats: Open Index Directory` for derived cache roots.',
                ),
                'showing config dump.',
            )

        _with_repo_context(self.window, 'config dump', on_context, validate_repo_settings=False)


class PairOfCleatsToolingDoctorCommand(_RepoContextCommand):
    def run(self):
        def on_context(context):
            execution = config.resolve_execution_mode(context['settings'], 'tooling-doctor', requested_mode='cli')
            if execution.get('error'):
                ui.show_error(execution['error'])
                return
            args = ['tooling', 'doctor', '--json', '--repo', context['repo_root']]
            _run_cli_json(
                self.window,
                context,
                'PairOfCleats tooling doctor',
                DOCTOR_PANEL,
                args,
                _render_tooling_doctor,
                'showing tooling doctor.',
            )

        _with_repo_context(self.window, 'tooling doctor', on_context, validate_repo_settings=False)


class PairOfCleatsServerHealthCommand(_ApiCommand):
    def run(self):
        settings = config.get_settings(self.window)
        execution = config.resolve_execution_mode(settings, 'server-health', requested_mode='api')
        if execution.get('error'):
            ui.show_error(execution['error'])
            return
        _run_api(
            self.window,
            'PairOfCleats server health',
            HEALTH_PANEL,
            lambda: api_client.health_json(execution.get('base_url'), settings),
            _render_server_health,
            'showing server health.',
        )


class PairOfCleatsServerStatusCommand(_RepoApiCommand):
    def run(self):
        settings = config.get_settings(self.window)
        execution = config.resolve_execution_mode(settings, 'server-status', requested_mode='api')
        if execution.get('error'):
            ui.show_error(execution['error'])
            return

        def on_context(context):
            _run_api(
                self.window,
                'PairOfCleats server status',
                STATUS_PANEL,
                lambda: api_client.status_json(execution.get('base_url'), context['repo_root'], settings),
                _render_server_status,
                'showing server status.',
                repo_root=context['repo_root'],
            )

        _with_repo_context(self.window, 'server status', on_context, validate_repo_settings=False)


class PairOfCleatsIndexHealthCommand(_RepoApiCommand):
    def run(self):
        settings = config.get_settings(self.window)
        execution = config.resolve_execution_mode(settings, 'index-health', requested_mode='api')
        if execution.get('error'):
            ui.show_error(execution['error'])
            return

        def on_context(context):
            _run_api(
                self.window,
                'PairOfCleats index health',
                INDEX_HEALTH_PANEL,
                lambda: api_client.status_json(execution.get('base_url'), context['repo_root'], settings),
                _render_index_health,
                'showing index health.',
                repo_root=context['repo_root'],
            )

        _with_repo_context(self.window, 'index health', on_context, validate_repo_settings=False)
