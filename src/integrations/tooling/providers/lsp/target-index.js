/**
 * Normalize one target row for overlap lookup.
 *
 * @param {object} target
 * @param {number} ordinal
 * @returns {object|null}
 */
const normalizeTargetEntry = (target, ordinal) => {
  const range = target?.virtualRange || null;
  if (!range) return null;
  const start = Number(range.start);
  const end = Number(range.end);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return {
    target,
    ordinal,
    start,
    end,
    span: end - start,
    name: typeof target?.symbolHint?.name === 'string'
      ? target.symbolHint.name
      : null,
    prefixMaxEnd: end
  };
};

/**
 * Build a deterministic overlap index for chunk targets in one document.
 *
 * Targets are sorted by start offset so lookups can binary-search to the last
 * candidate whose start is <= query end, then walk backward only while the
 * prefix max-end indicates overlaps are still possible.
 *
 * @param {Array<object>} targets
 * @returns {{entries:Array<object>}}
 */
export const buildTargetLookupIndex = (targets) => {
  const entries = (Array.isArray(targets) ? targets : [])
    .map((target, ordinal) => normalizeTargetEntry(target, ordinal))
    .filter(Boolean)
    .sort((left, right) => (
      (left.start - right.start)
      || (left.end - right.end)
      || (left.ordinal - right.ordinal)
    ));
  let prefixMaxEnd = -Infinity;
  for (const entry of entries) {
    prefixMaxEnd = Math.max(prefixMaxEnd, entry.end);
    entry.prefixMaxEnd = prefixMaxEnd;
  }
  return { entries };
};

/**
 * Legacy linear overlap search kept for regression testing.
 *
 * @param {Array<object>} targets
 * @param {{start:number,end:number}|null} offsets
 * @param {string|null} [nameHint=null]
 * @returns {object|null}
 */
export const findTargetForOffsetsLinear = (targets, offsets, nameHint = null) => {
  if (!offsets) return null;
  let best = null;
  let bestRank = -1;
  let bestSpan = Infinity;
  let bestOrdinal = Infinity;
  let ordinal = 0;
  for (const target of targets || []) {
    const range = target?.virtualRange || null;
    if (!range) {
      ordinal += 1;
      continue;
    }
    if (!Number.isFinite(range.start) || !Number.isFinite(range.end)) {
      ordinal += 1;
      continue;
    }
    const overlaps = offsets.end >= range.start && offsets.start <= range.end;
    if (!overlaps) {
      ordinal += 1;
      continue;
    }
    const contains = offsets.start >= range.start && offsets.end <= range.end;
    const nameMatch = nameHint && target?.symbolHint?.name === nameHint;
    const span = range.end - range.start;
    const rank = (contains ? 2 : 1) + (nameMatch ? 2 : 0);
    if (
      rank > bestRank
      || (rank === bestRank && span < bestSpan)
      || (rank === bestRank && span === bestSpan && ordinal < bestOrdinal)
    ) {
      best = target;
      bestRank = rank;
      bestSpan = span;
      bestOrdinal = ordinal;
    }
    ordinal += 1;
  }
  return best;
};

const findLastEntryStartingBefore = (entries, value) => {
  let low = 0;
  let high = entries.length;
  while (low < high) {
    const mid = low + Math.floor((high - low) / 2);
    if (entries[mid].start <= value) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }
  return low - 1;
};

/**
 * Resolve best chunk target for a symbol/diagnostic offset range.
 *
 * Ranking matches the prior linear implementation:
 * 1. containing ranges beat partial overlaps
 * 2. matching symbol names beat non-matching names
 * 3. smaller spans win for nested declarations
 * 4. original target order breaks exact ties
 *
 * @param {{entries:Array<object>}|Array<object>} targetIndex
 * @param {{start:number,end:number}|null} offsets
 * @param {string|null} [nameHint=null]
 * @returns {object|null}
 */
export const findTargetForOffsets = (targetIndex, offsets, nameHint = null) => {
  if (!offsets) return null;
  const index = Array.isArray(targetIndex)
    ? buildTargetLookupIndex(targetIndex)
    : targetIndex;
  const entries = Array.isArray(index?.entries) ? index.entries : [];
  if (!entries.length) return null;
  let best = null;
  let bestRank = -1;
  let bestSpan = Infinity;
  let bestOrdinal = Infinity;
  for (let idx = findLastEntryStartingBefore(entries, offsets.end); idx >= 0; idx -= 1) {
    const entry = entries[idx];
    if (entry.prefixMaxEnd < offsets.start) break;
    if (entry.end < offsets.start || entry.start > offsets.end) continue;
    const contains = offsets.start >= entry.start && offsets.end <= entry.end;
    const nameMatch = nameHint && entry.name === nameHint;
    const rank = (contains ? 2 : 1) + (nameMatch ? 2 : 0);
    if (
      rank > bestRank
      || (rank === bestRank && entry.span < bestSpan)
      || (rank === bestRank && entry.span === bestSpan && entry.ordinal < bestOrdinal)
    ) {
      best = entry.target;
      bestRank = rank;
      bestSpan = entry.span;
      bestOrdinal = entry.ordinal;
    }
  }
  return best;
};
