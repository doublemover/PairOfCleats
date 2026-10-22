"""Validate the exact buffer/range which admitted an asynchronous completion."""
import sublime


REQUEST_KEY = 'pairofcleats.completion_request'


def capture_target(view):
    if not view or not view.is_valid() or not view.sel():
        return None
    region = view.word(view.sel()[0])
    settings = view.settings()
    request_id = int(settings.get(REQUEST_KEY) or 0) + 1
    settings.set(REQUEST_KEY, request_id)
    return {'view_id': view.id(), 'buffer_id': view.buffer_id(), 'change_count': view.change_count(),
            'start': region.begin(), 'end': region.end(), 'expected_text': view.substr(region),
            'request_id': request_id}


def target_is_current(view, target):
    if not view or not view.is_valid() or not isinstance(target, dict):
        return False
    if (view.id() != target.get('view_id') or view.buffer_id() != target.get('buffer_id')
            or view.change_count() != target.get('change_count')
            or view.settings().get(REQUEST_KEY) != target.get('request_id')):
        return False
    start, end = target.get('start'), target.get('end')
    if not isinstance(start, int) or not isinstance(end, int) or start < 0 or end < start or end > view.size():
        return False
    return view.substr(sublime.Region(start, end)) == target.get('expected_text')


def apply_target(view, edit, text, target):
    if not text or not target_is_current(view, target):
        return False
    view.replace(edit, sublime.Region(target['start'], target['end']), text)
    view.settings().set(REQUEST_KEY, target['request_id'] + 1)
    return True
