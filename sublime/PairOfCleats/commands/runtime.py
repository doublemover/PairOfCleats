import sublime_plugin

from ..lib import tasks
from ..lib import ui
from ..lib import operations


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
        entries = active + tasks.recent_tasks(self.window)
        if not entries:
            tasks.show_progress(self.window)
            return
        scope = operations.capture(self.window, key='task-inspector')
        def selected(index):
            if index < 0 or not operations.is_current(scope):
                return
            task = entries[index]
            tasks.show_progress(self.window)
            actions = [('logs', 'Inspect Task Logs'), ('settings', 'Show Effective Settings for This Task'),
                       ('doctor', 'Tooling Doctor (current selected repository)'),
                       ('health', 'Index Health (current selected repository)'), ('select', 'Select Repository')]
            if any(entry['id'] == task['id'] for entry in tasks.active_tasks(self.window)) and task.get('cancellable'):
                actions.insert(1, ('cancel', 'Cancel Selected Task'))
            if (task.get('status') == 'failed' and task.get('title') == 'PairOfCleats index build'
                    and not task.get('cleanupUnconfirmed')):
                actions.append(('retry', 'Retry Index Build (choose mode and repository)'))
            def action(chosen):
                if chosen < 0 or not operations.is_current(scope):
                    return
                key = actions[chosen][0]
                if key == 'logs':
                    ui.write_output_panel(self.window, 'pairofcleats-task-logs',
                        'Task {0}: {1}\nRepository: {2}\nBounded log tail{3}:\n\n{4}'.format(
                            task['id'], task.get('title'), task.get('repoRoot'),
                            ' (older lines omitted)' if task.get('logTailTruncated') else '',
                            ''.join(task.get('logTail') or [])))
                elif key == 'cancel':
                    if not tasks.cancel_task(self.window, task['id']):
                        ui.show_status('PairOfCleats: selected task already settled or is not cancellable.')
                elif key == 'settings':
                    self.window.run_command('pair_of_cleats_show_effective_settings', {'repo_root': task.get('repoRoot')})
                elif key == 'doctor':
                    self.window.run_command('pair_of_cleats_tooling_doctor')
                elif key == 'health':
                    self.window.run_command('pair_of_cleats_index_health')
                elif key == 'select':
                    self.window.run_command('pair_of_cleats_select_repo')
                elif key == 'retry':
                    def retry(index):
                        if index >= 0 and operations.is_current(scope):
                            self.window.run_command(['pair_of_cleats_index_build_code', 'pair_of_cleats_index_build_prose',
                                                     'pair_of_cleats_index_build_all'][index])
                    self.window.show_quick_panel(['Build Code (select repository)', 'Build Prose (select repository)',
                                                 'Build All (select repository)'], retry)
            self.window.show_quick_panel([label for _key, label in actions], action)
        self.window.show_quick_panel([[task.get('title'), task.get('repoRoot'),
            'Operation {0}: {1}{2}'.format(task['id'], task.get('status'),
                ' (completed observation)' if task.get('completedAt') is not None else '')] for task in entries], selected)
