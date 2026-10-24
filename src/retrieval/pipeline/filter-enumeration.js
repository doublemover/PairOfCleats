import { resolveReturnTypeFacts } from '../output/filters/type-expression.js';
import { createHash } from 'node:crypto';
import { stableStringify } from '../../shared/stable-json.js';
import { createError, ERROR_CODES } from '../../shared/error-codes.js';
import { bitmapHas } from '../bitmap.js';
import { FILTER_MATCH_ENTRY_BYTES, FILTER_MATCH_CACHE_BYTES, persistFilterMatches, readFilterMatchPage } from './filter-enumeration-cache.js';

const VERSION = 1;
const MODE_KEYS = { code: 'code', prose: 'prose', 'extracted-prose': 'extractedProse', records: 'records' };
const digest = (value) => createHash('sha256').update(stableStringify(value)).digest('hex');
const invalid = (message) => createError(ERROR_CODES.INVALID_REQUEST, message);
const CACHE_BYTES = FILTER_MATCH_CACHE_BYTES;
const ENTRY_BYTES = FILTER_MATCH_ENTRY_BYTES;
const matchesCache = new Map();
const metadataIds = new WeakMap();
let nextMetadataId = 0, cachedBytes = 0;
const metadataId = meta => {
  if (!metadataIds.has(meta)) metadataIds.set(meta, ++nextMetadataId);
  return metadataIds.get(meta);
};
const admitMatches = (key, ids) => {
  const existing = matchesCache.get(key);
  if (existing) { cachedBytes -= existing.byteLength; matchesCache.delete(key); }
  if (ids.byteLength > CACHE_BYTES) return;
  while (matchesCache.size >= 32 || cachedBytes + ids.byteLength > CACHE_BYTES) {
    const oldest = matchesCache.keys().next().value;
    if (!oldest) break;
    cachedBytes -= matchesCache.get(oldest).byteLength; matchesCache.delete(oldest);
  }
  matchesCache.set(key, ids); cachedBytes += ids.byteLength;
};

/** A cursor is bound to both the indexed generation and the exact filters. */
export function createFilterEnumeration({ cursor = null, filters, modes, generation, cacheDir = null }) {
  // Both loader and search-session constructors use this owner. Preserve
  // selected roots and artifact signatures, while API-only invocation context
  // cannot change cursor identity for a direct CLI over the same generation.
  const hasSelectedRoots = generation?.generationByMode && Object.values(generation.generationByMode)
    .every(info => info === null || typeof info?.canonicalIndexDir === 'string' && info.canonicalIndexDir.length > 0);
  const cursorGeneration = hasSelectedRoots ? {
    ...generation,
    generationByMode: Object.fromEntries(Object.entries(generation.generationByMode)
      .map(([mode, info]) => [mode, info ? {
        buildId: info.buildId, artifactSurfaceVersion: info.artifactSurfaceVersion,
        canonicalIndexDir: info.canonicalIndexDir
      } : null]))
  } : generation;
  const generationHash = digest(cursorGeneration);
  const relativeTime = filters.modifiedSinceDays != null;
  const requestHash = digest({ version: VERSION, filters: relativeTime ? { ...filters, modifiedAfter: null } : filters, modes });
  let modifiedAfter = relativeTime ? filters.modifiedAfter : null;
  let offsets = Object.fromEntries(modes.map((mode) => [mode, 0]));
  if (cursor != null) {
    let parsed;
    try {
      if (typeof cursor !== 'string' || !/^[A-Za-z0-9_-]{1,8192}$/.test(cursor)) throw new Error();
      parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    } catch {
      throw invalid('Invalid filter enumeration cursor. Restart without --cursor.');
    }
    if (parsed?.version !== VERSION || parsed.request !== requestHash) {
      throw invalid('Filter enumeration cursor does not match these filters or modes.');
    }
    if (parsed.generation !== generationHash) {
      throw invalid('The indexed generation changed. Restart enumeration without --cursor or use the original --as-of index.');
    }
    if (!parsed.offsets || typeof parsed.offsets !== 'object' || Array.isArray(parsed.offsets)
      || Object.keys(parsed.offsets).length !== modes.length
      || modes.some((mode) => !Number.isSafeInteger(parsed.offsets[mode]) || parsed.offsets[mode] < 0)) {
      throw invalid('Invalid filter enumeration cursor offsets.');
    }
    if (relativeTime && !Number.isFinite(parsed.modifiedAfter)) throw invalid('Invalid filter cursor time anchor.');
    modifiedAfter = relativeTime ? parsed.modifiedAfter : null;
    offsets = parsed.offsets;
  }
  return { version: VERSION, generation: generationHash, request: requestHash, offsets, byMode: {}, filters, modifiedAfter, cacheDir };
}

export const filterRepresentationIdentity = (enumeration, mode) =>
  enumeration.generation + ':' + enumeration.request + ':' + enumeration.modifiedAfter + ':' + mode;

