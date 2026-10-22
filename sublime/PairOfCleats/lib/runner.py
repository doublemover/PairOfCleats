import json
import os
import signal
import subprocess
import threading
import time

import sublime

from . import config
from . import tasks
from . import operations
from .watch_progress import read_watch_progress


class ProcessResult(object):
    def __init__(
        self,
        returncode,
        output,
        payload=None,
        error=None,
        stdout='',
        stderr='',
        state='done',
        timed_out=False,
        cancelled=False,
        truncated=False,
        stdout_truncated=False,
        stderr_truncated=False,
    ):
        self.returncode = returncode
        self.output = output
        self.payload = payload
        self.error = error
        self.stdout = stdout
        self.stderr = stderr
        self.state = state
        self.timed_out = timed_out
        self.cancelled = cancelled
        self.truncated = truncated
        self.stdout_truncated = stdout_truncated
        self.stderr_truncated = stderr_truncated


class ProcessHandle(object):
    def __init__(self, process, thread, request_stop=None, task=None, window=None):
        self.process = process
        self.thread = thread
        self._request_stop = request_stop
        self._task = task
        self._window = window
        self._stopper = None
        self._cleanup_failures = []

    def cancel(self):
        if self.process is None or self.process.poll() is not None:
            return
        if self._task and self._window:
            tasks.mark_cancelling(self._window, self._task, details='Cancellation requested.')
        if self._request_stop:
            self._request_stop('cancelled')

    def wait(self, timeout):
        deadline = time.monotonic() + timeout
        if self.thread is not None:
            self.thread.join(timeout)
            if self.thread.is_alive():
                return False
        if self._stopper is not None:
            self._stopper.join(max(0.0, deadline - time.monotonic()))
            if self._stopper.is_alive():
                return False
        return not self._cleanup_failures


DEFAULT_WATCHDOG_MS = 15000
DEFAULT_TIMEOUT_MS = None
DEFAULT_OUTPUT_CAP_CHARS = 200000
TRUNCATION_MARKER = '\n[output truncated]\n'


def _build_spawn_kwargs():
    kwargs = {}
    if os.name == 'nt':
        creationflags = getattr(subprocess, 'CREATE_NEW_PROCESS_GROUP', 0)
        if creationflags:
            kwargs['creationflags'] = creationflags
    else:
        kwargs['start_new_session'] = True
    return kwargs


def _terminate_process_tree(process, force=False):
    if process is None or process.poll() is not None:
        return True
    if os.name == 'nt':
        pid = getattr(process, 'pid', None)
        if pid:
            cmd = ['taskkill', '/PID', str(pid), '/T']
            if force:
                cmd.append('/F')
            try:
                # Sublime Text 3 embeds Python 3.3 (before subprocess.run).
                # Bound a missing/stuck helper and retain direct fallback so
                # request_stop can still schedule its force-stop timer.
                status = subprocess.call(
                    cmd,
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                    timeout=2,
                )
                if status == 0:
                    return True
            except (OSError, subprocess.TimeoutExpired):
                pass
    else:
        pid = getattr(process, 'pid', None)
        if pid:
            try:
                pgid = os.getpgid(pid)
            except Exception:
                pgid = None
            if pgid is not None:
                try:
                    os.killpg(pgid, signal.SIGKILL if force else signal.SIGTERM)
                    return True
                except Exception:
                    pass
    try:
        if force:
            process.kill()
        else:
            process.terminate()
    except Exception:
        pass
    # A direct-process fallback cannot certify the descendant tree on Windows.
    return os.name != 'nt'


def _append_bounded(parts, text, max_chars, truncation_state):
    if not text:
        return
    if max_chars is None or max_chars <= 0:
        parts.append(text)
        return
    current = truncation_state.get('size', 0)
    if current >= max_chars:
        if not truncation_state.get('marked'):
            parts.append(TRUNCATION_MARKER)
            truncation_state['marked'] = True
        truncation_state['truncated'] = True
        return
    remaining = max_chars - current
    if len(text) <= remaining:
        parts.append(text)
        truncation_state['size'] = current + len(text)
        return
    if remaining > 0:
        parts.append(text[:remaining])
        truncation_state['size'] = max_chars
    if not truncation_state.get('marked'):
        parts.append(TRUNCATION_MARKER)
        truncation_state['marked'] = True
    truncation_state['truncated'] = True


