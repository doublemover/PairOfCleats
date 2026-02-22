import { buildLineIndex, offsetToLine } from '../../shared/lines.js';

const DEFAULT_CHUNK_GUARDRAIL_MAX_BYTES = 200 * 1024;
const CHUNK_ROLE_SRC = 'src';
const CHUNK_ROLE_TEST = 'test';
const CHUNK_ROLE_DOCS = 'docs';
const CHUNK_ROLE_CONFIG = 'config';
const HIGH_SURROGATE_MIN = 0xd800;
const HIGH_SURROGATE_MAX = 0xdbff;
const LOW_SURROGATE_MIN = 0xdc00;
const LOW_SURROGATE_MAX = 0xdfff;
const TEST_PATH_PATTERN = /(?:^|\/)(?:test|tests|spec|specs|__tests__|__mocks__)(?:\/|$)/i;
const DOCS_PATH_PATTERN = /(?:^|\/)(?:doc|docs|documentation|guides|manual|wiki)(?:\/|$)/i;
const CONFIG_PATH_PATTERN = /(?:^|\/)(?:config|configs|cfg|settings|etc)(?:\/|$)/i;
const TEST_FILE_PATTERN = /(?:^|[./_-])(?:test|tests|spec)\.[^.]+$/i;
const DOCS_EXTENSIONS = new Set(['.md', '.markdown', '.mdx', '.rst', '.adoc', '.txt']);
const CONFIG_EXTENSIONS = new Set([
  '.json',
  '.jsonc',
  '.yaml',
  '.yml',
  '.toml',
  '.ini',
  '.cfg',
  '.conf',
  '.properties',
  '.env',
  '.xml'
]);
const DEFAULT_LANGUAGE_ROLE_LIMITS = Object.freeze({
  [CHUNK_ROLE_TEST]: Object.freeze({ maxLines: 220, maxBytes: 96 * 1024 }),
  [CHUNK_ROLE_DOCS]: Object.freeze({ maxLines: 320, maxBytes: 160 * 1024 }),
  [CHUNK_ROLE_CONFIG]: Object.freeze({ maxLines: 180, maxBytes: 72 * 1024 }),
  javascript: Object.freeze({
    [CHUNK_ROLE_SRC]: Object.freeze({ maxLines: 260, maxBytes: 128 * 1024 }),
    [CHUNK_ROLE_TEST]: Object.freeze({ maxLines: 180, maxBytes: 88 * 1024 })
  }),
  typescript: Object.freeze({
    [CHUNK_ROLE_SRC]: Object.freeze({ maxLines: 260, maxBytes: 128 * 1024 }),
    [CHUNK_ROLE_TEST]: Object.freeze({ maxLines: 170, maxBytes: 84 * 1024 })
  }),
  python: Object.freeze({
    [CHUNK_ROLE_SRC]: Object.freeze({ maxLines: 300, maxBytes: 136 * 1024 }),
    [CHUNK_ROLE_TEST]: Object.freeze({ maxLines: 210, maxBytes: 96 * 1024 })
  }),
  markdown: Object.freeze({
    [CHUNK_ROLE_DOCS]: Object.freeze({ maxLines: 340, maxBytes: 180 * 1024 })
  })
});

const normalizeChunkLimit = (value) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  const limit = Math.max(0, Math.floor(num));
  return limit > 0 ? limit : null;
};

const normalizeChunkingRole = (value) => {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!normalized) return CHUNK_ROLE_SRC;
  if (
    normalized === CHUNK_ROLE_TEST
    || normalized === CHUNK_ROLE_DOCS
    || normalized === CHUNK_ROLE_CONFIG
    || normalized === CHUNK_ROLE_SRC
  ) {
    return normalized;
  }
  return CHUNK_ROLE_SRC;
};

const normalizePathForRole = (value) => (
  String(value || '').replace(/\\/g, '/').trim().toLowerCase()
);

const normalizeExt = (value) => {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return '';
  return normalized.startsWith('.') ? normalized : `.${normalized}`;
};

