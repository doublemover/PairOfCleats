import json
import os
import threading
import urllib.parse
import urllib.request
import urllib.error
from . import operations

_REQUEST_CONTEXT = threading.local()
MAX_RESPONSE_BYTES = 20 * 1024 * 1024
_RESPONSE_BLOCK_BYTES = 64 * 1024


class ApiResponseTooLarge(RuntimeError):
    code = 'api-response-too-large'

    def __init__(self, limit, prefix=b''):
        super(ApiResponseTooLarge, self).__init__(
            'API response exceeded the {0}-byte editor limit. Narrow the request or reduce result volume.'.format(limit))
        self.preview = bytes(prefix[:4096]).decode('utf-8', 'replace')


def _read_response(response, handle=None, max_bytes=None):
    """Bound received bytes for JSON, text and HTTP errors before decoding."""
    limit = MAX_RESPONSE_BYTES if max_bytes is None else min(MAX_RESPONSE_BYTES, max(1, int(max_bytes)))
    headers = {str(key).lower(): str(value) for key, value in response.headers.items()}
    length = headers.get('content-length', '')
    # urllib supplies wire bytes; unlike fetch, it does not decompress bodies.
    digits = length.lstrip('0') or '0'
    if length and all('0' <= char <= '9' for char in length) and (
            len(digits) > len(str(limit)) or int(digits) > limit):
        raise ApiResponseTooLarge(limit)
    data = bytearray()
    while True:
        if handle is not None and handle.is_cancelled():
            raise RuntimeError('API request cancelled.')
        block = response.read(min(_RESPONSE_BLOCK_BYTES, limit - len(data) + 1))
        if handle is not None and handle.is_cancelled():
            raise RuntimeError('API request cancelled.')
        if not block:
            return bytes(data)
        if len(block) > limit - len(data):
            raise ApiResponseTooLarge(limit, data if data else block)
        data.extend(block)


class ApiResult(object):
    def __init__(self, payload=None, headers=None, error=None):
        self.payload = payload
        self.headers = headers or {}
        self.error = error


def read_workflow_capabilities(payload):
    if not isinstance(payload, dict):
        return {}
    manifest = payload.get('runtimeManifest')
    selected = None
    if isinstance(manifest, dict):
        surfaces = manifest.get('surfaces')
        api = surfaces.get('api') if isinstance(surfaces, dict) else None
        selected = api.get('workflowCapabilities') if isinstance(api, dict) else None
    if not isinstance(selected, dict):
        selected = payload.get('capabilities')
    return {key: value for key, value in (selected or {}).items()
            if isinstance(key, str) and isinstance(value, bool)} if isinstance(selected, dict) else {}


class ApiHandle(object):
    def __init__(self, thread, scope=None):
        self.thread = thread
        self._cancelled = False
        self.scope = scope
        self.response = None
        self.response_lock = threading.Lock()
        self.on_cancel = None
        self.settled = False

    def cancel(self):
        if self._cancelled:
            return
        self._cancelled = True
        if callable(self.on_cancel):
            self.on_cancel()
        with self.response_lock:
            response = self.response
        if response is not None:
            try:
                response.close()
            except Exception:
                pass

    def is_cancelled(self):
        return self._cancelled or (self.scope is not None and not operations.is_current(self.scope))

    def wait(self, timeout):
        if self.thread is not None:
            self.thread.join(timeout)
            return not self.thread.is_alive()
        return True


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


def _api_headers(destination):
    try:
        import sublime
    except ImportError:
        # Standalone low-level callers have no editor-owned endpoint grant.
        return {}
    from . import config
    return config.build_destination_bound_api_headers(destination)


class _CredentialRedirectGuard(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, response, code, message, headers, destination):
        if any(key.lower() == 'authorization' for key, _ in request.header_items()):
            raise urllib.error.HTTPError(request.full_url, code,
                'Credential-bearing API redirects are not allowed.', headers, response)
        return super(_CredentialRedirectGuard, self).redirect_request(
            request, response, code, message, headers, destination)


