import os

import sublime

SETTINGS_FILE = 'PairOfCleats.sublime-settings'

DEFAULT_SETTINGS = {
    'pairofcleats_path': '',
    'node_path': '',
    'index_mode_default': 'both',
    'search_backend_default': '',
    'open_results_in': 'quick_panel',
    'profile': '',
    'cache_root': '',
    'embeddings_mode': '',
    'node_options': '',
    'env': {}
}

VALID_INDEX_MODES = {'code', 'prose', 'both'}
VALID_BACKENDS = {'memory', 'sqlite', 'sqlite-fts', 'lmdb'}
VALID_OPEN_TARGETS = {'quick_panel', 'new_tab', 'output_panel'}


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
