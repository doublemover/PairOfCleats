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


class ApiHandle(object):
    def __init__(self, thread):
        self.thread = thread
        self._cancelled = False

    def cancel(self):
        self._cancelled = True

    def is_cancelled(self):
        return self._cancelled


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


def run_async(request_fn, on_done, on_progress=None):
    import sublime
    handle = ApiHandle(None)

    def worker():
        try:
            if callable(on_progress):
                on_progress('Request started.')
            response = request_fn()
            if handle.is_cancelled():
                return
            if isinstance(response, tuple) and len(response) == 2:
                payload, headers = response
            else:
                payload, headers = response, {}
            result = ApiResult(payload=payload, headers=headers)
        except Exception as exc:
            if handle.is_cancelled():
                return
            result = ApiResult(error=str(exc))
        if handle.is_cancelled():
            return
        sublime.set_timeout(lambda: on_done(result), 0)

    thread = threading.Thread(target=worker)
    thread.daemon = True
    thread.start()
    handle.thread = thread
    return handle


def search_json(
        base_url,
        repo_root,
        settings,
        query,
        mode,
        backend=None,
        limit=None,
        ann=None,
        allow_sparse_fallback=False,
        as_of=None,
        snapshot=None,
        advanced=None):
    from . import search as search_lib

    base_url = normalize_base_url(base_url)
    if not base_url:
        raise RuntimeError('api_server_url is not set')

    timeout_ms = settings.get('api_timeout_ms') if isinstance(settings, dict) else None
    if not isinstance(timeout_ms, int) or timeout_ms <= 0:
        timeout_ms = 5000

    payload = search_lib.build_search_payload(
        query,
        repo_root=repo_root,
        mode=mode,
        backend=backend,
        limit=limit,
        ann=ann,
        allow_sparse_fallback=allow_sparse_fallback,
        as_of=as_of,
        snapshot=snapshot,
        advanced=advanced,
    )

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


def _resolve_timeout_ms(settings):
    timeout_ms = settings.get('api_timeout_ms') if isinstance(settings, dict) else None
    if not isinstance(timeout_ms, int) or timeout_ms <= 0:
        timeout_ms = 5000
    return timeout_ms


def health_json(base_url, settings):
    base_url = normalize_base_url(base_url)
    if not base_url:
        raise RuntimeError('api_server_url is not set')
    timeout_ms = _resolve_timeout_ms(settings)
    body, headers = request_json(
        build_url(base_url, '/health'),
        timeout_ms=timeout_ms,
    )
    if not isinstance(body, dict) or body.get('ok') is False:
        raise RuntimeError((body or {}).get('message') or 'API health request failed.')
    payload = dict(body)
    payload.setdefault('ok', True)
    return payload, headers


def status_json(base_url, repo_root, settings):
    base_url = normalize_base_url(base_url)
    if not base_url:
        raise RuntimeError('api_server_url is not set')
    timeout_ms = _resolve_timeout_ms(settings)
    body, headers = request_json(
        build_url(base_url, '/status', {'repo': repo_root}),
        timeout_ms=timeout_ms,
    )
    if not isinstance(body, dict) or body.get('ok') is False:
        raise RuntimeError((body or {}).get('message') or 'API status request failed.')
    payload = body.get('status')
    if not isinstance(payload, dict):
        raise RuntimeError('API status returned invalid JSON.')
    payload = dict(payload)
    payload.setdefault('ok', True)
    return payload, headers


