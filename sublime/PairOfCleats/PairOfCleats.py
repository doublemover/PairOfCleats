import sublime
import sublime_plugin

from .lib import config
from .lib import watch

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
