import http from 'node:http';
import https from 'node:https';
import { URL } from 'node:url';
import { createDownloadLookup, validateDownloadUrl } from './network-policy.js';

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

const downloadError = (url, message) => new Error(`Download request failed for ${url}: ${message}`);

const requestOnce = (url, { headers, responseType, timeoutMs, maxBytes, allowLocal }) => new Promise((resolve, reject) => {
  const parsed = validateDownloadUrl(url, { allowLocal });
  const handler = parsed.protocol === 'https:' ? https : http;
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    reject(downloadError(url, `unsupported protocol "${parsed.protocol}"`));
    return;
  }

  let settled = false;
  let timedOut = false;
  const finish = (fn, value) => {
    if (settled) return;
    settled = true;
    fn(value);
  };

  const req = handler.request(parsed, {
    method: 'GET', headers, lookup: createDownloadLookup({ allowLocal })
  }, (res) => {
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
        finish(reject, downloadError(url, `response exceeds maxBytes (${declaredBytes} > ${maxBytes})`));
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
        finish(reject, downloadError(url, `response exceeds maxBytes (${total} > ${maxBytes})`));
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
      finish(reject, downloadError(url, err?.message || 'response error'));
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
      finish(reject, downloadError(url, `timeout after ${timeoutMs}ms`));
      return;
    }
    finish(reject, downloadError(url, err?.message || 'request error'));
  });
  req.on('close', () => {
    if (timeoutHandle != null) clearTimeout(timeoutHandle);
  });
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
  let headers = options.headers && typeof options.headers === 'object'
    ? { ...options.headers }
    : {};
  const responseType = options.responseType === 'stream' ? 'stream' : 'buffer';
  const maxRedirects = Math.min(DEFAULT_MAX_REDIRECTS,
    toBoundedInteger(options.maxRedirects, DEFAULT_MAX_REDIRECTS, { min: 0 }));
  const timeoutMs = toTimeoutMs(options.timeoutMs) || 30_000;
  const maxBytes = toMaxBytes(options.maxBytes) || 64 * 1024 * 1024;
  const allowLocal = options.allowLocal === true || process.env.PAIROFCLEATS_ALLOW_LOCAL_DOWNLOADS === '1';
  let configuredOrigins = [];
  try { configuredOrigins = JSON.parse(process.env.PAIROFCLEATS_DOWNLOAD_REDIRECT_ORIGINS || '[]'); } catch {}
  const redirectOrigins = new Set(Array.isArray(configuredOrigins)
    ? configuredOrigins.map((entry) => validateDownloadUrl(entry, { allowLocal }).origin) : []);

  let currentUrl;
  try {
    currentUrl = new URL(initialUrl).toString();
  } catch {
    throw downloadError(String(initialUrl), 'invalid URL');
  }

  for (let redirects = 0; redirects <= maxRedirects; redirects++) {
    validateDownloadUrl(currentUrl, { allowLocal });
    const result = await requestOnce(currentUrl, { headers, responseType, timeoutMs, maxBytes, allowLocal });
    if (result.redirectUrl) {
      if (redirects >= maxRedirects) {
        throw downloadError(currentUrl, `too many redirects (max ${maxRedirects})`);
      }
      const previous = new URL(currentUrl);
      const next = validateDownloadUrl(result.redirectUrl, { allowLocal });
      if (previous.protocol === 'https:' && next.protocol !== 'https:') {
        throw downloadError(currentUrl, 'HTTPS downgrade redirect rejected');
      }
      if (previous.origin !== next.origin) {
        if (!redirectOrigins.has(next.origin)) {
          throw downloadError(currentUrl, 'cross-origin redirect requires launch-time approval');
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