export const resolveChunkingFileRole = ({
  relPath = null,
  ext = null,
  mode = null,
  explicitRole = null
} = {}) => {
  const provided = normalizeChunkingRole(explicitRole);
  if (provided !== CHUNK_ROLE_SRC || explicitRole) return provided;
  if (mode === 'prose' || mode === 'extracted-prose') return CHUNK_ROLE_DOCS;
  const normalizedPath = normalizePathForRole(relPath);
  const normalizedExt = normalizeExt(ext || (normalizedPath.includes('.')
    ? normalizedPath.slice(normalizedPath.lastIndexOf('.'))
    : ''));
  if (TEST_PATH_PATTERN.test(normalizedPath) || TEST_FILE_PATTERN.test(normalizedPath)) {
    return CHUNK_ROLE_TEST;
  }
  if (DOCS_PATH_PATTERN.test(normalizedPath) || DOCS_EXTENSIONS.has(normalizedExt)) {
    return CHUNK_ROLE_DOCS;
  }
  if (CONFIG_PATH_PATTERN.test(normalizedPath) || CONFIG_EXTENSIONS.has(normalizedExt)) {
    return CHUNK_ROLE_CONFIG;
  }
  return CHUNK_ROLE_SRC;
};

const resolveChunkingLanguageKey = (context = {}) => {
  const fromContext = typeof context?.languageId === 'string'
    ? context.languageId
    : (typeof context?.lang === 'string' ? context.lang : null);
  const normalizedContext = fromContext ? fromContext.trim().toLowerCase() : '';
  if (normalizedContext) return normalizedContext;
  const ext = normalizeExt(context?.ext);
  if (ext === '.ts' || ext === '.tsx') return 'typescript';
  if (ext === '.js' || ext === '.jsx' || ext === '.mjs' || ext === '.cjs') return 'javascript';
  if (ext === '.py') return 'python';
  if (ext === '.md' || ext === '.mdx' || ext === '.markdown') return 'markdown';
  return '';
};

const normalizeRoleOverride = (value) => {
  if (!value || typeof value !== 'object') return null;
  const maxBytes = normalizeChunkLimit(value.maxBytes);
  const maxLines = normalizeChunkLimit(value.maxLines);
  if (maxBytes == null && maxLines == null) return null;
  return { maxBytes, maxLines };
};

const resolveOverrideFromLanguageRoleMap = ({
  map = null,
  languageKey = '',
  role = CHUNK_ROLE_SRC
} = {}) => {
  if (!map || typeof map !== 'object') return null;
  const fromLanguage = languageKey && map[languageKey] && typeof map[languageKey] === 'object'
    ? normalizeRoleOverride(map[languageKey][role] || map[languageKey].default || null)
    : null;
  if (fromLanguage) return fromLanguage;
  const fromRole = normalizeRoleOverride(map[role] || map.default || null);
  return fromRole;
};

const mergeChunkLimit = (baseValue, overrideValue) => {
  if (baseValue == null) return overrideValue ?? null;
  if (overrideValue == null) return baseValue;
  return Math.min(baseValue, overrideValue);
};

/**
 * Resolve optional shared chunking cache for this text payload.
 * Shared caches are reused only when bound to the exact same source text.
 *
 * @param {object|null|undefined} context
 * @param {string} text
 * @returns {object|null}
 */
const resolveChunkingShared = (context, text) => {
  const shared = context?.chunkingShared;
  if (!shared || typeof shared !== 'object') return null;
  if (typeof shared.text === 'string' && shared.text !== text) return null;
  return shared;
};

/**
 * Resolve optional chunk size caps from indexing context.
 * @param {object} context
 * @returns {{maxBytes:number|null,maxLines:number|null}}
 */
export const resolveChunkingLimits = (context) => {
  const raw = context?.chunking && typeof context.chunking === 'object'
    ? context.chunking
    : {};
  const relPath = context?.relPath || context?.file || context?.filePath || null;
  const role = resolveChunkingFileRole({
    relPath,
    ext: context?.ext || null,
    mode: context?.mode || null,
    explicitRole: context?.fileRole
  });
  const languageKey = resolveChunkingLanguageKey({
    ...context,
    ext: context?.ext || context?.fileExt || null
  });
  const roleDefaultsEnabled = raw.useLanguageRoleDefaults !== false;
  const defaultsOverride = roleDefaultsEnabled
    ? resolveOverrideFromLanguageRoleMap({
      map: DEFAULT_LANGUAGE_ROLE_LIMITS,
      languageKey,
      role
    })
    : null;
  const configuredOverride = resolveOverrideFromLanguageRoleMap({
    map: raw.languageRoleLimits,
    languageKey,
    role
  });
  const effectiveOverride = configuredOverride || defaultsOverride;
  const rawMaxBytes = normalizeChunkLimit(raw.maxBytes);
  const rawMaxLines = normalizeChunkLimit(raw.maxLines);
  return {
    maxBytes: mergeChunkLimit(rawMaxBytes, effectiveOverride?.maxBytes ?? null),
    maxLines: mergeChunkLimit(rawMaxLines, effectiveOverride?.maxLines ?? null)
  };
};

