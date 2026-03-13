import importlib
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(__file__))

from runtime_harness import FakeWindow, install_fake_modules


class TaskBehaviorTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.sublime, _ = install_fake_modules()
        cls.tasks = importlib.import_module('PairOfCleats.lib.tasks')
        cls.runtime = importlib.import_module('PairOfCleats.commands.runtime')

    def setUp(self):
        self.sublime.reset()
        self.window = FakeWindow()
        self.sublime.set_active_window(self.window)
        self.cancelled = []

    def tearDown(self):
        self.tasks.clear_all()

    def test_progress_panel_tracks_active_and_recent_tasks(self):
        task = self.tasks.start_task(
            self.window,
            'PairOfCleats search',
            kind='search',
            repo_root='C:/repo',
            cancellable=True,
            cancel=lambda: self.cancelled.append('search'),
            details='Starting...',
            show_panel=True,
        )
        panel = self.window.panels[self.tasks.TASK_PANEL]
        self.assertIn('Active:', panel.appended)
        self.assertIn('PairOfCleats search', panel.appended)
        self.tasks.note_progress(self.window, task, details='Scanning code...')
        self.assertIn('Scanning code...', self.window.panels[self.tasks.TASK_PANEL].appended)
        self.tasks.note_watchdog(self.window, task, details='No new output for 15s.')
        self.assertIn('watchdog: 1 warning', self.window.panels[self.tasks.TASK_PANEL].appended)
        self.tasks.complete_task(self.window, task, status='done', details='Completed successfully.')
        self.assertIn('Recent:', self.window.panels[self.tasks.TASK_PANEL].appended)
        self.assertIn('Completed successfully.', self.window.panels[self.tasks.TASK_PANEL].appended)

    def test_cancel_active_command_uses_latest_cancellable_task(self):
        self.tasks.start_task(
            self.window,
            'PairOfCleats search',
            kind='search',
            cancellable=True,
            cancel=lambda: self.cancelled.append('search'),
            details='Running search...',
            show_panel=False,
        )
        self.tasks.start_task(
            self.window,
            'PairOfCleats map',
            kind='map',
            cancellable=True,
            cancel=lambda: self.cancelled.append('map'),
            details='Running map...',
            show_panel=False,
        )
        self.runtime.PairOfCleatsCancelActiveTaskCommand(self.window).run()
        self.assertEqual(self.cancelled, ['map'])
        self.assertIn('cancelling pairofcleats map', self.sublime.last_status.lower())


if __name__ == '__main__':
    unittest.main()
