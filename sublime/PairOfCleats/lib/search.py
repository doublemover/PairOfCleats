def build_search_args(query, repo_root=None, mode=None, backend=None, limit=None, explain=False):
    args = ['search', query, '--json']
    if mode and mode != 'both':
        args.extend(['--mode', mode])
    if backend:
        args.extend(['--backend', backend])
    if limit:
        args.extend(['--top', str(limit)])
    if explain:
        args.append('--explain')
    if repo_root:
        args.extend(['--repo', repo_root])
    return args
