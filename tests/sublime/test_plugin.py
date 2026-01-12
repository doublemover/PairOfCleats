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
index_state = importlib.import_module('PairOfCleats.lib.index_state')
indexing = importlib.import_module('PairOfCleats.lib.indexing')
map_lib = importlib.import_module('PairOfCleats.lib.map')
map_state = importlib.import_module('PairOfCleats.lib.map_state')
paths = importlib.import_module('PairOfCleats.lib.paths')
search = importlib.import_module('PairOfCleats.lib.search')
results = importlib.import_module('PairOfCleats.lib.results')
watch = importlib.import_module('PairOfCleats.lib.watch')


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

    def set_project_data(self, data):
        self._project_data = data

    def folders(self):
        return list(self._folders)

    def active_view(self):
        return self._view

    def id(self):
        return 1


class DummyProcess(object):
    def __init__(self, running=True):
        self._running = running

    def poll(self):
        return None if self._running else 0


class DummyHandle(object):
    def __init__(self, process):
        self.process = process
        self.cancelled = False

    def cancel(self):
        self.cancelled = True


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

    def test_map_output_dir_default(self):
        with tempfile.TemporaryDirectory() as root:
            settings = dict(config.DEFAULT_SETTINGS)
            output_dir = map_lib.resolve_output_dir(root, settings)
            expected = os.path.join(root, '.pairofcleats', 'maps')
            self.assertEqual(output_dir, expected)

    def test_build_map_args(self):
        settings = dict(config.DEFAULT_SETTINGS)
        args = map_lib.build_map_args(
            '/repo',
            settings,
            'file',
            'src/app.js',
            'calls',
            'dot',
            '/out.dot',
            '/out.model.json',
            '/out.nodes.json'
        )
        self.assertIn('report', args)
        self.assertIn('map', args)
        self.assertIn('--scope', args)
        self.assertIn('file', args)
        self.assertIn('--include', args)
        self.assertIn('calls', args)

    def test_record_last_map(self):
        window = MockWindow()
        payload = {'outPath': '/tmp/map.dot', 'format': 'dot'}
        map_state.record_last_map(window, payload)
        stored = map_state.get_last_map(window)
        self.assertEqual(stored.get('format'), 'dot')

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

    def test_record_last_build(self):
        window = MockWindow(project_data={})
        state = index_state.record_last_build(window, 'code')
        self.assertEqual(state.get('last_mode'), 'code')
        stored = index_state.get_last_build(window)
        self.assertEqual(stored.get('last_mode'), 'code')

    def test_build_index_args(self):
        args = indexing.build_index_args('code', repo_root='/repo')
        self.assertEqual(args[0:2], ['index', 'build'])
        self.assertIn('--mode', args)
        self.assertIn('--repo', args)

    def test_resolve_watch_root_folder_scope(self):
        settings = dict(config.DEFAULT_SETTINGS)
        settings['index_watch_scope'] = 'folder'
        window = MockWindow(folders=['/workspace/sub'])
        resolved = paths.resolve_watch_root(window, settings)
        self.assertEqual(resolved, '/workspace/sub')

    def test_watch_gating(self):
        window = MockWindow()
        process = DummyProcess(running=True)
        handle = DummyHandle(process)
        watch.register(window, handle, '/repo')
        self.assertTrue(watch.is_running(window))
        stopped = watch.stop(window)
        self.assertTrue(stopped)
        self.assertTrue(handle.cancelled)


if __name__ == '__main__':
    unittest.main()
