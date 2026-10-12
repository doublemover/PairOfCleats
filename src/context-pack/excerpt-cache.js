import fs from 'node:fs';
import path from 'node:path';
import { sha1 } from '../shared/hash.js';
import { buildLocalCacheKey } from '../shared/cache-key.js';
import { normalizeOptionalNumber } from '../shared/limits.js';
import { compareStrings } from '../shared/sort.js';
import { isRelativePathEscape } from '../shared/file-paths.js';
import { readVerifiedContainedFileSync } from '../shared/contained-file.js';

const trimUtf8Buffer = (buffer) => {
  let end = buffer.length;
  while (end > 0 && (buffer[end - 1] & 0xC0) === 0x80) {
    end -= 1;
  }
  if (end === 0) return buffer.subarray(0, 0);
  const lead = buffer[end - 1];
  let needed = 1;
  if ((lead & 0x80) === 0) needed = 1;
  else if ((lead & 0xE0) === 0xC0) needed = 2;
  else if ((lead & 0xF0) === 0xE0) needed = 3;
  else if ((lead & 0xF8) === 0xF0) needed = 4;
  if (end - 1 + needed <= buffer.length) {
    return buffer;
  }
  return buffer.subarray(0, Math.max(0, end - 1));
};

const EXCERPT_CACHE_MAX = 128;
const FILE_RANGE_CACHE_MAX = 64;
const EXCERPT_HASH_CACHE_MAX = 256;
const UTF8_TRUNCATION_DETECTION_SLACK_BYTES = 4;
const CACHE_BYTE_CAP = 8 * 1024 * 1024;
const excerptCache = new Map();
const fileRangeCache = new Map();
const excerptHashCache = new Map();
const cacheAccounting = new WeakMap();
const retainedStringBytes = text => Math.max(Buffer.byteLength(text), text.length * 2);

export const clearContextPackCaches = () => {
  excerptCache.clear();
  fileRangeCache.clear();
  excerptHashCache.clear();
  for (const cache of [excerptCache, fileRangeCache, excerptHashCache]) cacheAccounting.delete(cache);
};

const getCachedValue = (cache, key) => {
  if (!key) return null;
  if (!cache.has(key)) return null;
  const value = cache.get(key);
  cache.delete(key);
  cache.set(key, value);
  return value;
};

const setCachedValue = (cache, key, value, maxSize) => {
  if (!key) return;
  const accounting = cacheAccounting.get(cache) || { bytes: 0, weights: new Map() };
  cacheAccounting.set(cache, accounting);
  const remove = key => {
    accounting.bytes -= accounting.weights.get(key) || 0;
    accounting.weights.delete(key);
    cache.delete(key);
  };
  if (cache.has(key)) remove(key);
  const payloadBytes = typeof value === 'string' ? retainedStringBytes(value)
    : retainedStringBytes(value.excerpt || '') + retainedStringBytes(JSON.stringify(value.sourceIdentity || {})) + 256;
  const weight = retainedStringBytes(String(key)) + payloadBytes + 128;
  if (weight > CACHE_BYTE_CAP) return;
  cache.set(key, value);
  accounting.weights.set(key, weight);
  accounting.bytes += weight;
  while (cache.size > maxSize || accounting.bytes > CACHE_BYTE_CAP) {
    const oldest = cache.keys().next().value;
    remove(oldest);
  }
};

const readSourceSnapshot = (filePath, repoRoot, hashAlgorithm = 'sha1') => (
  readVerifiedContainedFileSync(repoRoot, filePath, { maxBytes: 64 * 1024 * 1024, hashAlgorithm })
);
const rangeKey = (filePath, cacheScope, start, end) => `${filePath}|${cacheScope}|${start}|${end}`;
const readSnapshotRange = (snapshot, filePath, start, end, cacheScope) => {
  const key = rangeKey(filePath, cacheScope, start, end);
  const cached = getCachedValue(fileRangeCache, key);
  if (cached !== null) return cached;
  const text = trimUtf8Buffer(snapshot.buffer.subarray(Math.max(0, Math.floor(start)),
    Math.max(0, Math.floor(end)))).toString('utf8');
  setCachedValue(fileRangeCache, key, text, FILE_RANGE_CACHE_MAX);
  return text;
};

