import time

import sublime

from . import ui

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
        'status': 'running',
        'startedAt': _now(),
        'lastActivityAt': _now(),
        'lastWatchdogAt': None,
        'watchdogCount': 0,
    }
    _ACTIVE_TASKS.setdefault(task['windowId'], []).append(task)
    _render(window, show_panel=show_panel)
    return task


def note_progress(window, task, details=None):
    if not task:
        return
    task['lastActivityAt'] = _now()
    if details is not None:
        task['details'] = details
    _render(window)


def note_watchdog(window, task, details=None):
    if not task:
        return
    task['lastWatchdogAt'] = _now()
    task['watchdogCount'] += 1
    if details:
        task['details'] = details
    _render(window, show_panel=True)


def mark_cancelling(window, task, details=None):
    if not task:
        return
    task['status'] = 'cancelling'
    task['lastActivityAt'] = _now()
    if details:
        task['details'] = details
    _render(window, show_panel=True)


def complete_task(window, task, status='done', details=None):
    if not task:
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


def clear_window(window):
    window_id = _window_id(window)
    _ACTIVE_TASKS.pop(window_id, None)
    _RECENT_TASKS.pop(window_id, None)


def clear_all():
    _ACTIVE_TASKS.clear()
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
