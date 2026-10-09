// Pure ranking utilities. Inputs must already be authorized within ONE partition.
// No store, model, network, cache, text lookup or authorization is performed here.
const reference = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const keyFor = value => {
  if (!reference(value?.sourceRef) || !reference(value?.snapshotRef)) throw new TypeError('Exact source/snapshot references required.');
  return JSON.stringify([value.sourceRef, value.snapshotRef]);
};
const integer = (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max;

/** Rank fusion avoids comparing uncalibrated lexical and semantic raw scores. */
export function fuseHistoryRanks({
  lexical = [], semantic = [], rankConstant = 60, lexicalWeight = 1, semanticWeight = 1,
  top = 20, maxPerGroup = null
} = {}) {
  if (!Array.isArray(lexical) || !Array.isArray(semantic) || lexical.length > 1000 || semantic.length > 1000
    || !integer(rankConstant, 1, 10000) || !integer(top, 1, 100)
    || ![lexicalWeight, semanticWeight].every(value => Number.isFinite(value) && value >= 0 && value <= 100)
    || lexicalWeight + semanticWeight === 0 || (maxPerGroup !== null && !integer(maxPerGroup, 1, 100))) {
    throw new TypeError('Invalid bounded fusion controls.');
  }
  const candidates = new Map();
  for (const [channel, rows, weight] of [['lexical', lexical, lexicalWeight], ['semantic', semantic, semanticWeight]]) {
    const seen = new Set();
    for (let index = 0; index < rows.length; index++) {
      const row = rows[index], key = keyFor(row);
      if (seen.has(key) || weight === 0) continue;
      seen.add(key);
      let item = candidates.get(key);
      if (!item) {
        item = { sourceRef: row.sourceRef, snapshotRef: row.snapshotRef,
          groupRef: row.groupRef ?? null, score: 0, ranks: {} };
        candidates.set(key, item);
      } else if (row.groupRef != null && item.groupRef != null && row.groupRef !== item.groupRef) {
        throw new TypeError('Conflicting provenance group for the same evidence.');
      } else if (item.groupRef === null) item.groupRef = row.groupRef ?? null;
      item.ranks[channel] = index + 1;
      item.score += weight / (rankConstant + index + 1);
    }
  }
  const ranked = [...candidates.values()].sort((left, right) => right.score - left.score
    || keyFor(left).localeCompare(keyFor(right)));
  const counts = new Map(), results = [];
  for (const row of ranked) {
    const group = row.groupRef ?? keyFor(row);
    if (maxPerGroup !== null && (counts.get(group) ?? 0) >= maxPerGroup) continue;
    counts.set(group, (counts.get(group) ?? 0) + 1);
    results.push(row);
    if (results.length === top) break;
  }
  return { method: 'weighted-reciprocal-rank-fusion', rankConstant,
    weights: { lexical: lexicalWeight, semantic: semanticWeight }, maxPerGroup,
    candidateCount: candidates.size, returned: results.length, results };
}

/** A reranker may reorder supplied evidence, never introduce or replace it. */
export function applyHistoryRerank(candidates, orderedReferences) {
  if (!Array.isArray(candidates) || !Array.isArray(orderedReferences) || candidates.length > 1000
    || candidates.length !== orderedReferences.length) throw new TypeError('Reranker must return a bounded full permutation.');
  const lookup = new Map(candidates.map(value => [keyFor(value), value]));
  if (lookup.size !== candidates.length) throw new TypeError('Duplicate candidates.');
  const seen = new Set();
  return orderedReferences.map(reference => {
    const key = keyFor(reference);
    if (!lookup.has(key) || seen.has(key)) throw new TypeError('Reranker introduced or repeated evidence.');
    seen.add(key);
    return lookup.get(key);
  });
}
