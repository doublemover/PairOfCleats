import json

import sublime
import sublime_plugin

from ..lib import config
from ..lib import ui

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
        settings = config.get_settings(self.window)
        overrides = config.extract_project_settings(self.window)
        text = _render_effective_settings(settings, overrides)
        ui.write_output_panel(self.window, SETTINGS_PANEL, text)
        ui.show_status('PairOfCleats: showing effective settings.')


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
