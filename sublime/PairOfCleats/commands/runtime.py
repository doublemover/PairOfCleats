import sublime_plugin

from ..lib import tasks
from ..lib import ui


class PairOfCleatsShowProgressCommand(sublime_plugin.WindowCommand):
    def is_enabled(self):
        return True

    def is_visible(self):
        return True

    def run(self):
        tasks.show_progress(self.window)


class PairOfCleatsCancelActiveTaskCommand(sublime_plugin.WindowCommand):
    def is_enabled(self):
        return True

    def is_visible(self):
        return True

    def run(self):
        task = tasks.cancel_active(self.window)
        if task:
            ui.show_status('PairOfCleats: cancelling {0}.'.format(task.get('title') or 'task'))
            return
        ui.show_status('PairOfCleats: no active cancellable task.')