/** Prefetch and direct reads use identical live content identities, never generation alone. */
export const prefetchFileRanges = (ranges, indexSignature, repoRoot = null) => {
  if (!repoRoot || !Array.isArray(ranges)) return;
  const byFile = new Map();
  for (const range of ranges) {
    if (!range?.filePath || !Number.isFinite(range.start) || !Number.isFinite(range.end)) continue;
    const group = byFile.get(range.filePath) || [];
    group.push(range);
    byFile.set(range.filePath, group);
  }
  for (const [filePath, group] of byFile) {
    try {
      const snapshot = readSourceSnapshot(filePath, repoRoot);
      const cacheScope = `${indexSignature || 'working'}:${snapshot.hash}`;
      for (const range of group) readSnapshotRange(snapshot, filePath, range.start, range.end, cacheScope);
    } catch {
      // Direct reads still enforce containment, bounds and current source identity.
    }
  }
};

export const isPathInsideRepo = (repoRoot, filePath) => {
  const relative = path.relative(repoRoot, filePath);
  if (!relative) return true;
  if (isRelativePathEscape(relative)) return false;
  return !path.isAbsolute(relative);
};

const sliceExcerpt = (text, maxBytes, maxTokens) => {
  let excerpt = text;
  let truncated = false;
  let truncatedBytes = false;
  let truncatedTokens = false;
  if (maxBytes != null && maxBytes > 0) {
    const buffer = Buffer.from(excerpt, 'utf8');
    if (buffer.length > maxBytes) {
      const safe = trimUtf8Buffer(buffer.subarray(0, maxBytes));
      excerpt = safe.toString('utf8');
      truncated = true;
      truncatedBytes = true;
    }
  }
  if (maxTokens != null && maxTokens > 0) {
    const tokens = excerpt.split(/\s+/).filter(Boolean);
    if (tokens.length > maxTokens) {
      excerpt = tokens.slice(0, maxTokens).join(' ');
      truncated = true;
      truncatedTokens = true;
    }
  }
  return { excerpt, truncated, truncatedBytes, truncatedTokens };
};

export const resolveExcerpt = ({
  filePath,
  repoRoot,
  start,
  end,
  maxBytes,
  maxTokens,
  indexSignature = null,
  indexedHash = null,
  hashAlgorithm = 'sha1'
}) => {
  const snapshot = readSourceSnapshot(filePath, repoRoot, hashAlgorithm);
  const cacheScope = `${indexSignature || 'working'}:${snapshot.hash}`;
  const expectedHash = typeof indexedHash === 'string'
    ? indexedHash.replace(new RegExp(`^${hashAlgorithm}:`), '').toLowerCase() : null;
  const sourceIdentity = {
    policy: 'working-tree-preview',
    currentHash: `${hashAlgorithm}:${snapshot.hash}`,
    indexedHash: expectedHash ? `${hashAlgorithm}:${expectedHash}` : null,
    drift: expectedHash ? (expectedHash === snapshot.hash ? 'unchanged' : 'changed') : 'unknown'
  };
  const cacheKeyInfo = buildLocalCacheKey({
    namespace: 'context-pack-excerpt',
    payload: {
      filePath,
      cacheScope,
      indexedHash: expectedHash,
      start: start ?? null,
      end: end ?? null,
      maxBytes: maxBytes ?? null,
      maxTokens: maxTokens ?? null
    }
  });
  const cached = getCachedValue(excerptCache, cacheKeyInfo.key);
  if (cached) return cached;
  let text = '';
  if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
    const safeMaxBytes = normalizeOptionalNumber(maxBytes);
    const readEnd = safeMaxBytes
      ? Math.min(end, start + safeMaxBytes + UTF8_TRUNCATION_DETECTION_SLACK_BYTES)
      : end;
    text = readSnapshotRange(snapshot, filePath, start, readEnd, cacheScope);
  } else {
    const limit = normalizeOptionalNumber(maxBytes) || snapshot.buffer.length;
    text = trimUtf8Buffer(snapshot.buffer.subarray(0, limit + UTF8_TRUNCATION_DETECTION_SLACK_BYTES)).toString('utf8');
  }
  const { excerpt, truncated, truncatedBytes, truncatedTokens } = sliceExcerpt(text, maxBytes, maxTokens);
  const excerptHash = excerpt ? `sha1:${sha1(excerpt)}` : null;
  let deduped = excerpt;
  if (excerptHash) {
    const cached = getCachedValue(excerptHashCache, excerptHash);
    if (cached) {
      deduped = cached;
    } else {
      setCachedValue(excerptHashCache, excerptHash, excerpt, EXCERPT_HASH_CACHE_MAX);
    }
  }
  const payload = { excerpt: deduped, truncated, excerptHash, truncatedBytes, truncatedTokens, sourceIdentity };
  setCachedValue(excerptCache, cacheKeyInfo.key, payload, EXCERPT_CACHE_MAX);
  return payload;
};

