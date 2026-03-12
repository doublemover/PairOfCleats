import json
import os
from urllib.parse import urlparse

import sublime

SETTINGS_FILE = 'PairOfCleats.sublime-settings'

DEFAULT_EDITOR_CONFIG_CONTRACT = {
    'schemaVersion': 1,
    'repoRoot': {
        'markers': ['.pairofcleats.json', '.git'],
        'vscode': {
            'walkUpFromWorkspaceFolder': False
        },
        'sublime': {
            'walkUpFromHints': True
        }
    },
    'cli': {
        'defaultCommand': 'pairofcleats',
        'repoRelativeEntrypoint': 'bin/pairofcleats.js',
        'jsEntrypointExtension': '.js'
    },
    'settings': {
        'vscode': {
            'namespace': 'pairofcleats',
            'cliPathKey': 'cliPath',
            'cliArgsKey': 'cliArgs',
            'extraSearchArgsKey': 'extraSearchArgs',
            'modeKey': 'searchMode',
            'backendKey': 'searchBackend',
            'annKey': 'searchAnn',
            'maxResultsKey': 'maxResults',
            'envKey': 'env'
        },
        'sublime': {
            'cliPathKey': 'pairofcleats_path',
            'nodePathKey': 'node_path',
            'envKey': 'env'
        }
    },
    'env': {
        'mergeOrder': ['process', 'settings'],
        'stringifyValues': True
    }
}


def _load_editor_config_contract():
    contract_path = os.path.abspath(
        os.path.join(
            os.path.dirname(__file__),
            '..',
            '..',
            '..',
            'docs',
            'tooling',
            'editor-config-contract.json'
        )
    )
    try:
        with open(contract_path, 'r', encoding='utf-8') as handle:
            loaded = json.load(handle)
        if isinstance(loaded, dict):
            return loaded
    except Exception:
        pass
    return DEFAULT_EDITOR_CONFIG_CONTRACT


EDITOR_CONFIG_CONTRACT = _load_editor_config_contract()


def _contract_get(path_parts, fallback):
    current = EDITOR_CONFIG_CONTRACT
    for key in path_parts:
        if not isinstance(current, dict) or key not in current:
            return fallback
        current = current[key]
    if current is None:
        return fallback
    return current


_SUBLIME_SETTING_KEYS = _contract_get(['settings', 'sublime'], {})
CLI_PATH_KEY = str(_SUBLIME_SETTING_KEYS.get('cliPathKey') or 'pairofcleats_path')
NODE_PATH_KEY = str(_SUBLIME_SETTING_KEYS.get('nodePathKey') or 'node_path')
ENV_KEY = str(_SUBLIME_SETTING_KEYS.get('envKey') or 'env')

DEFAULT_SETTINGS = {
    'pairofcleats_path': '',
    'node_path': '',
    'index_mode_default': 'both',
    'search_backend_default': '',
    'search_limit': 25,
    'search_prompt_options': False,
    'history_limit': 25,
    'api_server_url': '',
    'api_timeout_ms': 5000,
    'api_execution_mode': 'cli',
    'open_results_in': 'quick_panel',
    'results_buffer_threshold': 50,
    'progress_panel_on_start': True,
    'progress_watchdog_ms': 15000,
    'index_watch_scope': 'repo',
    'index_watch_folder': '',
    'index_watch_mode': 'all',
    'index_watch_poll_ms': 2000,
    'index_watch_debounce_ms': 500,
    'map_type_default': 'combined',
    'map_format_default': 'html-iso',
    'map_prompt_options': False,
    'map_output_dir': '.pairofcleats/maps',
    'map_only_exported': False,
    'map_collapse_default': 'none',
    'map_max_files': 200,
    'map_max_members_per_file': 60,
    'map_max_edges': 3000,
    'map_top_k_by_degree': False,
    'map_show_report_panel': None,
    'map_stream_output': False,
    'map_open_uri_template': 'subl://open?file={file}&line={line}&column={column}',
    'map_three_url': '',
    'map_index_mode': 'code',
    'map_wasd_sensitivity': 16000,
    'map_wasd_acceleration': 6000,
    'map_wasd_max_speed': 24000,
    'map_wasd_drag': 6,
    'map_zoom_sensitivity': 0.1,
    'env': {}
}

