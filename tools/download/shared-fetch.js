import http from 'node:http';
import https from 'node:https';
import { URL } from 'node:url';
import { createDownloadLookup, validateDownloadUrl } from './network-policy.js';
import { getDownloadEnvConfig } from '../../src/shared/env/runtime.js';

const REDIRECT_STATUS_CODES = new Set([301, 302, 303, 307, 308]);
const DEFAULT_MAX_REDIRECTS = 5;

const toBoundedInteger = (value, fallback, { min = 0 } = {}) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.floor(parsed));
};

const toMaxBytes = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.floor(parsed);
};

const toTimeoutMs = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.floor(parsed);
};

const downloadError = (url, message, code = 'ERR_DOWNLOAD_NETWORK') =>
  Object.assign(new Error(`Download request failed for ${url}: ${message}`), { code });

const requestOnce = (url, { headers, responseType, timeoutMs, maxBytes, allowLocal, signal, onResource }) => new Promise((resolve, reject) => {
  const parsed = validateDownloadUrl(url, { allowLocal });
  const handler = parsed.protocol === 'https:' ? https : http;
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    reject(downloadError(url, `unsupported protocol "${parsed.protocol}"`));
    return;
  }

  let settled = false;
  let timedOut = false;
  let requestClosed = false;
  let responseClosed = true;
  let response = null;
  let resolveClosed;
  const closed = new Promise(resolveClosure => { resolveClosed = resolveClosure; });
  const checkClosed = () => { if (requestClosed && responseClosed) resolveClosed(); };
  const finish = (fn, value) => {
    if (settled) return;
    settled = true;
    fn(value);
  };

  const req = handler.request(parsed, {
    method: 'GET', headers, lookup: createDownloadLookup({ allowLocal }), signal
  }, (res) => {
    response = res;
    responseClosed = res.closed === true;
    res.once('close', () => { responseClosed = true; checkClosed(); });
    res.on('error', error => finish(reject, downloadError(url, error?.message || 'response error', error?.code || 'ERR_DOWNLOAD_NETWORK')));
    const statusCode = Number(res.statusCode) || 0;
    const responseHeaders = res.headers || {};
    if (REDIRECT_STATUS_CODES.has(statusCode)) {
      const location = responseHeaders.location;
      if (!location) {
        res.resume();
        finish(reject, downloadError(url, 'redirect missing location header'));
        return;
      }
      res.resume();
      finish(resolve, {
        redirectUrl: new URL(location, parsed).toString()
      });
      return;
    }

    if (maxBytes != null) {
      const declaredBytes = Number(responseHeaders['content-length']);
      if (Number.isFinite(declaredBytes) && declaredBytes > maxBytes) {
        res.resume();
        finish(reject, downloadError(url, `response exceeds maxBytes (${declaredBytes} > ${maxBytes})`, 'ERR_DOWNLOAD_MAX_BYTES'));
        return;
      }
    }

    if (responseType === 'stream') {
      finish(resolve, {
        statusCode,
        headers: responseHeaders,
        stream: res
      });
      return;
    }

    const chunks = [];
    let total = 0;
    res.on('data', (chunk) => {
      total += chunk.length;
      if (maxBytes != null && total > maxBytes) {
        finish(reject, downloadError(url, `response exceeds maxBytes (${total} > ${maxBytes})`, 'ERR_DOWNLOAD_MAX_BYTES'));
        res.destroy();
        return;
      }
      chunks.push(chunk);
    });
    res.on('end', () => {
      finish(resolve, {
        statusCode,
        headers: responseHeaders,
        body: Buffer.concat(chunks)
      });
    });
    res.on('error', (err) => {
      finish(reject, timedOut
        ? downloadError(url, `timeout after ${timeoutMs}ms`, 'ERR_DOWNLOAD_TIMEOUT')
        : downloadError(url, err?.message || 'response error', err?.code || 'ERR_DOWNLOAD_NETWORK'));
    });
  });

  const timeoutHandle = timeoutMs == null
    ? null
    : setTimeout(() => {
      timedOut = true;
      req.destroy();
    }, timeoutMs);

  req.on('error', (err) => {
    if (timedOut) {
      finish(reject, downloadError(url, `timeout after ${timeoutMs}ms`, 'ERR_DOWNLOAD_TIMEOUT'));
      return;
    }
    finish(reject, downloadError(url, err?.message || 'request error', err?.code || 'ERR_DOWNLOAD_NETWORK'));
  });
  req.on('close', () => {
    requestClosed = true;
    checkClosed();
    if (timeoutHandle != null) clearTimeout(timeoutHandle);
  });
  if (typeof onResource === 'function') {
    try { onResource({ closed, isClosed: () => requestClosed && responseClosed,
      close: () => { response?.destroy(); req.destroy(); } }); }
    catch (error) { req.destroy(); finish(reject, error); return; }
  }
  req.end();
});

