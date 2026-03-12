import json
import os
import threading
import urllib.parse
import urllib.request
import urllib.error


class ApiResult(object):
    def __init__(self, payload=None, headers=None, error=None):
        self.payload = payload
        self.headers = headers or {}
        self.error = error


def normalize_base_url(value):
    if not value:
        return ''
    value = str(value).strip()
    if value.endswith('/'):
        value = value[:-1]
    return value


def build_url(base_url, path, params=None):
    base_url = normalize_base_url(base_url)
    if not base_url:
        return ''
    params = params or {}
    filtered = {}
    for key, value in params.items():
        if value is None or value == '':
            continue
        filtered[str(key)] = str(value)
    query = urllib.parse.urlencode(filtered, doseq=True)
    if query:
        return '{0}{1}?{2}'.format(base_url, path, query)
    return '{0}{1}'.format(base_url, path)


def _encode_payload(payload):
    if payload is None:
        return None
    if isinstance(payload, bytes):
        return payload
    return json.dumps(payload).encode('utf-8')


def _open_url(url, timeout_ms=5000, method='GET', payload=None, headers=None):
    timeout = float(timeout_ms or 5000) / 1000.0
    if timeout <= 0:
        timeout = 5.0
    request_headers = dict(headers or {})
    data = _encode_payload(payload)
    if data is not None and 'Content-Type' not in request_headers:
        request_headers['Content-Type'] = 'application/json'
    request = urllib.request.Request(url, data=data, headers=request_headers, method=method)

    try:
        resp = urllib.request.urlopen(request, timeout=timeout)
        try:
            status = resp.getcode() or 0
            headers = dict(resp.headers.items())
            data = resp.read()
        finally:
            try:
                resp.close()
            except Exception:
                pass
        return status, headers, data
    except urllib.error.HTTPError as err:
        try:
            data = err.read()
        except Exception:
            data = b''
        headers = dict(getattr(err, 'headers', {}).items()) if getattr(err, 'headers', None) else {}
        status = getattr(err, 'code', 0) or 0
        return status, headers, data


def request_json(url, timeout_ms=5000, method='GET', payload=None, headers=None):
    status, headers, data = _open_url(url, timeout_ms=timeout_ms, method=method, payload=payload, headers=headers)
    text = (data or b'').decode('utf-8', 'replace')
    if status < 200 or status >= 300:
        raise RuntimeError('API request failed ({0}): {1}'.format(status, text.strip() or url))
    try:
        return json.loads(text or '{}'), headers
    except Exception as exc:
        raise RuntimeError('API returned invalid JSON: {0}'.format(exc))


def request_text(url, timeout_ms=5000, method='GET', payload=None, headers=None):
    status, headers, data = _open_url(url, timeout_ms=timeout_ms, method=method, payload=payload, headers=headers)
    text = (data or b'').decode('utf-8', 'replace')
    if status < 200 or status >= 300:
        raise RuntimeError('API request failed ({0}): {1}'.format(status, text.strip() or url))
    return text, headers


def _ensure_parent_dir(path_value):
    if not path_value:
        return
    parent = os.path.dirname(path_value)
    if not parent:
        return
    if os.path.isdir(parent):
        return
    try:
        os.makedirs(parent)
    except Exception:
        pass


def _write_text(path_value, text):
    _ensure_parent_dir(path_value)
    with open(path_value, 'w') as handle:
        handle.write(text or '')


def _write_json(path_value, payload):
    _ensure_parent_dir(path_value)
    with open(path_value, 'w') as handle:
        json.dump(payload, handle, indent=2, sort_keys=True)


def run_async(request_fn, on_done):
    import sublime

    def worker():
        try:
            response = request_fn()
            if isinstance(response, tuple) and len(response) == 2:
                payload, headers = response
            else:
                payload, headers = response, {}
            result = ApiResult(payload=payload, headers=headers)
        except Exception as exc:
            result = ApiResult(error=str(exc))
        sublime.set_timeout(lambda: on_done(result), 0)

    thread = threading.Thread(target=worker)
    thread.daemon = True
    thread.start()
    return thread


