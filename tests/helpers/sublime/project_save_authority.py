import threading
import unittest
from runtime_harness import FakeWindow, install_fake_modules

install_fake_modules()
from PairOfCleats import plugin
from PairOfCleats.lib import operations


class ProjectSaveTests(unittest.TestCase):
    def setUp(self):
        operations.activate()
        self.window = FakeWindow()
        self.listener = plugin.PairOfCleatsWindowListener()

    def test_same_context_save_preserves_original_scope_and_work(self):
        scope = operations.capture(self.window, 'foreground-search')
        cancelled = []
        class Handle:
            def cancel(self):
                cancelled.append(True)
        operations.track(scope, Handle())
        self.window.set_project_data({'unrelated': {'editor_state': 'changed'}})
        self.listener.on_post_save_project(self.window)
        self.assertTrue(operations.is_current(scope))
        self.assertEqual(cancelled, [])

    def test_settings_change_stays_revoked_after_restoring_old_context(self):
        sibling = operations.capture(FakeWindow())
        scope = operations.capture(self.window, 'foreground-search')
        self.window.set_project_data({'settings': {'pairofcleats': {'search_limit': 10}}})
        self.listener.on_post_save_project(self.window)
        self.window.set_project_data({})
        self.assertFalse(operations.is_current(scope))
        self.assertTrue(operations.is_current(sibling))
        self.assertTrue(operations.is_current(operations.capture(self.window)))

    def test_folder_change_revokes(self):
        scope = operations.capture(self.window)
        self.window.set_folders(['another repository'])
        self.listener.on_post_save_project(self.window)
        self.assertFalse(operations.is_current(scope))

    def test_project_identity_change_revokes(self):
        self.window.project_file_name = lambda: 'original.sublime-project'
        scope = operations.capture(self.window)
        self.window.project_file_name = lambda: 'different.sublime-project'
        self.listener.on_post_save_project(self.window)
        self.assertFalse(operations.is_current(scope))

    def test_project_reload_always_revokes(self):
        scope = operations.capture(self.window)
        self.listener.on_load_project(self.window)
        self.assertFalse(operations.is_current(scope))

    def test_unreadable_context_cannot_preserve_authority_on_save(self):
        def unavailable():
            raise RuntimeError('controlled editor API failure')
        self.window.project_data = unavailable
        self.window.folders = unavailable
        scope = operations.capture(self.window)
        self.listener.on_post_save_project(self.window)
        self.assertFalse(operations.is_current(scope))

    def test_capture_crossing_changed_save_cannot_adopt_new_epoch(self):
        entered, release = threading.Event(), threading.Event()
        original = self.window.project_data
        def data():
            if threading.current_thread().name == 'native-reader':
                entered.set()
                if not release.wait(2):
                    raise AssertionError('bounded context read was not released')
            return original()
        self.window.project_data = data
        operations.capture(self.window)
        captured = []
        worker = threading.Thread(target=lambda: captured.append(operations.capture(self.window)), name='native-reader')
        worker.start()
        try:
            self.assertTrue(entered.wait(1))
            self.window.set_folders(['new context'])
            self.listener.on_post_save_project(self.window)
        finally:
            release.set()
            worker.join(2)
        self.assertFalse(worker.is_alive())
        self.assertFalse(operations.is_current(captured[0]))


if __name__ == '__main__':
    unittest.main()