SETTING_GROUPS = (
    ('Core', (
        'pairofcleats_path',
        'node_path',
        'index_mode_default',
        'search_backend_default',
        'search_limit',
        'search_prompt_options',
        'history_limit',
    )),
    ('API', (
        'api_server_url',
        'api_timeout_ms',
        'api_execution_mode',
    )),
    ('Output', (
        'open_results_in',
        'results_buffer_threshold',
        'progress_panel_on_start',
        'progress_watchdog_ms',
    )),
    ('Watch', (
        'index_watch_scope',
        'index_watch_folder',
        'index_watch_mode',
        'index_watch_poll_ms',
        'index_watch_debounce_ms',
    )),
    ('Map', (
        'map_type_default',
        'map_format_default',
        'map_prompt_options',
        'map_output_dir',
        'map_only_exported',
        'map_collapse_default',
        'map_max_files',
        'map_max_members_per_file',
        'map_max_edges',
        'map_top_k_by_degree',
        'map_show_report_panel',
        'map_stream_output',
        'map_open_uri_template',
        'map_three_url',
        'map_index_mode',
        'map_wasd_sensitivity',
        'map_wasd_acceleration',
        'map_wasd_max_speed',
        'map_wasd_drag',
        'map_zoom_sensitivity',
    )),
    ('Environment', (
        'env',
    )),
)

VALID_INDEX_MODES = {'code', 'prose', 'both'}
VALID_BACKENDS = {'memory', 'sqlite', 'sqlite-fts', 'lmdb'}
VALID_OPEN_TARGETS = {'quick_panel', 'new_tab', 'output_panel'}
VALID_API_EXECUTION_MODES = {'cli', 'prefer', 'require'}
VALID_WATCH_SCOPES = {'repo', 'folder'}
VALID_WATCH_MODES = {'all', 'code', 'prose', 'records', 'extracted-prose'}
VALID_MAP_TYPES = {'combined', 'imports', 'calls', 'usages', 'dataflow'}
VALID_MAP_FORMATS = {'json', 'dot', 'svg', 'html', 'html-iso'}
VALID_MAP_COLLAPSE = {'none', 'file', 'dir'}
VALID_MAP_MODES = {'code', 'prose'}


def prime_settings():
    try:
        sublime.load_settings(SETTINGS_FILE)
    except Exception:
        pass


def get_setting_groups():
    return tuple(
        (name, tuple(keys))
        for name, keys in SETTING_GROUPS
    )


def get_settings(window=None):
    base = _load_base_settings()
    overrides = extract_project_settings(window)
    return merge_settings(base, overrides)


def build_project_settings_template():
    overrides = {}
    for _group_name, keys in SETTING_GROUPS:
        for key in keys:
            if key == 'env':
                overrides[key] = {'PAIROFCLEATS_API_TOKEN': '...'}
                continue
            if key in ('pairofcleats_path', 'node_path', 'index_watch_folder', 'map_three_url'):
                continue
            overrides[key] = DEFAULT_SETTINGS.get(key)
    overrides['api_server_url'] = 'http://127.0.0.1:7464'
    payload = {
        'settings': {
            'pairofcleats': overrides
        }
    }
    return json.dumps(payload, indent=2, sort_keys=False) + '\n'


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
        if _is_env_key(key) and isinstance(value, dict):
            env = dict(_get_env_settings(merged) or {})
            env.update(value)
            merged[ENV_KEY] = env
        else:
            merged[key] = value
    return merged


def build_env(settings):
    env = dict(os.environ)
    extra = _get_env_settings(settings)
    if isinstance(extra, dict):
        for key, value in extra.items():
            if key:
                env[str(key)] = str(value)

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

    api_server_url = settings.get('api_server_url')
    if api_server_url and not _is_valid_base_url(api_server_url):
        errors.append('api_server_url must be an http:// or https:// URL.')
    api_execution_mode = str(settings.get('api_execution_mode') or 'cli').strip().lower()
    if api_execution_mode not in VALID_API_EXECUTION_MODES:
        errors.append('api_execution_mode must be one of: cli, prefer, require.')
    elif api_execution_mode in {'prefer', 'require'} and not api_server_url:
        errors.append('api_server_url must be set when api_execution_mode is prefer or require.')

    env = _get_env_settings(settings)
    if env is not None and not isinstance(env, dict):
        errors.append('env must be a JSON object (dictionary).')

    cli_path = _setting_value(settings, CLI_PATH_KEY, 'pairofcleats_path')
    if cli_path and (os.path.isabs(cli_path) or repo_root):
        resolved = _resolve_path(repo_root, cli_path)
        if resolved and not os.path.exists(resolved):
            errors.append(
                'pairofcleats_path does not exist: {0}'.format(resolved)
            )

    node_path = _setting_value(settings, NODE_PATH_KEY, 'node_path')
    if node_path and os.path.isabs(node_path):
        if not os.path.exists(node_path):
            errors.append(
                'node_path does not exist: {0}'.format(node_path)
            )

    _validate_int_setting(errors, settings, 'search_limit', allow_zero=False)
    _validate_int_setting(errors, settings, 'results_buffer_threshold', allow_zero=True)
    _validate_bool_setting(errors, settings, 'progress_panel_on_start')
    _validate_int_setting(errors, settings, 'progress_watchdog_ms', allow_zero=False)
    _validate_int_setting(errors, settings, 'history_limit', allow_zero=True)
    _validate_int_setting(errors, settings, 'api_timeout_ms', allow_zero=False)
    _validate_int_setting(errors, settings, 'index_watch_poll_ms', allow_zero=False)
    _validate_int_setting(errors, settings, 'index_watch_debounce_ms', allow_zero=False)

    _validate_bool_setting(errors, settings, 'search_prompt_options')

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

    _validate_bool_setting(errors, settings, 'map_prompt_options')
    _validate_bool_setting(errors, settings, 'map_only_exported')
    _validate_bool_setting(errors, settings, 'map_top_k_by_degree')
    _validate_bool_setting(errors, settings, 'map_stream_output')
    _validate_nullable_bool_setting(errors, settings, 'map_show_report_panel')

    map_type = settings.get('map_type_default')
    if map_type and map_type not in VALID_MAP_TYPES:
        errors.append('map_type_default must be one of: combined, imports, calls, usages, dataflow.')

    map_format = settings.get('map_format_default')
    if map_format and map_format not in VALID_MAP_FORMATS:
        errors.append('map_format_default must be one of: json, dot, svg, html, html-iso.')

    map_collapse = settings.get('map_collapse_default')
    if map_collapse and map_collapse not in VALID_MAP_COLLAPSE:
        errors.append('map_collapse_default must be one of: none, file, dir.')

    map_mode = settings.get('map_index_mode')
    if map_mode and map_mode not in VALID_MAP_MODES:
        errors.append('map_index_mode must be code or prose.')

    _validate_int_setting(errors, settings, 'map_max_files', allow_zero=False)
    _validate_int_setting(errors, settings, 'map_max_members_per_file', allow_zero=False)
    _validate_int_setting(errors, settings, 'map_max_edges', allow_zero=False)
    _validate_number_setting(errors, settings, 'map_wasd_sensitivity', allow_zero=False)
    _validate_number_setting(errors, settings, 'map_wasd_acceleration', allow_zero=False)
    _validate_number_setting(errors, settings, 'map_wasd_max_speed', allow_zero=False)
    _validate_number_setting(errors, settings, 'map_wasd_drag', allow_zero=False)
    _validate_number_setting(errors, settings, 'map_zoom_sensitivity', allow_zero=False)

    return errors


