import { assertSemanticQueryIndex } from '../contracts/validators/semantic-query-index.js';
import { canonicalSemanticJson } from '../index/semantic/identity.js';

export const QUERY_INDEX_MEMBERS = Object.freeze(['semantic_operands', 'semantic_lookup', 'semantic_ownership', 'semantic_records', 'semantic_edges']);
/** Physical lookup projections share the original member ordinal, including
 * rows that produce no entry. Canonical facts remain the authority. */
export function* queryIndexEntriesForRow({ partitionId, member, row, rowOrdinal }) {
  if (!QUERY_INDEX_MEMBERS.includes(member)) return;
  if (member === 'semantic_records' && (row.kind !== 'occurrence' || !row.data.expression)) return;
  const owner = member === 'semantic_records' ? row.data.expression : member === 'semantic_operands' ? row.parent
    : member === 'semantic_ownership' ? row.recordRef : { partitionId, localId: row.id };
  const owners = member === 'semantic_edges'
    ? [row.from, ...(canonicalSemanticJson(row.from) === canonicalSemanticJson(row.to) ? [] : [row.to])] : [owner];
  for (const endpoint of owners) yield { owner: endpoint, member, partitionId, rowOrdinal };
}
const compareText = (left, right) => left < right ? -1 : left > right ? 1 : 0;
export const compareQueryIndexRows = (left, right) => compareText(left.owner.partitionId, right.owner.partitionId)
  || left.owner.localId - right.owner.localId || compareText(left.member, right.member)
  || compareText(left.partitionId, right.partitionId) || left.rowOrdinal - right.rowOrdinal;
export const queryIndexKey = (row) => ({ owner: row.owner, member: row.member, partitionId: row.partitionId, rowOrdinal: row.rowOrdinal });
export const queryIndexOwnerCompare = (row, owner, member) => compareText(row.owner.partitionId, owner.partitionId)
  || row.owner.localId - owner.localId || compareText(row.member, member);
export const assertQueryIndexRow = (row) => assertSemanticQueryIndex(row, { rowOnly: true });
