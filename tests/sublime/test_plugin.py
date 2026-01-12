import importlib
import os
import sys
import tempfile
import types
import unittest

BASE_SETTINGS = {}


def install_sublime_stubs():
    sublime = types.ModuleType('sublime')

    class DummySettings(object):
        def __init__(self, values):
            self._values = values

        def get(self, key, default=None):
            return self._values.get(key, default)

    def load_settings(_name):
        return DummySettings(BASE_SETTINGS)

    sublime.load_settings = load_settings
    sublime.set_timeout = lambda fn, _delay=0: fn()
    sublime.error_message = lambda _message: None
    sublime.status_message = lambda _message: None
    sublime.active_window = lambda: None
    sublime.ENCODED_POSITION = 1

    class Region(object):
        def __init__(self, a, b):
            self.a = a
            self.b = b

    sublime.Region = Region

    sublime_plugin = types.ModuleType('sublime_plugin')

    class WindowCommand(object):
        def __init__(self, window=None):
            self.window = window

    sublime_plugin.WindowCommand = WindowCommand

    class TextCommand(object):
        def __init__(self, view=None):
            self.view = view

    sublime_plugin.TextCommand = TextCommand

    sys.modules['sublime'] = sublime
    sys.modules['sublime_plugin'] = sublime_plugin


install_sublime_stubs()

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
PACKAGE_ROOT = os.path.join(REPO_ROOT, 'sublime')
if PACKAGE_ROOT not in sys.path:
    sys.path.insert(0, PACKAGE_ROOT)

config = importlib.import_module('PairOfCleats.lib.config')
paths = importlib.import_module('PairOfCleats.lib.paths')
search = importlib.import_module('PairOfCleats.lib.search')
results = importlib.import_module('PairOfCleats.lib.results')


class MockView(object):
    def __init__(self, filename=None):
        self._filename = filename

    def file_name(self):
        return self._filename


class MockWindow(object):
    def __init__(self, project_data=None, folders=None, view=None):
        self._project_data = project_data or {}
        self._folders = folders or []
        self._view = view

    def project_data(self):
        return self._project_data

    def folders(self):
        return list(self._folders)

    def active_view(self):
        return self._view


class SublimePluginTests(unittest.TestCase):
    def setUp(self):
        BASE_SETTINGS.clear()
        BASE_SETTINGS.update(config.DEFAULT_SETTINGS)

    def test_find_repo_root_prefers_pairofcleats_json(self):
        with tempfile.TemporaryDirectory() as root:
            os.makedirs(os.path.join(root, 'src'))
            open(os.path.join(root, '.pairofcleats.json'), 'w').close()
            target = os.path.join(root, 'src', 'file.txt')
            open(target, 'w').close()

            resolved = paths.find_repo_root(target)
            self.assertEqual(resolved, root)

    def test_find_repo_root_git_fallback(self):
        with tempfile.TemporaryDirectory() as root:
            os.makedirs(os.path.join(root, 'src'))
            git_dir = os.path.join(root, '.git')
            os.makedirs(git_dir)
            target = os.path.join(root, 'src', 'file.txt')
            open(target, 'w').close()

            resolved = paths.find_repo_root(target)
            self.assertEqual(resolved, root)

    def test_resolve_cli_prefers_configured_path(self):
        with tempfile.TemporaryDirectory() as root:
            os.makedirs(os.path.join(root, 'bin'))
            cli_path = os.path.join(root, 'bin', 'pairofcleats.js')
            open(cli_path, 'w').close()
            settings = dict(config.DEFAULT_SETTINGS)
            settings['pairofcleats_path'] = 'bin/pairofcleats.js'
            settings['node_path'] = '/usr/bin/node'

            resolved = paths.resolve_cli(settings, root)
            self.assertEqual(resolved['command'], '/usr/bin/node')
            self.assertEqual(resolved['args_prefix'], [cli_path])
            self.assertEqual(resolved['source'], 'settings')

    def test_resolve_cli_local_bin(self):
        with tempfile.TemporaryDirectory() as root:
            bin_dir = os.path.join(root, 'node_modules', '.bin')
            os.makedirs(bin_dir)
            local_cli = os.path.join(bin_dir, 'pairofcleats.cmd')
            open(local_cli, 'w').close()
            settings = dict(config.DEFAULT_SETTINGS)

            resolved = paths.resolve_cli(settings, root)
            self.assertEqual(resolved['command'], local_cli)
            self.assertEqual(resolved['args_prefix'], [])
            self.assertEqual(resolved['source'], 'node_modules')

    def test_settings_merge_project_overrides(self):
        BASE_SETTINGS['open_results_in'] = 'quick_panel'
        BASE_SETTINGS['env'] = {'PAIROFCLEATS_CACHE_ROOT': 'A'}
        project_data = {
            'settings': {
                'pairofcleats': {
                    'open_results_in': 'output_panel',
                    'env': {
                        'PAIROFCLEATS_CACHE_ROOT': 'B'
                    }
                }
            }
        }
        window = MockWindow(project_data=project_data)
        settings = config.get_settings(window)

        self.assertEqual(settings['open_results_in'], 'output_panel')
        self.assertEqual(settings['env']['PAIROFCLEATS_CACHE_ROOT'], 'B')

    def test_validate_settings_reports_invalid_values(self):
        settings = dict(config.DEFAULT_SETTINGS)
        settings['index_mode_default'] = 'invalid'
        settings['open_results_in'] = 'nowhere'
        errors = config.validate_settings(settings)
        self.assertTrue(errors)

    def test_build_search_args(self):
        args = search.build_search_args(
            'alpha',
            repo_root='/repo',
            mode='code',
            backend='memory',
            limit=5,
            explain=True
        )
        self.assertIn('--json', args)
        self.assertIn('--mode', args)
        self.assertIn('--backend', args)
        self.assertIn('--top', args)
        self.assertIn('--explain', args)
        self.assertIn('/repo', args)

    def test_collect_hits_tolerates_partial_payload(self):
        payload = {
            'code': [{'file': 'src/a.py'}],
            'prose': None,
            'records': 'bad',
            'extractedProse': [{'file': 'docs/readme.md'}]
        }
        hits = results.collect_hits(payload)
        files = [hit.get('file') for hit in hits]
        self.assertIn('src/a.py', files)
        self.assertIn('docs/readme.md', files)


if __name__ == '__main__':
    unittest.main()
