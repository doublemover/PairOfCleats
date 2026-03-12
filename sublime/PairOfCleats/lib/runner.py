import json
import os
import subprocess
import threading
import time

import sublime

from . import config
from . import tasks


class ProcessResult(object):
    def __init__(self, returncode, output, payload=None, error=None):
        self.returncode = returncode
        self.output = output
        self.payload = payload
        self.error = error


class ProcessHandle(object):
    def __init__(self, process, thread, on_cancel=None, task=None, window=None):
        self.process = process
        self.thread = thread
        self._on_cancel = on_cancel
        self._task = task
        self._window = window

    def cancel(self):
        if self.process.poll() is not None:
            return
        if self._task and self._window:
            tasks.mark_cancelling(self._window, self._task, details='Cancellation requested.')
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
                panel_name='pairofcleats', watchdog_ms=None, show_progress_panel=None,
                spawn_process=None):
    if window is None:
        window = sublime.active_window()
    settings = config.get_settings(window) if window is not None else {}
    if show_progress_panel is None:
        show_progress_panel = bool(settings.get('progress_panel_on_start', True))
    if watchdog_ms is None:
        watchdog_ms = settings.get('progress_watchdog_ms') if isinstance(settings, dict) else None
    if not isinstance(watchdog_ms, int) or watchdog_ms <= 0:
        watchdog_ms = 15000
    panel = None
    if stream_output:
        panel = _ensure_panel(window, panel_name)
        _show_panel(window, panel_name)

    full_env = dict(os.environ)
    if env:
        full_env.update(env)

    spawn = spawn_process or subprocess.Popen
    proc = spawn(
        [command] + list(args),
        cwd=cwd or None,
        env=full_env,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        universal_newlines=True
    )
    task = tasks.start_task(
        window,
        title,
        kind='subprocess',
        repo_root=cwd,
        cancellable=True,
        details='Starting...',
        show_panel=show_progress_panel,
    )

    stdout_lines = []
    stderr_lines = []
    combined_lines = []
    output_lock = threading.Lock()
    activity_lock = threading.Lock()
    state = {
        'last_activity_at': time.time(),
        'watchdog_count': 0,
        'done': False,
    }

    def append_line(line):
        with output_lock:
            combined_lines.append(line)
        with activity_lock:
            state['last_activity_at'] = time.time()
        if task and window:
            detail = line.strip() or 'Output received.'
            tasks.note_progress(window, task, details=detail[:200])
        if panel is not None:
            _append_panel(panel, line)

    def done_callback(result):
        if on_done:
            on_done(result)

    def read_stream(stream, sink):
        try:
            for line in stream:
                sink.append(line)
                append_line(line)
        finally:
            try:
                stream.close()
            except Exception:
                pass

    def worker():
        stdout_thread = threading.Thread(target=read_stream, args=(proc.stdout, stdout_lines))
        stderr_thread = threading.Thread(target=read_stream, args=(proc.stderr, stderr_lines))
        stdout_thread.daemon = True
        stderr_thread.daemon = True
        stdout_thread.start()
        stderr_thread.start()
        stdout_thread.join()
        stderr_thread.join()
        proc.wait()

        output = ''.join(combined_lines)
        stdout_output = ''.join(stdout_lines)
        payload = None
        error = None
        if capture_json:
            try:
                payload = json.loads(stdout_output or '{}')
            except Exception as exc:
                error = 'Failed to parse JSON output: {0}'.format(exc)
        result = ProcessResult(proc.returncode, output, payload=payload, error=error)
        with activity_lock:
            state['done'] = True
        if task and window:
            if task.get('status') == 'cancelling':
                final_status = 'cancelled'
                detail = 'Cancelled.'
            else:
                final_status = 'done' if proc.returncode == 0 else 'failed'
                detail = 'Completed successfully.' if proc.returncode == 0 else (output.strip() or 'Process failed.')
            tasks.complete_task(window, task, status=final_status, details=detail[:240])
        sublime.set_timeout(lambda: done_callback(result), 0)

    def watchdog():
        timeout_seconds = (watchdog_ms or 0) / 1000.0
        if timeout_seconds <= 0:
            return
        while True:
            time.sleep(min(1.0, timeout_seconds))
            with activity_lock:
                if state['done']:
                    return
                idle_seconds = time.time() - state['last_activity_at']
                warnings = state['watchdog_count']
                if idle_seconds < timeout_seconds * max(1, warnings + 1):
                    continue
                state['watchdog_count'] += 1
            if task and window:
                details = 'No new output for {0:.0f}s.'.format(idle_seconds)
                tasks.note_watchdog(window, task, details=details)
                ui_message = 'PairOfCleats: {0} is still running ({1})'.format(title, details.lower())
                sublime.set_timeout(lambda message=ui_message: sublime.status_message(message), 0)

    thread = threading.Thread(target=worker)
    thread.daemon = True
    thread.start()
    watchdog_thread = threading.Thread(target=watchdog)
    watchdog_thread.daemon = True
    watchdog_thread.start()

    handle = ProcessHandle(proc, thread, task=task, window=window)
    if task:
        task['cancel'] = handle.cancel
    return handle


def _ensure_panel(window, name):
    panel = window.create_output_panel(name)
    panel.set_read_only(False)
    panel.run_command('select_all')
    panel.run_command('right_delete')
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
