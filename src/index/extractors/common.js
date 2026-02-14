import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

export const DOCUMENT_EXTRACTION_REASON_CODES = Object.freeze([
  'unsupported_encrypted',
  'unsupported_scanned',
  'oversize',
  'extract_timeout',
  'missing_dependency',
  'extract_failed'
]);

const REASON_CODE_SET = new Set(DOCUMENT_EXTRACTION_REASON_CODES);

export const DEFAULT_DOCUMENT_EXTRACTION_POLICY = Object.freeze({
  maxBytesPerFile: 64 * 1024 * 1024,
  maxPages: 5000,
  extractTimeoutMs: 15000
});

export const EXTRACTION_NORMALIZATION_POLICY = 'v1';

const normalizePositiveInt = (value, fallback) => {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return fallback;
  return Math.floor(num);
};

export const normalizeDocumentExtractionPolicy = (input = null) => {
  const raw = input && typeof input === 'object' ? input : {};
  return {
    maxBytesPerFile: normalizePositiveInt(
      raw.maxBytesPerFile,
      DEFAULT_DOCUMENT_EXTRACTION_POLICY.maxBytesPerFile
    ),
    maxPages: normalizePositiveInt(
      raw.maxPages,
      DEFAULT_DOCUMENT_EXTRACTION_POLICY.maxPages
    ),
    extractTimeoutMs: normalizePositiveInt(
      raw.extractTimeoutMs,
      DEFAULT_DOCUMENT_EXTRACTION_POLICY.extractTimeoutMs
    )
  };
};

export const normalizeExtractedText = (value) => {
  if (value == null) return '';
  let text = String(value);
  text = text.replace(/\r\n?/g, '\n');
  text = text.replace(/\u00a0/g, ' ');
  text = text.replace(/[ \t\f\v]+/g, ' ');
  text = text.replace(/ *\n */g, '\n');
  text = text.replace(/\n{3,}/g, '\n\n');
  return text.trim();
};

export const normalizeWarning = (entry) => {
  if (!entry) return null;
  if (typeof entry === 'string') return entry;
  if (typeof entry === 'object') {
    const message = entry.message || entry.reason || entry.type || null;
    return message ? String(message) : null;
  }
  return String(entry);
};

export const normalizeWarnings = (entries) => (
  Array.isArray(entries)
    ? entries.map((entry) => normalizeWarning(entry)).filter(Boolean)
    : []
);

export const resolveFailureReason = (reason, fallback = 'extract_failed') => (
  REASON_CODE_SET.has(reason) ? reason : fallback
);

export const withTimeout = async (operation, timeoutMs) => {
  const timeout = normalizePositiveInt(timeoutMs, DEFAULT_DOCUMENT_EXTRACTION_POLICY.extractTimeoutMs);
  let timer = null;
  try {
    const timeoutPromise = new Promise((_, reject) => {
      timer = setTimeout(() => {
        const err = new Error('Document extraction timed out');
        err.code = 'EXTRACT_TIMEOUT';
        reject(err);
      }, timeout);
      timer.unref?.();
    });
    return await Promise.race([Promise.resolve().then(operation), timeoutPromise]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

export const sha256Hex = (buffer) => createHash('sha256').update(buffer).digest('hex');

export const resolvePackageVersion = (name) => {
  try {
    const pkg = require(`${name}/package.json`);
    if (pkg && typeof pkg.version === 'string' && pkg.version.trim()) return pkg.version.trim();
  } catch {}
  return null;
};

export const buildFailedResult = (reason, warnings = []) => ({
  ok: false,
  reason: resolveFailureReason(reason),
  warnings: normalizeWarnings(warnings)
});

