"""Explicit service-host path mapping, with server admission and source revision checks."""
import ntpath
import os
import posixpath
import re
import copy
from urllib.parse import urlsplit, urlunsplit

from . import api_client, operations, ui

KEY = 'pairofcleats_service_repositories'
_MAPPINGS = {}


def _read(path, limit=65536):
    if os.path.getsize(path) > limit:
        raise ValueError('Repository identity metadata exceeds the editor bound.')
    with open(path, 'r', encoding='utf-8') as handle:
        return handle.read()


def git_head(root):
    try:
        directory = os.path.join(root, '.git')
        if os.path.isfile(directory):
            pointer = _read(directory).strip()
            if not pointer.startswith('gitdir:'):
                return None
            directory = os.path.abspath(os.path.join(root, pointer[7:].strip()))
        head = _read(os.path.join(directory, 'HEAD')).strip()
        if re.match(r'^[a-fA-F0-9]{40,64}$', head):
            return head.lower()
        if not head.startswith('ref: refs/'):
            return None
        ref = head[5:]
        if any(part in ('.', '..') for part in ref.split('/')):
            return None
        roots = [directory]
        try:
            roots.append(os.path.abspath(os.path.join(directory, _read(os.path.join(directory, 'commondir')).strip())))
        except OSError:
            pass
        for directory in roots:
            try:
                value = _read(os.path.join(directory, ref)).strip()
                if re.match(r'^[a-fA-F0-9]{40,64}$', value):
                    return value.lower()
            except OSError:
                pass
            try:
                for line in _read(os.path.join(directory, 'packed-refs'), 4194304).splitlines():
                    parts = line.split(' ')
                    if len(parts) == 2 and parts[1] == ref and re.match(r'^[a-fA-F0-9]{40,64}$', parts[0]):
                        return parts[0].lower()
            except OSError:
                pass
    except (OSError, ValueError):
        pass
    return None


def validate_root(value):
    if not isinstance(value, str):
        raise ValueError('Use an absolute service-host repository path without traversal components.')
    root = value.strip()
    drive, tail = ntpath.splitdrive(root)
    if (not root or '\0' in root or '\r' in root or '\n' in root
            or root.startswith(('\\\\?\\', '\\\\.\\'))
            or root.startswith('\\') and not root.startswith('\\\\')
            or drive and (tail and not ntpath.isabs(tail) or not tail and len(drive) == 2)
            or not (posixpath.isabs(root) or ntpath.isabs(root))
            or any(part in ('.', '..') for part in root.replace('\\', '/').split('/'))):
        raise ValueError('Use an absolute service-host repository path without traversal components.')
    return root


def relative_file(value, root):
    root = validate_root(root)
    if not isinstance(value, str) or not value or any(char in value for char in ('\0', '\r', '\n')):
        raise ValueError('Service returned an invalid source path.')
    flavor = ntpath if ntpath.splitdrive(root)[0] else posixpath
    # Validate before normalization: relpath would erase traversal components.
    if any(part in ('.', '..') for part in value.replace('\\', '/').split('/')):
        raise ValueError('Service returned a source path with traversal components.')
    try:
        relative = flavor.relpath(value, root) if flavor.isabs(value) else value
    except ValueError:
        raise ValueError('Service returned a source path outside its selected repository.')
    normalized = relative.replace('\\', '/')
    if (not normalized or normalized.startswith('/') or ':' in normalized
            or any(part in ('', '.', '..') for part in normalized.split('/'))):
        raise ValueError('Service returned a source path outside its selected repository.')
    return normalized


def map_payload(payload, root):
    if not isinstance(payload, dict):
        raise ValueError('Service returned an invalid search response.')
    result = copy.deepcopy(payload)
    for section in ('code', 'prose', 'extractedProse', 'records'):
        if section not in payload:
            continue
        if not isinstance(payload[section], list):
            raise ValueError('Service returned invalid search section membership.')
        for hit in result[section]:
            if not isinstance(hit, dict) or 'file' not in hit:
                raise ValueError('Service returned a search hit without a qualified source path.')
            hit['file'] = relative_file(hit['file'], root)
    return result


def resolve(window, settings, local_root, on_done, force=False):
    scope = operations.capture(window)
    settings = copy.deepcopy(settings)
    local_root = os.path.abspath(local_root)
    base = api_client.normalize_base_url(settings.get('api_server_url'))
    try:
        parsed = urlsplit(base)
        hostname = parsed.hostname or ''
        if ':' in hostname:
            hostname = '[' + hostname + ']'
        endpoint = urlunsplit((parsed.scheme, hostname + (':' + str(parsed.port) if parsed.port else ''), parsed.path, '', ''))
    except ValueError:
        ui.show_error('PairOfCleats: API endpoint is invalid. Inspect User Settings.')
        return
    commit = git_head(local_root)
    if not commit:
        ui.show_error('PairOfCleats: service mapping requires a readable Git HEAD. Use local CLI mode for unsupported source identities.')
        return
    stored = window.settings().get(KEY) if hasattr(window, 'settings') else _MAPPINGS.get(window.id())
    mappings = copy.deepcopy(stored) if isinstance(stored, dict) else {}
    key = base + '::' + local_root
    existing = None if force else mappings.get(key)
    if not isinstance(existing, dict) or existing.get('commit') != commit or not isinstance(existing.get('serviceRoot'), str):
        existing = None

    def current():
        if not operations.is_current(scope):
            return False
        if git_head(local_root) != commit:
            ui.show_error('PairOfCleats: local Git revision changed during service mapping. Select the repository again.')
            return False
        return True

    def check(value):
        if not current():
            return
        try:
            root = validate_root(value)
        except ValueError as error:
            ui.show_error(str(error))
            return
        def ready(response):
            if not current():
                return
            if response.error:
                ui.show_error(response.error)
                return
            payload = response.payload if isinstance(response.payload, dict) else {}
            coverage = payload.get('coverage')
            provenance = coverage.get('currentProvenance') if isinstance(coverage, dict) else None
            provenance = provenance if isinstance(provenance, dict) else {}
            head = provenance.get('head')
            observed = (head.get('commitId') if isinstance(head, dict) else None) or provenance.get('commit')
            if not isinstance(observed, str) or observed.lower() != commit or provenance.get('dirty') is not False:
                ui.show_error('PairOfCleats: service source revision does not match this checkout, or its source is dirty.')
                return
            def use(index):
                if index != 0 or not current():
                    return
                # Preserve mappings admitted by other requests during this wait.
                latest = window.settings().get(KEY) if hasattr(window, 'settings') else _MAPPINGS.get(window.id())
                updated = copy.deepcopy(latest) if isinstance(latest, dict) else {}
                updated[key] = {'serviceRoot': root, 'commit': commit}
                _MAPPINGS[window.id()] = updated
                if hasattr(window, 'settings'):
                    window.settings().set(KEY, updated)
                on_done(root)
            if existing:
                use(0)
            else:
                window.show_quick_panel([['Use repository mapping', endpoint + ' ' + root,
                    'Revision ' + commit[:12] + '; editor working-tree freshness remains unverified.']], use)
        api_client.run_async(lambda: api_client.status_json(base, root, settings), ready,
                             window=window, scope=scope)
    if existing:
        check(existing['serviceRoot'])
    else:
        window.show_input_panel('Repository path on service host ' + endpoint, local_root, check, None, None)
