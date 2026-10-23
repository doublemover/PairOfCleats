import sublime
import sublime_plugin

from .lib import config
from .lib import tasks
from .lib import watch
from .lib import operations
from .lib import completion_target
from .lib.installation import report_installation_diagnostics
from .commands import analysis as _analysis_commands
from .commands import evidence as _evidence_commands
from .commands import index as _index_commands
from .commands import map as _map_commands
from .commands import operator as _operator_commands
from .commands import runtime as _runtime_commands
from .commands import search as _search_commands
from .commands import semantic as _semantic_commands
from .commands import settings as _settings_commands
from .commands import validate as _validate_commands

PLUGIN_NAME = 'PairOfCleats'


def plugin_loaded():
    operations.activate()
    report_installation_diagnostics(sublime)
    config.prime_settings()


def _dispose_phase(label, callback):
    try:
        return callback()
    except Exception as error:
        print('PairOfCleats {0} failed: {1}'.format(label, error))


def _dispose_all(reason):
    # Revoke publication before any adapter cancellation can invoke callbacks.
    # Independent adapters still receive disposal if an earlier phase fails.
    _dispose_phase('owned operation disposal', lambda: operations.shutdown(all_windows=True))
    _dispose_phase('completion disposal', completion_target.clear_all)
    _dispose_phase('watch disposal', lambda: watch.stop_all(reason=reason))
    _dispose_phase('task display disposal', tasks.clear_all)


def plugin_unloaded():
    _dispose_all('plugin_unload')


class PairOfCleatsWindowListener(sublime_plugin.EventListener):
    def on_close(self, view):
        completion_target.clear_view(view)

    def on_window_command(self, window, command_name, args):
        if command_name == 'close_window':
            # The native close can be cancelled by its save prompt. Reap the
            # old work and revoke its epoch without permanently disabling an
            # otherwise live window if the user keeps it open.
            _dispose_phase('window operation disposal', lambda: operations.shutdown(window, close_window=False))
            _dispose_phase('window completion disposal', lambda: completion_target.clear_window(window))
            _dispose_phase('window watch disposal', lambda: watch.stop(window, reason='window_close'))

    def on_post_window_command(self, window, command_name, args):
        if command_name == 'close_window':
            watch.stop(window, reason='window_close')
        elif command_name in ('close_project', 'add_folder', 'remove_folder'):
            operations.invalidate(window)

    def on_load_project(self, window):
        operations.invalidate(window)

    def on_post_save_project(self, window):
        operations.invalidate(window)

    def on_exit(self):
        _dispose_all('app_exit')
