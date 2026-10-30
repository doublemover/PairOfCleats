"""Actual native export consumers retain old files and primary fault authority."""
import importlib
import json
import os
from unittest.mock import patch

from runtime_harness import FakeWindow, install_fake_modules, isolated_temp_directory

sublime, _plugin = install_fake_modules()
evidence = importlib.import_module('PairOfCleats.commands.evidence')
analysis = importlib.import_module('PairOfCleats.commands.analysis')
publication = importlib.import_module('PairOfCleats.lib.publication')
operations = importlib.import_module('PairOfCleats.lib.operations')
runner = importlib.import_module('PairOfCleats.lib.runner')
results_state = importlib.import_module('PairOfCleats.lib.results_state')
operations.activate()


class Window(FakeWindow):
    def show_input_panel(self, caption, initial, done, changed, cancelled):
        self.input = {'done': done, 'cancelled': cancelled}


class FaultFile:
    def __init__(self, handle, phase, primary, cleanup=None, revoke=None):
        self.handle, self.phase, self.primary = handle, phase, primary
        self.cleanup, self.revoke, self.closes = cleanup, revoke, 0

    def write(self, data):
        if self.phase == 'write':
            self.handle.write(data[:3])
            raise self.primary
        if self.phase == 'short-write':
            return self.handle.write(data[:3])
        return self.handle.write(data)

    def flush(self):
        if self.phase == 'flush':
            raise self.primary
        self.handle.flush()

    def fileno(self):
        return self.handle.fileno()

    def close(self):
        self.closes += 1
        self.handle.close()
        if self.revoke:
            self.revoke()
        if self.phase == 'close' and self.closes == 1:
            raise self.primary
        if self.cleanup:
            raise self.cleanup


def save_reviewed(window, destination, text, scope=None):
    scope = scope or operations.capture(window, key='evidence-collection')
    evidence.PairOfCleatsCopyContextCommand(window)._publish(text, '# Markdown', scope)
    window.quick_panel_callback(2)
    window.input['done'](destination)


