import { validateOperationSelector } from './operation-reader.js';
import { createNeighborReader } from './neighbors.js';
import { canonicalSemanticJson, semanticHash } from '../index/semantic/identity.js';
import { assertCurrentIndexFormat } from '../contracts/index-format.js';
import { assertSemanticEnvelope } from '../contracts/validators/semantic-envelopes.js';
import { validateSemanticRecord } from '../contracts/validators/semantic.js';
import { assertSqliteIndexFormat } from '../storage/sqlite/index-format.js';
import { throwIfAborted } from '../shared/abort.js';
import { assertSemanticTask } from '../contracts/validators/semantic-task.js';
import { resolvePublishedSemanticCoverage } from './coverage-resolution.js';

/** The database handle belongs to a pinned immutable generation. */
export const createSqliteSemanticStore = ({
  db, repoRoot, indexPath, artifactSurfaceVersion, generation, maxRecords = 128, manifest = null, maxRowBytes = 1048576
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
  if (!Number.isSafeInteger(maxRowBytes) || maxRowBytes < 1 || maxRowBytes > 16 * 1024 * 1024) throw new TypeError('Invalid semantic SQLite row allowance.');
  const statement = db.prepare('SELECT CASE WHEN length(CAST(payload AS BLOB))<=? THEN payload ELSE NULL END AS payload FROM semantic_records WHERE partition_id = ? AND local_id = ?');
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
      const stored = statement.get(maxRowBytes,ref.partitionId, ref.localId);
      if (!stored) { result.push(null); continue; }
      if (stored.payload === null) throw Object.assign(new Error('SQLite semantic record exceeds hydration allowance.'),{code:'ERR_SEMANTIC_OUTPUT_LIMIT'});
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
  const coverage = db.prepare('SELECT CASE WHEN length(CAST(payload AS BLOB))<=? THEN payload ELSE NULL END AS payload FROM semantic_coverage WHERE partition_id = ? ORDER BY ordinal LIMIT 513');
  const getCoverage = async (partitionIds, { signal = null } = {}) => {
    if (partitionIds.length > maxRecords) throw new Error('Coverage request exceeds allowance.');
    const result = [];
    const sources = new Set(partitionIds.map(id => { const row = partition.get(id); return row ? JSON.parse(row.descriptor).sourceUnitId : null; }));
    for (const entry of physicalPartitions.filter(entry => sources.has(JSON.parse(entry.descriptor).sourceUnitId))) {
      const id = entry.partition_id;
      throwIfAborted(signal);
      for (const row of coverage.all(maxRowBytes,id)) {
        if (row.payload===null) throw Object.assign(new Error('SQLite coverage row exceeds hydration allowance.'),{code:'ERR_SEMANTIC_OUTPUT_LIMIT'});
        const parsed=JSON.parse(row.payload);
        if(!validateSemanticRecord('coverage',parsed).ok)throw new Error('Invalid SQLite coverage row.');
        result.push({...parsed,partitionId:id});
      }
      if (result.length > 512) throw new Error('Coverage response exceeds allowance.');
    }
    return resolvePublishedSemanticCoverage(result,{generation,completedTasks:manifest?.completedTasks,
      sourceForPartition:id=>{const row=partition.get(id);return row?JSON.parse(row.descriptor).sourceUnitId:null;}});
  };
  const metadata=db.prepare('SELECT COUNT(*) AS count,COALESCE(SUM(length(CAST(descriptor AS BLOB))),0) AS bytes FROM semantic_analysis').get();
  if(metadata.count>100000||metadata.bytes>32*1024*1024)throw Object.assign(new Error('SQLite partition metadata exceeds query allowance.'),{code:'ERR_SEMANTIC_OUTPUT_LIMIT'});
  const physicalPartitions = db.prepare('SELECT partition_id, descriptor FROM semantic_analysis ORDER BY partition_id').all();
  for (const entry of physicalPartitions) assertSemanticEnvelope('partition', JSON.parse(entry.descriptor));
  if (!Number.isSafeInteger(maxRowBytes) || maxRowBytes < 1 || maxRowBytes > 16 * 1024 * 1024) throw new TypeError('Invalid semantic SQLite row allowance.');
  const inventoryHashes = rows => [...rows].sort((a,b)=>a.partitionId.localeCompare(b.partitionId));
  const descriptors = physicalPartitions.map(entry=>JSON.parse(entry.descriptor));
  if (manifest && (canonicalSemanticJson(manifest.generation)!==canonicalSemanticJson(generation)
    || canonicalSemanticJson(inventoryHashes(manifest.partitions))!==canonicalSemanticJson(inventoryHashes(descriptors)))) {
    throw Object.assign(new Error('SQLite semantic inventory differs from the published family.'),{code:'ERR_SEMANTIC_GENERATION_MISMATCH'});
  }
  const sourceRows = db.prepare('SELECT payload FROM semantic_sources WHERE source_id=? AND length(CAST(payload AS BLOB))<=?');
  const taskRows = db.prepare('SELECT task_id,CASE WHEN length(CAST(payload AS BLOB))<=? THEN payload ELSE NULL END AS payload FROM semantic_frontier WHERE partition_id=? AND task_id>? ORDER BY task_id LIMIT ?');
  const iterateRows = async function* (partitionId, member, {signal=null,batchRows=1}={}) {
    const stored=partition.get(partitionId);
    if(!stored||!['semantic_sources','semantic_frontier'].includes(member)||!Number.isSafeInteger(batchRows)||batchRows<1||batchRows>maxRecords)throw new TypeError('Invalid SQLite source/frontier request.');
    const descriptor=JSON.parse(stored.descriptor);
    if(member==='semantic_sources'){
      throwIfAborted(signal);const row=sourceRows.get(descriptor.sourceUnitId,maxRowBytes);
      if(!row)throw Object.assign(new Error('SQLite source manifest missing or exceeds row allowance.'),{code:'ERR_SEMANTIC_INTEGRITY'});
      const source=assertSemanticEnvelope('source',JSON.parse(row.payload));
      if(source.sourceUnitId!==descriptor.sourceUnitId)throw new Error('SQLite source identity mismatch.');
      yield source;return;
    }
    let after='';
    for(;;){
      throwIfAborted(signal);const rows=taskRows.all(maxRowBytes,partitionId,after,batchRows);if(!rows.length)return;
      for(const row of rows){
        throwIfAborted(signal);if(row.payload===null)throw new Error('SQLite frontier row allowance exceeded.');
        const task=assertSemanticTask(JSON.parse(row.payload));
        if(task.taskId!==row.task_id||task.baseBuildId!==generation.baseBuildId||!task.sourceUnits.includes(descriptor.sourceUnitId))throw new Error('SQLite frontier source/generation mismatch.');
        after=task.taskId;yield task;
      }
    }
  };
  const getExplainInventory=()=>manifest||{generation,partitions:descriptors,completedTasks:null};
  const incident = 'SELECT rowid, payload FROM semantic_edges INDEXED BY semantic_edges_forward WHERE partition_id = ? AND from_partition = ? AND from_id = ? UNION SELECT rowid, payload FROM semantic_edges INDEXED BY semantic_edges_reverse WHERE partition_id = ? AND to_partition = ? AND to_id = ?';
  const relatedQueries = {
    semantic_edges: db.prepare('SELECT payload FROM (' + incident + ') ORDER BY rowid LIMIT ? OFFSET ?'),
    semantic_records: db.prepare("SELECT payload FROM semantic_records WHERE partition_id = ? AND record_kind = 'occurrence' AND json_extract(payload, '$.data.expression.partitionId') = ? AND json_extract(payload, '$.data.expression.localId') = ? ORDER BY rowid LIMIT ? OFFSET ?"),
    semantic_operands: db.prepare('SELECT payload FROM semantic_operands WHERE partition_id = ? AND parent_partition = ? AND parent_id = ? ORDER BY rowid LIMIT ? OFFSET ?'),
    semantic_ownership: db.prepare('SELECT payload FROM semantic_ownership WHERE partition_id = ? AND record_partition = ? AND local_id = ? ORDER BY rowid LIMIT ? OFFSET ?'),
    semantic_lookup: db.prepare('SELECT payload FROM semantic_lookup WHERE partition_id = ? AND partition_id = ? AND local_id = ? ORDER BY rowid LIMIT ? OFFSET ?')
  };
  const relatedCounts = {
    semantic_edges: db.prepare('SELECT COUNT(*) AS n FROM (' + incident + ')'),
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
      const args = [entry.partition_id, ref.partitionId, ref.localId, ...(member === 'semantic_edges' ? [entry.partition_id, ref.partitionId, ref.localId] : [])];
      const count = relatedCounts[member].get(...args).n;
      total += count;
      if (remainingOffset >= count) { remainingOffset -= count; continue; }
      if (rows.length >= limit) continue;
      const values = relatedQueries[member].all(...args, limit - rows.length, remainingOffset);
      remainingOffset = 0;
      const descriptor = JSON.parse(entry.descriptor);
      for (const stored of values) {
        throwIfAborted(signal);
        const row = JSON.parse(stored.payload);
        const family = { semantic_edges: 'edge', semantic_records: 'node', semantic_operands: 'operand', semantic_ownership: 'ownership', semantic_lookup: 'lookup' }[member];
        if (!validateSemanticRecord(family, row, { structuralSlots: descriptor.structuralSlots }).ok) throw new Error('Invalid hydrated semantic member.');
        if (member === 'semantic_edges' && ![row.from, row.to].some(endpoint => canonicalSemanticJson(endpoint) === canonicalSemanticJson(ref))) throw new Error('Semantic edge index points to a different endpoint.');
        rows.push(member === 'semantic_lookup' ? { partitionId: entry.partition_id, id: row.id, value: row.value }
          : member === 'semantic_records' ? { ...row, ref: { partitionId: entry.partition_id, localId: row.id },
            availableFieldGroups: ['span', 'scope', 'data'], omittedFieldGroups: [] } : row);
      }
    }
    if (offset > total) throw new Error('Related semantic cursor exceeds member rows.');
    return { rows, offset: offset + rows.length, done: offset + rows.length === total };
  };
  const findOperations = async (selector, { offset = 0, limit = 128, signal = null } = {}) => {
    validateOperationSelector(selector,offset,limit); throwIfAborted(signal);
    const fields = { astKind: '$.data.astKind', operation: '$.data.operation', invocationKind: '$.data.invocationKind' };
    const sql = selector.field === 'chunkUid'
      ? "SELECT DISTINCT r.partition_id,r.local_id FROM semantic_ownership o JOIN semantic_records r ON r.partition_id=o.record_partition AND r.local_id=o.local_id WHERE o.chunk_uid=? AND r.record_kind='expression' ORDER BY r.partition_id,r.local_id LIMIT ? OFFSET ?"
      : selector.field === 'sourceUnitId' || selector.field === 'sourcePath'
        ? "SELECT r.partition_id,r.local_id FROM semantic_analysis a JOIN semantic_records r ON r.partition_id=a.partition_id "
          + (selector.field === 'sourcePath' ? "JOIN semantic_sources s ON s.source_id=a.source_id WHERE json_extract(s.payload,'$.path')=?" : "WHERE a.source_id=?")
          + " AND r.record_kind='expression' ORDER BY r.partition_id,r.local_id LIMIT ? OFFSET ?"
        : "SELECT partition_id,local_id FROM semantic_records WHERE record_kind='expression' AND json_extract(payload,'" + fields[selector.field] + "')=? ORDER BY partition_id,local_id LIMIT ? OFFSET ?";
    const rows = db.prepare(sql).all(selector.value,limit+1,offset);
    return { refs: rows.slice(0,limit).map(row => ({partitionId:row.partition_id,localId:row.local_id})),offset:offset+Math.min(limit,rows.length),done:rows.length<=limit };
  };
  return { findOperations, iterateRows, getExplainInventory, backend: 'sqlite', storeId: indexPath, cursorScope: semanticHash('semantic.store-inventory.v1', physicalPartitions.map(entry => { const descriptor = JSON.parse(entry.descriptor); return { partitionId: descriptor.partitionId, canonicalHash: descriptor.canonicalHash }; })), repoRoot, generation: { ...generation }, getRecords, getCoverage, getRelatedPage, getNeighbors: createNeighborReader(getRelatedPage) };
};
