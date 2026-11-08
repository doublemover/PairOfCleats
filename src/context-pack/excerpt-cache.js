import fs from 'node:fs';
import path from 'node:path';
import { sha1 } from '../shared/hash.js';
import { buildLocalCacheKey } from '../shared/cache-key.js';
import { normalizeOptionalNumber } from '../shared/limits.js';
import { compareStrings } from '../shared/sort.js';
import { isRelativePathEscape } from '../shared/file-paths.js';
import { readVerifiedContainedFileSync } from '../shared/contained-file.js';
import { throwIfAborted } from '../shared/abort.js';
import { observeStorageResource } from '../shared/storage/failure-observation.js';

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

const SOURCE_SNAPSHOT_BYTE_CAP = 64 * 1024 * 1024;
const sourceContexts = new WeakMap();
const decodedSnapshots = new WeakMap();
const sourceText = snapshot => {
  let text = decodedSnapshots.get(snapshot);
  if (text === undefined) {
    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(snapshot.buffer);
    decodedSnapshots.set(snapshot, text);
  }
  return text;
};
const retainedSnapshotBytes = snapshot => snapshot.buffer.length * 3;

/** One assembly owns a bounded point-in-time source view; later requests reverify. */
export const createExcerptSourceContext = ({ maxBytes = SOURCE_SNAPSHOT_BYTE_CAP } = {}) => {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0 || maxBytes > SOURCE_SNAPSHOT_BYTE_CAP) {
    throw new TypeError('Invalid excerpt source snapshot allowance.');
  }
  const state = { entries: new Map(), bytes: 0, maxBytes, active: true };
  const context = Object.freeze({ clear() {
    state.entries.clear(); state.bytes = 0; state.active = false;
  } });
  sourceContexts.set(context, state);
  return context;
};

const readSourceSnapshot = (filePath, repoRoot, hashAlgorithm = 'sha1', sourceContext = null, { maxBytes = SOURCE_SNAPSHOT_BYTE_CAP, signal = null } = {}) => {
  throwIfAborted(signal);
  const state = sourceContexts.get(sourceContext);
  if (state && !state.active) throw new Error('Excerpt source context has ended.');
  const key = JSON.stringify([path.resolve(repoRoot), path.resolve(filePath), hashAlgorithm]);
  const cached = state?.entries.get(key);
  if (cached) {
    if (cached.buffer.length > maxBytes) throw Object.assign(new Error('Source exceeds the read byte allowance.'), { code: 'ERR_FILE_TOO_LARGE' });
    state.entries.delete(key); state.entries.set(key, cached);
    return cached;
  }
  const snapshot = readVerifiedContainedFileSync(repoRoot, filePath, {
    maxBytes, hashAlgorithm, signal
  });
  const retainedBytes = retainedSnapshotBytes(snapshot);
  if (state && retainedBytes <= state.maxBytes) {
    while (state.entries.size && (state.bytes + retainedBytes > state.maxBytes
      || state.entries.size >= FILE_RANGE_CACHE_MAX)) {
      const oldest = state.entries.keys().next().value;
      state.bytes -= retainedSnapshotBytes(state.entries.get(oldest));
      state.entries.delete(oldest);
    }
    state.entries.set(key, snapshot); state.bytes += retainedBytes;
  }
  return snapshot;
};
const rangeKey = (filePath, cacheScope, start, end) => `utf16-v2|${filePath}|${cacheScope}|${start}|${end}`;
const readSnapshotRange = (snapshot, filePath, start, end, cacheScope, { cache = true } = {}) => {
  const key = rangeKey(filePath, cacheScope, start, end);
  const cached = cache ? getCachedValue(fileRangeCache, key) : null;
  if (cached !== null) return cached;
  const source = sourceText(snapshot);
  const splitSurrogate = index => index > 0 && index < source.length
    && source.charCodeAt(index) >= 0xDC00 && source.charCodeAt(index) <= 0xDFFF
    && source.charCodeAt(index - 1) >= 0xD800 && source.charCodeAt(index - 1) <= 0xDBFF;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start
    || end > source.length || splitSurrogate(start) || splitSurrogate(end)) {
    throw Object.assign(new Error('Indexed source range is not a valid UTF-16 span in the verified UTF-8 snapshot.'),
      { code: 'ERR_CONTEXT_PACK_SOURCE_RANGE' });
  }
  const text = source.slice(start, end);
  if (cache) setCachedValue(fileRangeCache, key, text, FILE_RANGE_CACHE_MAX);
  return text;
};