def _open_url(url, timeout_ms=5000, method='GET', payload=None, headers=None):
    handle = getattr(_REQUEST_CONTEXT, 'handle', None)
    if handle is not None and handle.is_cancelled():
        raise RuntimeError('API request cancelled.')
    timeout = float(timeout_ms or 5000) / 1000.0
    if timeout <= 0:
        timeout = 5.0
    request_headers = dict(headers or {})
    data = _encode_payload(payload)
    if data is not None and 'Content-Type' not in request_headers:
        request_headers['Content-Type'] = 'application/json'
    request = urllib.request.Request(url, data=data, headers=request_headers, method=method)

    opener = urllib.request.build_opener(_CredentialRedirectGuard())
    try:
        resp = opener.open(request, timeout=timeout)
    except urllib.error.HTTPError as err:
        # HTTPError owns a live response too, including authentication/proxy
        # bodies. It follows the same budget, cancellation and close path.
        resp = err
    if handle is not None:
        with handle.response_lock:
            handle.response = resp
    try:
        if handle is not None and handle.is_cancelled():
            raise RuntimeError('API request cancelled.')
        status = resp.getcode() or 0
        headers = dict(resp.headers.items())
        data = _read_response(resp, handle)
        return status, headers, data
    finally:
        if handle is not None:
            with handle.response_lock:
                handle.response = None
        try:
            resp.close()
        except Exception:
            pass


def request_json(url, timeout_ms=5000, method='GET', payload=None, headers=None):
    status, headers, data = _open_url(url, timeout_ms=timeout_ms, method=method, payload=payload, headers=headers)
    text = (data or b'').decode('utf-8', 'replace')
    if status < 200 or status >= 300:
        raise RuntimeError('API request failed ({0}): {1}'.format(status, text.strip()[:4096] or 'No response detail.'))
    try:
        return json.loads(text or '{}'), headers
    except Exception as exc:
        raise RuntimeError('API returned invalid JSON: {0}'.format(exc))


def request_text(url, timeout_ms=5000, method='GET', payload=None, headers=None):
    status, headers, data = _open_url(url, timeout_ms=timeout_ms, method=method, payload=payload, headers=headers)
    text = (data or b'').decode('utf-8', 'replace')
    if status < 200 or status >= 300:
        raise RuntimeError('API request failed ({0}): {1}'.format(status, text.strip()[:4096] or 'No response detail.'))
    return text, headers


def _ensure_parent_dir(path_value):
    handle = getattr(_REQUEST_CONTEXT, 'handle', None)
    if handle is not None and handle.is_cancelled():
        raise RuntimeError('API export cancelled.')
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


def run_async(request_fn, on_done, on_progress=None, window=None, scope=None, task=None):
    import sublime
    scope = scope or operations.capture(window or sublime.active_window())
    handle = ApiHandle(None, scope=scope)
    if task is not None:
        from . import tasks
        task['_scope'] = dict(scope)
        def cancelled_task():
            tasks.mark_cancelling(window, task,
                details='Cancellation requested; waiting for owned HTTP request settlement.')
            if handle.settled:
                sublime.set_timeout(lambda: tasks.complete_task(window, task, status='cancelled',
                    details='Cancelled after owned HTTP request settlement.'), 0)
        handle.on_cancel = cancelled_task
        task['cancellable'] = True
        task['cancel'] = handle.cancel

    def worker():
        _REQUEST_CONTEXT.handle = handle
        try:
            if handle.is_cancelled():
                return
            if callable(on_progress) and not handle.is_cancelled():
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
        finally:
            _REQUEST_CONTEXT.handle = None
            operations.release(handle)
            handle.settled = True
            if task is not None and handle.is_cancelled():
                from . import tasks
                sublime.set_timeout(lambda: tasks.complete_task(window, task, status='cancelled',
                    details='Cancelled after owned HTTP request settlement.'), 0)
        if handle.is_cancelled():
            return
        sublime.set_timeout(lambda: on_done(result) if not handle.is_cancelled() else None, 0)

    thread = threading.Thread(target=worker)
    thread.daemon = True
    handle.thread = thread
    operations.track(scope, handle)
    thread.start()
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
        advanced=None,
        cursor=None):
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
        cursor=cursor,
    )

    body, headers = request_json(
        build_url(base_url, '/search'),
        timeout_ms=timeout_ms,
        method='POST',
        payload=payload,
        headers=_api_headers(base_url),
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
        headers=_api_headers(base_url),
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
        headers=_api_headers(base_url),
    )
    if not isinstance(body, dict) or body.get('ok') is False:
        raise RuntimeError((body or {}).get('message') or 'API status request failed.')
    payload = body.get('status')
    if not isinstance(payload, dict):
        raise RuntimeError('API status returned invalid JSON.')
    payload = dict(payload)
    payload.setdefault('ok', True)
    return payload, headers


