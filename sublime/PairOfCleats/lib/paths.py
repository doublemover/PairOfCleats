import os


def find_repo_root(start_path):
    if not start_path:
        return None

    path = start_path
    if os.path.isfile(path):
        path = os.path.dirname(path)
    path = os.path.abspath(path)

    while True:
        if os.path.isfile(os.path.join(path, '.pairofcleats.json')):
            return path
        if os.path.isdir(os.path.join(path, '.git')):
            return path

        parent = os.path.dirname(path)
        if parent == path:
            break
        path = parent

    return None


def resolve_repo_root(window, return_reason=False, path_hint=None, allow_fallback=True):
    root, reason = _resolve_repo_root(window, path_hint=path_hint, allow_fallback=allow_fallback)
    if return_reason:
        return root, reason
    return root


def describe_repo_root(window, path_hint=None, allow_fallback=True):
    return _describe_repo_root(window, path_hint=path_hint, allow_fallback=allow_fallback)


def has_repo_root(window, path_hint=None, allow_fallback=True):
    root, _ = resolve_repo_root(window, return_reason=True, path_hint=path_hint, allow_fallback=allow_fallback)
    return root is not None


def resolve_repo_root_interactive(window, on_done, path_hint=None, allow_fallback=True, prompt='PairOfCleats repo'):
    resolution = _describe_repo_root(window, path_hint=path_hint, allow_fallback=allow_fallback)
    selected_root = resolution.get('selected_root')
    if selected_root:
        on_done(selected_root, resolution.get('reason'))
        return
    repo_roots = resolution.get('repo_roots') or []
    if len(repo_roots) <= 1 or window is None or not hasattr(window, 'show_quick_panel'):
        on_done(None, resolution.get('reason'))
        return
    items = []
    for entry in repo_roots:
        label = entry.get('root')
        source = entry.get('source')
        hint = 'repo root'
        if source == 'folder':
            hint = 'open folder'
        elif source == 'hint':
            hint = 'path hint'
        elif source == 'active_file':
            hint = 'active file'
        items.append([label, hint])

    def on_select(index):
        if index < 0:
            on_done(None, 'Repo selection cancelled.')
            return
        chosen = repo_roots[index]
        on_done(chosen.get('root'), 'Using selected repo: {0}'.format(chosen.get('root')))

    window.show_quick_panel(items, on_select)


def _resolve_repo_root(window, path_hint=None, allow_fallback=True):
    resolution = _describe_repo_root(window, path_hint=path_hint, allow_fallback=allow_fallback)
    return resolution.get('selected_root'), resolution.get('reason')


def _describe_repo_root(window, path_hint=None, allow_fallback=True):
    if window is None:
        return {'selected_root': None, 'reason': 'No active window.', 'repo_roots': []}

    hint_root = None
    hint_repo_root = None
    if path_hint:
        hint_path = path_hint
        if os.path.isfile(hint_path):
            hint_path = os.path.dirname(hint_path)
        if hint_path:
            root = find_repo_root(hint_path)
            if root:
                hint_repo_root = os.path.abspath(root)
            hint_root = os.path.abspath(hint_path)

    active_file = None
    folders = window.folders() or []
    folders = sorted([os.path.abspath(folder) for folder in folders if folder])
    view = window.active_view()
    active_file = view.file_name() if view else None

    repo_roots = []
    seen_roots = set()

    def add_root(root, source):
        normalized = os.path.abspath(root)
        if normalized in seen_roots:
            return
        seen_roots.add(normalized)
        repo_roots.append({'root': normalized, 'source': source})

    if hint_repo_root:
        add_root(hint_repo_root, 'hint')
    if active_file:
        active_root = find_repo_root(active_file)
        if active_root:
            add_root(active_root, 'active_file')
    for folder in folders:
        folder_root = find_repo_root(folder)
        if folder_root:
            add_root(folder_root, 'folder')

    if hint_repo_root:
        return {'selected_root': hint_repo_root, 'reason': None, 'repo_roots': repo_roots}
    if hint_root and not allow_fallback:
        return {
            'selected_root': None,
            'reason': 'Repo root not found for the requested path. Choose a repo folder with .pairofcleats.json or .git.',
            'repo_roots': repo_roots,
        }
    if len(repo_roots) == 1:
        return {'selected_root': repo_roots[0]['root'], 'reason': None, 'repo_roots': repo_roots}
    if len(repo_roots) > 1:
        return {
            'selected_root': None,
            'reason': 'Multiple repo roots found. Choose a target repo.',
            'repo_roots': repo_roots,
        }

    if not allow_fallback:
        if hint_root:
            return {
                'selected_root': None,
                'reason': 'Repo root not found for the requested path. Choose a repo folder with .pairofcleats.json or .git.',
                'repo_roots': repo_roots,
            }
        if folders:
            return {
                'selected_root': None,
                'reason': 'No repo root found in the open folders. Mutating PairOfCleats commands require an explicit repo root.',
                'repo_roots': [],
            }
        if active_file:
            return {
                'selected_root': None,
                'reason': 'No repo root found for the active file. Mutating PairOfCleats commands require an explicit repo root.',
                'repo_roots': [],
            }
        return {
            'selected_root': None,
            'reason': 'No folders are open. Add a folder or project to enable PairOfCleats.',
            'repo_roots': [],
        }

    if hint_root:
        return {'selected_root': hint_root, 'reason': 'Repo root not found; using hint path.', 'repo_roots': []}
    if folders:
        return {'selected_root': folders[0], 'reason': 'Repo root not found; using open folder.', 'repo_roots': []}
    if active_file:
        return {'selected_root': os.path.dirname(active_file), 'reason': 'Repo root not found; using active file folder.', 'repo_roots': []}

    if folders or active_file:
        return {'selected_root': None, 'reason': 'Repo root not found. Open a folder with .pairofcleats.json or .git.', 'repo_roots': []}

    return {'selected_root': None, 'reason': 'No folders are open. Add a folder or project to enable PairOfCleats.', 'repo_roots': []}


