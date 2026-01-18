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


def resolve_repo_root(window, return_reason=False, path_hint=None):
    root, reason = _resolve_repo_root(window, path_hint=path_hint)
    if return_reason:
        return root, reason
    return root


def has_repo_root(window, path_hint=None):
    root, _ = resolve_repo_root(window, return_reason=True, path_hint=path_hint)
    return root is not None


def _resolve_repo_root(window, path_hint=None):
    if window is None:
        return None, 'No active window.'

    hint_root = None
    if path_hint:
        hint_path = path_hint
        if os.path.isfile(hint_path):
            hint_path = os.path.dirname(hint_path)
        if hint_path:
            root = find_repo_root(hint_path)
            if root:
                return root, None
            hint_root = os.path.abspath(hint_path)

    candidates = []
    active_file = None
    folders = window.folders() or []
    folders = sorted([os.path.abspath(folder) for folder in folders if folder])
    if folders:
        candidates.extend(folders)
    else:
        view = window.active_view()
        active_file = view.file_name() if view else None
        if active_file:
            candidates.append(active_file)

    for candidate in candidates:
        root = find_repo_root(candidate)
        if root:
            return root, None

    if hint_root:
        return hint_root, 'Repo root not found; using hint path.'
    if folders:
        return folders[0], 'Repo root not found; using open folder.'
    if active_file:
        return os.path.dirname(active_file), 'Repo root not found; using active file folder.'

    if candidates:
        return None, 'Repo root not found. Open a folder with .pairofcleats.json or .git.'

    return None, 'No folders are open. Add a folder or project to enable PairOfCleats.'


def resolve_watch_root(window, settings):
    repo_root, _ = resolve_repo_root(window, return_reason=True)
    scope = (settings.get('index_watch_scope') or 'repo').strip().lower()
    folder_override = settings.get('index_watch_folder') or ''
    if scope == 'folder':
        if folder_override:
            resolved = resolve_path(repo_root, folder_override)
            if resolved:
                return resolved
        folders = window.folders() if window is not None else []
        if folders:
            return folders[0]
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
        return value
    if repo_root:
        return os.path.normpath(os.path.join(repo_root, value))
    return value


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
