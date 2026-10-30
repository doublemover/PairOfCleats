"""Runs inside the actual isolated editor. Never imports/activates the package."""
import hashlib
import json
import os
import re
import sys
import time
import traceback
import threading
import sublime
import sublime_plugin


_CONFIG = None
_OLD_SCOPE = None
_OLD_OPERATIONS = None
_OLD_LOADED = None
_DEADLINE = None
_LOG_LOCK = threading.RLock()
_LOG_BYTES = 0
_LOG_FAILURE = None
_ORIGINAL_STDOUT = None
_ORIGINAL_STDERR = None
_ORIGINAL_ERROR_MESSAGE = None
_TRACE_FILE = None
_PROJECT_WINDOWS = set()
_OPERATION_EVENTS = []
_OPERATION_TRACES = []


def _observe_operations(operations):
    if not operations or not _CONFIG.get('captureOperationEvents'):
        return
    for name in ('capture', 'invalidate', 'shutdown', 'is_current'):
        original = getattr(operations, name)
        if any(current is original for _, _, _, current in _OPERATION_TRACES):
            continue

        def trace(method, label):
            def observed(*args, **kwargs):
                before = {key: value['epoch'] for key, value in operations._STATES.items()}
                result = method(*args, **kwargs)
                if len(_OPERATION_EVENTS) < 64 and (label != 'is_current' or result is False):
                    scope = args[0] if args and isinstance(args[0], dict) else None
                    event = {'name': label, 'before': before,
                             'after': {key: value['epoch'] for key, value in operations._STATES.items()},
                             'scopeEpoch': scope.get('epoch') if scope else None,
                             'scopeContext': scope.get('context') if scope else None,
                             'caller': traceback.format_stack(limit=3)[:-1]}
                    _OPERATION_EVENTS.append(event)
                    _diagnostic('[native operation] ' + json.dumps(event) + '\n')
                return result
            return observed

        current = trace(original, name)
        _OPERATION_TRACES.append((operations, name, original, current))
        setattr(operations, name, current)


class PoCNativeProjectListener(sublime_plugin.EventListener):
    def on_load_project(self, window):
        _PROJECT_WINDOWS.add(window.id())


def _diagnostic(text):
    global _LOG_BYTES, _LOG_FAILURE
    try:
        data = text.encode('utf-8', 'replace')[:8192]
        with _LOG_LOCK:
            data = data[:max(0, 65536 - _LOG_BYTES)]
            if data:
                with open(os.path.join(_CONFIG['fixture'], 'native-diagnostics.log'), 'ab') as handle:
                    handle.write(data)
                _LOG_BYTES += len(data)
    except Exception as error:
        _LOG_FAILURE = str(error)


class _DiagnosticTee:
    def __init__(self, original):
        self.original = original

    def write(self, text):
        _diagnostic(text)
        return self.original.write(text)

    def __getattr__(self, key):
        return getattr(self.original, key)


