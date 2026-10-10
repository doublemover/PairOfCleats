import { canonicalSemanticJson } from '../index/semantic/identity.js';
import { assertCurrentIndexFormat } from '../contracts/index-format.js';
import { assertSemanticEnvelope } from '../contracts/validators/semantic-envelopes.js';
import { validateSemanticRecord } from '../contracts/validators/semantic.js';
import { assertSqliteIndexFormat } from '../storage/sqlite/index-format.js';
import { throwIfAborted } from '../shared/abort.js';

/** The database handle belongs to a pinned immutable generation. */
export const createSqliteSemanticStore = ({
  db, repoRoot, indexPath, artifactSurfaceVersion, generation, maxRecords = 128
}) => {
  assertSqliteIndexFormat({ db, repoRoot, indexPath, operation: 'semantic_detail' });
  assertCurrentIndexFormat({
    operation: 'semantic_detail', component: 'SQLite artifact surface',
    foundVersion: artifactSurfaceVersion, repoRoot, indexPath
  });
  assertSemanticEnvelope('generation', generation);
  const storedGeneration = db.prepare("SELECT value FROM index_format_meta WHERE key='semanticGeneration'").get();
  if (!storedGeneration || canonicalSemanticJson(JSON.parse(storedGeneration.value)) !== canonicalSemanticJson(generation)) {
    throw Object.assign(new Error('SQLite semantic generation mismatch.'), { code: 'ERR_SEMANTIC_GENERATION_MISMATCH' });
  }
  const statement = db.prepare('SELECT payload FROM semantic_records WHERE partition_id = ? AND local_id = ?');
  const partition = db.prepare('SELECT descriptor FROM semantic_analysis WHERE partition_id = ?');
  const getRecords = async (refs, fields = ['span', 'scope', 'data'], { signal = null } = {}) => {
    if (!Array.isArray(refs) || refs.length > maxRecords) throw new Error('Semantic record request exceeds its limit.');
    if (!Array.isArray(fields) || fields.some((field) => !['span', 'scope', 'data'].includes(field))) {
      throw new Error('Unknown semantic detail field group.');
    }
    const result = [];
    for (const ref of refs) {
      throwIfAborted(signal);
      if (!validateSemanticRecord('recordRef', ref).ok) throw new Error('Invalid semantic RecordRef.');
      if (!partition.get(ref.partitionId)) throw new Error('Record partition is not in the pinned generation.');
      const stored = statement.get(ref.partitionId, ref.localId);
      if (!stored) { result.push(null); continue; }
      const row = JSON.parse(stored.payload);
      if (!validateSemanticRecord('node', row).ok || row.id !== ref.localId) throw new Error('Invalid semantic node.');
      result.push({
        ref, id: row.id, kind: row.kind,
        ...Object.fromEntries(fields.map((field) => [field, row[field]])),
        availableFieldGroups: ['span', 'scope', 'data'],
        omittedFieldGroups: ['span', 'scope', 'data'].filter((field) => !fields.includes(field))
      });
    }
    return result;
  };
  const coverage = db.prepare('SELECT payload FROM semantic_coverage WHERE partition_id = ? ORDER BY ordinal LIMIT 513');
  const getCoverage = async (partitionIds, { signal = null } = {}) => {
    if (partitionIds.length > maxRecords) throw new Error('Coverage request exceeds allowance.');
    const result = [];
    for (const id of new Set(partitionIds)) {
      throwIfAborted(signal);
      for (const row of coverage.all(id)) result.push(JSON.parse(row.payload));
      if (result.length > 512) throw new Error('Coverage response exceeds allowance.');
    }
    return result;
  };
  const physicalPartitions = db.prepare('SELECT partition_id, descriptor FROM semantic_analysis ORDER BY partition_id').all();
  for (const entry of physicalPartitions) assertSemanticEnvelope('partition', JSON.parse(entry.descriptor));
  const relatedQueries = {
    semantic_records: db.prepare("SELECT payload FROM semantic_records WHERE partition_id = ? AND record_kind = 'occurrence' AND json_extract(payload, '$.data.expression.partitionId') = ? AND json_extract(payload, '$.data.expression.localId') = ? ORDER BY rowid LIMIT ? OFFSET ?"),
    semantic_operands: db.prepare('SELECT payload FROM semantic_operands WHERE partition_id = ? AND parent_partition = ? AND parent_id = ? ORDER BY rowid LIMIT ? OFFSET ?'),
    semantic_ownership: db.prepare('SELECT payload FROM semantic_ownership WHERE partition_id = ? AND record_partition = ? AND local_id = ? ORDER BY rowid LIMIT ? OFFSET ?'),
    semantic_lookup: db.prepare('SELECT payload FROM semantic_lookup WHERE partition_id = ? AND partition_id = ? AND local_id = ? ORDER BY rowid LIMIT ? OFFSET ?')
  };
  const relatedCounts = {
    semantic_records: db.prepare("SELECT COUNT(*) AS n FROM semantic_records WHERE partition_id = ? AND record_kind = 'occurrence' AND json_extract(payload, '$.data.expression.partitionId') = ? AND json_extract(payload, '$.data.expression.localId') = ?"),
    semantic_operands: db.prepare('SELECT COUNT(*) AS n FROM semantic_operands WHERE partition_id = ? AND parent_partition = ? AND parent_id = ?'),
    semantic_ownership: db.prepare('SELECT COUNT(*) AS n FROM semantic_ownership WHERE partition_id = ? AND record_partition = ? AND local_id = ?'),
    semantic_lookup: db.prepare('SELECT COUNT(*) AS n FROM semantic_lookup WHERE partition_id = ? AND partition_id = ? AND local_id = ?')
  };
  const getRelatedPage = async (ref, member, { offset = 0, limit = 128, signal = null } = {}) => {
    if (!validateSemanticRecord('recordRef', ref).ok || !partition.get(ref.partitionId)
      || !Object.hasOwn(relatedQueries, member) || !Number.isSafeInteger(offset) || offset < 0
      || !Number.isSafeInteger(limit) || limit < 1 || limit > 512) throw new Error('Invalid related semantic request.');
    const rows = [];
    let remainingOffset = offset, total = 0;
    for (const entry of physicalPartitions) {
      throwIfAborted(signal);
      const count = relatedCounts[member].get(entry.partition_id, ref.partitionId, ref.localId).n;
      total += count;
      if (remainingOffset >= count) { remainingOffset -= count; continue; }
      if (rows.length >= limit) continue;
      const values = relatedQueries[member].all(entry.partition_id, ref.partitionId, ref.localId, limit - rows.length, remainingOffset);
      remainingOffset = 0;
      const descriptor = JSON.parse(entry.descriptor);
      for (const stored of values) {
        throwIfAborted(signal);
        const row = JSON.parse(stored.payload);
        const family = { semantic_records: 'node', semantic_operands: 'operand', semantic_ownership: 'ownership', semantic_lookup: 'lookup' }[member];
        if (!validateSemanticRecord(family, row, { structuralSlots: descriptor.structuralSlots }).ok) throw new Error('Invalid hydrated semantic member.');
        rows.push(member === 'semantic_lookup' ? { partitionId: entry.partition_id, id: row.id, value: row.value }
          : member === 'semantic_records' ? { ...row, ref: { partitionId: entry.partition_id, localId: row.id },
            availableFieldGroups: ['span', 'scope', 'data'], omittedFieldGroups: [] } : row);
      }
    }
    if (offset > total) throw new Error('Related semantic cursor exceeds member rows.');
    return { rows, offset: offset + rows.length, done: offset + rows.length === total };
  };
  return { backend: 'sqlite', storeId: indexPath, repoRoot, generation: { ...generation }, getRecords, getCoverage, getRelatedPage };
};
