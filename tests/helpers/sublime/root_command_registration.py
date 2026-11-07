"""Model the native loader's root-module discovery without opening an editor."""
import importlib
import inspect
import json
import os
import re
import unittest

from runtime_harness import PACKAGE_ROOT, install_fake_modules


class RootCommandRegistrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        _, cls.api = install_fake_modules()
        cls.plugin = importlib.import_module('PairOfCleats.plugin')

    def commands(self):
        bases = (self.api.ApplicationCommand, self.api.WindowCommand, self.api.TextCommand)
        return [(name, value) for name, value in vars(self.plugin).items()
                if inspect.isclass(value) and issubclass(value, bases)]

    def test_advertised_commands_are_native_loader_members_once(self):
        commands = self.commands()
        names = [re.sub(r'([a-z0-9])([A-Z])', r'\1_\2', command.__name__[:-7]).lower()
                 for _, command in commands]
        self.assertEqual(len(names), len(set(names)))
        with open(os.path.join(PACKAGE_ROOT, 'PairOfCleats', 'Default.sublime-commands'), encoding='utf-8') as handle:
            expected = json.load(handle)
        self.assertTrue(expected)
        for entry in expected:
            self.assertIn(entry['command'], names)
        for name, command in commands:
            self.assertEqual(name, command.__name__)
            self.assertTrue(command.__module__.startswith('PairOfCleats.commands.'))

    def test_export_refresh_removes_only_owned_aliases(self):
        plugin = self.plugin
        previous = dict(plugin._EXPORTED_COMMAND_CLASSES)
        stale = type('PairOfCleatsObsoleteCommand', (self.api.WindowCommand,), {})
        sentinel = object()
        plugin.PairOfCleatsObsoleteCommand = stale
        plugin.PairOfCleatsUnowned = sentinel
        plugin._EXPORTED_COMMAND_CLASSES['PairOfCleatsObsoleteCommand'] = stale
        try:
            plugin._EXPORTED_COMMAND_CLASSES = plugin._expose_command_classes()
            self.assertFalse(hasattr(plugin, 'PairOfCleatsObsoleteCommand'))
            self.assertIs(plugin.PairOfCleatsUnowned, sentinel)
            self.assertEqual(plugin._EXPORTED_COMMAND_CLASSES, previous)
            for name, command in previous.items():
                self.assertIs(getattr(plugin, name), command)
        finally:
            del plugin.PairOfCleatsUnowned


if __name__ == '__main__':
    unittest.main()