def resolve_watch_root(window, settings, repo_root=None):
    if not repo_root:
        repo_root, _ = resolve_repo_root(window, return_reason=True, allow_fallback=False)
    scope = (settings.get('index_watch_scope') or 'repo').strip().lower()
    folder_override = settings.get('index_watch_folder') or ''
    if scope == 'folder':
        if folder_override:
            resolved = resolve_path_within_repo(repo_root, folder_override)
            if resolved:
                return resolved
    return repo_root


def resolve_cli(settings, repo_root):
    node_path = settings.get('node_path') or 'node'
    configured = (settings.get('pairofcleats_path') or '').strip()
    if configured:
        resolved = resolve_path(repo_root, configured)
        return _cli_for_path(resolved, node_path, 'settings')

    local_bin = _find_local_binary(repo_root)
    if local_bin:
        return _cli_for_path(local_bin, node_path, 'node_modules')

    if repo_root:
        local_js = os.path.join(repo_root, 'bin', 'pairofcleats.js')
        if os.path.exists(local_js):
            return _cli_for_path(local_js, node_path, 'repo-bin')

    return {
        'command': 'pairofcleats',
        'args_prefix': [],
        'source': 'path'
    }


def resolve_path(repo_root, value):
    if not value:
        return None
    if os.path.isabs(value):
        return os.path.normpath(value)
    if repo_root:
        return os.path.normpath(os.path.join(repo_root, value))
    return os.path.normpath(value)


def resolve_path_within_repo(repo_root, value):
    resolved = resolve_path(repo_root, value)
    if not resolved or not repo_root:
        return None
    try:
        repo_root_norm = os.path.normcase(os.path.abspath(repo_root))
        resolved_norm = os.path.normcase(os.path.abspath(resolved))
        common = os.path.commonpath([repo_root_norm, resolved_norm])
    except Exception:
        return None
    if common != repo_root_norm:
        return None
    return resolved


def _find_local_binary(repo_root):
    if not repo_root:
        return None
    bin_dir = os.path.join(repo_root, 'node_modules', '.bin')
    candidates = [
        'pairofcleats',
        'pairofcleats.cmd',
        'pairofcleats.ps1'
    ]
    for name in candidates:
        candidate = os.path.join(bin_dir, name)
        if os.path.exists(candidate):
            return candidate
    return None


def _cli_for_path(path_value, node_path, source):
    if path_value and path_value.lower().endswith('.js'):
        return {
            'command': node_path or 'node',
            'args_prefix': [path_value],
            'source': source
        }
    return {
        'command': path_value,
        'args_prefix': [],
        'source': source
    }
