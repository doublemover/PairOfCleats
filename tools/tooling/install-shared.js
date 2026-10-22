import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

export const toInt = (value, fallback, min = 0) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.floor(parsed));
};

export const sleep = async (ms) => {
  if (!Number.isFinite(ms) || ms <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, ms));
};

export const jitterForAttempt = (attempt, jitterMs) => {
  if (!Number.isFinite(jitterMs) || jitterMs <= 0) return 0;
  const seed = (attempt * 193) + 17;
  return seed % (Math.floor(jitterMs) + 1);
};

export const withTimeoutSignal = (timeoutMs) => {
  const abortController = new AbortController();
  const timer = setTimeout(() => {
    abortController.abort(new Error(`timeout after ${timeoutMs}ms`));
  }, timeoutMs);
  return {
    signal: abortController.signal,
    clear: () => clearTimeout(timer)
  };
};

export const createInstallError = (reason, message, options = {}) => {
  const error = new Error(message);
  error.reason = reason;
  error.retryable = options.retryable === true;
  if (Number.isInteger(options.statusCode)) {
    error.statusCode = options.statusCode;
  }
  if (options.cause) error.cause = options.cause;
  return error;
};

export const normalizeChecksum = (value) => String(value || '').trim().toLowerCase();

export const computeSha256 = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');

export const isRetryableHttpStatus = (statusCode) => statusCode === 408 || statusCode === 429 || statusCode >= 500;

const defaultDownloadMessage = (reason, details) => {
  if (reason === 'download_http_error') {
    return `Failed to download ${details.label} (${details.statusCode} ${details.statusText}).`;
  }
  if (reason === 'download_empty_payload') return `Downloaded empty ${details.label} payload.`;
  if (reason === 'download_timeout') return `Timed out downloading ${details.label} after ${details.timeoutMs}ms.`;
  return `Failed to download ${details.label}: ${details.message || details.errorText}`;
};

const buildDownloadMessage = (createErrorMessage, reason, details) => {
  if (typeof createErrorMessage === 'function') {
    const message = createErrorMessage(reason, details);
    if (message) return String(message);
  }
  return defaultDownloadMessage(reason, details);
};

