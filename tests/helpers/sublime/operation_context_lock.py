import threading
import unittest
from unittest.mock import patch

from runtime_harness import FakeWindow, install_fake_modules

install_fake_modules()
from PairOfCleats.lib import operations, tasks


class NativeWindow(FakeWindow):
    def __init__(self, block_after=1):
        super().__init__()
        self.block_after = block_after
        self.calls = 0
        self.ready = threading.Event()
        self.release_api = threading.Event()

    def folders(self):
        if threading.current_thread().name == 'native-reader':
            self.calls += 1
            if self.calls == self.block_after:
                self.ready.set()
                if not self.release_api.wait(3):
                    raise AssertionError('Native API could not finish its UI callback')
        return ['original-project']


class ContextLockTests(unittest.TestCase):
    def setUp(self):
        operations.activate()

    def cycle(self, window, reader, ui):
        values, errors = {}, []
        ui_done = threading.Event()
        def work():
            try:
                values['reader'] = reader()
            except Exception as error:
                errors.append(error)
            finally:
                window.ready.set()
        def callback():
            try:
                values['ui'] = ui()
            except Exception as error:
                errors.append(error)
            finally:
                ui_done.set()
                window.release_api.set()
        worker = threading.Thread(target=work, name='native-reader')
        main = threading.Thread(target=callback, name='native-ui')
        worker.start()
        try:
            self.assertTrue(window.ready.wait(2))
            main.start()
            completed = ui_done.wait(1)
        finally:
            window.release_api.set()
            worker.join(2)
            if main.ident is not None:
                main.join(2)
        self.assertTrue(completed, 'UI callback must complete while the reader waits for the editor API')
        self.assertFalse(worker.is_alive())
        self.assertFalse(main.is_alive())
        self.assertEqual(errors, [])
        return values

    def test_live_scope_releases_lock_while_native_api_waits(self):
        window = NativeWindow()
        scope = operations.capture(window, 'request')
        values = self.cycle(window, lambda: operations.is_current(scope), lambda: operations.is_current(scope))
        self.assertTrue(values['reader'])
        self.assertTrue(values['ui'])

    def test_invalidation_during_native_context_read_stays_revoked(self):
        window = NativeWindow()
        scope = operations.capture(window, 'request')
        values = self.cycle(window, lambda: operations.is_current(scope), lambda: operations.invalidate(window))
        self.assertFalse(values['reader'], 'epoch must be checked again after the unlocked editor call')

    def test_capture_retains_epoch_from_before_native_context_read(self):
        window = NativeWindow()
        operations.capture(window, 'request')
        values = self.cycle(window, lambda: operations.capture(window, 'request'), lambda: operations.invalidate(window))
        self.assertFalse(operations.is_current(values['reader']), 'context sampling cannot adopt a later epoch')

    def test_progress_coalescing_does_not_wait_for_editor_under_render_lock(self):
        window = NativeWindow(block_after=3)
        callbacks, rendered = [], []
        with patch.object(tasks.sublime, 'set_timeout', side_effect=lambda callback, _delay=0: callbacks.append(callback)), \
                patch.object(tasks, '_render_now', side_effect=lambda _window, show_panel=False: rendered.append(show_panel)):
            tasks._render(window)
            self.assertEqual(len(callbacks), 1)
            self.cycle(window, lambda: tasks._render(window, show_panel=True), callbacks[0])
            self.assertEqual(rendered, [True], 'coalesced request keeps its panel intent and one publication')
            self.assertEqual(len(callbacks), 1)

    def test_coalescing_retains_a_current_sibling_request(self):
        window = NativeWindow()
        first = operations.capture(window, 'first-request')
        second = operations.capture(window, 'second-request')
        self.assertTrue(operations.is_current(second))
        self.assertIs(operations.coalescing_scope(second, first), first)
        operations.capture(window, 'first-request')
        self.assertIs(operations.coalescing_scope(second, first), second)
        operations.capture(window, 'second-request')
        self.assertIsNone(operations.coalescing_scope(second, first))


if __name__ == '__main__':
    unittest.main()
