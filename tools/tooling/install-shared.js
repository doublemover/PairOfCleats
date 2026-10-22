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

const captureDownloadClosure = error => {
  let observer;
  try { observer = error.cacheOwnershipReleased; } catch { return { required: true, observe: () => false }; }
  return { required: error.cacheOwnershipPending === true || typeof observer === 'function',
    observe: () => { try { return typeof observer === 'function' && observer.call(error) === true; } catch { return false; } } };
};

/** Actual transport reconciliation, used by the existing install resource
 * owners before releasing their separate transaction/storage lifetimes.
 */
export const settleInstallDownload = async error => {
  const session = error?.downloadSession;
  if (!session || typeof session.releaseAfterClosure !== 'function' || typeof session.isSettled !== 'function') {
    throw new Error('Download reconciliation requires its actual response resource owner.');
  }
  const receipt = await session.releaseAfterClosure();
  let allReleased = false;
  try { allReleased = error.cacheOwnershipReleased?.() === true; } catch { /* Unknown owner remains retained. */ }
  if (receipt?.resourceId !== session.resourceId || receipt.settled !== true || receipt.pending !== false
    || session.isSettled() !== true || !allReleased) {
    throw Object.assign(new Error('Actual download response/resource settlement remains unconfirmed.'), { cacheOwnershipPending: true });
  }
  return receipt;
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
  settlementTimeoutMs = 4000,
  drainErrorBody = false,
  fetchImpl = fetch
}) => {
  if (maxBytes !== null && (!Number.isSafeInteger(maxBytes) || maxBytes <= 0)) throw createInstallError('invalid_download_byte_bound', 'Download byte bound must be a positive safe integer.');
  if (!Number.isSafeInteger(settlementTimeoutMs) || settlementTimeoutMs < 1) throw new TypeError('Download settlement observation requires a positive bounded interval.');
  signal?.throwIfAborted();
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
  let cleanupSettled = false;
  let closing = null;
  let nodeCloseFailure = null;
  let nodeBody = null;
  let nodeClosed = null;
  let nodeReturn = null;
  let nodeReaderClose = null;
  let operationCloseFailure = null;
  const resourceId = crypto.randomUUID();
  const releaseReader = () => {
    const owned = reader;
    if (owned && typeof owned.releaseLock !== 'function') throw new Error('Download reader lock has no confirmed release owner.');
    owned?.releaseLock?.();
    reader = null;
  };
  const observeNodeBody = body => {
    if (!body || typeof body.destroy !== 'function' || typeof body.once !== 'function') return;
    nodeBody = body;
    if (body.errored?.syscall === 'close') nodeCloseFailure = body.errored;
    nodeClosed = body.closed === true ? Promise.resolve() : new Promise(resolve => body.once('close', resolve));
    body.on?.('error', error => { if (error?.syscall === 'close') nodeCloseFailure = error; });
  };
  const closeNodeBody = async () => {
    // Node's iterator done/return establishes iteration, not fd/socket close.
    // Start iterator teardown and independently observe the actual body close;
    // both remain owned if either has not completed within the observation.
    if (!bodyComplete && iterator && !nodeReturn) {
      const owned = iterator;
      nodeReturn = Promise.resolve().then(async () => {
        if (typeof owned.return !== 'function') throw new Error('Node response iterator has no teardown owner.');
        const result = await owned.return();
        if (result?.done !== true) throw new Error('Node response iterator teardown remains incomplete.');
        iterator = null;
      }).catch(error => { nodeReturn = null; throw error; });
    }
    if (!bodyComplete && reader && !nodeReaderClose) {
      const owned = reader;
      nodeReaderClose = Promise.resolve().then(() => owned.cancel(fetchOptions.signal.reason))
        .catch(error => { nodeReaderClose = null; throw error; });
    }
    const returned = nodeReturn;
    // Attach both observers immediately so a failed return is never unhandled
    // while the native body close is still pending.
    const complete = Promise.all([nodeClosed, returned, nodeReaderClose]).then(() => {
      if (nodeCloseFailure) throw nodeCloseFailure;
    });
    complete.catch(() => {});
    if (nodeBody.closed !== true) nodeBody.destroy();
    await complete;
  };
  const closeBody = async () => {
    if (nodeBody) {
      await closeNodeBody();
      bodyComplete = true;
    } else if (!bodyComplete && response?.body) {
      // A reader/iterator owns a stream lock. Close through that owner before
      // considering the unlocked body; cancelling the body while locked fails.
      const close = reader ? () => reader.cancel(fetchOptions.signal.reason)
        : typeof iterator?.return === 'function' ? async () => {
          const result = await iterator.return();
          if (result?.done !== true) throw new Error('Download iterator teardown did not confirm completion.');
        }
          : typeof response?.body?.cancel === 'function' ? () => response.body.cancel(fetchOptions.signal.reason) : null;
      if (!close) throw new Error('Download response body has no confirmed teardown owner.');
      // Failed cancellation retains the original locked reader for retry.
      // Releasing it first would lose the only actual transport owner.
      await close();
      bodyComplete = true;
    }
    releaseReader();
    iterator = null;
    cleanupSettled = true;
  };
  const finishClose = () => {
    if (cleanupSettled) return Promise.resolve();
    if (!closing) closing = closeBody().catch(error => { closing = null; throw error; });
    return closing;
  };
  const observeClose = async () => {
    let timer;
    try {
      await Promise.race([finishClose(), new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('Download response teardown remains pending.')), settlementTimeoutMs);
      })]);
    } finally { clearTimeout(timer); }
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
    iterator = null;
    if (!nodeBody) cleanupSettled = true;
    return discard ? null : Buffer.concat(chunks, bytes);
  };
  try {
    response = await fetchImpl(url, fetchOptions);
    observeNodeBody(response?.body);
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
    if (nodeBody) {
      try { await observeClose(); }
      catch (error) { operationCloseFailure = error; throw error; }
    }
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
    let primaryError = signal?.aborted ? signal.reason || error : error;
    if (!primaryError || typeof primaryError !== 'object') primaryError = new Error(String(primaryError), { cause: primaryError });
    try {
      if (error === operationCloseFailure) throw error;
      await observeClose();
    }
    catch (cleanupError) {
      const previous = captureDownloadClosure(primaryError);
      const additional = captureDownloadClosure(cleanupError);
      const allReleased = () => cleanupSettled && (!previous.required || previous.observe())
        && (!additional.required || additional.observe());
      const session = Object.freeze({ resourceId,
        isSettled: () => cleanupSettled,
        releaseAfterClosure: async () => {
          await observeClose();
          return { resourceId, settled: true, pending: false };
        } });
      const descriptors = { cacheOwnershipPending: { value: true, configurable: true, writable: true },
        retryable: { value: false, configurable: true, writable: true },
        cacheOwnershipReleased: { value: allReleased, configurable: true, writable: true },
        downloadCleanupError: { value: cleanupError, configurable: true },
        downloadSession: { value: session, configurable: true } };
      try { Object.defineProperties(primaryError, descriptors); }
      catch {
        const aggregate = new AggregateError([primaryError, cleanupError], primaryError.message || 'Download and response cleanup failed.', { cause: primaryError });
        for (const key of ['code', 'reason', 'statusCode']) if (primaryError[key] !== undefined) aggregate[key] = primaryError[key];
        Object.defineProperties(aggregate, descriptors);
        primaryError = aggregate;
      }
    }
    if (signal?.aborted) throw primaryError;
    if (primaryError.cacheOwnershipPending) throw primaryError;
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
