import { canonicalSemanticJson } from '../index/semantic/identity.js';
import { validateSemanticRecord } from '../contracts/validators/semantic.js';
import { throwIfAborted } from '../shared/abort.js';

const columns = 'partition_id AS ownerPartition,rowid AS hydrationOrdinal,payload';
const incident = 'SELECT ' + columns + ' FROM semantic_edges WHERE from_partition=? AND from_id=?'
  + ' UNION SELECT ' + columns + ' FROM semantic_edges WHERE to_partition=? AND to_id=?';
const relations = Object.freeze({
  semantic_edges: { family: 'edge', sql: incident, args: ref => [ref.partitionId, ref.localId, ref.partitionId, ref.localId] },
  semantic_records: { family: 'node', sql: 'SELECT ' + columns + " FROM semantic_records WHERE record_kind='occurrence'"
    + " AND json_extract(payload,'$.data.expression.partitionId')=? AND json_extract(payload,'$.data.expression.localId')=?" },
  semantic_operands: { family: 'operand', sql: 'SELECT ' + columns + ' FROM semantic_operands WHERE parent_partition=? AND parent_id=?' },
  semantic_ownership: { family: 'ownership', sql: 'SELECT ' + columns + ' FROM semantic_ownership WHERE record_partition=? AND local_id=?' },
  semantic_lookup: { family: 'lookup', sql: 'SELECT ' + columns + ' FROM semantic_lookup WHERE partition_id=? AND local_id=?' }
});

/** One endpoint-qualified page, preserving the original partition/rowid order.
 * The extra row carries only metadata; it cannot consume/export payload bytes.
 * Numeric offsets remain incident-row offsets, including filtered neighbors.
 */
export const createSqliteRelatedReader = ({ db, descriptors, createHydration, maxRowBytes }) => {
  const inventory = new Map(descriptors.map(descriptor => [descriptor.partitionId, descriptor]));
  const plans = new Map(Object.entries(relations).map(([member, relation]) => {
    // Orphan rows were not visible through the original admitted inventory loop.
    const qualified = 'SELECT r.* FROM (' + relation.sql + ') r'
      + ' WHERE EXISTS (SELECT 1 FROM semantic_analysis a WHERE a.partition_id=r.ownerPartition)';
    const ordered = qualified + ' ORDER BY ownerPartition COLLATE BINARY,hydrationOrdinal LIMIT ? OFFSET ?';
    const page = db.prepare('SELECT ownerPartition,hydrationOrdinal,payloadBytes,'
      + 'CASE WHEN pageOrdinal<=? AND payloadBytes<=?'
      + ' AND SUM(CASE WHEN pageOrdinal<=? THEN payloadBytes ELSE 0 END) OVER ()<=?'
      + ' THEN payload ELSE NULL END AS payload FROM ('
      + 'SELECT *,length(CAST(payload AS BLOB)) AS payloadBytes,'
      + 'ROW_NUMBER() OVER (ORDER BY ownerPartition COLLATE BINARY,hydrationOrdinal) AS pageOrdinal'
      + ' FROM (' + ordered + ')) ORDER BY ownerPartition COLLATE BINARY,hydrationOrdinal');
    const predecessor = db.prepare('SELECT 1 AS present FROM (' + ordered + ')');
    return [member, { ...relation, page, predecessor }];
  }));
  return async (ref, member, { offset = 0, limit = 128, signal = null, metrics = null } = {}) => {
    const plan = plans.get(member);
    if (!inventory.has(ref.partitionId) || !plan || !Number.isSafeInteger(offset) || offset < 0
      || !Number.isSafeInteger(limit) || limit < 1 || limit > 512) throw new Error('Invalid related semantic request.');
    const args = plan.args ? plan.args(ref) : [ref.partitionId, ref.localId];
    const hydration = createHydration(metrics), rows = [];
    let more = false;
    const countStatement = () => { if (metrics) metrics.relatedStatements = (metrics.relatedStatements || 0) + 1; };
    throwIfAborted(signal); countStatement();
    const values = plan.page.iterate(limit, maxRowBytes, limit, hydration.remaining(), ...args, limit + 1, offset);
    for (const stored of values) {
      throwIfAborted(signal);
      if (rows.length === limit) {
        more = true;
        if (metrics) metrics.relatedLookaheadRows = (metrics.relatedLookaheadRows || 0) + 1;
        break;
      }
      const descriptor = inventory.get(stored.ownerPartition);
      if (!descriptor) throw new Error('Related semantic row is outside the pinned inventory.');
      const row = hydration.parse(stored);
      if (!validateSemanticRecord(plan.family, row, { structuralSlots: descriptor.structuralSlots }).ok) {
        throw new Error('Invalid hydrated semantic member.');
      }
      if (member === 'semantic_edges' && ![row.from, row.to].some(endpoint => canonicalSemanticJson(endpoint) === canonicalSemanticJson(ref))) {
        throw new Error('Semantic edge index points to a different endpoint.');
      }
      rows.push(member === 'semantic_lookup' ? { partitionId: stored.ownerPartition, id: row.id, value: row.value }
        : member === 'semantic_records' ? { ...row, ref: { partitionId: stored.ownerPartition, localId: row.id },
          availableFieldGroups: ['span', 'scope', 'data'], omittedFieldGroups: [] } : row);
    }
    if (!rows.length && offset > 0) {
      // Prove offset==end versus offset>end without counting the whole relation.
      throwIfAborted(signal); countStatement();
      if (!plan.predecessor.get(...args, 1, offset - 1)) throw new Error('Related semantic cursor exceeds member rows.');
    }
    return { rows, offset: offset + rows.length, done: !more };
  };
};