/** Scan every eligible indexed chunk; retain only this page, with no ranking cutoff. */
export async function enumerateFilterMatches({ meta, allowed, match = null, mode, topN, enumeration, throwIfAborted, loadCost = null, preparedPage = null, ensureMetadata = null }) {
  const offset = enumeration.offsets[mode] || 0;
  const hits = [];
  const identity = filterRepresentationIdentity(enumeration, mode);
  const key = identity + ':' + metadataId(meta) + ':' + meta.length;
  const cached = matchesCache.get(key);
  const persisted = cached ? null : preparedPage || await readFilterMatchPage({ cacheDir: enumeration.cacheDir,
    identity, rowCount: meta.length, offset, limit: topN, throwIfAborted });
  let total = 0, scanned = 0, yielded = 0;
  const checkpoint = async () => {
    throwIfAborted?.(); await new Promise(resolve => setImmediate(resolve)); yielded += 1; throwIfAborted?.();
  };
  let diskPage = persisted;
  if (diskPage) for (let i = 0; i < diskPage.ids.length; i += 1) {
    if (i % 256 === 0) await checkpoint();
    const id = diskPage.ids[i];
    if (!meta[id] || match && !match(meta[id])) { diskPage = null; break; }
  }
  let saved = false;
  const append = id => {
    const chunk = meta[id];
    hits.push({ ...chunk, score: 0, scoreType: 'filter', rankMethod: 'indexed-order',
      ...(enumeration.filters?.returnType ? { filterEvidence: {
        returnType: { requested: enumeration.filters.returnType, match: 'type-expression-exact', facts: resolveReturnTypeFacts(chunk) }
      } } : {}) });
  };
  if (cached) {
    matchesCache.delete(key); matchesCache.set(key, cached);
    total = cached.length;
    for (let i = offset; i < Math.min(total, offset + topN); i += 1) {
      if ((i - offset) % 256 === 0) await checkpoint();
      append(cached[i]);
    }
  } else if (diskPage) {
    total = diskPage.total;
    for (let i = 0; i < diskPage.ids.length; i += 1) {
      if (i % 256 === 0) await checkpoint();
      append(diskPage.ids[i]);
    }
  } else {
    await ensureMetadata?.();
    throwIfAborted?.();
    let blocks = [], block = new Uint32Array(16384), used = 0, retained = 0, cacheable = true;
    let checkpoint = performance.now();
    for (let id = 0; id < meta.length; id += 1) {
      if (id % 256 === 0 || performance.now() - checkpoint >= 8) {
        throwIfAborted?.(); await new Promise(resolve => setImmediate(resolve));
        yielded += 1; checkpoint = performance.now(); throwIfAborted?.();
      }
      const chunk = meta[id]; scanned += 1;
      if (!chunk || allowed && !bitmapHas(allowed, id) || match && !match(chunk)) continue;
      if (total >= offset && hits.length < topN) append(id);
      total += 1;
      if (cacheable) {
        if ((retained + used + 1) * 4 > ENTRY_BYTES) { cacheable = false; blocks = []; block = null; }
        else {
          block[used++] = id;
          if (used === block.length) { blocks.push(block); retained += used; used = 0; block = new Uint32Array(16384); }
        }
      }
    }
    if (cacheable) {
      const ids = new Uint32Array(total);
      let start = 0;
      for (const saved of blocks) { ids.set(saved, start); start += saved.length; }
      ids.set(block.subarray(0, used), start); admitMatches(key, ids);
      saved = await persistFilterMatches({ cacheDir: enumeration.cacheDir, identity, rowCount: meta.length, ids, metadata: meta, throwIfAborted });
    }
  }
  throwIfAborted?.();
  enumeration.byMode[mode] = { offset, total, matched: hits.length, cost: {
    scannedMetadata: scanned, hydratedHits: hits.length, yieldedCheckpoints: yielded, metadataRetainedRows: meta.length,
    matchingRepresentation: cached ? 'warm' : diskPage ? diskPage.representation || 'persisted-seek' : matchesCache.has(key) ? 'admitted' : 'entry-byte-limit',
    cacheBytes: cachedBytes, persisted: saved, continuationReadBytes: diskPage?.readBytes || 0,
    startupWork: loadCost || { kind: 'caller-supplied-metadata', metadataLoadedRows: null }
  } };
  return hits;
}

/** Advance only past hits actually emitted after the output byte budget. */
export function buildFilterPagination(enumeration, payload) {
  if (!enumeration) return null;
  const offsets = {};
  const byMode = {};
  let total = 0;
  let returned = 0;
  let hasMore = false;
  for (const [mode, state] of Object.entries(enumeration.byMode)) {
    const count = payload[MODE_KEYS[mode]]?.length || 0;
    const next = Math.min(state.total, state.offset + count);
    offsets[mode] = next;
    byMode[mode] = { offset: state.offset, total: state.total, returned: count, hasMore: next < state.total };
    total += state.total;
    returned += count;
    hasMore ||= next < state.total;
  }
  if (hasMore && returned === 0) {
    throw invalid('The output budget cannot fit a filter result. Increase --output-bytes or use --compact.');
  }
  const nextCursor = hasMore ? Buffer.from(JSON.stringify({
    version: VERSION, generation: enumeration.generation, request: enumeration.request, offsets, modifiedAfter: enumeration.modifiedAfter
  })).toString('base64url') : null;
  return {
    kind: 'filter', order: 'indexed-order', generation: enumeration.generation,
    total, returned, hasMore, nextCursor, byMode,
    coverage: 'indexed-metadata',
    cost: { byMode: Object.fromEntries(Object.entries(enumeration.byMode).map(([mode, state]) => [mode, state.cost || null])) },
    coverageNote: 'Enumerates every matching indexed chunk. Missing compiler facts are not inferred; this is not whole-program type or relation completeness.'
  };
}
