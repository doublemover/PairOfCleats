const MAX_ALLOWED_IDS = 4096;
const MAX_DOMAIN_BYTES = 64 * 1024;
const TOKEN_BATCH = 896;

/** Exact caller-owned eligible IDs only. Unknown/broad domains keep the
 * existing broad posting path; no approximate prefilter is promoted here. */
const selectiveDomain = (allowedIds, totalDocs) => {
  if (!allowedIds) return null;
  const rawSize = typeof allowedIds.size === 'function' ? allowedIds.size() : allowedIds.size;
  if (Number.isFinite(rawSize) && (rawSize > MAX_ALLOWED_IDS || rawSize * 2 > totalDocs)) return null;
  const iterable = typeof allowedIds[Symbol.iterator] === 'function' ? allowedIds
    : typeof allowedIds.values === 'function' ? allowedIds.values() : null;
  if (!iterable) return null;
  const unique = new Set();
  for (const id of iterable) {
    if (!Number.isSafeInteger(id) || id < 0) throw new TypeError('Invalid exact SQLite BM25 eligible ordinal.');
    unique.add(id);
    if (unique.size > MAX_ALLOWED_IDS || unique.size * 2 > totalDocs) return null;
  }
  const ids = [...unique].sort((left, right) => left - right), json = JSON.stringify(ids);
  return Buffer.byteLength(json) <= MAX_DOMAIN_BYTES ? { ids, json } : null;
};

export const hydrateSelectiveSqliteBm25 = ({ db, mode, tokenIds, tokenIdToIndex, vocab, vocabIndex,
  stats, allowedIds, getCachedStatement, throwIfAborted = null, metrics = {} }) => {
  const domain = selectiveDomain(allowedIds, stats.totalDocs);
  if (!domain) return null;
  const postings = Array.from({ length: vocab.length }, () => []), documentFrequencies = new Array(vocab.length).fill(0);
  const docLengths = new Map();
  Object.assign(metrics, { plan: 'indexed-eligible-id-probes', eligibleIds: domain.ids.length, eligibleIdBytes: Buffer.byteLength(domain.json),
    postingRowsReturned: 0, lengthDocumentsLoaded: 0, globalDfQueries: 0, globalDfDocuments: 0, statements: 0 });
  for (let first = 0; first < tokenIds.length; first += TOKEN_BATCH) {
    throwIfAborted?.();
    const ids = tokenIds.slice(first, first + TOKEN_BATCH), placeholders = ids.map(() => '?').join(',');
    const df = getCachedStatement(db, `bm25-global-df:${ids.length}`,
      `SELECT token_id AS id, COUNT(*) AS df FROM token_postings WHERE mode = ? AND token_id IN (${placeholders}) GROUP BY token_id`);
    metrics.globalDfQueries++; metrics.statements++;
    for (const row of df.iterate(mode, ...ids)) {
      throwIfAborted?.();
      const index = tokenIdToIndex.get(row.id);
      if (index == null || !Number.isSafeInteger(row.df) || row.df < 0 || row.df > stats.totalDocs) throw new Error('Invalid global SQLite BM25 document frequency.');
      documentFrequencies[index] = row.df; metrics.globalDfDocuments += row.df;
    }
    if (!domain.ids.length) continue;
    const statement = getCachedStatement(db, `bm25-eligible-postings:${ids.length}`,
      `SELECT p.token_id AS id, p.doc_id, p.tf, dl.len FROM token_postings AS p
       LEFT JOIN doc_lengths AS dl ON dl.mode = p.mode AND dl.doc_id = p.doc_id
       WHERE p.mode = ? AND p.token_id IN (${placeholders})
       AND p.doc_id IN (SELECT value FROM json_each(?)) ORDER BY p.token_id, p.doc_id`);
    metrics.statements++;
    for (const row of statement.iterate(mode, ...ids, domain.json)) {
      if (metrics.postingRowsReturned % 256 === 0) throwIfAborted?.();
      const index = tokenIdToIndex.get(row.id);
      if (index == null) throw new Error('SQLite BM25 returned an unselected token.');
      postings[index].push([row.doc_id, row.tf]); docLengths.set(row.doc_id, row.len || 0);
      metrics.postingRowsReturned++;
    }
  }
  metrics.lengthDocumentsLoaded = docLengths.size;
  return { vocab, postings, vocabIndex, docLengths, documentFrequencies,
    avgDocLen: stats.avgDocLen, totalDocs: stats.totalDocs, postingDomain: { version: 1, kind: 'eligible-subset' }, hydrationCost: metrics };
};
