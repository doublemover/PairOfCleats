import os
import sys

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
PACKAGE_ROOT = os.path.join(REPO_ROOT, 'sublime')
if PACKAGE_ROOT not in sys.path:
    sys.path.insert(0, PACKAGE_ROOT)


class FakeSettings:
    def __init__(self):
        self._data = {}

    def get(self, key, default=None):
        return self._data.get(key, default)

    def set(self, key, value):
        self._data[key] = value

    def update(self, values):
        for key, value in (values or {}).items():
            self._data[key] = value

    def clear(self):
        self._data.clear()


class FakeRegion:
    def __init__(self, a, b):
        self.a = a
        self.b = b

    def empty(self):
        return self.a == self.b


class FakeSelection(list):
    pass


class FakeView:
    def __init__(self, file_name=None, text=''):
        self._file_name = file_name
        self._settings = FakeSettings()
        self.appended = ''
        self.read_only = False
        self.name = ''
        self.scratch = False
        self.regions = {}
        self.text = text
        self._selection = FakeSelection([FakeRegion(0, 0)])
        self.command_log = []
        self._window = None

    def file_name(self):
        return self._file_name

    def window(self):
        return self._window

    def set_window(self, window):
        self._window = window

    def settings(self):
        return self._settings

    def set_name(self, value):
        self.name = value

    def set_scratch(self, value):
        self.scratch = value

    def set_read_only(self, value):
        self.read_only = value

    def run_command(self, name, args=None):
        args = args or {}
        self.command_log.append({'name': name, 'args': args})
        if name == 'append':
            self.appended += args.get('characters', '')
        elif name == 'right_delete':
            self.appended = ''
        elif name == 'pair_of_cleats_apply_completion':
            self.text = args.get('text', '')

    def erase_regions(self, key):
        self.regions.pop(key, None)

    def add_regions(self, key, regions, scope, flags=0):
        self.regions[key] = {'regions': regions, 'scope': scope, 'flags': flags}

    def text_point(self, row, col):
        return row * 1000 + col

    def full_line(self, region):
        return region

    def is_loading(self):
        return False

    def sel(self):
        return self._selection

    def substr(self, region):
        if isinstance(region, FakeRegion):
            return self.text[region.a:region.b]
        return ''

    def word(self, region):
        text = self.text or ''
        point = region.a
        start = point
        end = point
        while start > 0 and (text[start - 1].isalnum() or text[start - 1] == '_'):
            start -= 1
        while end < len(text) and (text[end].isalnum() or text[end] == '_'):
            end += 1
        return FakeRegion(start, end)


class FakeWindow:
    _next_id = 1

    def __init__(self):
        self._id = FakeWindow._next_id
        FakeWindow._next_id += 1
        self._project_data = {}
        self._folders = []
        self.quick_panel_items = None
        self.quick_panel_callback = None
        self.panels = {}
        self.new_views = []
        self.opened_files = []
        self.group_count = 1
        self.current_group = 0
        self.commands = []
        self._active_view = None

    def project_data(self):
        return self._project_data

    def id(self):
        return self._id

    def set_project_data(self, value):
        self._project_data = value

    def set_folders(self, folders):
        self._folders = list(folders or [])

    def show_quick_panel(self, items, on_select, selected_index=-1):
        self.quick_panel_items = items
        self.quick_panel_callback = on_select

    def create_output_panel(self, name):
        panel = self.panels.get(name)
        if panel is None:
            panel = FakeView()
            panel.set_window(self)
            self.panels[name] = panel
        return panel

    def new_file(self):
        view = FakeView()
        view.set_window(self)
        self.new_views.append(view)
        self._active_view = view
        return view

    def open_file(self, encoded_path, flags=0):
        view = FakeView(encoded_path.split(':', 1)[0])
        view.set_window(self)
        self.opened_files.append({'path': encoded_path, 'flags': flags, 'view': view})
        self._active_view = view
        return view

    def run_command(self, name, args=None):
        self.commands.append({'name': name, 'args': args})
        if name == 'new_pane':
            self.group_count += 1

    def num_groups(self):
        return self.group_count

    def active_group(self):
        return self.current_group

    def focus_group(self, index):
        self.current_group = index

    def folders(self):
        return list(self._folders)

    def active_view(self):
        return self._active_view

    def set_active_view(self, view):
        self._active_view = view
        if view is not None:
            view.set_window(self)


class FakeWindowCommand:
    def __init__(self, window=None):
        self.window = window


class FakeTextCommand:
    def __init__(self, view=None):
        self.view = view


class FakeEventListener:
    pass


def install_fake_modules():
    class FakeSublimeModule:
        ENCODED_POSITION = 1
        Region = FakeRegion
        clipboard = ''
        last_status = ''
        status_history = []
        last_error = ''
        _settings_files = {}
        _active_window = None

        @staticmethod
        def set_timeout(callback, delay=0):
            callback()

        @staticmethod
        def load_settings(name):
            settings = FakeSublimeModule._settings_files.get(name)
            if settings is None:
                settings = FakeSettings()
                FakeSublimeModule._settings_files[name] = settings
            return settings

        @staticmethod
        def set_clipboard(value):
            FakeSublimeModule.clipboard = value

        @staticmethod
        def status_message(message):
            FakeSublimeModule.last_status = message
            FakeSublimeModule.status_history.append(message)

        @staticmethod
        def error_message(message):
            FakeSublimeModule.last_error = message

        @staticmethod
        def active_window():
            return FakeSublimeModule._active_window

        @staticmethod
        def set_active_window(window):
            FakeSublimeModule._active_window = window

        @staticmethod
        def reset():
            FakeSublimeModule.clipboard = ''
            FakeSublimeModule.last_status = ''
            FakeSublimeModule.status_history = []
            FakeSublimeModule.last_error = ''
            FakeSublimeModule._settings_files = {}
            FakeSublimeModule._active_window = None

    class FakeSublimePluginModule:
        WindowCommand = FakeWindowCommand
        TextCommand = FakeTextCommand
        EventListener = FakeEventListener

    sys.modules['sublime'] = FakeSublimeModule
    sys.modules['sublime_plugin'] = FakeSublimePluginModule
    return FakeSublimeModule, FakeSublimePluginModule
