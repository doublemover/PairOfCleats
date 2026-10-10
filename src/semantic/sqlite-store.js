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
  if (!storedGeneration || JSON.stringify(JSON.parse(storedGeneration.value)) !== JSON.stringify(generation)) {
    throw Object.assign(new Error('SQLite semantic generation mismatch.'), { code: 'ERR_SEMANTIC_GENERATION_MISMATCH' });
  }
  const statement = db.prepare('SELECT payload FROM semantic_records WHERE partition_id = ? AND local_id = ?');
  const partition = db.prepare('SELECT partition_id FROM semantic_analysis WHERE partition_id = ?');
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
  return { repoRoot, generation: { ...generation }, getRecords, getCoverage };
};
