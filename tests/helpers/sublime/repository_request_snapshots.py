"""Actual command continuations retain their admitted repository and settings."""
import importlib
import json
import os
from unittest.mock import patch

from runtime_harness import FakeWindow, FakeSettings, install_fake_modules, isolated_temp_directory

sublime, _plugin = install_fake_modules()
config = importlib.import_module('PairOfCleats.lib.config')
paths = importlib.import_module('PairOfCleats.lib.paths')
operations = importlib.import_module('PairOfCleats.lib.operations')
commands = importlib.import_module('PairOfCleats.commands.search')
settings_commands = importlib.import_module('PairOfCleats.commands.settings')
operator = importlib.import_module('PairOfCleats.commands.operator')
service = importlib.import_module('PairOfCleats.lib.service_repository')
api = importlib.import_module('PairOfCleats.lib.api_client')
results_state = importlib.import_module('PairOfCleats.lib.results_state')
operations.activate()


class Window(FakeWindow):
    def __init__(self):
        super().__init__()
        self._settings = FakeSettings()

    def settings(self):
        return self._settings

    def show_input_panel(self, caption, initial, on_done, on_change, on_cancel):
        self.input = {'caption': caption, 'done': on_done, 'cancel': on_cancel}


def refused(call):
    try:
        call()
        raise AssertionError('invalid service membership was admitted')
    except ValueError:
        pass