def search_json(base_url, repo_root, settings, query, mode, backend=None, limit=None):
    base_url = normalize_base_url(base_url)
    if not base_url:
        raise RuntimeError('api_server_url is not set')

    timeout_ms = settings.get('api_timeout_ms') if isinstance(settings, dict) else None
    if not isinstance(timeout_ms, int) or timeout_ms <= 0:
        timeout_ms = 5000

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

    body, headers = request_json(
        build_url(base_url, '/search'),
        timeout_ms=timeout_ms,
        method='POST',
        payload=payload,
    )
    if not isinstance(body, dict) or body.get('ok') is False:
        raise RuntimeError((body or {}).get('message') or 'API search failed.')
    result = body.get('result')
    if not isinstance(result, dict):
        raise RuntimeError('API search returned invalid JSON.')
    payload = dict(result)
    payload.setdefault('ok', True)
    return payload, headers


def generate_map_report(
        base_url,
        repo_root,
        settings,
        scope,
        focus,
        include,
        map_format,
        output_path,
        model_path,
        node_list_path):
    base_url = normalize_base_url(base_url)
    if not base_url:
        raise RuntimeError('api_server_url is not set')

    timeout_ms = settings.get('api_timeout_ms') if isinstance(settings, dict) else None
    if not isinstance(timeout_ms, int) or timeout_ms <= 0:
        timeout_ms = 5000

    params = {
        'repo': repo_root,
        'mode': settings.get('map_index_mode') or 'code',
        'scope': scope,
        'focus': focus,
        'include': include,
        'collapse': settings.get('map_collapse_default') or 'none'
    }

    if settings.get('map_only_exported'):
        params['onlyExported'] = '1'

    max_files = settings.get('map_max_files')
    if isinstance(max_files, int) and max_files > 0:
        params['maxFiles'] = str(max_files)

    max_members = settings.get('map_max_members_per_file')
    if isinstance(max_members, int) and max_members > 0:
        params['maxMembersPerFile'] = str(max_members)

    max_edges = settings.get('map_max_edges')
    if isinstance(max_edges, int) and max_edges > 0:
        params['maxEdges'] = str(max_edges)

    if settings.get('map_top_k_by_degree') is True:
        params['topKByDegree'] = '1'

    open_uri = settings.get('map_open_uri_template')
    if open_uri:
        params['openUriTemplate'] = open_uri

    three_url = settings.get('map_three_url')
    if three_url:
        params['threeUrl'] = three_url

    # Viewer controls (only used by html-iso)
    for setting_key, param_key in [
            ('map_wasd_sensitivity', 'wasdSensitivity'),
            ('map_wasd_acceleration', 'wasdAcceleration'),
            ('map_wasd_max_speed', 'wasdMaxSpeed'),
            ('map_wasd_drag', 'wasdDrag'),
            ('map_zoom_sensitivity', 'zoomSensitivity')]:
        value = settings.get(setting_key)
        if isinstance(value, (int, float)):
            params[param_key] = str(value)

    model_url = build_url(base_url, '/map', dict(params, **{'format': 'json'}))
    map_model, model_headers = request_json(model_url, timeout_ms=timeout_ms)
    _write_json(model_path, map_model)

    nodes_url = build_url(base_url, '/map/nodes', params)
    node_list, _headers = request_json(nodes_url, timeout_ms=timeout_ms)
    _write_json(node_list_path, node_list)

    out_url = build_url(base_url, '/map', dict(params, **{'format': map_format}))
    out_path = output_path

    if map_format in ('json', 'dot'):
        text, _headers = request_text(out_url, timeout_ms=timeout_ms)
        _write_text(output_path, text)
        out_path = output_path
    else:
        out_path = out_url

    cache_key = model_headers.get('X-PairofCleats-Map-CacheKey') or ''

    return {
        'ok': True,
        'source': 'api',
        'repo': repo_root,
        'format': map_format,
        'outPath': out_path,
        'modelPath': model_path,
        'nodeListPath': node_list_path,
        'cacheKey': cache_key,
        'summary': map_model.get('summary') if isinstance(map_model, dict) else None,
        'warnings': map_model.get('warnings') if isinstance(map_model, dict) else None
    }
