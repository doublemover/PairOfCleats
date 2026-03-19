import fs from 'node:fs';
import path from 'node:path';
import { sha1 } from '../shared/hash.js';
import { buildLocalCacheKey } from '../shared/cache-key.js';
import { normalizeOptionalNumber } from '../shared/limits.js';
import { compareStrings } from '../shared/sort.js';
import { isRelativePathEscape, readFileRangeSync } from '../shared/files.js';

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
const excerptCache = new Map();
const fileRangeCache = new Map();
const excerptHashCache = new Map();

export const clearContextPackCaches = () => {
  excerptCache.clear();
  fileRangeCache.clear();
  excerptHashCache.clear();
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
  if (cache.has(key)) cache.delete(key);
  cache.set(key, value);
  while (cache.size > maxSize) {
    const oldest = cache.keys().next().value;
    cache.delete(oldest);
  }
};

const getFileCacheFingerprint = (filePath) => {
  try {
    const stats = fs.statSync(filePath);
    return `${stats.size}:${Number.isFinite(stats.mtimeMs) ? Math.trunc(stats.mtimeMs) : 0}`;
  } catch {
    return 'missing';
  }
};

const readFilePrefix = (filePath, maxBytes) => {
  if (!Number.isFinite(maxBytes) || maxBytes <= 0) return '';
  let fd = null;
  try {
    fd = fs.openSync(filePath, 'r');
    const buffer = Buffer.allocUnsafe(maxBytes + UTF8_TRUNCATION_DETECTION_SLACK_BYTES);
    const bytesRead = fs.readSync(fd, buffer, 0, buffer.length, 0);
    const slice = trimUtf8Buffer(buffer.subarray(0, bytesRead));
    return slice.toString('utf8');
  } finally {
    if (fd !== null) fs.closeSync(fd);
  }
};

const readFileRangeCached = (filePath, start, end, cacheScope) => {
  const key = `${filePath}|${cacheScope}|${start}|${end}`;
  const cached = getCachedValue(fileRangeCache, key);
  if (cached != null) return cached;
  const buffer = readFileRangeSync(filePath, start, end);
  const text = trimUtf8Buffer(buffer).toString('utf8');
  setCachedValue(fileRangeCache, key, text, FILE_RANGE_CACHE_MAX);
  return text;
};

const prefetchFileRanges = (ranges, cacheScope) => {
  if (!Array.isArray(ranges) || !ranges.length) return;
  for (const range of ranges) {
    if (!range?.filePath) continue;
    const key = `${range.filePath}|${cacheScope}|${range.start}|${range.end}`;
    if (fileRangeCache.has(key)) continue;
    try {
      const buffer = readFileRangeSync(range.filePath, range.start, range.end);
      const text = trimUtf8Buffer(buffer).toString('utf8');
      setCachedValue(fileRangeCache, key, text, FILE_RANGE_CACHE_MAX);
    } catch {
      // Best-effort prefetch.
    }
  }
};

const isPathInsideRepo = (repoRoot, filePath) => {
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

const resolveExcerpt = ({
  filePath,
  start,
  end,
  maxBytes,
  maxTokens,
  indexSignature = null
}) => {
  const cacheScope = indexSignature || getFileCacheFingerprint(filePath);
  const cacheKeyInfo = buildLocalCacheKey({
    namespace: 'context-pack-excerpt',
    payload: {
      filePath,
      cacheScope,
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
    prefetchFileRanges([{ filePath, start, end: readEnd }], cacheScope);
    text = readFileRangeCached(filePath, start, readEnd, cacheScope);
  } else {
    text = readFilePrefix(filePath, normalizeOptionalNumber(maxBytes));
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
  const payload = { excerpt: deduped, truncated, excerptHash, truncatedBytes, truncatedTokens };
  setCachedValue(excerptCache, cacheKeyInfo.key, payload, EXCERPT_CACHE_MAX);
  return payload;
};

export const buildPrimaryExcerpt = ({ chunk, repoRoot, maxBytes, maxTokens, indexSignature, warnings }) => {
  if (!chunk) {
    warnings.push({ code: 'MISSING_PRIMARY', message: 'Primary chunk not found for seed.' });
    return { excerpt: '', excerptHash: null, file: null, range: null, truncated: false };
  }
  const filePath = chunk.file ? path.resolve(repoRoot, chunk.file) : null;
  let text = '';
  let excerpt = '';
  let excerptHash = null;
  let truncated = false;
  if (filePath) {
    if (!isPathInsideRepo(repoRoot, filePath)) {
      warnings.push({
        code: 'PRIMARY_PATH_OUTSIDE_REPO',
        message: 'Primary chunk path resolves outside repo root.'
      });
    } else if (fs.existsSync(filePath)) {
      const maxBytesNum = normalizeOptionalNumber(maxBytes);
      const maxTokensNum = normalizeOptionalNumber(maxTokens);
      const resolvedExcerpt = resolveExcerpt({
        filePath,
        start: Number.isFinite(chunk.start) ? chunk.start : null,
        end: Number.isFinite(chunk.end) ? chunk.end : null,
        maxBytes: maxBytesNum,
        maxTokens: maxTokensNum,
        indexSignature
      });
      excerpt = resolvedExcerpt.excerpt || '';
      truncated = resolvedExcerpt.truncated;
      excerptHash = resolvedExcerpt.excerptHash || null;
    } else {
      warnings.push({
        code: 'PRIMARY_PATH_MISSING',
        message: 'Primary chunk path not found on disk.'
      });
    }
  } else if (chunk.headline) {
    text = String(chunk.headline);
  } else if (chunk.docmeta?.doc) {
    text = String(chunk.docmeta.doc);
  }

  if (!filePath || !excerpt) {
    const { excerpt: sliced, truncated: slicedTruncated } = sliceExcerpt(
      text,
      normalizeOptionalNumber(maxBytes),
      normalizeOptionalNumber(maxTokens)
    );
    excerpt = sliced;
    truncated = truncated || slicedTruncated;
    excerptHash = excerpt ? `sha1:${sha1(excerpt)}` : null;
  }
  if (truncated) {
    warnings.push({
      code: 'PRIMARY_EXCERPT_TRUNCATED',
      message: 'Primary excerpt truncated due to maxBytes/maxTokens.'
    });
  }
  const range = (Number.isFinite(chunk.startLine) || Number.isFinite(chunk.endLine))
    ? {
      startLine: Number.isFinite(chunk.startLine) ? chunk.startLine : null,
      endLine: Number.isFinite(chunk.endLine) ? chunk.endLine : null
    }
    : null;
  return {
    excerpt,
    excerptHash,
    file: chunk.file || null,
    range,
    truncated
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
