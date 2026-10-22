import json
from urllib.parse import urlsplit, urlunsplit

import sublime
import sublime_plugin

from ..lib import config
from ..lib import ui
from ..lib import paths
from ..lib import service_repository
from ..lib import installation_evidence, operations

SETTINGS_PANEL = 'pairofcleats-settings'


class PairOfCleatsOpenSettingsCommand(sublime_plugin.WindowCommand):
    def is_enabled(self):
        return True

    def is_visible(self):
        return True

    def run(self):
        self.window.run_command(
            'edit_settings',
            {
                'base_file': '${packages}/PairOfCleats/PairOfCleats.sublime-settings',
                'user_file': '${packages}/User/PairOfCleats.sublime-settings'
            }
        )


class PairOfCleatsOpenProjectSettingsCommand(sublime_plugin.WindowCommand):
    def is_enabled(self):
        return True

    def is_visible(self):
        return True

    def run(self):
        data = self.window.project_data() or {}
        settings = data.get('settings')
        if not isinstance(settings, dict):
            settings = {}
            data['settings'] = settings
        override = settings.get('pairofcleats')
        if not isinstance(override, dict):
            settings['pairofcleats'] = {}
        self.window.set_project_data(data)
        self.window.run_command('edit_project')


class PairOfCleatsProjectSettingsTemplateCommand(sublime_plugin.WindowCommand):
    def is_enabled(self):
        return True

    def is_visible(self):
        return True

    def run(self):
        view = self.window.new_file()
        view.set_name('PairOfCleats Project Settings Template')
        view.set_scratch(True)
        view.run_command('append', {'characters': config.build_project_settings_template()})


class PairOfCleatsShowEffectiveSettingsCommand(sublime_plugin.WindowCommand):
    def is_enabled(self):
        return True

    def is_visible(self):
        return True

    def run(self):
        def show(root, reason):
            if not root:
                ui.show_status('PairOfCleats: {0}'.format(reason))
                return
            settings = config.get_settings(self.window)
            overrides = config.extract_project_settings(self.window)
            text = 'Target repository: {0}\n\n'.format(root) + _render_effective_settings(settings, overrides)
            cli = paths.resolve_cli(settings, root)
            text += '\nCLI/runtime command: {0}; argument count: {1}\n'.format(
                cli.get('command') or 'unavailable', len(cli.get('args_prefix') or []))
            prefix = cli.get('args_prefix') or []
            text += 'CLI installation: {0}\n'.format(prefix[0] if prefix and str(prefix[0]).lower().endswith('.js')
                else cli.get('command') or 'unresolved')
            text += installation_evidence.render({})
            errors = config.validate_settings(settings, root)
            if errors:
                text += '\nCorrections:\n- {0}\n'.format('\n- '.join(errors))
            ui.write_output_panel(self.window, SETTINGS_PANEL, text)
            scope = operations.capture(self.window, key='effective-settings')
            def action(index):
                if index < 0 or not operations.is_current(scope):
                    return
                if index == 0:
                    if errors:
                        ui.show_error('Correct the effective-settings errors before observing this installation.')
                        return
                    installation_evidence.inspect(self.window, settings, root, cli, scope,
                        lambda facts: ui.write_output_panel(self.window, SETTINGS_PANEL, text + installation_evidence.render(facts)))
                elif index == 1:
                    self.window.run_command('pair_of_cleats_open_settings')
                elif index == 2:
                    self.window.run_command('pair_of_cleats_tooling_doctor')
            self.window.show_quick_panel(['Inspect Installation / Transport Evidence', 'Open User Settings',
                                          'Tooling Doctor', 'Done'], action)
        paths.resolve_repo_root_interactive(self.window, show)


class PairOfCleatsSelectRepoCommand(sublime_plugin.WindowCommand):
    def run(self, clear=False):
        paths.select_repo(self.window)
        if clear:
            ui.show_status('PairOfCleats: repository selection cleared.')
            return
        paths.resolve_repo_root_interactive(self.window, lambda root, reason: (
            paths.select_repo(self.window, root), ui.show_status(reason or root or 'Selection cancelled.')))


def _render_effective_settings(settings, overrides):
    raw_overrides = overrides if isinstance(overrides, dict) else {}
    effective_overrides = config.filter_project_settings(raw_overrides)
    override_keys = set(effective_overrides).intersection(config.DEFAULT_SETTINGS)
    ignored_keys = set(raw_overrides).intersection(config.PROJECT_IGNORED_SETTING_KEYS,
                                                   config.DEFAULT_SETTINGS)
    unsupported_keys = set(raw_overrides).difference(config.DEFAULT_SETTINGS)

    lines = [
        'PairOfCleats effective settings',
        '',
        'Settings precedence:',
        '- Base: package defaults and User Settings',
        '- Supported project values replace matching base values',
        '- CLI/Node paths, API connection/mode and environment use User Settings',
        '',
    ]

    if override_keys:
        lines.append('Project override keys: {0}'.format(', '.join(sorted(override_keys))))
    else:
        lines.append('Project override keys: (none)')
    if ignored_keys:
        lines.append('Ignored project keys (use User Settings): {0}'.format(', '.join(sorted(ignored_keys))))
    if unsupported_keys:
        lines.append('Unsupported project keys: {0}'.format(', '.join(sorted(unsupported_keys))))
    lines.append('')

    for title, keys in config.SETTING_GROUPS:
        lines.append('{0}:'.format(title))
        for key in keys:
            value = settings.get(key)
            if key == 'env' or any(part in key.lower() for part in ('token', 'secret', 'password', 'credential', 'args')):
                value = '[redacted]'
            elif key == 'api_server_url' and value:
                try:
                    parsed = urlsplit(value)
                    authority = parsed.hostname or ''
                    if parsed.port:
                        authority += ':' + str(parsed.port)
                    value = urlunsplit((parsed.scheme, authority, parsed.path, '', ''))
                except ValueError:
                    value = '[invalid endpoint; inspect User Settings]'
            source = _setting_source(key, effective_overrides)
            lines.append('- {0} = {1} [{2}]'.format(key, _format_value(value), source))
        lines.append('')

    return '\n'.join(lines).rstrip() + '\n'


def _setting_source(key, overrides):
    if not isinstance(overrides, dict) or key in config.PROJECT_IGNORED_SETTING_KEYS:
        return 'base'
    return 'project' if key in overrides else 'base'


def _format_value(value):
    if isinstance(value, str):
        return json.dumps(value)
    if isinstance(value, dict):
        return json.dumps(value, sort_keys=True)
    return json.dumps(value)


class PairOfCleatsSelectServiceRepositoryCommand(sublime_plugin.WindowCommand):
    def run(self):
        def chosen(root, reason):
            if not root:
                ui.show_status(reason or 'Selection cancelled.')
                return
            service_repository.resolve(self.window, config.get_settings(self.window), root,
                                       lambda selected: ui.show_status('PairOfCleats service repository: ' + selected), force=True)
        paths.resolve_repo_root_interactive(self.window, chosen)