/**
 * Fetch a URL with redirect handling and bounded response controls.
 * @param {string} initialUrl
 * @param {object} [options]
 * @param {Record<string,string>} [options.headers]
 * @param {'buffer'|'stream'} [options.responseType]
 * @param {number} [options.maxRedirects]
 * @param {number} [options.timeoutMs]
 * @param {number|null|undefined} [options.maxBytes]
 * @returns {Promise<{statusCode:number,headers:object,body?:Buffer,stream?:import('node:stream').Readable,url:string,redirects:number}>}
 */
export async function fetchDownloadUrl(initialUrl, options = {}) {
  options.signal?.throwIfAborted();
  let headers = options.headers && typeof options.headers === 'object'
    ? { ...options.headers }
    : {};
  const responseType = options.responseType === 'stream' ? 'stream' : 'buffer';
  const maxRedirects = Math.min(DEFAULT_MAX_REDIRECTS,
    toBoundedInteger(options.maxRedirects, DEFAULT_MAX_REDIRECTS, { min: 0 }));
  const timeoutMs = toTimeoutMs(options.timeoutMs) || 30_000;
  const deadline = Date.now() + timeoutMs;
  const maxBytes = toMaxBytes(options.maxBytes) || 64 * 1024 * 1024;
  const downloadEnv = getDownloadEnvConfig();
  const allowLocal = options.allowLocal === true || downloadEnv.allowLocal;
  let configuredOrigins = [];
  try { configuredOrigins = JSON.parse(downloadEnv.redirectOriginsJson); } catch {}
  const redirectOrigins = new Set(Array.isArray(configuredOrigins)
    ? configuredOrigins.map((entry) => validateDownloadUrl(entry, { allowLocal }).origin) : []);

  let currentUrl;
  try {
    currentUrl = new URL(initialUrl).toString();
  } catch {
    throw downloadError(String(initialUrl), 'invalid URL');
  }

  for (let redirects = 0; redirects <= maxRedirects; redirects++) {
    options.signal?.throwIfAborted();
    validateDownloadUrl(currentUrl, { allowLocal });
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) throw downloadError(currentUrl, `timeout after ${timeoutMs}ms`, 'ERR_DOWNLOAD_TIMEOUT');
    const result = await requestOnce(currentUrl, { headers, responseType, timeoutMs: remainingMs, maxBytes, allowLocal,
      signal: options.signal, onResource: options.onResource });
    if (result.redirectUrl) {
      if (redirects >= maxRedirects) {
        throw downloadError(currentUrl, `too many redirects (max ${maxRedirects})`, 'ERR_DOWNLOAD_REDIRECT');
      }
      const previous = new URL(currentUrl);
      const next = validateDownloadUrl(result.redirectUrl, { allowLocal });
      if (previous.protocol === 'https:' && next.protocol !== 'https:') {
        throw downloadError(currentUrl, 'HTTPS downgrade redirect rejected', 'ERR_DOWNLOAD_AUTHORITY');
      }
      if (previous.origin !== next.origin) {
        if (!redirectOrigins.has(next.origin)) {
          throw downloadError(currentUrl, 'cross-origin redirect requires launch-time approval', 'ERR_DOWNLOAD_AUTHORITY');
        }
        headers = Object.fromEntries(Object.entries(headers).filter(([key]) => (
          !['authorization', 'cookie', 'proxy-authorization', 'host'].includes(key.toLowerCase())
        )));
      }
      currentUrl = next.toString();
      continue;
    }
    return {
      ...result,
      url: currentUrl,
      redirects
    };
  }

  throw downloadError(currentUrl, `too many redirects (max ${maxRedirects})`);
}
