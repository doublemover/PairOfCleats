"""Resolved search scope shared by history and result-session replay."""
import copy
import json


SAVED_SEARCH_VERSION = 1
SCOPE_FIELDS = ('repoRoot', 'mode', 'backend', 'limit', 'ann', 'allow_sparse_fallback',
                'as_of', 'snapshot', 'advanced')


def normalize_saved_options(options, repo_root=None):
    source = options if isinstance(options, dict) else {}
    complete = all(key in source for key in SCOPE_FIELDS if key != 'repoRoot')
    root = repo_root or source.get('repoRoot')
    complete = complete and isinstance(root, str) and bool(root)
    if source.get('scopeComplete') is False:
        complete = False
    if source.get('schemaVersion', SAVED_SEARCH_VERSION) != SAVED_SEARCH_VERSION:
        complete = False
    normalized = {key: copy.deepcopy(source.get(key)) for key in SCOPE_FIELDS if key in source}
    if root:
        normalized['repoRoot'] = root
    normalized['schemaVersion'] = SAVED_SEARCH_VERSION
    normalized['scopeComplete'] = complete
    if len(json.dumps(normalized, ensure_ascii=False).encode('utf-8')) > 16384:
        raise ValueError('Saved search scope exceeds the 16 KiB history limit.')
    return normalized


def normalize_saved_entry(entry):
    if not isinstance(entry, dict) or not entry.get('query'):
        return None
    normalized = normalize_saved_options(entry)
    normalized['query'] = str(entry['query'])
    return normalized
