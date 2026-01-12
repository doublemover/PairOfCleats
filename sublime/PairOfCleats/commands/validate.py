import sublime_plugin

from ..lib import config
from ..lib import paths
from ..lib import ui


class PairOfCleatsValidateSettingsCommand(sublime_plugin.WindowCommand):
    def is_enabled(self):
        return True

    def is_visible(self):
        return True

    def run(self):
        settings = config.get_settings(self.window)
        repo_root, reason = paths.resolve_repo_root(self.window, return_reason=True)
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
        ui.show_status('PairOfCleats settings look good.')
