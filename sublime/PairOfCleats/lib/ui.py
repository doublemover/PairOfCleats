import sublime


def show_error(message):
    try:
        sublime.error_message(message)
    except Exception:
        print(message)


def show_status(message):
    try:
        sublime.status_message(message)
    except Exception:
        print(message)
