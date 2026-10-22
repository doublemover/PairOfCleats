"""Contract authoring only until invoked by the supported test runner."""
import importlib
import json
import os

from runtime_harness import FakeRegion, FakeWindow, install_fake_modules, isolated_temp_directory

sublime, _plugin = install_fake_modules()
paths = importlib.import_module('PairOfCleats.lib.paths')
config = importlib.import_module('PairOfCleats.lib.config')
search = importlib.import_module('PairOfCleats.lib.search')
semantic = importlib.import_module('PairOfCleats.commands.semantic')
evidence = importlib.import_module('PairOfCleats.commands.evidence')
settings_commands = importlib.import_module('PairOfCleats.commands.settings')
results = importlib.import_module('PairOfCleats.lib.results')
tasks = importlib.import_module('PairOfCleats.lib.tasks')
operations = importlib.import_module('PairOfCleats.lib.operations')
service = importlib.import_module('PairOfCleats.lib.service_repository')
operations.activate()
window = FakeWindow()
sublime.set_active_window(window)

with isolated_temp_directory() as temporary:
    first = os.path.join(temporary, 'first')
    second = os.path.join(temporary, 'second')
    for root in (first, second):
        os.makedirs(os.path.join(root, '.git'))
        with open(os.path.join(root, '.git', 'HEAD'), 'w') as handle:
            handle.write('a' * 40)
    window.set_folders([first, second])
    assert paths.resolve_repo_root(window) is None
    paths.select_repo(window, first)
    assert paths.resolve_repo_root(window) == first
    assert window.project_data() == {}, 'selection never rewrites the project'
    window.set_folders([second])
    assert paths.resolve_repo_root(window) == second, 'removed selected roots are reconciled'
    paths.select_repo(window)
    assert service.git_head(second) == 'a' * 40
    assert service.relative_file('/srv/雪 repo/src/a.py', '/srv/雪 repo') == 'src/a.py'
    assert service.relative_file('C:\\repo\\src\\a.py', 'C:\\repo') == 'src/a.py'
    try:
        service.relative_file('/srv/sibling/a.py', '/srv/repo')
        raise AssertionError('sibling traversal was admitted')
    except ValueError:
        pass
    assert results.resolve_hit_path({'file': '../first/a.py'}, second) is None

settings = config.get_settings(window)
settings.update({'env': {'TOKEN': 'never-print-secret'},
                 'api_server_url': 'http://user:never-print-secret@localhost:7345/?token=never-print-secret'})
rendered = settings_commands._render_effective_settings(settings, {})
assert 'never-print-secret' not in rendered
assert '[redacted]' in rendered

args = search.build_search_args('', repo_root='/repo', mode='records', advanced={'modified_since': 0}, cursor='opaque')
assert args[-2:] == ['--', '']
assert args[args.index('--cursor') + 1] == 'opaque'
assert '--modified-since' in args
assert search.has_effective_filter({'modified_since': 0})
assert not search.has_effective_filter({'case': True})
assert search.build_search_payload('', repo_root='/repo', mode='all', advanced={'type': 'function'}, cursor='opaque')['cursor'] == 'opaque'
try:
    search.build_search_payload('', backend='tantivy')
    raise AssertionError('unsupported API backend was admitted')
except ValueError:
    pass

generation = {'baseBuildId': 'build-a', 'semanticRevision': 0}
ref = {'partitionId': 'sy1:' + 'a' * 64, 'localId': 1}
detail = semantic.request_for('detail', '/repo', generation, ref)
assert detail['refs'] == [ref]
assert detail['limits'] == {'records': 128, 'bytes': 65536, 'workMs': 250, 'rows': 512}
trace = semantic.request_for('trace', '/repo', generation, ref, 'downstream')
assert trace['generation'] == generation and trace['limits']['edges'] == 512
assert trace['direction'] == 'downstream' and trace['limits']['depth'] == 2
assert semantic.request_for('enrichment', '/repo', generation, ['task'])['action'] == 'plan'
assert 'does not prove absence of flow' in semantic.describe({'status': 'partial', 'generation': generation})

cancelled = []
first_task = tasks.start_task(window, 'first', repo_root='/one', cancellable=True, cancel=lambda: cancelled.append('one'), show_panel=False)
second_task = tasks.start_task(window, 'second', repo_root='/two', cancellable=True, cancel=lambda: cancelled.append('two'), show_panel=False)
frame = {'proto': 'poc.progress@2', 'event': 'task:progress', 'ts': '2026-10-22T10:00:00.000Z',
         'stage': 'parsing', 'current': 2, 'total': 7, 'message': 'Structured evidence'}
assert tasks.note_structured_progress(window, first_task, json.dumps(frame))
assert first_task['stage'] == 'parsing' and first_task['current'] == 2
assert not tasks.note_structured_progress(window, second_task, '[api] listening: untrusted log prose')
assert second_task['status'] == 'starting'
assert tasks.cancel_task(window, second_task['id']) is second_task
assert cancelled == ['two'] and first_task['status'] == 'indexing'
assert tasks.cancel_task(window, 9999999) is None

packet = {'version': '1.0.0', 'seed': {'type': 'file', 'path': 'a.py'},
          'primary': {'ref': None, 'file': 'a.py', 'excerpt': '[do not execute](command:example)'},
          'provenance': {'repo': '/repo', 'indexSignature': 'a', 'generatedAt': '2026-10-22T10:00:00.000Z', 'capsUsed': {}},
          'evidence': {'schemaVersion': 1, 'complete': False},
          'warnings': [{'code': 'partial_frontier', 'message': 'Unknown flow remains'}]}
encoded, markdown = evidence.render_preview([packet], 'Inspect partial flow', ['one excluded'])
assert json.loads(encoded) == [packet], 'canonical packets retain warnings/provenance unchanged'
assert 'Unknown flow remains' in markdown and 'one excluded' in markdown
assert 'Token estimate unavailable' in markdown


class CoordinateView(object):
    text = 'a😀z\nsecond'

    def text_point(self, row, column):
        return sum(len(line) for line in self.text.splitlines(True)[:row]) + column

    def line(self, point):
        end = self.text.find('\n', point)
        return FakeRegion(point, len(self.text) if end < 0 else end)

    def substr(self, region):
        return self.text[region.a:region.b]


view = CoordinateView()
assert results._utf16_point(view, 0, 3) == 2, 'astral code point counts two UTF-16 units'
assert results._utf16_point(view, 1, 2) == 6, 'multiline end column uses its own row'
print('Extended Sublime repository, filter, semantic, task and evidence contracts passed')
