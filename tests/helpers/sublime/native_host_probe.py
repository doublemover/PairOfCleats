"""Runs inside the actual isolated editor. Never imports/activates the package."""
import hashlib
import json
import os
import re
import sys
import time
import traceback
import sublime
import sublime_plugin


_CONFIG = None
_SEEN = None
_OLD_SCOPE = None
_OLD_OPERATIONS = None
_OLD_LOADED = None
_DEADLINE = None


def _window():
    wanted = os.path.normcase(os.path.realpath(_CONFIG['project']))
    return next((window for window in sublime.windows()
                 if window.project_file_name() and os.path.normcase(os.path.realpath(window.project_file_name())) == wanted), None)


def _commands():
    names = []
    for key in ('application_command_classes', 'window_command_classes', 'text_command_classes'):
        classes = getattr(sublime_plugin, key)
        for command in classes:
            if command.__module__.split('.')[0] != 'PairOfCleats':
                continue
            name = command.__name__
            if name.endswith('Command'):
                name = name[:-7]
            names.append(re.sub(r'([a-z0-9])([A-Z])', r'\1_\2', name).lower())
    return sorted(names)


def _inspect():
    window = _window()
    plugin = sys.modules.get('PairOfCleats.plugin')
    operations = sys.modules.get('PairOfCleats.lib.operations')
    installation = sys.modules.get('PairOfCleats.lib.installation')
    results = sys.modules.get('PairOfCleats.lib.results_state')
    resource_hash = None
    resource_error = None
    try:
        body = sublime.load_resource('Packages/PairOfCleats/editor-config-contract.json')
        json.loads(body)
        resource_hash = hashlib.sha256(body.encode('utf-8')).hexdigest()
    except Exception as error:
        resource_error = str(error)
    return {
        'hostBuild': sublime.version(), 'python': sys.version,
        'executable': sublime.executable_path(), 'packages': sublime.packages_path(), 'cache': sublime.cache_path(),
        'windowReady': window is not None, 'folders': window.folders() if window else [],
        'pluginFile': getattr(plugin, '__file__', None), 'commands': _commands(),
        'contractSha256': resource_hash, 'resourceError': resource_error,
        'diagnostics': installation.installation_diagnostics(sublime) if installation else [],
        'active': bool(operations and operations._ALIVE),
        'oldScopeCurrent': _OLD_OPERATIONS.is_current(_OLD_SCOPE) if _OLD_OPERATIONS and _OLD_SCOPE else None,
        'rootReloaded': bool(plugin and _OLD_LOADED and plugin.plugin_loaded is not _OLD_LOADED),
        'results': results.get_last_results(window) if results and window else None,
        'loadedModules': sorted(name for name in sys.modules if name.startswith('PairOfCleats.'))
    }


def _action(request):
    global _OLD_SCOPE, _OLD_OPERATIONS, _OLD_LOADED
    action = request['action']
    window = _window()
    if action == 'inspect':
        return _inspect()
    if action == 'capture':
        if window is None:
            raise RuntimeError('The explicit fixture project is not open.')
        _OLD_OPERATIONS = sys.modules['PairOfCleats.lib.operations']
        _OLD_SCOPE = _OLD_OPERATIONS.capture(window, 'native-package-qualification')
        _OLD_LOADED = sys.modules['PairOfCleats.plugin'].plugin_loaded
        return _inspect()
    if action == 'search':
        if window is None:
            raise RuntimeError('The explicit fixture project is not open.')
        window.run_command('pair_of_cleats_search', {'query': request['query']})
        return {'submitted': True}
    if action in ('disable', 'enable'):
        preferences = sublime.load_settings('Preferences.sublime-settings')
        ignored = [name for name in preferences.get('ignored_packages', []) if name != 'PairOfCleats']
        if action == 'disable':
            ignored.append('PairOfCleats')
        preferences.set('ignored_packages', ignored)
        sublime.save_settings('Preferences.sublime-settings')
        return {'ignored': ignored}
    if action == 'quit':
        sublime.set_timeout(lambda: sublime.run_command('exit'), 100)
        return {'quitRequested': True}
    raise RuntimeError('Unknown native qualification operation.')


def _poll():
    global _SEEN
    if time.monotonic() > _DEADLINE:
        sublime.run_command('exit')
        return
    try:
        request_path = os.path.join(_CONFIG['fixture'], 'request.json')
        if os.path.isfile(request_path):
            with open(request_path, 'r', encoding='utf-8') as handle:
                request = json.load(handle)
            if request['id'] != _SEEN:
                _SEEN = request['id']
                try:
                    response = {'id': _SEEN, 'ok': True, 'result': _action(request)}
                except Exception:
                    response = {'id': _SEEN, 'ok': False, 'error': traceback.format_exc()[-16000:]}
                target = os.path.join(_CONFIG['fixture'], 'response.json')
                staged = target + '.tmp'
                with open(staged, 'w', encoding='utf-8') as handle:
                    json.dump(response, handle)
                os.replace(staged, target)
    except Exception:
        with open(os.path.join(_CONFIG['fixture'], 'probe-error.txt'), 'w', encoding='utf-8') as handle:
            handle.write(traceback.format_exc())
        sublime.run_command('exit')
        return
    sublime.set_timeout(_poll, 25)


def plugin_loaded():
    global _CONFIG, _DEADLINE
    with open(os.path.join(os.path.dirname(__file__), 'native-qualification.json'), 'r', encoding='utf-8') as handle:
        _CONFIG = json.load(handle)
    if os.path.normcase(os.path.realpath(sublime.packages_path())) != os.path.normcase(os.path.realpath(_CONFIG['packages'])):
        raise RuntimeError('Native editor did not select the disposable package profile.')
    _DEADLINE = time.monotonic() + 24
    sublime.set_timeout(_poll, 25)
