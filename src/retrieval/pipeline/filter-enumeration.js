import { resolveReturnTypeFacts } from '../output/filters/type-expression.js';
import { createHash } from 'node:crypto';
import { stableStringify } from '../../shared/stable-json.js';
import { createError, ERROR_CODES } from '../../shared/error-codes.js';
import { bitmapHas } from '../bitmap.js';

const VERSION = 1;
const MODE_KEYS = { code: 'code', prose: 'prose', 'extracted-prose': 'extractedProse', records: 'records' };
const digest = (value) => createHash('sha256').update(stableStringify(value)).digest('hex');
const invalid = (message) => createError(ERROR_CODES.INVALID_REQUEST, message);

/** A cursor is bound to both the indexed generation and the exact filters. */
export function createFilterEnumeration({ cursor = null, filters, modes, generation }) {
  const generationHash = digest(generation);
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
  return { version: VERSION, generation: generationHash, request: requestHash, offsets, byMode: {}, filters, modifiedAfter };
}

/** Scan every eligible indexed chunk; retain only this page, with no ranking cutoff. */
export function enumerateFilterMatches({ meta, allowed, mode, topN, enumeration, throwIfAborted }) {
  const offset = enumeration.offsets[mode] || 0;
  const hits = [];
  let total = 0;
  for (let id = 0; id < meta.length; id += 1) {
    if (id % 256 === 0) throwIfAborted?.();
    const chunk = meta[id];
    if (!chunk || (allowed && !bitmapHas(allowed, id))) continue;
    if (total >= offset && hits.length < topN) {
      hits.push({ ...chunk, score: 0, scoreType: 'filter', rankMethod: 'indexed-order',
        ...(enumeration.filters?.returnType ? { filterEvidence: {
          returnType: { requested: enumeration.filters.returnType, match: 'type-expression-exact', facts: resolveReturnTypeFacts(chunk) }
        } } : {}) });
    }
    total += 1;
  }
  enumeration.byMode[mode] = { offset, total, matched: hits.length };
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
    coverageNote: 'Enumerates every matching indexed chunk. Missing compiler facts are not inferred; this is not whole-program type or relation completeness.'
  };
}
