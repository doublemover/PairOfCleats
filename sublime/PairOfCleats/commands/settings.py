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
    override_keys = set(overrides.keys()) if isinstance(overrides, dict) else set()
    project_env = overrides.get(config.ENV_KEY) if isinstance(overrides, dict) else None
    if not isinstance(project_env, dict):
        project_env = overrides.get('env') if isinstance(overrides, dict) else None
    project_env_keys = sorted(project_env.keys()) if isinstance(project_env, dict) else []

    lines = [
        'PairOfCleats effective settings',
        '',
        'Merge semantics:',
        '- Base settings: PairOfCleats.sublime-settings + User overrides',
        '- Project settings: settings.pairofcleats overrides base values',
        '- env: shallow-merged, base env first and project env keys override conflicts',
        '',
    ]

    if override_keys:
        lines.append('Project override keys: {0}'.format(', '.join(sorted(override_keys))))
    else:
        lines.append('Project override keys: (none)')
    if project_env_keys:
        lines.append('Project env override keys: {0}'.format(', '.join(project_env_keys)))
    lines.append('')

    for title, keys in config.SETTING_GROUPS:
        lines.append('{0}:'.format(title))
        for key in keys:
            value = settings.get(key)
            source = _setting_source(key, overrides)
            lines.append('- {0} = {1} [{2}]'.format(key, _format_value(value), source))
        lines.append('')

    return '\n'.join(lines).rstrip() + '\n'


def _setting_source(key, overrides):
    if not isinstance(overrides, dict):
        return 'base'
    if key == 'env':
        if isinstance(overrides.get(config.ENV_KEY), dict) or isinstance(overrides.get('env'), dict):
            return 'base+project'
        return 'base'
    return 'project' if key in overrides else 'base'


def _format_value(value):
    if isinstance(value, str):
        return json.dumps(value)
    if isinstance(value, dict):
        return json.dumps(value, sort_keys=True)
    return json.dumps(value)
