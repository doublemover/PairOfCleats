const { createHash } = require('node:crypto');
const { filterHitIdentity } = require('./filter-pagination.js');

/** Display identity only. These IDs preserve native focus/expansion; they never
 * become semantic refs, source witnesses, cursor state or command authority. */
function resultTreeItemId({ resultSetId, groupMode = 'section', kind, key = '', hit = null, ordinal = null, occurrence = 0 }) {
  if (typeof resultSetId !== 'string' || !resultSetId || resultSetId.length > 256
    || !['section', 'file', 'query'].includes(groupMode)) return null;
  let identity;
  if (kind === 'result-set') identity = ['result-set', resultSetId];
  else if (kind === 'group' && typeof key === 'string') identity = ['group', resultSetId, groupMode, key];
  else if (kind === 'hit' && hit) {
    const exact = filterHitIdentity(hit);
    if (!Number.isSafeInteger(occurrence) || occurrence < 0
      || !exact && (!Number.isSafeInteger(ordinal) || ordinal < 0)) return null;
    // Unknown source IDs are not deduplicated; their captured ordinal remains
    // stable because continuation appends to the existing bounded hit array.
    identity = ['hit', resultSetId, exact || ['captured-ordinal', ordinal], occurrence];
  } else return null;
  return 'pairofcleats.result-tree.' + createHash('sha256').update(JSON.stringify(identity)).digest('hex');
}

function resultTreeHitOccurrences(hits) {
  const seen = new Map();
  return hits.map(hit => {
    const key = filterHitIdentity(hit);
    if (!key) return 0;
    const occurrence = seen.get(key) || 0;
    seen.set(key, occurrence + 1);
    return occurrence;
  });
}

module.exports = { resultTreeItemId, resultTreeHitOccurrences };
