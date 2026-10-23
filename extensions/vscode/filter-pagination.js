const { createHash } = require('node:crypto');

// Display progress only. Digests never decode, resume or grant cursor authority.
// History follows actual retained arrays and is not fabricated after restart.
const cursorHistories = new WeakMap();
const cursorDigest = cursor => createHash('sha256').update(cursor).digest('hex');

function normalizeFilterPagination(value) {
  if (value?.kind !== 'filter' || typeof value.generation !== 'string'
    || value.generation.length !== 64 || !/^[a-f0-9]{64}$/.test(value.generation)
    || typeof value.hasMore !== 'boolean'
    || value.order != null && value.order !== 'indexed-order'
    || !value.hasMore && value.nextCursor != null
    || value.hasMore && (typeof value.nextCursor !== 'string' || !value.nextCursor.length || value.nextCursor.length > 8192)) return null;
  return {
    kind: 'filter', order: 'indexed-order', generation: value.generation,
    total: Number.isSafeInteger(value.total) && value.total >= 0 ? value.total : null,
    returned: Number.isSafeInteger(value.returned) && value.returned >= 0 ? value.returned : 0,
    hasMore: value.hasMore === true,
    nextCursor: typeof value.nextCursor === 'string' && value.nextCursor.length <= 8192
      ? value.nextCursor : null,
    coverage: value.coverage || 'indexed-metadata',
    coverageNote: String(value.coverageNote || '').slice(0, 4096)
  };
}

function admitFilterPage(value, hits) {
  const page = normalizeFilterPagination(value);
  if (!page || !Array.isArray(hits) || hits.length > 2000
    || !Number.isSafeInteger(value.returned) || value.returned !== hits.length
    || page.total !== null && page.total < page.returned
    || page.hasMore && page.returned === 0) {
    throw new Error('Indexed browsing returned invalid generation/page membership. Restart with supported indexed metadata filters.');
  }
  return page;
}

function filterHitIdentity(hit) {
  if (typeof hit.chunkUid === 'string' && hit.chunkUid) return JSON.stringify([hit.section || '', 'chunkUid', hit.chunkUid]);
  const id = typeof hit.id === 'string' || Number.isSafeInteger(hit.id) && hit.id >= 0 ? hit.id : null;
  return id === null || id === '' ? null : JSON.stringify([hit.section || '', typeof id, id]);
}

function mergeFilterPage(previous, next, hits) {
  if (!previous?.pagination || !next
    || JSON.stringify(previous.pagination.generation) !== JSON.stringify(next.generation)) {
    throw new Error('Indexed generation changed. Restart Browse Indexed Matches to use the new generation.');
  }
  next = admitFilterPage(next, hits);
  if (previous.pagination.total != null && next.total != null && previous.pagination.total !== next.total) {
    throw new Error('Indexed matching total changed within one generation. Restart browsing; the previous result set is retained.');
  }
  if (next.hasMore && next.nextCursor === previous.pagination.nextCursor) {
    throw new Error('Indexed continuation did not advance. Restart browsing; the previous result set is retained.');
  }
  const priorHistory = cursorHistories.get(previous.hits);
  const cursors = new Set(priorHistory?.generation === next.generation ? priorHistory.cursors : []);
  if (typeof previous.pagination.nextCursor === 'string') cursors.add(cursorDigest(previous.pagination.nextCursor));
  if (next.hasMore && cursors.has(cursorDigest(next.nextCursor))) {
    throw new Error('Indexed continuation repeated an earlier cursor. Restart browsing; the previous result set is retained.');
  }
  const seen = new Set(previous.hits.map(hit => filterHitIdentity(hit)).filter(Boolean));
  const added = hits.filter(hit => {
    const key = filterHitIdentity(hit);
    if (!key) return true;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (next.hasMore && !added.length) {
    throw new Error('Indexed continuation returned no new source identities. Restart browsing; the previous result set is retained.');
  }
  if (previous.hits.length + added.length > 2000) {
    throw new Error('This editor view reached its 2,000 hit bound. Narrow the filters and restart browsing.');
  }
  const merged = [...previous.hits, ...added], total = next.total ?? previous.pagination.total;
  if (total != null && merged.length > total) {
    throw new Error('Indexed loaded membership exceeds its captured matching total. Restart browsing; the previous result set is retained.');
  }
  if (next.hasMore) cursors.add(cursorDigest(next.nextCursor));
  cursorHistories.set(merged, { generation: next.generation, cursors });
  return merged;
}

/** Normalization copies hit objects/arrays. Carry only the actual merge owner's
 * private progress record; a serialized public field cannot manufacture it. */
function carryFilterPageHistory(originalHits, normalizedHits) {
  if (!Array.isArray(originalHits) || !Array.isArray(normalizedHits)) return;
  const history = cursorHistories.get(originalHits);
  if (history) cursorHistories.set(normalizedHits, history);
}

function continuationInvocation(invocation, cursor) {
  if (!cursor || !invocation) throw new Error('No indexed continuation is available.');
  const request = invocation.request ? { ...invocation.request,
    options: { ...invocation.request.options, cursor } } : null;
  if (invocation.kind === 'api-search') {
    return { ...invocation, ...(request ? { request } : {}), payload: { ...invocation.payload, cursor } };
  }
  const args = [...invocation.args];
  const end = args.indexOf('--');
  const boundary = end < 0 ? args.length : end;
  const existing = args.indexOf('--cursor');
  if (existing >= 0 && existing < boundary) args.splice(existing, 2);
  const insertion = args.indexOf('--');
  args.splice(insertion < 0 ? args.length : insertion, 0, '--cursor', cursor);
  return { ...invocation, ...(request ? { request } : {}), args };
}

module.exports = { normalizeFilterPagination, admitFilterPage, filterHitIdentity, mergeFilterPage, carryFilterPageHistory, continuationInvocation };