with isolated_temp_directory() as temporary:
    first, second = [os.path.join(temporary, name) for name in ('first', 'second')]
    for root in (first, second):
        os.makedirs(os.path.join(root, '.git'))
        with open(os.path.join(root, '.git', 'HEAD'), 'w') as handle:
            handle.write('a' * 40)
    window = Window()
    sublime.set_active_window(window)
    window.set_folders([first, second])
    paths.select_repo(window, first)

    # Switch cancellation keeps the original choice; a deliberate switch offers
    # both roots even when one is already selected.
    settings_commands.PairOfCleatsSelectRepoCommand(window).run()
    assert len(window.quick_panel_items) == 2
    window.quick_panel_callback(-1)
    assert paths.resolve_repo_root(window) == first
    settings_commands.PairOfCleatsSelectRepoCommand(window).run()
    window.quick_panel_callback(1)
    assert paths.resolve_repo_root(window) == second

    paths.select_repo(window, first)
    user = sublime.load_settings(config.SETTINGS_FILE)
    user.update({'api_execution_mode': 'require', 'api_server_url': 'http://localhost:7345',
                 'search_advanced_defaults': {'path': ['src/**']},
                 'env': {'FIXTURE': 'original'}, 'open_results_in': 'quick_panel'})
    window.set_project_data({'settings': {'pairofcleats': {'search_limit': 7}}})
    captured_settings = config.get_settings(window)
    user.get('search_advanced_defaults')['path'].append('replacement/**')
    user.get('env')['FIXTURE'] = 'replacement'
    assert captured_settings['search_advanced_defaults']['path'] == ['src/**']
    assert captured_settings['env']['FIXTURE'] == 'original'
    captured_settings['search_advanced_defaults']['path'].append('private/**')
    assert user.get('search_advanced_defaults')['path'] == ['src/**', 'replacement/**']

    mappings, requests = [], []
    user.set('search_advanced_defaults', {'path': ['src/**']})

    def mapping(target_window, settings, root, on_done):
        mappings.append((target_window, settings, root, on_done))

    def asynchronous(request, done, **options):
        requests.append((request, done, options))

    with patch.object(service, 'resolve', side_effect=mapping), \
            patch.object(api, 'run_async', side_effect=asynchronous), \
            patch.object(api, 'search_json', return_value=({'code': []}, {})) as search_json:
        commands.PairOfCleatsSearchCommand(window).run(query='needle')
        assert mappings[-1][2] == first
        paths.select_repo(window, second)
        user.set('api_server_url', 'http://replacement.invalid:9999')
        user.set('search_limit', 99)
        user.get('search_advanced_defaults')['path'].append('wrong/**')
        mappings[-1][3]('/service/original')
        requests[-1][0]()
        call = search_json.call_args
        assert call.args[:2] == ('http://localhost:7345', '/service/original')
        assert call.kwargs['limit'] == 7 and call.kwargs['advanced']['path'] == ['src/**']
        assert requests[-1][2]['task']['repoRoot'] == first
        requests[-1][1](api.ApiResult(payload={'code': [{'file': '/service/original/src/original.py',
            'chunkUid': 'original-hit'}]}))
        session = results_state.get_last_results(window)
        assert session['repoRoot'] == first and session['endpoint'] == 'http://localhost:7345'
        assert session['serviceRoot'] == '/service/original' and session['hits'][0]['file'] == 'src/original.py'

        # Superseded native mapping must never start a request under a fresh key.
        commands.PairOfCleatsSearchCommand(window).run(query='superseded')
        stale_mapping = mappings[-1][3]
        commands.PairOfCleatsSearchCommand(window).run(query='current')
        before = len(requests)
        stale_mapping('/service/stale')
        assert len(requests) == before

        # The actual completion transport has the same original root/endpoint,
        # and a stale response cannot publish callbacks or errors.
        callbacks = []
        user.set('api_server_url', 'http://localhost:7345')
        paths.select_repo(window, first)
        commands._execute_symbol_lookup(window, 'alp', lambda *args: callbacks.append(args))
        saved = mappings[-1][3]
        paths.select_repo(window, second)
        user.set('api_server_url', 'http://replacement.invalid:9999')
        saved('/service/original')
        requests[-1][0]()
        assert search_json.call_args.args[:2] == ('http://localhost:7345', '/service/original')
        stale_done = requests[-1][1]
        commands._execute_symbol_lookup(window, 'beta', lambda *args: callbacks.append(args))
        sublime.last_error = ''
        stale_done(api.ApiResult(error='old failure must remain invisible'))
        assert callbacks == [] and sublime.last_error == ''

    # Service mappings own the original local HEAD through both HTTP response
    # and the native confirmation; malformed provenance never crashes the UI.
    paths.select_repo(window, first)
    user.set('api_server_url', 'http://user:secret@localhost:7345/prefix?token=secret')
    pending = []
    selected = []
    with patch.object(api, 'run_async', side_effect=lambda request, done, **options: pending.append((request, done))), \
            patch.object(api, 'status_json', return_value=({}, {})) as status_json:
        service.resolve(window, config.get_settings(window), first, selected.append, force=True)
        assert 'secret' not in window.input['caption']
        window.input['done']('/srv/雪 repo')
        pending[-1][0]()
        assert status_json.call_args.args[1] == '/srv/雪 repo'
        response = api.ApiResult(payload={'coverage': {'currentProvenance': {
            'head': {'commitId': 'a' * 40}, 'dirty': False}}})
        pending[-1][1](response)
        assert 'secret' not in json.dumps(window.quick_panel_items)
        with open(os.path.join(first, '.git', 'HEAD'), 'w') as handle:
            handle.write('b' * 40)
        window.quick_panel_callback(0)
        assert selected == [] and 'revision changed' in sublime.last_error
        service.resolve(window, config.get_settings(window), first, selected.append, force=True)
        window.input['done']('/srv/雪 repo')
        pending[-1][1](api.ApiResult(payload={'coverage': ['malformed']}))
        assert selected == [] and 'does not match' in sublime.last_error

    # Server Status and Index Health map their local target just like search.
    operator_pending, status_calls = [], []
    user.set('api_server_url', 'http://localhost:7345')
    with patch.object(service, 'resolve', side_effect=mapping), \
            patch.object(api, 'run_async', side_effect=asynchronous), \
            patch.object(api, 'status_json', side_effect=lambda base, root, settings:
                (status_calls.append((base, root)) or ({'repo': {'root': root}}, {}))):
        for command, panel in [(operator.PairOfCleatsServerStatusCommand, operator.STATUS_PANEL),
                               (operator.PairOfCleatsIndexHealthCommand, operator.INDEX_HEALTH_PANEL)]:
            paths.select_repo(window, first)
            command(window).run()
            assert mappings[-1][2] == first
            paths.select_repo(window, second)
            mappings[-1][3]('/service/original')
            payload, headers = requests[-1][0]()
            requests[-1][1](api.ApiResult(payload=payload, headers=headers))
            assert status_calls[-1] == ('http://localhost:7345', '/service/original')
            assert first in window.panels[panel].appended and '/service/original' in window.panels[panel].appended

for value in (None, 1, '../escape.py', '/srv/repo/../other/a.py', '/srv/sibling/a.py',
              'C:\\other\\a.py', 'src/./a.py', 'src//a.py', 'src/a.py\0'):
    refused(lambda value=value: service.relative_file(value, '/srv/repo'))
for payload in ({'code': None}, {'code': [None]}, {'code': [{}]}, {'records': [{'file': 7}]}):
    refused(lambda payload=payload: service.map_payload(payload, '/srv/repo'))
assert service.relative_file('C:\\repo\\src\\a.py', 'C:\\repo') == 'src/a.py'
assert service.relative_file('/srv/雪 repo/src/a.py', '/srv/雪 repo') == 'src/a.py'
original = {'code': [{'file': '/srv/repo/a.py', 'nested': {'value': 1}}]}
mapped = service.map_payload(original, '/srv/repo')
mapped['code'][0]['nested']['value'] = 2
assert original['code'][0]['nested']['value'] == 1 and original['code'][0]['file'] == '/srv/repo/a.py'
print('Sublime repository requests retain original configuration, mapping and publication authority')
