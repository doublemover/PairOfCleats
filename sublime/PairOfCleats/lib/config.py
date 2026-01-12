import os

import sublime

SETTINGS_FILE = 'PairOfCleats.sublime-settings'

DEFAULT_SETTINGS = {
    'pairofcleats_path': '',
    'node_path': '',
    'index_mode_default': 'both',
    'search_backend_default': '',
    'open_results_in': 'quick_panel',
    'search_limit': 25,
    'results_buffer_threshold': 50,
    'history_limit': 25,
    'search_prompt_options': False,
    'index_watch_scope': 'repo',
    'index_watch_folder': '',
    'index_watch_mode': 'all',
    'index_watch_poll_ms': 2000,
    'index_watch_debounce_ms': 500,
    'profile': '',
    'cache_root': '',
    'embeddings_mode': '',
    'node_options': '',
    'env': {}
}

VALID_INDEX_MODES = {'code', 'prose', 'both'}
VALID_BACKENDS = {'memory', 'sqlite', 'sqlite-fts', 'lmdb'}
VALID_OPEN_TARGETS = {'quick_panel', 'new_tab', 'output_panel'}
VALID_WATCH_SCOPES = {'repo', 'folder'}
VALID_WATCH_MODES = {'all', 'code', 'prose', 'records', 'extracted-prose'}


def prime_settings():
    try:
        sublime.load_settings(SETTINGS_FILE)
    except Exception:
        pass


def get_settings(window=None):
    base = _load_base_settings()
    overrides = extract_project_settings(window)
    return merge_settings(base, overrides)


def extract_project_settings(window):
    if window is None:
        return {}
    data = window.project_data() or {}
    settings = data.get('settings') if isinstance(data, dict) else {}
    if not isinstance(settings, dict):
        settings = {}

    override = settings.get('pairofcleats') or settings.get('PairOfCleats')
    if override is None:
        override = data.get('pairofcleats') or data.get('PairOfCleats')
    if isinstance(override, dict):
        return override
    return {}


def merge_settings(base, overrides):
    merged = dict(base)
    for key, value in overrides.items():
        if key == 'env' and isinstance(value, dict):
            env = dict(merged.get('env') or {})
            env.update(value)
            merged['env'] = env
        else:
            merged[key] = value
    return merged


def build_env(settings):
    env = dict(os.environ)
    extra = settings.get('env') or {}
    if isinstance(extra, dict):
        for key, value in extra.items():
            if key:
                env[str(key)] = str(value)

    if settings.get('profile'):
        env['PAIROFCLEATS_PROFILE'] = str(settings['profile'])
    if settings.get('cache_root'):
        env['PAIROFCLEATS_CACHE_ROOT'] = str(settings['cache_root'])
    if settings.get('embeddings_mode'):
        env['PAIROFCLEATS_EMBEDDINGS'] = str(settings['embeddings_mode'])
    if settings.get('node_options'):
        env['PAIROFCLEATS_NODE_OPTIONS'] = str(settings['node_options'])
    return env


def validate_settings(settings, repo_root=None):
    errors = []

    mode = settings.get('index_mode_default')
    if mode and mode not in VALID_INDEX_MODES:
        errors.append(
            'index_mode_default must be one of: code, prose, both.'
        )

    backend = settings.get('search_backend_default')
    if backend and backend not in VALID_BACKENDS:
        errors.append(
            'search_backend_default must be one of: memory, sqlite, sqlite-fts, lmdb.'
        )

    target = settings.get('open_results_in')
    if target and target not in VALID_OPEN_TARGETS:
        errors.append(
            'open_results_in must be one of: quick_panel, new_tab, output_panel.'
        )

    env = settings.get('env')
    if env is not None and not isinstance(env, dict):
        errors.append('env must be a JSON object (dictionary).')

    cli_path = settings.get('pairofcleats_path')
    if cli_path and (os.path.isabs(cli_path) or repo_root):
        resolved = _resolve_path(repo_root, cli_path)
        if resolved and not os.path.exists(resolved):
            errors.append(
                'pairofcleats_path does not exist: {0}'.format(resolved)
            )

    node_path = settings.get('node_path')
    if node_path and os.path.isabs(node_path):
        if not os.path.exists(node_path):
            errors.append(
                'node_path does not exist: {0}'.format(node_path)
            )

    _validate_int_setting(errors, settings, 'search_limit', allow_zero=False)
    _validate_int_setting(errors, settings, 'results_buffer_threshold', allow_zero=True)
    _validate_int_setting(errors, settings, 'history_limit', allow_zero=True)
    _validate_int_setting(errors, settings, 'index_watch_poll_ms', allow_zero=False)
    _validate_int_setting(errors, settings, 'index_watch_debounce_ms', allow_zero=False)

    watch_scope = settings.get('index_watch_scope')
    if watch_scope and watch_scope not in VALID_WATCH_SCOPES:
        errors.append('index_watch_scope must be repo or folder.')

    watch_mode = settings.get('index_watch_mode')
    if watch_mode and watch_mode not in VALID_WATCH_MODES:
        errors.append('index_watch_mode must be one of: all, code, prose, records, extracted-prose.')

    watch_folder = settings.get('index_watch_folder')
    if watch_folder and (os.path.isabs(watch_folder) or repo_root):
        resolved = _resolve_path(repo_root, watch_folder)
        if resolved and not os.path.exists(resolved):
            errors.append('index_watch_folder does not exist: {0}'.format(resolved))

    return errors


def _load_base_settings():
    settings = sublime.load_settings(SETTINGS_FILE)
    values = dict(DEFAULT_SETTINGS)
    for key in DEFAULT_SETTINGS:
        values[key] = settings.get(key, DEFAULT_SETTINGS[key])
    return values


def _resolve_path(repo_root, raw_path):
    if not raw_path:
        return None
    if os.path.isabs(raw_path):
        return raw_path
    if repo_root:
        return os.path.join(repo_root, raw_path)
    return raw_path


def _validate_int_setting(errors, settings, key, allow_zero=False):
    value = settings.get(key)
    if value is None or value == '':
        return
    if isinstance(value, bool) or not isinstance(value, int):
        errors.append('{0} must be an integer.'.format(key))
        return
    if allow_zero:
        if value < 0:
            errors.append('{0} must be 0 or higher.'.format(key))
    elif value < 1:
        errors.append('{0} must be 1 or higher.'.format(key))