export const buildPrimaryExcerpt = ({ chunk, repoRoot, maxBytes, maxTokens, indexSignature, warnings }) => {
  const evidenceWarningCodes = [];
  const pushWarning = (code, message) => {
    warnings.push({ code, message });
    evidenceWarningCodes.push(code);
  };
  if (!chunk) {
    pushWarning('MISSING_PRIMARY', 'Primary chunk not found for seed.');
    return {
      excerpt: '',
      excerptHash: null,
      file: null,
      range: null,
      truncated: false,
      evidence: {
        state: 'missing',
        source: 'missing',
        fileBacked: false,
        substituted: false,
        missing: true,
        truncated: false,
        truncatedBytes: false,
        truncatedTokens: false,
        warningCodes: evidenceWarningCodes
      }
    };
  }
  const filePath = chunk.file ? path.resolve(repoRoot, chunk.file) : null;
  let text = '';
  let excerpt = '';
  let excerptHash = null;
  let truncated = false;
  let truncatedBytes = false;
  let truncatedTokens = false;
  let fileBacked = false;
  let sourceIdentity = null;
  let fallbackSource = null;
  if (filePath) {
    if (!isPathInsideRepo(repoRoot, filePath)) {
      pushWarning('PRIMARY_PATH_OUTSIDE_REPO', 'Primary chunk path resolves outside repo root.');
    } else if (fs.existsSync(filePath)) {
      const maxBytesNum = normalizeOptionalNumber(maxBytes);
      const maxTokensNum = normalizeOptionalNumber(maxTokens);
      let resolvedExcerpt;
      try {
        resolvedExcerpt = resolveExcerpt({
          filePath,
          repoRoot,
          start: Number.isFinite(chunk.start) ? chunk.start : null,
          end: Number.isFinite(chunk.end) ? chunk.end : null,
          maxBytes: maxBytesNum,
          maxTokens: maxTokensNum,
          indexSignature,
          indexedHash: chunk.fileHash || null,
          hashAlgorithm: chunk.fileHashAlgo === 'sha256' ? 'sha256' : 'sha1'
        });
      } catch {
        pushWarning('PRIMARY_PATH_UNAVAILABLE', 'Primary path failed current file identity or containment checks.');
        resolvedExcerpt = { excerpt: '', excerptHash: null, truncated: false, truncatedBytes: false, truncatedTokens: false };
      }
      sourceIdentity = resolvedExcerpt.sourceIdentity || null;
      if (sourceIdentity && sourceIdentity.drift !== 'unchanged') {
        pushWarning(sourceIdentity.drift === 'changed' ? 'PRIMARY_SOURCE_DRIFT' : 'PRIMARY_SOURCE_UNVERIFIED',
          'Working-tree preview is not verified against the indexed source; indexed line and byte coordinates may have drifted.');
      }
      excerpt = resolvedExcerpt.excerpt || '';
      truncated = resolvedExcerpt.truncated;
      truncatedBytes = resolvedExcerpt.truncatedBytes === true;
      truncatedTokens = resolvedExcerpt.truncatedTokens === true;
      excerptHash = resolvedExcerpt.excerptHash || null;
      fileBacked = excerpt.length > 0;
    } else {
      pushWarning('PRIMARY_PATH_MISSING', 'Primary chunk path not found on disk.');
    }
  } else if (chunk.headline) {
    text = String(chunk.headline);
    fallbackSource = 'headline';
  } else if (chunk.docmeta?.doc) {
    text = String(chunk.docmeta.doc);
    fallbackSource = 'docmeta';
  }

  if (!filePath || !excerpt) {
    const {
      excerpt: sliced,
      truncated: slicedTruncated,
      truncatedBytes: slicedTruncatedBytes,
      truncatedTokens: slicedTruncatedTokens
    } = sliceExcerpt(
      text,
      normalizeOptionalNumber(maxBytes),
      normalizeOptionalNumber(maxTokens)
    );
    excerpt = sliced;
    truncated = truncated || slicedTruncated;
    truncatedBytes = truncatedBytes || slicedTruncatedBytes;
    truncatedTokens = truncatedTokens || slicedTruncatedTokens;
    excerptHash = excerpt ? `sha1:${sha1(excerpt)}` : null;
  }
  if (truncated) {
    pushWarning('PRIMARY_EXCERPT_TRUNCATED', 'Primary excerpt truncated due to maxBytes/maxTokens.');
  }
  const range = (Number.isFinite(chunk.startLine) || Number.isFinite(chunk.endLine))
    ? {
      startLine: Number.isFinite(chunk.startLine) ? chunk.startLine : null,
      endLine: Number.isFinite(chunk.endLine) ? chunk.endLine : null
    }
    : null;
  const evidenceState = fileBacked
    ? 'file-backed'
    : excerpt
      ? 'fallback'
      : 'missing';
  return {
    excerpt,
    excerptHash,
    file: chunk.file || null,
    range,
    truncated,
    evidence: {
      state: evidenceState,
      source: fileBacked
        ? (sourceIdentity?.drift === 'unchanged' ? 'indexed-source-verified' : 'working-tree-preview')
        : fallbackSource
          ? `${fallbackSource}-fallback`
          : 'missing',
      fileBacked,
      sourceIdentity,
      substituted: Boolean(!fileBacked && excerpt),
      missing: !excerpt,
      truncated,
      truncatedBytes,
      truncatedTokens,
      warningCodes: evidenceWarningCodes
    }
  };
};