/** Prefetch and direct reads use identical live content identities, never generation alone. */
export const prefetchFileRanges = (ranges, indexSignature, repoRoot = null, sourceContext = null) => {
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
      const snapshot = readSourceSnapshot(filePath, repoRoot, 'sha1', sourceContext);
      const cacheScope = `${indexSignature || 'working'}:${snapshot.hash}`;
      for (const range of group) readSnapshotRange(snapshot, filePath, range.start, range.end, cacheScope);
    } catch (error) {
      observeStorageResource(error, { phase: 'context-source-prefetch' }).requireSettled();
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
  hashAlgorithm = 'sha1',
  sourceContext = null,
  taskPolicy = undefined,
  signal = null,
  sourceMaxBytes = null,
  selectRange = null
}) => {
  const intact = taskPolicy?.task === 'edit-safe';
  const snapshot = readSourceSnapshot(filePath, repoRoot, hashAlgorithm, sourceContext,
    { ...(intact ? { maxBytes: sourceMaxBytes ?? maxBytes } : {}), signal });
  const cacheScope = `${indexSignature || 'working'}:${snapshot.hash}`;
  const expectedHash = typeof indexedHash === 'string'
    ? indexedHash.replace(new RegExp(`^${hashAlgorithm}:`), '').toLowerCase() : null;
  const sourceIdentity = {
    policy: 'working-tree-preview',
    currentHash: `${hashAlgorithm}:${snapshot.hash}`,
    indexedHash: expectedHash ? `${hashAlgorithm}:${expectedHash}` : null,
    drift: expectedHash ? (expectedHash === snapshot.hash ? 'unchanged' : 'changed') : 'unknown'
  };
  if (intact && sourceIdentity.drift !== 'unchanged') throw Object.assign(new Error('Edit source differs from its pinned indexed source hash.'), { code: 'ERR_CONTEXT_PACK_SOURCE_MISMATCH', status: 409 });
  throwIfAborted(signal);
  let selectedRange = null;
  if (selectRange !== null) {
    if (!intact || typeof selectRange !== 'function') throw new TypeError('Range qualification requires its internal intact-source owner.');
    selectedRange = selectRange(sourceText(snapshot));
    [start, end] = selectedRange.span;
  }
  const cacheKeyInfo = buildLocalCacheKey({
    namespace: 'context-pack-excerpt',
    payload: {
      filePath,
      cacheScope,
      indexedHash: expectedHash,
      start: start ?? null,
      end: end ?? null,
      maxBytes: maxBytes ?? null,
      maxTokens: maxTokens ?? null,
      taskPolicy: taskPolicy || null
    }
  });
  const cached = intact ? null : getCachedValue(excerptCache, cacheKeyInfo.key);
  if (cached) return cached;
  let text = '';
  if (start != null || end != null) {
    text = readSnapshotRange(snapshot, filePath, start, end, cacheScope, { cache: !intact });
  } else {
    text = sourceText(snapshot);
  }
  if (intact && (Buffer.byteLength(text) > maxBytes || maxTokens != null && text.split(/\s+/).filter(Boolean).length > maxTokens)) {
    throw Object.assign(new Error('The mandatory complete edit unit cannot fit the selected byte/token allowance.'), { code: 'ERR_CONTEXT_PACK_UNIT_CANNOT_FIT', status: 413 });
  }
  const { excerpt, truncated, truncatedBytes, truncatedTokens } = intact
    ? { excerpt: text, truncated: false, truncatedBytes: false, truncatedTokens: false } : sliceExcerpt(text, maxBytes, maxTokens);
  const excerptHash = excerpt ? `sha1:${sha1(excerpt)}` : null;
  let deduped = excerpt;
  if (excerptHash && !intact) {
    const cached = getCachedValue(excerptHashCache, excerptHash);
    if (cached) {
      deduped = cached;
    } else {
      setCachedValue(excerptHashCache, excerptHash, excerpt, EXCERPT_HASH_CACHE_MAX);
    }
  }
  throwIfAborted(signal);
  const payload = { excerpt: deduped, truncated, excerptHash, truncatedBytes, truncatedTokens, sourceIdentity, sourceLength: text.length,
    ...(selectedRange ? { selectedRange, sourceFileLength: sourceText(snapshot).length } : {}) };
  // Edit units are reverified for each assembly and never publish a partial
  // request's derived cache state if later assembly or cancellation fails.
  if (!intact) setCachedValue(excerptCache, cacheKeyInfo.key, payload, EXCERPT_CACHE_MAX);
  return payload;
};

export const buildPrimaryExcerpt = ({ chunk, repoRoot, maxBytes, maxTokens, indexSignature, warnings, taskPolicy, signal }) => {
  throwIfAborted(signal);
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
          hashAlgorithm: chunk.fileHashAlgo === 'sha256' ? 'sha256' : 'sha1',
          taskPolicy, signal
        });
      } catch (error) {
        observeStorageResource(error, { phase: 'context-primary-source' }).requireSettled();
        throwIfAborted(signal);
        pushWarning('PRIMARY_PATH_UNAVAILABLE', 'Primary path failed current file identity or containment checks.');
        resolvedExcerpt = { excerpt: '', excerptHash: null, truncated: false, truncatedBytes: false, truncatedTokens: false };
      }
      sourceIdentity = resolvedExcerpt.sourceIdentity || null;
      if (sourceIdentity && sourceIdentity.drift !== 'unchanged') {
        pushWarning(sourceIdentity.drift === 'changed' ? 'PRIMARY_SOURCE_DRIFT' : 'PRIMARY_SOURCE_UNVERIFIED',
          'Working-tree preview is not verified against the indexed source; indexed line and UTF-16 coordinates may have drifted.');
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
  // Exact duplicates consume the cap without adding evidence. Preserve distinct
  // sources/confidences, including disagreements from different providers.
  const seen = new Set();
  const uniqueFacts = facts.filter((fact) => {
    const key = JSON.stringify([fact.role, fact.name, fact.type, fact.source, fact.confidence]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  facts.splice(0, facts.length, ...uniqueFacts);
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
