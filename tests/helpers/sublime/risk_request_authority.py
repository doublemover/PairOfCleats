"""Actual risk/context commands preserve original root, seed and lifetime."""
import importlib
import os
from unittest.mock import patch

from runtime_harness import FakeWindow, FakeView, install_fake_modules, isolated_temp_directory

sublime, _plugin = install_fake_modules()
analysis = importlib.import_module('PairOfCleats.commands.analysis')
paths = importlib.import_module('PairOfCleats.lib.paths')
operations = importlib.import_module('PairOfCleats.lib.operations')
runner = importlib.import_module('PairOfCleats.lib.runner')
state = importlib.import_module('PairOfCleats.lib.results_state')
operations.activate()


class Window(FakeWindow):
    def show_input_panel(self, caption, initial, on_done, on_change, on_cancel):
        self.input = {'done': on_done, 'cancel': on_cancel}


with isolated_temp_directory() as temporary:
    first, second = [os.path.join(temporary, name) for name in ('first', 'second')]
    generation_dir = os.path.join(temporary, 'custom-cache', 'code-only-build', 'index-code')
    for root in (first, second):
        os.makedirs(os.path.join(root, '.git'))
        os.makedirs(os.path.join(root, 'src'))
    os.makedirs(os.path.join(generation_dir, 'pieces'))
    # Opaque publication-presence witness only. The CLI is inert; this fixture
    # does not claim to decode a native artifact or validate its format.
    with open(os.path.join(generation_dir, 'pieces', 'manifest.json'), 'w') as handle:
        handle.write('{}')
    window = Window()
    window.set_folders([first, second])
    source = FakeView(os.path.join(first, 'src', 'original.py'), 'original')
    window.set_active_view(source)
    sublime.set_active_window(window)
    paths.select_repo(window, first)
    calls = []

    def invoke(command, args, **options):
        calls.append((command, args, options))

    def packet(chunk='original'):
        return {'provenance': {'repo': first, 'indexDir': generation_dir, 'indexSignature': 'selected-code-generation'},
                'primary': {'ref': {'chunkUid': chunk}, 'file': 'src/original.py'},
                'risk': {'anchor': {'chunkUid': chunk}}}

    def risk(chunk='original'):
        return {'chunk': {'chunkUid': chunk, 'file': 'src/original.py'}, 'summary': {}, 'flows': [],
                'warnings': ['Partial indexed evidence remains partial']}

    def complete(call, payload=None, error=None):
        call[2]['on_done'](runner.ProcessResult(0, '', payload=payload, error=error))

    def qualification(seed='chunk:original'):
        return {'source': 'context-pack', 'repoRoot': first, 'mode': 'code', 'indexDir': generation_dir,
                'indexSignature': 'selected-code-generation', 'seed': seed, 'chunkUid': 'original'}

    with patch.object(analysis.paths, 'resolve_cli', return_value={'command': 'inert-cli', 'args_prefix': []}), \
            patch.object(analysis.runner, 'run_process', side_effect=invoke):
        command = analysis.PairOfCleatsRiskExplainCommand(window)
        destination = os.path.join(temporary, 'risk.json')
        command.run(chunk='original', export_json=True, out_path=destination)
        seed_call = calls[-1]
        paths.select_repo(window, second)
        seed_packet = packet()
        complete(seed_call, seed_packet)
        risk_call = calls[-1]
        assert risk_call[1][:2] == ['risk', 'explain'] and risk_call[2]['cwd'] == first
        assert risk_call[1][risk_call[1].index('--index') + 1] == generation_dir
        assert risk_call[1][risk_call[1].index('--chunk') + 1] == 'original'
        seed_packet['provenance']['indexDir'] = os.path.join(first, 'index-code')
        seed_packet['risk']['anchor']['chunkUid'] = 'replacement'
        complete(risk_call, risk())
        saved = state.get_last_risk_explain(window)
        assert saved['repoRoot'] == first and os.path.isfile(destination)
        assert saved['payload']['sourceQualification']['indexDir'] == generation_dir
        assert saved['payload']['sourceQualification']['chunkUid'] == 'original'
        assert 'does not independently reattest' in saved['text']

        # A different returned chunk does not inherit the requested seed's
        # qualification and cannot overwrite prior evidence or an export.
        paths.select_repo(window, first)
        command.run(chunk='original', export_json=True, out_path=destination + '.wrong')
        complete(calls[-1], packet())
        complete(calls[-1], risk('wrong'))
        assert 'selected chunk identity' in sublime.last_error
        assert not os.path.exists(destination + '.wrong')
        assert state.get_last_risk_explain(window)['payload'] == saved['payload']

        # Canonical resolver disagreement is refused before risk dispatch.
        for response in (packet('wrong'), dict(packet(), risk={'anchor': {'chunkUid': 'wrong'}}),
                         dict(packet(), provenance=[])):
            command.run(chunk='original')
            count = len(calls)
            complete(calls[-1], response)
            assert len(calls) == count
            assert state.get_last_risk_explain(window)['payload'] == saved['payload']

        # Retained file/symbol seeds dispatch their qualified chunk rather than
        # passing the original selector text as a chunk UID.
        for seed in ('chunk:original', 'file:src/original.py', 'symbol:Original'):
            selected = qualification(seed)
            before = len(calls)
            command.run(chunk=seed, source_qualification=selected)
            assert len(calls) == before + 1 and calls[-1][1][:2] == ['risk', 'explain']
            assert calls[-1][1][calls[-1][1].index('--chunk') + 1] == 'original'
            selected['indexDir'] = 'replacement'
            selected['chunkUid'] = 'replacement'
            complete(calls[-1], risk())
            assert state.get_last_risk_explain(window)['payload']['sourceQualification']['indexDir'] == generation_dir

        for change in ({'chunkUid': 'wrong'}, {'seed': 'chunk:wrong'}, {'chunkUid': None},
                       {'indexDir': 'relative/index-code'}, {'repoRoot': second}):
            before = len(calls)
            command.run(chunk='original', source_qualification=dict(qualification(), **change))
            assert len(calls) == before

        # Older context resolution cannot start risk after a newer request.
        command.run(chunk='older')
        older = calls[-1]
        command.run(chunk='current')
        before = len(calls)
        complete(older, packet('older'))
        assert len(calls) == before
        complete(calls[-1], packet('current'))
        complete(calls[-1], risk('current'))
        sublime.last_error = ''
        complete(older, error='old failure must stay invisible')
        assert sublime.last_error == ''

        # Native analysis hit/action and direction pickers retain their own
        # original project epoch rather than acquiring fresh dispatch scopes.
        actions = analysis.PairOfCleatsAnalysisActionsCommand(window)
        with patch.object(analysis.results, 'apply_hit_action') as applied:
            actions.run(source='risk-explain')
            old_hit = window.quick_panel_callback
            operations.invalidate(window)
            old_hit(0)
            assert not applied.called
            actions.run(source='risk-explain')
            window.quick_panel_callback(0)
            old_action = window.quick_panel_callback
            operations.invalidate(window)
            old_action(0)
            assert not applied.called
        directions = []
        analysis._prompt_direction(window, directions.append)
        old_direction = window.quick_panel_callback
        operations.invalidate(window)
        old_direction(0)
        assert directions == []

        # An originating owned read/cleanup failure remains authoritative even
        # when the child also has a nonzero exit and secondary output.
        command.run(chunk='original')
        complete(calls[-1], packet())
        calls[-1][2]['on_done'](runner.ProcessResult(2, 'secondary risk exit output',
            error='original owned risk read failure'))
        assert sublime.last_error == 'original owned risk read failure'
        analysis.PairOfCleatsContextPackCommand(window).run(seed='file:src/original.py')
        calls[-1][2]['on_done'](runner.ProcessResult(2, 'secondary context exit output',
            error='original owned context read failure'))
        assert sublime.last_error == 'original owned context read failure'

        # Input uses the root resolved before the prompt, and replacement
        # project/closed window cannot authorize a late resolution/export.
        paths.select_repo(window, first)
        command.run()
        original_input = window.input['done']
        paths.select_repo(window, second)
        original_input('original')
        assert calls[-1][2]['cwd'] == first
        command.run()
        stale_input = window.input['done']
        window.set_folders([second])
        before = len(calls)
        stale_input('must-not-run')
        assert len(calls) == before
        window.set_folders([first, second])
        paths.select_repo(window, first)
        command.run(chunk='original', export_json=True, out_path=destination + '.closed')
        complete(calls[-1], packet())
        pending = calls[-1]
        operations.shutdown(window, timeout=0)
        complete(pending, risk())
        assert not os.path.exists(destination + '.closed')

        operations.activate()
        paths.select_repo(window, second)
        # A contextual source seed belongs to its own file repository even if
        # the window's explicit general read-only selection points elsewhere.
        analysis.PairOfCleatsContextPackCommand(window).run()
        assert calls[-1][1][calls[-1][1].index('--repo') + 1] == first
        assert calls[-1][1][calls[-1][1].index('--seed') + 1] == 'file:src/original.py'

print('Sublime risk and context commands retain original generation selection, chunk identity and lifetime')