export const normalizeTypeFacts = (seedRef, chunk, maxTypeEntries, warnings) => {
  if (!chunk?.docmeta?.inferredTypes) {
    warnings.push({
      code: 'MISSING_TYPES',
      message: 'No inferred types found for seed.'
    });
    return [];
  }
  const facts = [];
  const pushFacts = (role, entries) => {
    if (!entries || typeof entries !== 'object') return;
    for (const [name, types] of Object.entries(entries)) {
      const list = Array.isArray(types) ? types : [];
      for (const entry of list) {
        if (!entry?.type) continue;
        facts.push({
          subject: seedRef,
          role: `${role}:${name}`,
          name,
          type: entry.type,
          source: entry.source || null,
          confidence: Number.isFinite(entry.confidence) ? entry.confidence : null
        });
      }
    }
  };
  pushFacts('param', chunk.docmeta.inferredTypes.params);
  pushFacts('field', chunk.docmeta.inferredTypes.fields);
  pushFacts('local', chunk.docmeta.inferredTypes.locals);
  const returns = Array.isArray(chunk.docmeta.inferredTypes.returns)
    ? chunk.docmeta.inferredTypes.returns
    : [];
  for (const entry of returns) {
    if (!entry?.type) continue;
    facts.push({
      subject: seedRef,
      role: 'return',
      name: null,
      type: entry.type,
      source: entry.source || null,
      confidence: Number.isFinite(entry.confidence) ? entry.confidence : null
    });
  }
  facts.sort((a, b) => compareStrings(a.role, b.role) || compareStrings(a.type, b.type));
  if (Number.isFinite(maxTypeEntries) && maxTypeEntries >= 0 && facts.length > maxTypeEntries) {
    warnings.push({
      code: 'TYPES_TRUNCATED',
      message: 'Type facts truncated due to maxTypeEntries.'
    });
    return facts.slice(0, maxTypeEntries);
  }
  return facts;
};

export const buildTypeFactsEvidence = ({
  includeTypes = false,
  facts = [],
  warnings = []
} = {}) => {
  const warningCodes = Array.from(new Set(
    (Array.isArray(warnings) ? warnings : [])
      .map((entry) => String(entry?.code || '').trim())
      .filter(Boolean)
  ));
  const truncated = warningCodes.includes('TYPES_TRUNCATED');
  const missing = warningCodes.includes('MISSING_TYPES') || !Array.isArray(facts) || facts.length === 0;
  return {
    included: includeTypes === true,
    state: includeTypes !== true
      ? 'omitted'
      : missing
        ? 'missing'
        : truncated
          ? 'partial'
          : 'complete',
    count: Array.isArray(facts) ? facts.length : 0,
    truncated,
    warningCodes
  };
};
