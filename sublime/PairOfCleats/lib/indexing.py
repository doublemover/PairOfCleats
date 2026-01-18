def build_index_args(mode, repo_root=None, watch=False, watch_poll_ms=None, watch_debounce_ms=None):
    args = ['index', 'watch' if watch else 'build']
    if mode:
        args.extend(['--mode', mode])
    if watch:
        if watch_poll_ms is not None:
            args.extend(['--watch-poll', str(watch_poll_ms)])
        if watch_debounce_ms is not None:
            args.extend(['--watch-debounce', str(watch_debounce_ms)])
    if repo_root:
        args.extend(['--repo', repo_root])
    return args


def build_validate_args(repo_root=None, modes=None, json_output=True):
    args = ['index', 'validate']
    if json_output:
        args.append('--json')
    if modes:
        args.extend(['--mode', modes])
    if repo_root:
        args.extend(['--repo', repo_root])
    return args


def build_config_dump_args(repo_root=None, json_output=True):
    args = ['config', 'dump']
    if json_output:
        args.append('--json')
    if repo_root:
        args.extend(['--repo', repo_root])
    return args