const buildChunkWithRange = (chunk, start, end, lineIndex) => {
  const next = { ...chunk, start, end };
  if (lineIndex) {
    const meta = chunk.meta && typeof chunk.meta === 'object' ? { ...chunk.meta } : {};
    const startLine = offsetToLine(lineIndex, start);
    const endOffset = end > start ? end - 1 : start;
    const endLine = offsetToLine(lineIndex, endOffset);
    meta.startLine = startLine;
    meta.endLine = endLine;
    next.meta = meta;
  }
  return next;
};

const isHighSurrogate = (code) => code >= HIGH_SURROGATE_MIN && code <= HIGH_SURROGATE_MAX;
const isLowSurrogate = (code) => code >= LOW_SURROGATE_MIN && code <= LOW_SURROGATE_MAX;

const buildUtf8ByteMetrics = (text) => {
  const length = text.length;
  const prefix = new Uint32Array(length + 1);
  for (let i = 0; i < length; i += 1) {
    const code = text.charCodeAt(i);
    const base = prefix[i];
    if (isHighSurrogate(code) && i + 1 < length) {
      const next = text.charCodeAt(i + 1);
      if (isLowSurrogate(next)) {
        prefix[i + 1] = base + 3;
        prefix[i + 2] = base + 4;
        i += 1;
        continue;
      }
    }
    if (code <= 0x7f) {
      prefix[i + 1] = base + 1;
    } else if (code <= 0x7ff) {
      prefix[i + 1] = base + 2;
    } else {
      prefix[i + 1] = base + 3;
    }
  }
  return { text, prefix };
};

const byteLengthByRange = (text, start, end, metrics = null) => {
  if (end <= start) return 0;
  if (!metrics || metrics.text !== text || !metrics.prefix) {
    return Buffer.byteLength(text.slice(start, end), 'utf8');
  }
  let bytes = metrics.prefix[end] - metrics.prefix[start];
  if (start > 0) {
    const prev = text.charCodeAt(start - 1);
    const current = text.charCodeAt(start);
    if (isHighSurrogate(prev) && isLowSurrogate(current)) {
      bytes += 2;
    }
  }
  return bytes;
};

/**
 * Split a chunk into line-bounded windows.
 * @param {object} chunk
 * @param {string} text
 * @param {number[]} lineIndex
 * @param {number} maxLines
 * @returns {object[]}
 */
export const splitChunkByLines = (chunk, text, lineIndex, maxLines) => {
  if (!lineIndex || !maxLines) return [chunk];
  const start = Number.isFinite(chunk.start) ? chunk.start : 0;
  const end = Number.isFinite(chunk.end) ? chunk.end : start;
  if (end <= start) return [chunk];
  const startLineIdx = offsetToLine(lineIndex, start) - 1;
  const endOffset = end > start ? end - 1 : start;
  const endLineIdx = offsetToLine(lineIndex, endOffset) - 1;
  const totalLines = endLineIdx - startLineIdx + 1;
  if (totalLines <= maxLines) return [chunk];
  const output = [];
  let currentStart = start;
  let lineCount = 0;
  for (let lineIdx = startLineIdx; lineIdx <= endLineIdx; lineIdx += 1) {
    if (lineCount >= maxLines) {
      const splitAt = lineIndex[lineIdx] ?? end;
      if (splitAt > currentStart) {
        output.push(buildChunkWithRange(chunk, currentStart, splitAt, lineIndex));
      }
      currentStart = splitAt;
      lineCount = 0;
    }
    lineCount += 1;
  }
  if (currentStart < end) {
    output.push(buildChunkWithRange(chunk, currentStart, end, lineIndex));
  }
  return output.length ? output : [chunk];
};

const resolveByteBoundary = (text, start, end, maxBytes, byteMetrics = null) => {
  let lo = start;
  let hi = end;
  let best = start;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    const bytes = byteLengthByRange(text, start, mid, byteMetrics);
    if (bytes <= maxBytes) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return best;
};

/**
 * Split a chunk into byte-bounded windows while preserving line metadata.
 * @param {object} chunk
 * @param {string} text
 * @param {(() => number[])|number[]} resolveLineIndex
 * @param {number} maxBytes
 * @param {{text:string,prefix:Uint32Array}|null} [byteMetrics]
 * @returns {object[]}
 */
