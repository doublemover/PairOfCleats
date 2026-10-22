import sublime
import sublime_plugin

from .lib import config
from .lib import tasks
from .lib import watch
from .lib import operations
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


def plugin_unloaded():
    watch.stop_all(reason='plugin_unload')
    operations.shutdown(all_windows=True)
    tasks.clear_all()


class PairOfCleatsWindowListener(sublime_plugin.EventListener):
    def on_window_command(self, window, command_name, args):
        if command_name == 'close_window':
            watch.stop(window, reason='window_close')
            operations.shutdown(window)

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
        watch.stop_all(reason='app_exit')
        operations.shutdown(all_windows=True)
        tasks.clear_all()
