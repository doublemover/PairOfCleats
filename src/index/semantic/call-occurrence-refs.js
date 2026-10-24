const invocationKinds = new Set(['call', 'optionalCall', 'construct', 'tag', 'import']);

/** Join already retained syntax invocations to already captured native call
 * occurrences. This copies portable references only; native trees and source
 * payloads remain owned by their existing producer/retention owners.
 */
export const createCallOccurrenceRefJoin = ({ chunks, source, partitionId }) => {
  const detailsBySpan = new Map();
  let eligible = 0, linked = 0, ambiguous = 0;
  if (source.coordinateUnit !== 'utf16' || source.mapping !== null) {
    return { observe() {}, finish: () => ({ eligible: 0, linked: 0, ambiguous: 0, unavailable: 0 }) };
  }
  for (const chunk of chunks || []) {
    if (chunk?.file !== source.path) continue;
    for (const detail of chunk.codeRelations?.callDetails || []) {
      if (detail?.source !== 'tree-sitter' || detail.coordinateSystem !== 'utf16'
        || !Number.isSafeInteger(detail.start) || !Number.isSafeInteger(detail.end)
        || detail.start < 0 || detail.end <= detail.start || detail.end > source.textLength) continue;
      const key = detail.start + ':' + detail.end;
      const values = detailsBySpan.get(key) || [];
      values.push(detail); detailsBySpan.set(key, values); eligible += 1;
    }
  }
  const matches = new Map();
  const observe = row => {
    if (row?.kind !== 'expression' || !invocationKinds.has(row.data?.invocationKind) || !Array.isArray(row.span)) return;
    const key = row.span[0] + ':' + row.span[1];
    if (!detailsBySpan.has(key)) return;
    const prior = matches.get(key);
    if (prior !== undefined && prior !== false && prior !== row.id) matches.set(key, false);
    else if (prior !== false) matches.set(key, row.id);
  };
  return { observe, finish() {
    for (const [span, details] of detailsBySpan) {
      const localId = matches.get(span);
      for (const detail of details) {
        // Never retain an old-generation reference on a current exact source join.
        delete detail.semanticRecordRef;
        if (localId === false) { ambiguous += 1; detail.semanticRecordRefReason = 'ambiguous-invocation-span'; }
        else if (Number.isSafeInteger(localId)) {
          detail.semanticRecordRef = { partitionId, localId };
          detail.semanticRecordRefReason = 'exact-retained-invocation-span'; linked += 1;
        } else detail.semanticRecordRefReason = 'retained-invocation-unavailable';
      }
    }
    return { eligible, linked, ambiguous, unavailable: eligible - linked - ambiguous };
  } };
};