export const splitChunkByBytes = (chunk, text, resolveLineIndex, maxBytes, byteMetrics = null) => {
  if (!maxBytes) return [chunk];
  const start = Number.isFinite(chunk.start) ? chunk.start : 0;
  const end = Number.isFinite(chunk.end) ? chunk.end : start;
  if (end <= start) return [chunk];
  const bytes = byteLengthByRange(text, start, end, byteMetrics);
  if (bytes <= maxBytes) return [chunk];
  const output = [];
  let cursor = start;
  let hi = start;
  let lineIndex = null;
  const ensureLineIndex = () => {
    if (lineIndex) return lineIndex;
    if (typeof resolveLineIndex === 'function') {
      lineIndex = resolveLineIndex();
    } else if (resolveLineIndex && Array.isArray(resolveLineIndex)) {
      lineIndex = resolveLineIndex;
    }
    return lineIndex;
  };
  const canUseLinearWindowScan = Boolean(
    byteMetrics
    && byteMetrics.text === text
    && byteMetrics.prefix
  );
  if (canUseLinearWindowScan) {
    while (cursor < end) {
      if (hi < cursor + 1) hi = cursor + 1;
      while (hi <= end && byteLengthByRange(text, cursor, hi, byteMetrics) <= maxBytes) {
        hi += 1;
      }
      let safeNext = hi - 1;
      if (safeNext <= cursor) {
        safeNext = Math.min(cursor + 1, end);
      }
      output.push(buildChunkWithRange(chunk, cursor, safeNext, ensureLineIndex()));
      if (safeNext <= cursor) break;
      cursor = safeNext;
    }
    return output.length ? output : [chunk];
  }
  while (cursor < end) {
    const next = resolveByteBoundary(text, cursor, end, maxBytes, byteMetrics);
    const safeNext = next > cursor ? next : Math.min(cursor + 1, end);
    output.push(buildChunkWithRange(chunk, cursor, safeNext, ensureLineIndex()));
    if (safeNext <= cursor) break;
    cursor = safeNext;
  }
  return output.length ? output : [chunk];
};

/**
 * Apply configured line/byte chunk caps with a byte-guardrail fallback.
 * @param {Array<object>} chunks
 * @param {string} text
 * @param {object} context
 * @returns {Array<object>}
 */
export const applyChunkingLimits = (chunks, text, context) => {
  if (!Array.isArray(chunks) || !chunks.length) return chunks;
  const { maxBytes, maxLines } = resolveChunkingLimits(context);
  const shared = resolveChunkingShared(context, text);
  let byteMetrics = shared?.byteMetrics
    && shared.byteMetrics.text === text
    && shared.byteMetrics.prefix
    ? shared.byteMetrics
    : null;
  if (!byteMetrics && (maxBytes || !maxLines)) {
    byteMetrics = buildUtf8ByteMetrics(text);
    if (shared) shared.byteMetrics = byteMetrics;
  }
  const resolveChunkBytes = (chunk) => {
    const start = Number.isFinite(chunk.start) ? chunk.start : 0;
    const end = Number.isFinite(chunk.end) ? chunk.end : start;
    if (end <= start) return 0;
    return byteLengthByRange(text, start, end, byteMetrics);
  };
  const guardrailMaxBytes = (!maxBytes && !maxLines)
    ? chunks.some((chunk) => resolveChunkBytes(chunk) > DEFAULT_CHUNK_GUARDRAIL_MAX_BYTES)
      ? DEFAULT_CHUNK_GUARDRAIL_MAX_BYTES
      : null
    : null;
  if (!maxBytes && !maxLines && !guardrailMaxBytes) return chunks;
  let lineIndex = Array.isArray(shared?.lineIndex) ? shared.lineIndex : null;
  const getLineIndex = () => {
    if (!lineIndex) {
      lineIndex = buildLineIndex(text);
      if (shared) shared.lineIndex = lineIndex;
    }
    return lineIndex;
  };
  let output = chunks;
  if (maxLines) {
    const resolvedLineIndex = getLineIndex();
    const nextOutput = [];
    for (const chunk of output) {
      const split = splitChunkByLines(chunk, text, resolvedLineIndex, maxLines);
      for (const item of split) nextOutput.push(item);
    }
    output = nextOutput;
  }
  const effectiveMaxBytes = maxBytes || guardrailMaxBytes;
  if (effectiveMaxBytes) {
    const nextOutput = [];
    for (const chunk of output) {
      const split = splitChunkByBytes(chunk, text, getLineIndex, effectiveMaxBytes, byteMetrics);
      for (const item of split) nextOutput.push(item);
    }
    output = nextOutput;
  }
  return output;
};
