import json
import os
import subprocess
import threading

import sublime


class ProcessResult(object):
    def __init__(self, returncode, output, payload=None, error=None):
        self.returncode = returncode
        self.output = output
        self.payload = payload
        self.error = error


class ProcessHandle(object):
    def __init__(self, process, thread, on_cancel=None):
        self.process = process
        self.thread = thread
        self._on_cancel = on_cancel

    def cancel(self):
        if self.process.poll() is not None:
            return
        try:
            self.process.terminate()
        except Exception:
            pass
        if self._on_cancel:
            self._on_cancel()
        timer = threading.Timer(1.5, self._kill_if_running)
        timer.daemon = True
        timer.start()

    def _kill_if_running(self):
        if self.process.poll() is not None:
            return
        try:
            self.process.kill()
        except Exception:
            pass


def run_process(command, args, cwd=None, env=None, window=None, title='PairOfCleats',
                capture_json=False, on_done=None, stream_output=True,
                panel_name='pairofcleats'):
    if window is None:
        window = sublime.active_window()
    panel = None
    if stream_output:
        panel = _ensure_panel(window, panel_name)
        _show_panel(window, panel_name)

    full_env = dict(os.environ)
    if env:
        full_env.update(env)

    cmd = command
    cmd_args = list(args)

    # Windows: `.cmd`/`.bat` wrappers (npm bin) are not directly executable via CreateProcess.
    # Run them through cmd.exe for reliable cross-platform behavior.
    if os.name == 'nt':
        lowered = (command or '').lower()
        if lowered.endswith('.cmd') or lowered.endswith('.bat'):
            cmd = os.environ.get('COMSPEC') or 'cmd.exe'
            cmd_args = ['/c', command] + cmd_args
        elif lowered.endswith('.ps1'):
            # PowerShell scripts require an interpreter.
            cmd = 'powershell'
            cmd_args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', command] + cmd_args

    proc = subprocess.Popen(
        [cmd] + cmd_args,
        cwd=cwd or None,
        env=full_env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        universal_newlines=True
    )

    output_lines = []

    def append_line(line):
        output_lines.append(line)
        if panel is not None:
            _append_panel(panel, line)

    def done_callback(result):
        if on_done:
            on_done(result)

    def worker():
        try:
            for line in proc.stdout:
                append_line(line)
        finally:
            proc.wait()

        output = ''.join(output_lines)
        payload = None
        error = None
        if capture_json:
            try:
                payload = json.loads(output or '{}')
            except Exception as exc:
                error = 'Failed to parse JSON output: {0}'.format(exc)
        result = ProcessResult(proc.returncode, output, payload=payload, error=error)
        sublime.set_timeout(lambda: done_callback(result), 0)

    thread = threading.Thread(target=worker)
    thread.daemon = True
    thread.start()

    return ProcessHandle(proc, thread)


def _ensure_panel(window, name):
    panel = window.create_output_panel(name)
    panel.set_read_only(False)
    return panel


def _show_panel(window, name):
    window.run_command('show_panel', {'panel': 'output.{0}'.format(name)})


def _append_panel(panel, text):
    def append():
        panel.run_command('append', {
            'characters': text,
            'force': True,
            'scroll_to_end': True
        })
    sublime.set_timeout(append, 0)
