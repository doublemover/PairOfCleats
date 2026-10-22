"""Explicit service-host path mapping, with server admission and source revision checks."""
import ntpath
import os
import posixpath
import re

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
    root = value.strip()
    if (not root or '\0' in root or not (posixpath.isabs(root) or ntpath.isabs(root))
            or any(part in ('.', '..') for part in root.replace('\\', '/').split('/'))):
        raise ValueError('Use an absolute service-host repository path without traversal components.')
    return root


def relative_file(value, root):
    flavor = ntpath if ntpath.splitdrive(root)[0] else posixpath
    relative = flavor.relpath(value, root) if flavor.isabs(value) else value
    normalized = relative.replace('\\', '/')
    if (not normalized or normalized.startswith('/') or ':' in normalized
            or any(part in ('.', '..') for part in normalized.split('/'))):
        raise ValueError('Service returned a source path outside its selected repository.')
    return normalized


def map_payload(payload, root):
    result = dict(payload)
    for section in ('code', 'prose', 'extractedProse', 'records'):
        if isinstance(payload.get(section), list):
            result[section] = [dict(hit, file=relative_file(hit['file'], root)) for hit in payload[section]]
    return result


def resolve(window, settings, local_root, on_done, force=False):
    scope = operations.capture(window)
    base = api_client.normalize_base_url(settings.get('api_server_url'))
    commit = git_head(local_root)
    if not commit:
        ui.show_error('PairOfCleats: service mapping requires a readable Git HEAD. Use local CLI mode for unsupported source identities.')
        return
    mappings = (window.settings().get(KEY) or {}) if hasattr(window, 'settings') else _MAPPINGS.setdefault(window.id(), {})
    key = base + '::' + local_root
    existing = None if force else mappings.get(key)
    def check(value):
        try:
            root = validate_root(value)
        except ValueError as error:
            ui.show_error(str(error))
            return
        def ready(response):
            if not operations.is_current(scope):
                return
            if response.error:
                ui.show_error(response.error)
                return
            provenance = ((response.payload or {}).get('coverage') or {}).get('currentProvenance') or {}
            observed = (provenance.get('head') or {}).get('commitId') or provenance.get('commit')
            if not observed or observed.lower() != commit or provenance.get('dirty') is not False:
                ui.show_error('PairOfCleats: service source revision does not match this checkout, or its source is dirty.')
                return
            def use(index):
                if index != 0 or not operations.is_current(scope):
                    return
                mappings[key] = {'serviceRoot': root, 'commit': commit}
                _MAPPINGS[window.id()] = mappings
                if hasattr(window, 'settings'):
                    window.settings().set(KEY, mappings)
                on_done(root)
            if existing:
                use(0)
            else:
                window.show_quick_panel([['Use repository mapping', base + ' ' + root,
                    'Revision ' + commit[:12] + '; editor working-tree freshness remains unverified.']], use)
        api_client.run_async(lambda: api_client.status_json(base, root, settings), ready,
                             window=window, scope=scope)
    if existing:
        check(existing['serviceRoot'])
    else:
        window.show_input_panel('Repository path on service host ' + base, local_root, check, None, None)