def run_process(command, args, cwd=None, env=None, window=None, title='PairOfCleats',
                capture_json=False, on_done=None, stream_output=True,
                panel_name='pairofcleats', watchdog_ms=None, show_progress_panel=None,
                spawn_process=None, timeout_ms=DEFAULT_TIMEOUT_MS,
                output_cap_chars=DEFAULT_OUTPUT_CAP_CHARS, operation_scope=None, on_settled=None):
    if window is None:
        window = sublime.active_window()
    scope = operation_scope or operations.capture(window)
    if not operations.is_current(scope):
        return ProcessHandle(None, None)
    settings = config.get_settings(window) if window is not None else {}
    if show_progress_panel is None:
        show_progress_panel = bool(settings.get('progress_panel_on_start', True))
    if watchdog_ms is None:
        watchdog_ms = settings.get('progress_watchdog_ms') if isinstance(settings, dict) else None
    if not isinstance(watchdog_ms, int) or watchdog_ms <= 0:
        watchdog_ms = DEFAULT_WATCHDOG_MS
    panel = None
    if stream_output:
        panel = _ensure_panel(window, panel_name)
        _show_panel(window, panel_name)

    full_env = dict(os.environ)
    if env:
        full_env.update(env)

    spawn = spawn_process or subprocess.Popen
    try:
        spawn_kwargs = {
            'cwd': cwd or None,
            'env': full_env,
            'stdout': subprocess.PIPE,
            'stderr': subprocess.PIPE,
            'universal_newlines': True,
        }
        if spawn_process is None:
            spawn_kwargs.update(_build_spawn_kwargs())
        proc = spawn([command] + list(args), **spawn_kwargs)
    except Exception as exc:
        result = ProcessResult(
            -1,
            '',
            error='Failed to launch process: {0}'.format(exc),
            state='spawn_failed',
        )
        if callable(on_settled):
            on_settled(result)
        if on_done:
            sublime.set_timeout(lambda: on_done(result) if operations.is_current(scope) else None, 0)
        return ProcessHandle(None, None)
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
        'started_at': time.time(),
        'last_activity_at': time.time(),
        'watchdog_count': 0,
        'done': False,
        'stop_reason': None,
        'stop_lock': threading.Lock(),
        'stdout': {'size': 0, 'truncated': False, 'marked': False},
        'stderr': {'size': 0, 'truncated': False, 'marked': False},
        'combined': {'size': 0, 'truncated': False, 'marked': False},
        'panel': {'size': 0, 'truncated': False, 'marked': False},
    }

    def append_line(line, sink_state):
        with output_lock:
            _append_bounded(combined_lines, line, output_cap_chars, state['combined'])
            _append_bounded(sink_state['parts'], line, output_cap_chars, sink_state['state'])
        with activity_lock:
            state['last_activity_at'] = time.time()
        # Resource failure evidence survives revoked UI publication. Never
        # revive the old scope to render it or replay a command.
        if task and len(line.encode('utf-8')) <= 65536:
            try:
                event = json.loads(line)
                observation = read_watch_progress(event)
                if observation and event['event'] == 'task:end':
                    state['watch_failure'] = bool(state.get('watch_failure') or event.get('status') == 'failed' or observation['ownershipPending'])
                    state['watch_ownership_pending'] = bool(state.get('watch_ownership_pending') or observation['ownershipPending'])
            except (ValueError, TypeError):
                pass
        if task and window and operations.is_current(scope):
            tasks.note_log(task, line)
            if not tasks.note_structured_progress(window, task, line):
                detail = line.strip() or 'Output received.'
                tasks.note_progress(window, task, details=detail[:200])
        if panel is not None and operations.is_current(scope):
            panel_text = []
            _append_bounded(panel_text, line, output_cap_chars, state['panel'])
            if panel_text:
                _append_panel(panel, ''.join(panel_text), scope=scope)

    def done_callback(result):
        if on_done and operations.is_current(scope):
            on_done(result)

    def read_stream(stream, sink):
        try:
            for line in stream:
                append_line(line, sink)
        finally:
            try:
                stream.close()
            except Exception:
                pass

    def request_stop(reason):
        with state['stop_lock']:
            if state['done'] or state['stop_reason'] is not None:
                return
            state['stop_reason'] = reason
        def terminate():
            if not _terminate_process_tree(proc, force=True):
                handle._cleanup_failures.append('Owned descendant termination was not confirmed.')
        stopper = threading.Thread(target=terminate)
        handle._stopper = stopper
        stopper.daemon = True
        stopper.start()

    def worker():
        stdout_sink = {'parts': stdout_lines, 'state': state['stdout']}
        stderr_sink = {'parts': stderr_lines, 'state': state['stderr']}
        stdout_thread = threading.Thread(target=read_stream, args=(proc.stdout, stdout_sink))
        stderr_thread = threading.Thread(target=read_stream, args=(proc.stderr, stderr_sink))
        stdout_thread.daemon = True
        stderr_thread.daemon = True
        stdout_thread.start()
        stderr_thread.start()
        stdout_thread.join()
        stderr_thread.join()
        proc.wait()

        output = ''.join(combined_lines)
        stdout_output = ''.join(stdout_lines)
        stderr_output = ''.join(stderr_lines)
        payload = None
        error = None
        result_state = 'done'
        if capture_json:
            if state['stdout']['truncated']:
                error = 'Process output was truncated before JSON parsing could complete.'
                result_state = 'parse_failed'
            else:
                try:
                    payload = json.loads(stdout_output or '{}')
                except Exception as exc:
                    error = 'Failed to parse JSON output: {0}'.format(exc)
                    result_state = 'parse_failed'
        stop_reason = state['stop_reason']
        if stop_reason == 'timed_out':
            result_state = 'timed_out'
            error = error or 'Process timed out after {0}ms.'.format(timeout_ms)
        elif stop_reason == 'cancelled':
            result_state = 'cancelled'
        elif proc.returncode != 0 and result_state == 'done':
            result_state = 'failed'
        result = ProcessResult(
            proc.returncode,
            output,
            payload=payload,
            error=error,
            stdout=stdout_output,
            stderr=stderr_output,
            state=result_state,
            timed_out=(stop_reason == 'timed_out'),
            cancelled=(stop_reason == 'cancelled'),
            truncated=state['combined']['truncated'],
            stdout_truncated=state['stdout']['truncated'],
            stderr_truncated=state['stderr']['truncated'],
        )
        with activity_lock:
            state['done'] = True
        if handle._stopper is not None:
            handle._stopper.join(2.1)
        if state.get('watch_ownership_pending') or task and (task.get('watch') or {}).get('ownershipPending'):
            handle._cleanup_failures.append('Canonical watch teardown ownership remains pending.')
        cleanup_unconfirmed = bool(handle._cleanup_failures or (handle._stopper is not None and handle._stopper.is_alive()))
        if cleanup_unconfirmed:
            result.error = 'Owned process-tree settlement remains unconfirmed.'
            result.state = 'cleanup_unconfirmed'
        elif state.get('watch_failure') or task and task.get('watchFailure'):
            result.error = 'Canonical watch teardown reported failure; cancellation does not prove success.'
            result.state = 'failed'
        if task and window:
            task['cleanupUnconfirmed'] = cleanup_unconfirmed
            if cleanup_unconfirmed:
                final_status = 'failed'
                detail = result.error
            elif result.timed_out:
                final_status = 'failed'
                detail = error or 'Timed out.'
            elif result.error:
                final_status = 'failed'
                detail = result.error
            elif result.cancelled or task.get('status') == 'cancelling':
                final_status = 'cancelled'
                detail = 'Cancelled.'
            else:
                final_status = 'done' if proc.returncode == 0 else 'failed'
                detail = 'Completed successfully.' if proc.returncode == 0 else (output.strip() or 'Process failed.')
            tasks.complete_task(window, task, status=final_status, details=detail[:240])
        if callable(on_settled):
            on_settled(result)
        sublime.set_timeout(lambda: done_callback(result), 0)
        if not handle._cleanup_failures and (handle._stopper is None or not handle._stopper.is_alive()):
            operations.release(handle)

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
                sublime.set_timeout(lambda message=ui_message: sublime.status_message(message)
                                    if operations.is_current(scope) else None, 0)

    def timeout_watchdog():
        if not isinstance(timeout_ms, int) or timeout_ms <= 0:
            return
        timeout_seconds = timeout_ms / 1000.0
        while True:
            time.sleep(min(0.25, timeout_seconds))
            with activity_lock:
                if state['done']:
                    return
                elapsed = time.time() - state['started_at']
            if elapsed < timeout_seconds:
                continue
            request_stop('timed_out')
            return

    thread = threading.Thread(target=worker)
    thread.daemon = True
    handle = ProcessHandle(proc, thread, request_stop=request_stop, task=task, window=window)
    operations.track(scope, handle)
    if task:
        task['cancel'] = handle.cancel
    thread.start()
    watchdog_thread = threading.Thread(target=watchdog)
    watchdog_thread.daemon = True
    watchdog_thread.start()
    timeout_thread = threading.Thread(target=timeout_watchdog)
    timeout_thread.daemon = True
    timeout_thread.start()

    return handle


def _ensure_panel(window, name):
    panel = window.create_output_panel(name)
    panel.set_read_only(False)
    panel.run_command('select_all')
    panel.run_command('right_delete')
    return panel


def _show_panel(window, name):
    window.run_command('show_panel', {'panel': 'output.{0}'.format(name)})


def _append_panel(panel, text, scope=None):
    def append():
        if scope is not None and not operations.is_current(scope):
            return
        panel.run_command('append', {
            'characters': text,
            'force': True,
            'scroll_to_end': True
        })
    sublime.set_timeout(append, 0)
