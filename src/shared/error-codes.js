export const ERROR_CODES = Object.freeze({
  INVALID_REQUEST: 'INVALID_REQUEST',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CAPABILITY_MISSING: 'CAPABILITY_MISSING',
  NO_INDEX: 'NO_INDEX',
  CANCELLED: 'CANCELLED',
  INTERNAL: 'INTERNAL',
  QUEUE_OVERLOADED: 'QUEUE_OVERLOADED',
  TOOL_TIMEOUT: 'TOOL_TIMEOUT',
  DOWNLOAD_VERIFY_FAILED: 'DOWNLOAD_VERIFY_FAILED',
  ARCHIVE_UNSAFE: 'ARCHIVE_UNSAFE',
  ARCHIVE_TOO_LARGE: 'ARCHIVE_TOO_LARGE'
});

export const ERROR_NAMESPACE = 'poc';

export const ERROR_HINTS = Object.freeze({
  [ERROR_CODES.INVALID_REQUEST]: 'Review the request flags/payload and retry with a valid shape.',
  [ERROR_CODES.UNAUTHORIZED]: 'Set a valid API token or credentials for this request.',
  [ERROR_CODES.FORBIDDEN]: 'Request targets a path/resource outside the allowed scope.',
  [ERROR_CODES.NOT_FOUND]: 'Verify the requested path/resource exists and is accessible.',
  [ERROR_CODES.CAPABILITY_MISSING]: 'Install the required dependency or disable the capability.',
  [ERROR_CODES.NO_INDEX]: 'Run `pairofcleats index build` (or `node build_index.js`) and retry.',
  [ERROR_CODES.CANCELLED]: 'Retry the operation or increase timeout/deadline if cancellation was unintended.',
  [ERROR_CODES.INTERNAL]: 'Retry once; if the issue persists, collect logs and file a bug.',
  [ERROR_CODES.QUEUE_OVERLOADED]: 'Retry shortly or lower request concurrency.',
  [ERROR_CODES.TOOL_TIMEOUT]: 'Increase timeout or reduce requested workload size.',
  [ERROR_CODES.DOWNLOAD_VERIFY_FAILED]: 'Re-download artifacts and verify checksums/transport integrity.',
  [ERROR_CODES.ARCHIVE_UNSAFE]: 'Use a trusted archive source and remove unsafe entries.',
  [ERROR_CODES.ARCHIVE_TOO_LARGE]: 'Use a smaller archive or raise policy limits explicitly.'
});

export const isErrorCode = (value) => (
  typeof value === 'string' && Object.values(ERROR_CODES).includes(value)
);

export const normalizeErrorCode = (value, fallback = ERROR_CODES.INTERNAL) => (
  isErrorCode(value) ? value : fallback
);

const MAX_HINT_INPUT = 16384;

const capHintInput = (value) => {
  if (!value) return '';
  const text = String(value);
  if (text.length <= MAX_HINT_INPUT) return text;
  return text.slice(0, MAX_HINT_INPUT);
};

export const resolveErrorHint = ({ code, message = '', stderr = '', stdout = '', hint = '' } = {}) => {
  if (hint && String(hint).trim()) return String(hint).trim();
  const resolvedCode = normalizeErrorCode(code, ERROR_CODES.INTERNAL);
  const combined = [message, stderr, stdout]
    .map(capHintInput)
    .filter(Boolean)
    .join('\n')
    .toLowerCase();

  if (combined) {
    if (combined.includes('sqlite backend requested but index not found')
      || combined.includes('missing required tables')) {
      return 'Run `pairofcleats index build --stage 4` (or `node build_index.js --stage 4`) or set sqlite.use=false / --backend memory.';
    }
    if (combined.includes('better-sqlite3 is required')) {
      return 'Run `npm install` and ensure better-sqlite3 can load on this platform.';
    }
    if (combined.includes('chunk_meta.json')
      || combined.includes('minhash_signatures')
      || combined.includes('index not found')
      || combined.includes('build-index')
      || combined.includes('build index')) {
      return 'Run `pairofcleats index build` (build-index) or `pairofcleats setup`/`pairofcleats bootstrap` to generate indexes.';
    }
    if ((combined.includes('model') || combined.includes('xenova') || combined.includes('transformers'))
      && (combined.includes('not found') || combined.includes('failed') || combined.includes('fetch') || combined.includes('download') || combined.includes('enoent'))) {
      return 'Run `node tools/download/models.js` or use `--stub-embeddings` / `PAIROFCLEATS_EMBEDDINGS=stub`.';
    }
    if (combined.includes('dictionary')
      || combined.includes('wordlist')
      || combined.includes('words_alpha')
      || combined.includes('download-dicts')) {
      return 'Run `node tools/download/dicts.js --lang en` (or configure dictionary.files/languages).';
    }
  }

  return ERROR_HINTS[resolvedCode] || ERROR_HINTS[ERROR_CODES.INTERNAL];
};

export const namespacedErrorCode = (code) => (
  `${ERROR_NAMESPACE}.${normalizeErrorCode(code).toLowerCase()}`
);

export const buildErrorPayload = ({ code, message, details = {} } = {}) => {
  const resolvedCode = normalizeErrorCode(code, ERROR_CODES.INTERNAL);
  const payload = {
    ok: false,
    code: resolvedCode,
    namespaceCode: namespacedErrorCode(resolvedCode),
    message: message || 'Error'
  };
  if (details && typeof details === 'object') {
    Object.assign(payload, details);
  }
  if (!payload.hint) {
    payload.hint = resolveErrorHint({
      code: resolvedCode,
      message: payload.message,
      stderr: payload.stderr,
      stdout: payload.stdout
    });
  }
  return payload;
};

export const createError = (code, message, details = null) => {
  const err = new Error(message || 'Error');
  err.code = normalizeErrorCode(code, ERROR_CODES.INTERNAL);
  if (details && typeof details === 'object') {
    Object.assign(err, details);
  }
  return err;
};
