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
  drainErrorBody = false
}) => {
  const timeout = withTimeoutSignal(timeoutMs);
  const fetchOptions = {
    redirect,
    signal: timeout.signal
  };
  if (headers && typeof headers === 'object') {
    fetchOptions.headers = headers;
  }
  try {
    const response = await fetch(url, fetchOptions);
    if (!response.ok) {
      if (drainErrorBody) {
        try {
          await response.arrayBuffer();
        } catch {}
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
    const body = Buffer.from(await response.arrayBuffer());
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
