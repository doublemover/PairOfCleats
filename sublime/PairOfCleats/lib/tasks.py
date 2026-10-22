import time
import json
import math
from datetime import datetime

import sublime

from . import ui
from . import operations

TASK_PANEL = 'pairofcleats-progress'
_ACTIVE_TASKS = {}
_RECENT_TASKS = {}
_NEXT_TASK_ID = 1
_MAX_RECENT_TASKS = 8


def _window_id(window):
    if window is None:
        return None
    try:
        return window.id()
    except Exception:
        return id(window)


def _now():
    return time.time()


def _next_task_id():
    global _NEXT_TASK_ID
    task_id = _NEXT_TASK_ID
    _NEXT_TASK_ID += 1
    return task_id


def start_task(window, title, kind='task', repo_root=None, cancellable=False, cancel=None,
               details=None, show_panel=True):
    if window is None:
        window = sublime.active_window()
    if window is None:
        return None
    task = {
        'id': _next_task_id(),
        'windowId': _window_id(window),
        'title': title,
        'kind': kind,
        'repoRoot': repo_root or '',
        'cancellable': bool(cancellable),
        'cancel': cancel,
        'details': details or '',
        'status': 'starting',
        'stage': 'indeterminate',
        'current': None,
        'total': None,
        'startedAt': _now(),
        'lastActivityAt': _now(),
        'lastWatchdogAt': None,
        'watchdogCount': 0,
        '_scope': operations.capture(window),
    }
    _ACTIVE_TASKS.setdefault(task['windowId'], []).append(task)
    _render(window, show_panel=show_panel)
    return task


def note_progress(window, task, details=None):
    if not task or task.get('completedAt') is not None:
        return
    task['lastActivityAt'] = _now()
    if details is not None:
        task['details'] = details
    _render(window)


def note_log(task, line):
    if not task or task.get('completedAt') is not None or not line:
        return
    raw = line.encode('utf-8')[:8192]
    text = raw.decode('utf-8', 'ignore')
    rows = task.setdefault('logTail', [])
    rows.append(text)
    task['logTailBytes'] = task.get('logTailBytes', 0) + len(text.encode('utf-8'))
    while len(rows) > 128 or task['logTailBytes'] > 65536:
        task['logTailBytes'] -= len(rows.pop(0).encode('utf-8'))
        task['logTailTruncated'] = True


def note_structured_progress(window, task, line):
    """Consume poc.progress@2; never derive stages or readiness from log prose."""
    if not task or task.get('completedAt') is not None or len(line.encode('utf-8')) > 65536:
        return False
    try:
        event = json.loads(line)
        if (not isinstance(event, dict) or event.get('proto') != 'poc.progress@2'
                or event.get('event') not in ('hello', 'job:start', 'job:spawn', 'job:end',
                    'job:artifacts', 'runtime:metrics', 'event:chunk', 'task:start',
                    'task:progress', 'task:end', 'log')):
            return False
        timestamp = event.get('ts')
        if not isinstance(timestamp, str):
            return False
        parsed_time = None
        for pattern in ('%Y-%m-%dT%H:%M:%S.%fZ', '%Y-%m-%dT%H:%M:%SZ'):
            try:
                parsed_time = datetime.strptime(timestamp, pattern)
                break
            except ValueError:
                pass
        if parsed_time is None:
            return False
    except (ValueError, KeyError, TypeError):
        return False
    if task.get('status') == 'cancelling':
        task['lastActivityAt'] = _now()
        _render(window)
        return True
    task['stage'] = str(event.get('stage') or event.get('name') or task.get('stage') or 'indeterminate')[:256]
    task['details'] = str(event.get('message') or event.get('text') or task.get('details') or '')[:1024]
    for field in ('current', 'total'):
        value = event.get(field)
        task[field] = value if isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) and value >= 0 else None
    if event['event'] in ('task:start', 'task:progress'):
        task['status'] = 'indexing'
    elif event['event'] == 'job:end':
        task['status'] = 'failed' if event.get('status') == 'failed' else 'settling'
    task['lastActivityAt'] = _now()
    _render(window)
    return True


def note_watchdog(window, task, details=None):
    if not task or task.get('completedAt') is not None:
        return
    task['lastWatchdogAt'] = _now()
    task['watchdogCount'] += 1
    if details:
        task['details'] = details
    _render(window, show_panel=True)


def mark_cancelling(window, task, details=None):
    if not task or task.get('completedAt') is not None:
        return
    task['status'] = 'cancelling'
    task['lastActivityAt'] = _now()
    if details:
        task['details'] = details
    _render(window, show_panel=True)


