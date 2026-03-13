ADVANCED_SEARCH_OPTION_SPECS = {
    'filter': {'payload': 'filter', 'cli': '--filter', 'type': 'string'},
    'type': {'payload': 'type', 'cli': '--type', 'type': 'string'},
    'author': {'payload': 'author', 'cli': '--author', 'type': 'string'},
    'import': {'payload': 'import', 'cli': '--import', 'type': 'string'},
    'calls': {'payload': 'calls', 'cli': '--calls', 'type': 'string'},
    'uses': {'payload': 'uses', 'cli': '--uses', 'type': 'string'},
    'signature': {'payload': 'signature', 'cli': '--signature', 'type': 'string'},
    'param': {'payload': 'param', 'cli': '--param', 'type': 'string'},
    'inferred_type': {'payload': 'inferredType', 'cli': '--inferred-type', 'type': 'string'},
    'return_type': {'payload': 'returnType', 'cli': '--return-type', 'type': 'string'},
    'risk': {'payload': 'risk', 'cli': '--risk', 'type': 'string'},
    'risk_tag': {'payload': 'riskTag', 'cli': '--risk-tag', 'type': 'string'},
    'risk_source': {'payload': 'riskSource', 'cli': '--risk-source', 'type': 'string'},
    'risk_sink': {'payload': 'riskSink', 'cli': '--risk-sink', 'type': 'string'},
    'risk_category': {'payload': 'riskCategory', 'cli': '--risk-category', 'type': 'string'},
    'risk_flow': {'payload': 'riskFlow', 'cli': '--risk-flow', 'type': 'string'},
    'chunk_author': {'payload': 'chunkAuthor', 'cli': '--chunk-author', 'type': 'string'},
    'modified_after': {'payload': 'modifiedAfter', 'cli': '--modified-after', 'type': 'string'},
    'visibility': {'payload': 'visibility', 'cli': '--visibility', 'type': 'string'},
    'extends': {'payload': 'extends', 'cli': '--extends', 'type': 'string'},
    'lang': {'payload': 'lang', 'cli': '--lang', 'type': 'string'},
    'branch': {'payload': 'branch', 'cli': '--branch', 'type': 'string'},
    'modified_since': {'payload': 'modifiedSince', 'cli': '--modified-since', 'type': 'int'},
    'case': {'payload': 'case', 'cli': '--case', 'type': 'bool'},
    'case_file': {'payload': 'caseFile', 'cli': '--case-file', 'type': 'bool'},
    'case_tokens': {'payload': 'caseTokens', 'cli': '--case-tokens', 'type': 'bool'},
    'lint': {'payload': 'lint', 'cli': '--lint', 'type': 'bool'},
    'async': {'payload': 'async', 'cli': '--async', 'type': 'bool'},
    'generator': {'payload': 'generator', 'cli': '--generator', 'type': 'bool'},
    'returns': {'payload': 'returns', 'cli': '--returns', 'type': 'bool'},
    'path': {'payload': 'path', 'cli': '--path', 'type': 'list'},
    'file': {'payload': 'file', 'cli': '--file', 'type': 'list'},
    'ext': {'payload': 'ext', 'cli': '--ext', 'type': 'list'},
}

VALID_ADVANCED_SEARCH_OPTION_KEYS = tuple(sorted(ADVANCED_SEARCH_OPTION_SPECS.keys()))


def _normalize_string(value):
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _normalize_list(value):
    if value is None:
        return None
    items = value if isinstance(value, (list, tuple)) else [value]
    normalized = []
    for entry in items:
        text = _normalize_string(entry)
        if text:
            normalized.append(text)
    return normalized or None


def normalize_advanced_search_defaults(value):
    if not isinstance(value, dict):
        return {}
    normalized = {}
    for key, raw in value.items():
        if key not in ADVANCED_SEARCH_OPTION_SPECS:
            continue
        spec = ADVANCED_SEARCH_OPTION_SPECS[key]
        type_name = spec['type']
        if type_name == 'string':
            text = _normalize_string(raw)
            if text:
                normalized[key] = text
            continue
        if type_name == 'list':
            items = _normalize_list(raw)
            if items:
                normalized[key] = items
            continue
        if type_name == 'int':
            try:
                numeric = int(raw)
            except Exception:
                continue
            if numeric >= 0:
                normalized[key] = numeric
            continue
        if type_name == 'bool':
            if isinstance(raw, bool):
                normalized[key] = raw
    return normalized


def build_search_payload(
        query,
        repo_root=None,
        mode=None,
        backend=None,
        limit=None,
        ann=None,
        allow_sparse_fallback=False,
        as_of=None,
        snapshot=None,
        advanced=None):
    payload = {
        'repo': repo_root,
        'query': query,
        'mode': mode or 'both',
        'output': 'compact-json',
    }
    if backend:
        payload['backend'] = backend
    if isinstance(limit, int) and limit > 0:
        payload['top'] = limit
    if isinstance(ann, bool):
        payload['ann'] = ann
    if allow_sparse_fallback:
        payload['allowSparseFallback'] = True
    if as_of:
        payload['asOf'] = as_of
    elif snapshot:
        payload['snapshotId'] = snapshot
    for key, value in normalize_advanced_search_defaults(advanced).items():
        payload_key = ADVANCED_SEARCH_OPTION_SPECS[key]['payload']
        payload[payload_key] = value
    return payload


def build_search_args(
        query,
        repo_root=None,
        mode=None,
        backend=None,
        limit=None,
        explain=False,
        ann=None,
        allow_sparse_fallback=False,
        as_of=None,
        snapshot=None,
        advanced=None):
    args = ['search', query, '--json']
    if mode and mode != 'both':
        args.extend(['--mode', mode])
    if backend:
        args.extend(['--backend', backend])
    if isinstance(limit, int) and limit > 0:
        args.extend(['--top', str(limit)])
    if explain:
        args.append('--explain')
    if isinstance(ann, bool):
        args.append('--ann' if ann else '--no-ann')
    if allow_sparse_fallback:
        args.append('--allow-sparse-fallback')
    if as_of:
        args.extend(['--as-of', str(as_of)])
    elif snapshot:
        args.extend(['--snapshot', str(snapshot)])
    for key, value in normalize_advanced_search_defaults(advanced).items():
        spec = ADVANCED_SEARCH_OPTION_SPECS[key]
        if spec['type'] == 'bool':
            if value:
                args.append(spec['cli'])
            continue
        if spec['type'] == 'list':
            for entry in value:
                args.extend([spec['cli'], entry])
            continue
        args.extend([spec['cli'], str(value)])
    if repo_root:
        args.extend(['--repo', repo_root])
    return args
