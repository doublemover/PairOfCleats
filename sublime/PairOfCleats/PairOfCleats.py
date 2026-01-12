import sublime

from .lib import config

PLUGIN_NAME = 'PairOfCleats'


def plugin_loaded():
    config.prime_settings()


def plugin_unloaded():
    pass