export const downloadToBuffer = async ({
  url,
  timeoutMs,
  label,
  createErrorMessage,
  headers,
  redirect = 'follow',
  signal = null,
  maxBytes = null,
  drainErrorBody = false,
  fetchImpl = fetch
}) => {
  if (maxBytes !== null && (!Number.isSafeInteger(maxBytes) || maxBytes <= 0)) throw createInstallError('invalid_download_byte_bound', 'Download byte bound must be a positive safe integer.');
  const timeout = withTimeoutSignal(timeoutMs);
  const fetchOptions = {
    redirect,
    signal: signal ? AbortSignal.any([timeout.signal, signal]) : timeout.signal
  };
  if (headers && typeof headers === 'object') {
    fetchOptions.headers = headers;
  }
  let response = null;
  let iterator = null;
  let reader = null;
  let bodyComplete = false;
  const releaseReader = () => {
    const owned = reader;
    reader = null;
    owned?.releaseLock?.();
  };
  const closeBody = async () => {
    let failure = null;
    if (!bodyComplete) {
      // A reader/iterator owns a stream lock. Close through that owner before
      // considering the unlocked body; cancelling the body while locked fails.
      const close = reader ? () => reader.cancel(fetchOptions.signal.reason)
        : typeof iterator?.return === 'function' ? () => iterator.return()
          : typeof response?.body?.cancel === 'function' ? () => response.body.cancel(fetchOptions.signal.reason)
            : typeof response?.body?.destroy === 'function' ? () => response.body.destroy() : null;
      try { await close?.(); } catch (error) { failure = error; }
    }
    try { releaseReader(); } catch (error) { failure ||= error; }
    if (failure) throw failure;
  };
  const readNext = async () => {
    fetchOptions.signal.throwIfAborted();
    let onAbort;
    const interrupted = new Promise((_, reject) => {
      onAbort = () => reject(fetchOptions.signal.reason);
      fetchOptions.signal.addEventListener('abort', onAbort, { once: true });
    });
    try { return await Promise.race([reader ? reader.read() : iterator.next(), interrupted]); }
    finally { fetchOptions.signal.removeEventListener('abort', onAbort); }
  };
  const consume = async ({ limit = maxBytes, discard = false } = {}) => {
    if (typeof response.body?.getReader === 'function') reader = response.body.getReader();
    else if (typeof response.body?.[Symbol.asyncIterator] === 'function') iterator = response.body[Symbol.asyncIterator]();
    else {
      if (limit) throw createInstallError('download_stream_unavailable', 'Bounded download requires an incrementally readable response body.', { retryable: false });
      const body = Buffer.from(await response.arrayBuffer());
      bodyComplete = true;
      return body;
    }
    const chunks = [];
    let bytes = 0;
    while (true) {
      const next = await readNext();
      if (next.done) { bodyComplete = true; break; }
      const chunk = next.value;
      if (!(chunk instanceof Uint8Array)) throw createInstallError('download_invalid_chunk', 'Download transport produced a non-byte chunk.', { retryable: false });
      bytes += chunk.byteLength;
      if (limit && bytes > limit) throw createInstallError('download_too_large', `${label} exceeds the download byte limit.`, { retryable: false });
      if (!discard) chunks.push(Buffer.from(chunk));
    }
    releaseReader();
    return discard ? null : Buffer.concat(chunks, bytes);
  };
  try {
    response = await fetchImpl(url, fetchOptions);
    if (!response.ok) {
      if (drainErrorBody) {
        // Legacy draining remains bounded and does not allocate an error body.
        try { await consume({ limit: Math.min(maxBytes || 65536, 65536), discard: true }); } catch {}
      }
      throw createInstallError(
        'download_http_error',
        buildDownloadMessage(createErrorMessage, 'download_http_error', {
          label,
          url,
          statusCode: response.status,
          statusText: response.statusText
        }),
        { retryable: isRetryableHttpStatus(response.status), statusCode: response.status }
      );
    }
    const declaredBytes = Number(response.headers?.get?.('content-length'));
    if (maxBytes && Number.isFinite(declaredBytes) && declaredBytes > maxBytes) {
      throw createInstallError('download_too_large', `${label} exceeds the download byte limit.`, { retryable: false });
    }
    const body = await consume();
    if (!body.length) {
      throw createInstallError(
        'download_empty_payload',
        buildDownloadMessage(createErrorMessage, 'download_empty_payload', { label, url }),
        { retryable: false }
      );
    }
    return {
      body,
      sha256: computeSha256(body),
      sourceUrl: response.url || url
    };
  } catch (error) {
    const primaryError = signal?.aborted ? signal.reason || error : error;
    try { await closeBody(); }
    catch (cleanupError) {
      if (primaryError && typeof primaryError === 'object') {
        try { Object.defineProperty(primaryError, 'downloadCleanupError', { value: cleanupError, configurable: true }); } catch {}
      }
    }
    if (signal?.aborted) throw primaryError;
    if (error?.reason) throw error;
    const timeoutTriggered = timeout.signal?.aborted === true;
    const message = String(error?.message || '');
    if (timeoutTriggered || error?.name === 'AbortError' || /timeout/i.test(message)) {
      throw createInstallError(
        'download_timeout',
        buildDownloadMessage(createErrorMessage, 'download_timeout', {
          label,
          url,
          timeoutMs,
          message,
          errorText: message || String(error)
        }),
        { retryable: true, cause: error }
      );
    }
    throw createInstallError(
      'download_network_error',
      buildDownloadMessage(createErrorMessage, 'download_network_error', {
        label,
        url,
        message,
        errorText: message || String(error)
      }),
      { retryable: true, cause: error }
    );
  } finally {
    timeout.clear();
  }
};

export const writeInstallReport = async (reportPath, payload) => {
  const target = String(reportPath || '').trim();
  if (!target) return null;
  const resolved = path.resolve(target);
  await fs.mkdir(path.dirname(resolved), { recursive: true });
  await fs.writeFile(resolved, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  return resolved;
};
