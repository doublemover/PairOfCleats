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
                capture_json=False, on_done=None):
    if window is None:
        window = sublime.active_window()
    panel = _ensure_panel(window)
    _show_panel(window, panel)

    full_env = dict(os.environ)
    if env:
        full_env.update(env)

    proc = subprocess.Popen(
        [command] + list(args),
        cwd=cwd or None,
        env=full_env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        universal_newlines=True
    )

    output_lines = []

    def append_line(line):
        output_lines.append(line)
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


def _ensure_panel(window):
    panel = window.create_output_panel('pairofcleats')
    panel.set_read_only(False)
    return panel


def _show_panel(window, panel):
    window.run_command('show_panel', {'panel': 'output.pairofcleats'})


def _append_panel(panel, text):
    def append():
        panel.run_command('append', {
            'characters': text,
            'force': True,
            'scroll_to_end': True
        })
    sublime.set_timeout(append, 0)
