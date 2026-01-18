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


def write_output_panel(window, name, text):
    if window is None:
        window = sublime.active_window()
    if window is None:
        return None

    panel = window.create_output_panel(name)
    panel.set_read_only(False)
    panel.run_command('select_all')
    panel.run_command('right_delete')
    panel.run_command('append', {
        'characters': text,
        'force': True,
        'scroll_to_end': False
    })
    panel.set_read_only(True)
    window.run_command('show_panel', {'panel': 'output.{0}'.format(name)})
    return panel
