import sublime
import sublime_plugin

from .lib import config
from .lib import watch
from .commands import index as _index_commands
from .commands import map as _map_commands
from .commands import search as _search_commands
from .commands import settings as _settings_commands
from .commands import validate as _validate_commands

PLUGIN_NAME = 'PairOfCleats'


def plugin_loaded():
    config.prime_settings()


def plugin_unloaded():
    watch.stop_all()


class PairOfCleatsWindowListener(sublime_plugin.EventListener):
    def on_window_command(self, window, command_name, args):
        if command_name == 'close_window':
            watch.stop(window)

    def on_post_window_command(self, window, command_name, args):
        if command_name == 'close_window':
            watch.stop(window)

    def on_exit(self):
        watch.stop_all()