def _load_base_settings():
    settings = sublime.load_settings(SETTINGS_FILE)
    values = dict(DEFAULT_SETTINGS)
    for key in DEFAULT_SETTINGS:
        values[key] = settings.get(key, DEFAULT_SETTINGS[key])
    return values


def resolve_execution_mode(settings, workflow, supports_api=False):
    mode = str((settings or {}).get('api_execution_mode') or 'cli').strip().lower()
    if mode not in VALID_API_EXECUTION_MODES:
        mode = 'cli'
    base_url = str((settings or {}).get('api_server_url') or '').strip()
    workflow_label = str(workflow or 'this workflow').replace('-', ' ')
    if mode == 'cli':
        return {
            'mode': 'cli',
            'allow_fallback': False,
            'base_url': base_url,
            'error': None,
        }
    if not base_url:
        return {
            'mode': None if mode == 'require' else 'cli',
            'allow_fallback': False,
            'base_url': '',
            'error': 'PairOfCleats: api_server_url must be set when api_execution_mode is {0}.'.format(mode)
            if mode == 'require' else None,
        }
    if not supports_api:
        return {
            'mode': None if mode == 'require' else 'cli',
            'allow_fallback': False,
            'base_url': base_url,
            'error': 'PairOfCleats: API mode is not supported for {0}.'.format(workflow_label)
            if mode == 'require' else None,
        }
    return {
        'mode': 'api',
        'allow_fallback': mode == 'prefer',
        'base_url': base_url,
        'error': None,
    }


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


def _validate_number_setting(errors, settings, key, allow_zero=False):
    value = settings.get(key)
    if value is None or value == '':
        return
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        errors.append('{0} must be a number.'.format(key))
        return
    if allow_zero:
        if value < 0:
            errors.append('{0} must be 0 or higher.'.format(key))
    elif value <= 0:
        errors.append('{0} must be greater than 0.'.format(key))


def _validate_bool_setting(errors, settings, key):
    value = settings.get(key)
    if value is None or value == '':
        return
    if not isinstance(value, bool):
        errors.append('{0} must be true or false.'.format(key))


def _validate_nullable_bool_setting(errors, settings, key):
    value = settings.get(key)
    if value is None or value == '':
        return
    if not isinstance(value, bool):
        errors.append('{0} must be true, false, or null.'.format(key))


def _is_valid_base_url(value):
    try:
        parsed = urlparse(str(value).strip())
    except Exception:
        return False
    return parsed.scheme in ('http', 'https') and bool(parsed.netloc)


def _is_env_key(key):
    return key == ENV_KEY or key == 'env'


def _get_env_settings(settings):
    if ENV_KEY in settings:
        return settings.get(ENV_KEY)
    return settings.get('env')


def _setting_value(settings, primary_key, fallback_key):
    if primary_key in settings:
        return settings.get(primary_key)
    return settings.get(fallback_key)
