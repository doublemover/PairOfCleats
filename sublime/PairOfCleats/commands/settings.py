import sublime
import sublime_plugin


class PairOfCleatsOpenSettingsCommand(sublime_plugin.WindowCommand):
    def run(self):
        self.window.run_command(
            'edit_settings',
            {
                'base_file': '${packages}/PairOfCleats/PairOfCleats.sublime-settings',
                'user_file': '${packages}/User/PairOfCleats.sublime-settings'
            }
        )
