def extract_selection(view):
    if view is None:
        return ''
    for region in view.sel():
        empty = getattr(region, 'empty', None)
        if callable(empty):
            if not empty():
                return view.substr(region)
            continue
        if getattr(region, 'a', None) != getattr(region, 'b', None):
            return view.substr(region)
    return ''


def extract_symbol(view):
    if view is None:
        return ''
    selection = view.sel()
    if not selection:
        return ''
    region = selection[0]
    word = view.word(region)
    return view.substr(word)