def complete_task(window, task, status='done', details=None):
    if not task:
        return
    if task.get('completedAt') is not None:
        return
    task['status'] = status
    task['completedAt'] = _now()
    if details is not None:
        task['details'] = details
    window_id = task.get('windowId')
    active = _ACTIVE_TASKS.get(window_id) or []
    _ACTIVE_TASKS[window_id] = [entry for entry in active if entry.get('id') != task.get('id')]
    recent = _RECENT_TASKS.setdefault(window_id, [])
    recent.insert(0, dict(task))
    del recent[_MAX_RECENT_TASKS:]
    _render(window)


def active_tasks(window):
    return list(_ACTIVE_TASKS.get(_window_id(window)) or [])


def recent_tasks(window):
    return list(_RECENT_TASKS.get(_window_id(window)) or [])


def show_progress(window):
    _render(window, show_panel=True)


def cancel_active(window):
    tasks = active_tasks(window)
    for task in reversed(tasks):
        cancel = task.get('cancel')
        if not task.get('cancellable') or not callable(cancel):
            continue
        mark_cancelling(window, task, details='Cancellation requested.')
        cancel()
        return task
    return None


def cancel_task(window, task_id):
    task = next((entry for entry in active_tasks(window) if entry['id'] == task_id), None)
    if not task or not task.get('cancellable') or not callable(task.get('cancel')):
        return None
    mark_cancelling(window, task, details='Cancellation requested; waiting for owned process settlement.')
    task['cancel']()
    return task


def clear_window(window):
    confirmed = operations.shutdown(window)
    window_id = _window_id(window)
    if confirmed:
        _ACTIVE_TASKS.pop(window_id, None)
    _RECENT_TASKS.pop(window_id, None)


def clear_all():
    for active in _ACTIVE_TASKS.values():
        for task in active:
            task['status'] = 'interrupted'
            task['details'] = 'Editor disposed; owned operation settlement remains tracked.'
            cancel = task.get('cancel')
            if callable(cancel):
                cancel()
    _RECENT_TASKS.clear()


def _format_age(seconds):
    seconds = max(0.0, float(seconds))
    if seconds < 1:
        return '{0:.0f}ms'.format(seconds * 1000.0)
    if seconds < 60:
        return '{0:.1f}s'.format(seconds)
    minutes, rem = divmod(int(seconds), 60)
    return '{0}m {1}s'.format(minutes, rem)


def _render(window, show_panel=False):
    if window is None:
        window = sublime.active_window()
    if window is None:
        return
    if not operations.is_current(operations.capture(window)):
        return
    now = _now()
    lines = ['PairOfCleats task progress', '']
    active = active_tasks(window)
    if active:
        lines.append('Active:')
        for task in active:
            elapsed = _format_age(now - task.get('startedAt', now))
            idle = _format_age(now - task.get('lastActivityAt', now))
            lines.append('- [{0}] {1} ({2}, idle {3})'.format(
                task.get('status') or 'running',
                task.get('title') or task.get('kind') or 'task',
                elapsed,
                idle,
            ))
            if task.get('repoRoot'):
                lines.append('  repo: {0}'.format(task['repoRoot']))
            lines.append('  operation: {0}; stage: {1}; counters: {2}/{3}'.format(
                task['id'], task.get('stage', 'indeterminate'),
                task.get('current') if task.get('current') is not None else 'unknown',
                task.get('total') if task.get('total') is not None else 'unknown'))
            if task.get('details'):
                lines.append('  detail: {0}'.format(task['details']))
            if task.get('watchdogCount'):
                lines.append('  watchdog: {0} warning(s)'.format(task['watchdogCount']))
        lines.append('')
    recent = recent_tasks(window)
    if recent:
        lines.append('Recent:')
        for task in recent:
            duration = _format_age(task.get('completedAt', now) - task.get('startedAt', now))
            lines.append('- [{0}] {1} ({2})'.format(
                task.get('status') or 'done',
                task.get('title') or task.get('kind') or 'task',
                duration,
            ))
            if task.get('details'):
                lines.append('  detail: {0}'.format(task['details']))
            if task.get('watchdogCount'):
                lines.append('  watchdog: {0} warning(s)'.format(task['watchdogCount']))
        lines.append('')
    if not active and not recent:
        lines.append('No active or recent PairOfCleats tasks.')
        lines.append('')
    text = '\n'.join(lines)
    ui.write_output_panel(window, TASK_PANEL, text, show_panel=show_panel)
