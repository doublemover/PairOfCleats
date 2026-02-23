const loggedSizeSkips = new Set();

/**
 * Count newline-delimited lines without allocating an intermediate array.
 *
 * Returning `1` for non-empty single-line input matches splitter-based line
 * counts while avoiding `text.split('\n')` allocations on large files.
 *
 * @param {string} text
 * @returns {number}
 */
export function countLines(text) {
  if (!text) return 0;
  let count = 1;
  for (let i = 0; i < text.length; i += 1) {
    if (text.charCodeAt(i) === 10) count += 1;
  }
  return count;
}

/**
 * Apply configured file-size guards before parser allocation.
 *
 * Guard checks run before parser creation to avoid expensive native parse work
 * on inputs that are already outside configured limits.
 *
 * @param {string} text
 * @param {object} options
 * @param {string} resolvedId
 * @returns {boolean}
 */
export function exceedsTreeSitterLimits(text, options, resolvedId) {
  const config = options?.treeSitter || {};
  const perLanguage = config.byLanguage?.[resolvedId] || {};
  const maxBytes = perLanguage.maxBytes ?? config.maxBytes;
  const maxLines = perLanguage.maxLines ?? config.maxLines;

  if (typeof maxBytes === 'number' && maxBytes > 0) {
    const bytes = Buffer.byteLength(text, 'utf8');
    if (bytes > maxBytes) {
      const key = `${resolvedId}:bytes`;
      if (!loggedSizeSkips.has(key) && options?.log) {
        options.log(`Tree-sitter disabled for ${resolvedId}; file exceeds maxBytes (${bytes} > ${maxBytes}).`);
        loggedSizeSkips.add(key);
      }
      return true;
    }
  }

  if (typeof maxLines === 'number' && maxLines > 0) {
    const lines = countLines(text);
    if (lines > maxLines) {
      const key = `${resolvedId}:lines`;
      if (!loggedSizeSkips.has(key) && options?.log) {
        options.log(`Tree-sitter disabled for ${resolvedId}; file exceeds maxLines (${lines} > ${maxLines}).`);
        loggedSizeSkips.add(key);
      }
      return true;
    }
  }

  return false;
}

/**
 * Resolve parser timeout policy in milliseconds.
 * @param {object} options
 * @param {string} resolvedId
 * @returns {number|null}
 */
export function resolveParseTimeoutMs(options, resolvedId) {
  const config = options?.treeSitter || {};
  const perLanguage = config.byLanguage?.[resolvedId] || {};
  const raw = perLanguage.maxParseMs ?? config.maxParseMs;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : null;
}

/**
 * Guard known native parser crash paths by language/platform.
 *
 * Some parser/native-runtime combinations can terminate the process before a JS
 * exception is thrown. This check keeps chunking deterministic by opting out of
 * those paths and allowing the caller to choose strict whole-file behavior.
 *
 * @param {string} resolvedId
 * @param {object} [options={}]
 * @returns {boolean}
 */
export const shouldGuardNativeParser = (resolvedId, options = {}) => {
  if (resolvedId !== 'perl') return false;
  const configured = options?.treeSitter?.nativeParserGuards?.perl;
  if (configured === false) return false;
  if (configured === true) return true;
  return process.platform === 'win32';
};
