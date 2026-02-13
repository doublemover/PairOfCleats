import { redactAbsolutePaths } from './redact.js';

const VALIDATION_POINTER_RE = /^#?(\/[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*)$/;
const VALIDATION_MESSAGE_RE = /\s+(has unknown field|missing required field|must\b)/i;

/**
 * Preserve non-filesystem field pointers in validation errors after path
 * redaction.
 *
 * AJV-style messages and `{ path, message }` payload entries commonly use
 * JSON pointer syntax (for example `/top`, `/mode`). Those are not filesystem
 * paths and should remain visible so callers can correct requests.
 *
 * @param {any} original
 * @param {any} redacted
 * @returns {any}
 */
const preserveValidationFieldPath = (original, redacted) => {
  if (typeof original === 'string') {
    const trimmed = original.trim();
    const pointerToken = trimmed.split(/\s+/, 1)[0] || '';
    if (VALIDATION_POINTER_RE.test(pointerToken) && VALIDATION_MESSAGE_RE.test(trimmed)) {
      return original;
    }
    return redacted;
  }
  if (!original || typeof original !== 'object' || Array.isArray(original)) {
    return redacted;
  }
  const result = redacted && typeof redacted === 'object' && !Array.isArray(redacted)
    ? { ...redacted }
    : {};
  const pathValue = original.path;
  if (typeof pathValue === 'string' && VALIDATION_POINTER_RE.test(pathValue)) {
    result.path = pathValue;
  }
  return result;
};

/**
 * Write a JSON payload to the HTTP response.
 * @param {import('node:http').ServerResponse} res
 * @param {number} statusCode
 * @param {any} payload
 * @param {object} [headers]
 */
export const sendJson = (res, statusCode, payload, headers = {}) => {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    ...headers
  });
  res.end(body);
};

/**
 * Write an error payload to the HTTP response.
 * @param {import('node:http').ServerResponse} res
 * @param {number} statusCode
 * @param {string} code
 * @param {string} message
 * @param {object} [details]
 * @param {object} [headers]
 */
export const sendError = (res, statusCode, code, message, details = {}, headers = {}) => {
  const { code: ignored, ...rest } = details || {};
  const rawPayload = { ok: false, code, message, ...rest };
  const redactedPayload = redactAbsolutePaths(rawPayload);
  if (Array.isArray(rawPayload.errors) && Array.isArray(redactedPayload?.errors)) {
    redactedPayload.errors = rawPayload.errors.map((entry, index) => (
      preserveValidationFieldPath(entry, redactedPayload.errors[index])
    ));
  }
  sendJson(res, statusCode, redactedPayload, headers);
};
