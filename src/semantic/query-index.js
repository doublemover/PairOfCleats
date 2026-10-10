import { assertSemanticQueryIndex } from '../contracts/validators/semantic-query-index.js';

export const QUERY_INDEX_MEMBERS = Object.freeze(['semantic_operands', 'semantic_lookup', 'semantic_ownership', 'semantic_records', 'semantic_edges']);
const compareText = (left, right) => left < right ? -1 : left > right ? 1 : 0;
export const compareQueryIndexRows = (left, right) => compareText(left.owner.partitionId, right.owner.partitionId)
  || left.owner.localId - right.owner.localId || compareText(left.member, right.member)
  || compareText(left.partitionId, right.partitionId) || left.rowOrdinal - right.rowOrdinal;
export const queryIndexKey = (row) => ({ owner: row.owner, member: row.member, partitionId: row.partitionId, rowOrdinal: row.rowOrdinal });
export const queryIndexOwnerCompare = (row, owner, member) => compareText(row.owner.partitionId, owner.partitionId)
  || row.owner.localId - owner.localId || compareText(row.member, member);
export const assertQueryIndexRow = (row) => assertSemanticQueryIndex(row, { rowOnly: true });
