function normalizeFilterPagination(value) {
  if (value?.kind !== 'filter' || !/^[a-f0-9]{64}$/.test(value.generation || '')) return null;
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

function mergeFilterPage(previous, next, hits) {
  if (!previous?.pagination || !next
    || JSON.stringify(previous.pagination.generation) !== JSON.stringify(next.generation)) {
    throw new Error('Indexed generation changed. Restart Browse Indexed Matches to use the new generation.');
  }
  const identity = hit => {
    const id = hit.chunkUid || (typeof hit.id === 'string' || Number.isSafeInteger(hit.id) ? hit.id : null);
    return id === null || id === '' ? null : `${hit.section || ''}:${id}`;
  };
  const seen = new Set(previous.hits.map(hit => identity(hit)).filter(Boolean));
  const added = hits.filter(hit => {
    const key = identity(hit);
    if (!key) return true;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (previous.hits.length + added.length > 2000) {
    throw new Error('This editor view reached its 2,000 hit bound. Narrow the filters and restart browsing.');
  }
  return [...previous.hits, ...added];
}

function continuationInvocation(invocation, cursor) {
  if (!cursor || !invocation) throw new Error('No indexed continuation is available.');
  if (invocation.kind === 'api-search') {
    return { ...invocation, payload: { ...invocation.payload, cursor } };
  }
  const args = [...invocation.args];
  const end = args.indexOf('--');
  const boundary = end < 0 ? args.length : end;
  const existing = args.indexOf('--cursor');
  if (existing >= 0 && existing < boundary) args.splice(existing, 2);
  const insertion = args.indexOf('--');
  args.splice(insertion < 0 ? args.length : insertion, 0, '--cursor', cursor);
  return { ...invocation, args };
}

module.exports = { normalizeFilterPagination, mergeFilterPage, continuationInvocation };