with isolated_temp_directory() as root:
    window = Window()
    window.set_folders([root])
    sublime.set_active_window(window)
    destination = os.path.join(root, 'reviewed evidence \u03bb.json')
    original = b'previous acknowledged bytes\r\n'
    reviewed = '["exact \u03bb evidence"]\n'
    actual_fdopen = publication.os.fdopen

    def restore():
        with open(destination, 'wb') as handle:
            handle.write(original)
        window.opened_files[:] = []
        sublime.last_error = ''

    def assert_old(phase):
        with open(destination, 'rb') as handle:
            assert handle.read() == original, phase
        assert not window.opened_files, phase

    for phase in ('write', 'short-write', 'flush', 'fsync', 'close', 'replace', 'fdopen'):
        restore()
        primary = OSError('original ' + phase + ' failure')
        if phase in ('write', 'short-write', 'flush', 'close'):
            interception = patch.object(publication.os, 'fdopen', side_effect=lambda descriptor, mode:
                FaultFile(actual_fdopen(descriptor, mode), phase, primary))
        else:
            owner = publication.os
            interception = patch.object(owner, phase, side_effect=primary)
        with interception:
            save_reviewed(window, destination, reviewed)
        assert_old(phase)
        assert ('original ' + phase + ' failure' in sublime.last_error
                if phase != 'short-write' else 'incomplete' in sublime.last_error)
        assert not [name for name in os.listdir(root) if name.endswith('.tmp')], phase

    # Failure objects survive helper teardown unchanged; close and temp-removal
    # failures remain independently attached to that original resource error.
    restore()
    primary, cleanup = OSError('original write fault'), OSError('independent close fault')
    with patch.object(publication.os, 'fdopen', side_effect=lambda descriptor, mode:
            FaultFile(actual_fdopen(descriptor, mode), 'write', primary, cleanup=cleanup)), \
            patch.object(publication.os, 'unlink', side_effect=OSError('independent removal fault')):
        try:
            analysis._write_json(destination, {'reviewed': 'original'})
        except OSError as error:
            assert error is primary
            assert any('independent close fault' in value for value in error.pairofcleats_cleanup_errors)
            assert any('independent removal fault' in value for value in error.pairofcleats_cleanup_errors)
            retained_path = error.pairofcleats_recovery_path
        else:
            raise AssertionError('the original write failure was lost')
    assert_old('independent cleanup faults')
    assert os.path.isfile(retained_path)
    os.unlink(retained_path)

    # Publication rechecks the original operation after closing staged bytes.
    # Project replacement during staging leaves the old destination untouched.
    restore()
    scope = operations.capture(window, key='evidence-collection')
    with patch.object(publication.os, 'fdopen', side_effect=lambda descriptor, mode:
            FaultFile(actual_fdopen(descriptor, mode), None, None,
                      revoke=lambda: operations.invalidate(window))):
        save_reviewed(window, destination, reviewed, scope)
    assert_old('revoked original request')
    assert sublime.last_error == ''
    assert not [name for name in os.listdir(root) if name.endswith('.tmp')]

    restore()
    scope = operations.capture(window, key='evidence-collection')
    with patch.object(publication.os, 'fdopen', side_effect=lambda descriptor, mode:
            FaultFile(actual_fdopen(descriptor, mode), None, None,
                      revoke=lambda: operations.invalidate(window))), \
            patch.object(publication.os, 'unlink', side_effect=OSError('cancelled cleanup fault')), \
            patch('builtins.print') as printed:
        save_reviewed(window, destination, reviewed, scope)
        assert printed.called and 'cancelled cleanup fault' in printed.call_args[0][0]
        assert 'Unremoved staged export:' in printed.call_args[0][0]
    assert_old('revoked export cleanup failure')
    for name in os.listdir(root):
        if name.endswith('.tmp'):
            os.unlink(os.path.join(root, name))

    # Exact reviewed bytes are published once. Opening the saved file can fail
    # independently without reporting a failed save or suppressing its status.
    notifications = []
    restore()
    with patch.object(window, 'open_file', side_effect=RuntimeError('original host open failure')), \
            patch.object(publication.ui, 'show_status', side_effect=lambda text: notifications.append(text)):
        save_reviewed(window, destination, reviewed)
        duplicate = window.input['done']
        with patch.object(publication.os, 'replace') as replace:
            duplicate(destination)
            assert not replace.called
    with open(destination, 'rb') as handle:
        assert handle.read() == reviewed.encode('utf-8')
    assert notifications and 'saved reviewed evidence' in notifications[0]
    assert 'saved reviewed evidence' in sublime.last_error and 'original host open failure' in sublime.last_error
    assert 'save failed' not in sublime.last_error

    scope = operations.capture(window, key='evidence-collection')
    evidence.PairOfCleatsCopyContextCommand(window)._publish(reviewed, '# Markdown', scope)
    with patch.object(sublime, 'set_clipboard', side_effect=OSError('original clipboard failure')):
        window.quick_panel_callback(0)
    assert 'original clipboard failure' in sublime.last_error

    with patch.object(window, 'open_file', side_effect=RuntimeError('open fault')), \
            patch.object(publication.ui, 'show_status', side_effect=RuntimeError('status fault')), \
            patch.object(publication.ui, 'show_error', side_effect=RuntimeError('error display fault')), \
            patch('builtins.print') as printed:
        failures = publication.notify_saved(window, destination, 'reviewed evidence')
        assert len(failures) == 3 and printed.called

    # The actual Context Pack consumer must not publish a new session or a
    # successful export when file replacement fails.
    calls = []
    payload = {'version': '1.0.0', 'seed': {'type': 'file', 'path': 'original.py'},
        'primary': {'file': 'original.py'}, 'evidence': {}, 'provenance': {}}
    old_session = {'repoRoot': root, 'text': 'previous acknowledged evidence', 'hits': []}
    results_state.record_last_context_pack(window, old_session)
    restore()
    context = {'repo_root': root, 'settings': {'api_execution_mode': 'cli'},
        'cli': {'command': 'inert-cli', 'args_prefix': []}, 'env': {},
        'scope': operations.capture(window, key='analysis-context-pack')}
    with patch.object(analysis.runner, 'run_process', side_effect=lambda *args, **options: calls.append(options)):
        analysis.PairOfCleatsContextPackCommand(window)._execute(
            'file:original.py', 0, False, False, False, True, destination, context)
    with patch.object(publication.os, 'replace', side_effect=OSError('original analysis replace failure')):
        calls[0]['on_done'](runner.ProcessResult(0, '', payload=payload))
    assert_old('analysis consumer failure')
    assert results_state.get_last_context_pack(window)['text'] == old_session['text']
    assert 'original analysis replace failure' in sublime.last_error

    # A successfully published analysis export still receives its saved-file
    # notification when independent project-history and result-panel steps fail.
    restore()
    statuses = []
    with patch.object(analysis, '_record_analysis_session', side_effect=OSError('history display fault')), \
            patch.object(analysis.results, 'open_output_panel', side_effect=RuntimeError('panel display fault')), \
            patch.object(publication.ui, 'show_status', side_effect=lambda text: statuses.append(text)):
        calls[0]['on_done'](runner.ProcessResult(0, '', payload=payload))
    with open(destination, 'rb') as handle:
        assert json.loads(handle.read().decode('utf-8')) == payload
    assert statuses and 'saved context pack JSON' in statuses[0]
    assert window.opened_files and 'history display fault' in sublime.last_error and 'panel display fault' in sublime.last_error

    # A failed analysis remains the first diagnostic if saving its diagnostic
    # JSON also fails; a secondary export error cannot replace its cause.
    generic_calls = []
    with patch.object(analysis.runner, 'run_process', side_effect=lambda *args, **options: generic_calls.append(options)):
        analysis._execute_analysis_command(window, 'inert analysis', 'architecture-check', root, [],
            lambda payload: [], lambda payload, hits: 'diagnostic evidence',
            export_json=True, out_path=destination, context=context)
    with patch.object(publication.os, 'replace', side_effect=OSError('secondary export failure')):
        generic_calls[0]['on_done'](runner.ProcessResult(2, '',
            payload={'ok': False, 'message': 'original analysis failure'}))
    assert sublime.last_error.startswith('original analysis failure\n')
    assert 'secondary export failure' in sublime.last_error

    # Serialization errors precede even staging and do not truncate a previous
    # export. Successful analysis export reuses the same direct-save owner.
    with patch.object(publication.tempfile, 'mkstemp') as staged:
        try:
            analysis._write_json(destination, {'invalid': object()})
        except TypeError:
            pass
        else:
            raise AssertionError('serialization must reject unsupported values')
        assert not staged.called
    with open(destination, 'rb') as handle:
        assert json.loads(handle.read().decode('utf-8')) == payload
    analysis._write_json(destination, payload)
    with open(destination, 'rb') as handle:
        assert handle.read() == (json.dumps(payload, indent=2, sort_keys=False) + '\n').encode('utf-8')

print('Sublime direct export consumers preserve destinations and independent failure authority')