def _observed_error_message(message):
    _diagnostic('[native error_message] ' + str(message) + '\n')
    return _ORIGINAL_ERROR_MESSAGE(message)


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
    _observe_operations(operations)
    installation = sys.modules.get('PairOfCleats.lib.installation')
    results = sys.modules.get('PairOfCleats.lib.results_state')
    search = sys.modules.get('PairOfCleats.commands.search')
    state = operations._STATES.get(window.id()) if operations and window else None
    search_state = None
    if search and window:
        command = search.PairOfCleatsSearchCommand(window)
        search_state = {'name': command.name(), 'enabled': command.is_enabled()}
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
        'projectLoaded': bool(window and window.id() in _PROJECT_WINDOWS),
        'pluginFile': getattr(plugin, '__file__', None), 'commands': _commands(),
        'contractSha256': resource_hash, 'resourceError': resource_error,
        'diagnostics': installation.installation_diagnostics(sublime) if installation else [],
        'active': bool(operations and operations._ALIVE),
        'diagnosticCaptureError': _LOG_FAILURE,
        'apiReady': getattr(sublime_plugin, 'api_ready', None),
        'operationState': {'epoch': state['epoch'], 'closed': state['closed'], 'keys': dict(state['keys'])} if state else None,
        'operationEvents': list(_OPERATION_EVENTS),
        'searchCommand': search_state,
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
    if action == 'open-project':
        if not sublime_plugin.api_ready or sublime.active_window() is None:
            raise RuntimeError('Native observer must be ready before opening the project.')
        sublime.active_window().run_command('open_project_or_workspace', {
            'file': _CONFIG['project'], 'new_window': False})
        return {'projectRequested': True}
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
    if time.monotonic() > _DEADLINE:
        sublime.run_command('exit')
        return
    try:
        requests = os.path.join(_CONFIG['fixture'], 'requests')
        pending = sorted(name for name in os.listdir(requests) if name.endswith('.json'))
        if pending:
            request_path = os.path.join(requests, pending[0])
            with open(request_path, 'r', encoding='utf-8') as handle:
                request = json.load(handle)
            os.unlink(request_path)
            try:
                response = {'id': request['id'], 'ok': True, 'result': _action(request)}
            except Exception:
                response = {'id': request['id'], 'ok': False, 'error': traceback.format_exc()[-16000:]}
            target = os.path.join(_CONFIG['fixture'], 'responses', request['id'] + '.json')
            staged = target + '.tmp'
            with open(staged, 'w', encoding='utf-8') as handle:
                json.dump(response, handle)
            os.rename(staged, target)
    except Exception:
        with open(os.path.join(_CONFIG['fixture'], 'probe-error.txt'), 'w', encoding='utf-8') as handle:
            handle.write(traceback.format_exc())
        sublime.run_command('exit')
        return
    sublime.set_timeout(_poll, 25)


def plugin_loaded():
    global _CONFIG, _DEADLINE, _ORIGINAL_STDOUT, _ORIGINAL_STDERR, _ORIGINAL_ERROR_MESSAGE, _TRACE_FILE
    with open(os.path.join(os.path.dirname(__file__), 'native-qualification.json'), 'r', encoding='utf-8') as handle:
        _CONFIG = json.load(handle)
    if os.path.normcase(os.path.realpath(sublime.packages_path())) != os.path.normcase(os.path.realpath(_CONFIG['packages'])):
        raise RuntimeError('Native editor did not select the disposable package profile.')
    _ORIGINAL_STDOUT, _ORIGINAL_STDERR = sys.stdout, sys.stderr
    _ORIGINAL_ERROR_MESSAGE = sublime.error_message
    sys.stdout, sys.stderr = _DiagnosticTee(sys.stdout), _DiagnosticTee(sys.stderr)
    sublime.error_message = _observed_error_message
    if _CONFIG.get('captureThreadDump'):
        try:
            import faulthandler
            _TRACE_FILE = open(os.path.join(_CONFIG['fixture'], 'native-python-threads.log'), 'w')
            faulthandler.dump_traceback_later(6, file=_TRACE_FILE)
        except Exception as error:
            _diagnostic('[thread trace unavailable] ' + str(error) + '\n')
    _DEADLINE = time.monotonic() + 24
    sublime.set_timeout(_poll, 25)


def plugin_unloaded():
    for operations, name, original, current in _OPERATION_TRACES:
        if getattr(operations, name) is current:
            setattr(operations, name, original)
    if _TRACE_FILE is not None:
        import faulthandler
        faulthandler.cancel_dump_traceback_later()
        _TRACE_FILE.close()
    if isinstance(sys.stdout, _DiagnosticTee):
        sys.stdout = _ORIGINAL_STDOUT
    if isinstance(sys.stderr, _DiagnosticTee):
        sys.stderr = _ORIGINAL_STDERR
    if sublime.error_message is _observed_error_message:
        sublime.error_message = _ORIGINAL_ERROR_MESSAGE
