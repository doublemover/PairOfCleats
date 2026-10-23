"""One-shot native prompt steps bound to their original operation."""
from . import operations


class NativePrompt:
    def __init__(self, window, scope=None, key='native-prompt'):
        self.window = window
        self.scope = scope or operations.capture(window, key=key)
        self.revision = 0
        self.cancelled = False

    def current(self):
        return not self.cancelled and operations.is_current(self.scope)

    def cancel(self):
        self.cancelled = True
        self.revision += 1

    def _step(self, callback):
        self.revision += 1
        revision = self.revision
        def accepted(value):
            if revision != self.revision or not self.current():
                return
            self.revision += 1
            callback(value)
        return accepted

    def choose(self, items, callback, selected_index=0, on_cancel=None):
        if not self.current():
            return
        def selected(index):
            if type(index) is not int or index < 0 or index >= len(items):
                self.cancel()
                if index == -1 and callable(on_cancel):
                    on_cancel()
                return
            callback(index)
        self.window.show_quick_panel(items, self._step(selected), selected_index=selected_index)

    def input(self, caption, initial, callback, on_cancel=None):
        if not self.current():
            return
        def entered(value):
            if not isinstance(value, str):
                self.cancel()
                return
            callback(value)
        accepted = self._step(entered)
        revision = self.revision
        def cancelled():
            if revision == self.revision and self.current():
                self.cancel()
                if callable(on_cancel):
                    on_cancel()
        self.window.show_input_panel(caption, initial, accepted, None, cancelled)
