import importlib
import hashlib
import json
import os
from unittest.mock import patch
from runtime_harness import FakeWindow, FakeView, FakeRegion, install_fake_modules, isolated_temp_directory

sublime, _ = install_fake_modules()
discovery = importlib.import_module('PairOfCleats.lib.semantic_discovery')
operations = importlib.import_module('PairOfCleats.lib.operations')
runner = importlib.import_module('PairOfCleats.lib.runner')
semantic = importlib.import_module('PairOfCleats.commands.semantic')
paths = importlib.import_module('PairOfCleats.lib.paths')
operations.activate()
window = FakeWindow()
generation = {'baseBuildId': 'retained-build', 'semanticRevision': 0}
section = {'schemaVersion': 1, 'repoRoot': '/selected-root', 'generation': generation, 'status': 'partial',
           'discovery': {'generation': generation}, 'detail': None, 'trace': None, 'followUps': [],
           'selector': {'field': 'sourcePath', 'value': 'snow 雪.py'}, 'warnings': ['partial remains partial']}
assert discovery.generation_from_context_pack({'semantic': section}, '/selected-root')['generation'] == generation
assert discovery.generation_from_context_pack({'semantic': section}, '/different-root') is None
assert discovery.generation_from_context_pack({'runtime': {'buildId': 'guess'}}, '/selected-root') is None
assert discovery.api_client.read_workflow_capabilities({'runtimeManifest': {'surfaces': {'api': {
    'workflowCapabilities': {'semantic-find': False}}}}, 'capabilities': {'semantic-find': True}})['semantic-find'] is False
try:
    discovery.generation_from_context_pack({'semantic': dict(section, trace={
        'generation': {'baseBuildId': 'changed', 'semanticRevision': 0}})}, '/selected-root')
    raise AssertionError('mixed semantic generations were admitted')
except ValueError:
    pass
request = discovery.context_discovery_request('/selected-root', 'file:snow 雪.py')
assert request['includeSemantic'] is True and request['includeGraph'] is False and request['includeRisk'] is False
assert request['maxBytes'] == 8192 and request['maxWallClockMs'] == 250
calls, accepted, errors = [], [], []


def invoke(command, args, **options):
    calls.append((command, args, options))
    options['on_done'](runner.ProcessResult(0, '', payload={'semantic': section}))


with patch.object(discovery.runner, 'run_process', side_effect=invoke):
    discovery.discover_generation(window, {'root': '/selected-root', 'settings': {'api_execution_mode': 'cli'},
        'scope': operations.capture(window)}, 'file:snow 雪.py', accepted.append, errors.append)
assert accepted[0]['generation'] == generation and errors == []
assert calls[0][1][calls[0][1].index('--repo') + 1] == '/selected-root'
assert calls[0][2]['operation_scope'] and calls[0][2]['timeout_ms'] == 5000


class SourceView(FakeView):
    def is_dirty(self):
        return False

    def rowcol(self, point):
        before = self.text[:point]
        return before.count('\n'), len(before.rsplit('\n', 1)[-1])

    def text_point(self, row, column):
        return sum(len(line) for line in self.text.splitlines(True)[:row]) + column


with isolated_temp_directory() as temporary:
    os.makedirs(os.path.join(temporary, '.git'))
    filename = os.path.join(temporary, 'snow 雪.py')
    retained = 'snow = "😀"; WidgetBuilder()\r\n'
    with open(filename, 'wb') as handle:
        handle.write(retained.encode('utf-8'))
    view = SourceView(filename, retained.replace('\r\n', '\n'))
    point = view.text.index('WidgetBuilder')
    view.sel()[:] = [FakeRegion(point, point)]
    window.set_folders([temporary])
    window.set_active_view(view)
    paths.select_repo(window, temporary)
    target = {'partitionId': 'sy1:' + 'a' * 64, 'localId': 2}
    navigation_calls, semantic_calls = [], []
    def navigate(command, args, **options):
        navigation_calls.append((command, args, options))
        assert args[:2] == ['tooling', 'navigate']
        assert args[args.index('--source-hash') + 1] == hashlib.sha256(retained.encode('utf-8')).hexdigest()
        assert int(args[args.index('--column') + 1]) == len(view.text[:point].encode('utf-16-le')) // 2 + 1
        payload = {'ok': True, 'status': 'resolved', 'generation': generation,
                   'sourceHash': args[args.index('--source-hash') + 1],
                   'sourceVersion': str(view.change_count()), 'coordinateUnit': 'utf16',
                   'binding': {'status': 'resolved', 'targetId': json.dumps(target)}, 'results': []}
        options['on_done'](runner.ProcessResult(0, '', payload=payload))
    with patch.object(runner, 'run_process', side_effect=navigate), \
            patch.object(semantic, 'execute', side_effect=lambda selected_window, operation, request, context, done:
                         semantic_calls.append((operation, request))):
        semantic.PairOfCleatsSemanticEvidenceCommand(window).run(repo_root=temporary)
        assert window.quick_panel_items[0] == 'Use Current Source-qualified Cursor Binding'
        window.quick_panel_callback(0)
    assert len(navigation_calls) == 1, 'first use must actually request the canonical current source binding'
    assert semantic_calls[0][0] == 'find' and semantic_calls[0][1]['selector'] == {'target': target}
    assert semantic_calls[0][1]['generation'] == generation
print('Sublime canonical generation discovery preserves scope, bounds and unknown states')
