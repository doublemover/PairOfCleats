"""Validate the exact buffer/range which admitted an asynchronous completion."""
import sublime
import copy
import uuid
from collections import OrderedDict
from . import operations


REQUEST_KEY = 'pairofcleats.completion_request'
_TARGETS = OrderedDict()
MAX_TARGETS = 128


def capture_target(view):
    if not view or not view.is_valid() or not view.sel() or not view.window():
        return None
    region = view.word(view.sel()[0])
    settings = view.settings()
    previous = settings.get(REQUEST_KEY)
    request_id = previous + 1 if type(previous) is int and previous >= 0 else 1
    settings.set(REQUEST_KEY, request_id)
    target = {'view_id': view.id(), 'buffer_id': view.buffer_id(), 'change_count': view.change_count(),
            'start': region.begin(), 'end': region.end(), 'expected_text': view.substr(region),
            'request_id': request_id, 'nonce': uuid.uuid4().hex}
    _TARGETS.pop(view.id(), None)
    _TARGETS[view.id()] = {'target': copy.deepcopy(target), 'windowId': view.window().id(),
        'file': view.file_name(), 'scope': operations.capture(view.window())}
    while len(_TARGETS) > MAX_TARGETS:
        _TARGETS.popitem(last=False)
    return target


def clear_view(view):
    if view is not None:
        _TARGETS.pop(view.id(), None)


def clear_window(window):
    for view_id, captured in list(_TARGETS.items()):
        if window is not None and captured['windowId'] == window.id():
            _TARGETS.pop(view_id, None)


def clear_all():
    _TARGETS.clear()


def target_is_current(view, target):
    if not view or not view.is_valid() or not isinstance(target, dict):
        return False
    captured = _TARGETS.get(view.id())
    if (not captured or captured['target'] != target or not operations.is_current(captured['scope'])
            or not view.window() or view.window().id() != captured['windowId']
            or view.file_name() != captured['file']):
        return False
    if (view.id() != target.get('view_id') or view.buffer_id() != target.get('buffer_id')
            or view.change_count() != target.get('change_count')
            or view.settings().get(REQUEST_KEY) != target.get('request_id')):
        return False
    start, end = target.get('start'), target.get('end')
    if type(start) is not int or type(end) is not int or start < 0 or end < start or end > view.size():
        return False
    return view.substr(sublime.Region(start, end)) == target.get('expected_text')


def apply_target(view, edit, text, target):
    if not text or not target_is_current(view, target):
        return False
    view.replace(edit, sublime.Region(target['start'], target['end']), text)
    view.settings().set(REQUEST_KEY, target['request_id'] + 1)
    clear_view(view)
    return True
