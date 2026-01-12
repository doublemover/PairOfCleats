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


def resolve_repo_root(window):
    if window is None:
        return None

    view = window.active_view()
    active_file = view.file_name() if view else None
    candidates = []

    if active_file:
        candidates.append(active_file)
    for folder in window.folders() or []:
        candidates.append(folder)

    for candidate in candidates:
        root = find_repo_root(candidate)
        if root:
            return root

    if active_file:
        return os.path.dirname(active_file)

    return None


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
        return os.path.join(repo_root, value)
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
