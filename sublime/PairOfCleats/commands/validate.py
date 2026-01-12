import sublime_plugin

from ..lib import config
from ..lib import paths
from ..lib import ui


class PairOfCleatsValidateSettingsCommand(sublime_plugin.WindowCommand):
    def run(self):
        settings = config.get_settings(self.window)
        repo_root = paths.resolve_repo_root(self.window)
        errors = config.validate_settings(settings, repo_root)
        if errors:
            message = 'PairOfCleats settings need attention:\n- {0}'.format(
                '\n- '.join(errors)
            )
            ui.show_error(message)
            return
        ui.show_status('PairOfCleats settings look good.')
