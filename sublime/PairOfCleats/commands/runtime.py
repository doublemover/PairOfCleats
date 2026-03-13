import sublime_plugin

from ..lib import tasks
from ..lib import ui


class PairOfCleatsShowProgressCommand(sublime_plugin.WindowCommand):
    def is_enabled(self):
        return bool(tasks.active_tasks(self.window) or tasks.recent_tasks(self.window))

    def is_visible(self):
        return self.is_enabled()

    def run(self):
        tasks.show_progress(self.window)


class PairOfCleatsCancelActiveTaskCommand(sublime_plugin.WindowCommand):
    def is_enabled(self):
        return any(
            task.get('cancellable') and callable(task.get('cancel'))
            for task in tasks.active_tasks(self.window)
        )

    def is_visible(self):
        return self.is_enabled()

    def run(self):
        task = tasks.cancel_active(self.window)
        if task:
            ui.show_status('PairOfCleats: cancelling {0}.'.format(task.get('title') or 'task'))
            return
        ui.show_status('PairOfCleats: no active cancellable task.')
