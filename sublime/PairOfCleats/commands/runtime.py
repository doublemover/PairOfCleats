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
        active = [task for task in tasks.active_tasks(self.window)
                  if task.get('cancellable') and callable(task.get('cancel'))]
        if not active:
            ui.show_status('PairOfCleats: no active cancellable task.')
            return
        def selected(index):
            if index < 0:
                return
            task = tasks.cancel_task(self.window, active[index]['id'])
            ui.show_status('PairOfCleats: cancellation requested for exact task {0}.'.format(
                task['id']) if task else 'PairOfCleats: selected task already settled.')
        self.window.show_quick_panel([[task.get('title'), task.get('repoRoot'),
            'Operation {0}: {1}'.format(task['id'], task.get('status'))] for task in active], selected)


class PairOfCleatsInspectTasksCommand(sublime_plugin.WindowCommand):
    def run(self):
        active = tasks.active_tasks(self.window)
        if not active:
            tasks.show_progress(self.window)
            return
        def selected(index):
            if index < 0:
                return
            task = active[index]
            tasks.show_progress(self.window)
            actions = ['Inspect Task Logs', 'Cancel Selected Task', 'Show Effective Settings', 'Tooling Doctor']
            def action(chosen):
                if chosen == 0:
                    self.window.run_command('show_panel', {'panel': 'output.pairofcleats'})
                elif chosen == 1:
                    if not tasks.cancel_task(self.window, task['id']):
                        ui.show_status('PairOfCleats: selected task already settled or is not cancellable.')
                elif chosen == 2:
                    self.window.run_command('pairofcleats_show_effective_settings')
                elif chosen == 3:
                    self.window.run_command('pairofcleats_tooling_doctor')
            self.window.show_quick_panel(actions, action)
        self.window.show_quick_panel([[task.get('title'), task.get('repoRoot'),
            'Operation {0}: {1}'.format(task['id'], task.get('status'))] for task in active], selected)
