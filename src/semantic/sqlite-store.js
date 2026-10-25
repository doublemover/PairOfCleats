import { captureOperationSelector } from './operation-reader.js';
import { createSourceReferenceReader } from './source-references.js';
import { createNeighborReader } from './neighbors.js';
import { captureSemanticDetailFields, captureSemanticRecordRef, captureSemanticRecordRefs } from './reader-input.js';
import { canonicalSemanticJson, semanticHash } from '../index/semantic/identity.js';
import { assertCurrentIndexFormat } from '../contracts/index-format.js';
import { assertSemanticEnvelope } from '../contracts/validators/semantic-envelopes.js';
import { validateSemanticRecord } from '../contracts/validators/semantic.js';
import { assertSqliteIndexFormat } from '../storage/sqlite/index-format.js';
import { throwIfAborted } from '../shared/abort.js';
import { assertSemanticTask } from '../contracts/validators/semantic-task.js';
import { resolvePublishedSemanticCoverage } from './coverage-resolution.js';
const requestError = message => new Error(message);

/** The database handle belongs to a pinned immutable generation. */
export const createSqliteSemanticStore = ({
  db, repoRoot, indexPath, artifactSurfaceVersion, generation, maxRecords = 128, manifest = null,
  maxRowBytes = 1048576, maxHydrationBytes = maxRowBytes
}) => {
  assertSqliteIndexFormat({ db, repoRoot, indexPath, operation: 'semantic_detail' });
  assertCurrentIndexFormat({
    operation: 'semantic_detail', component: 'SQLite artifact surface',
    foundVersion: artifactSurfaceVersion, repoRoot, indexPath
  });
  assertSemanticEnvelope('generation', generation);
  generation = Object.freeze({ ...generation });
  manifest = manifest ? structuredClone(manifest) : null;
  const storedGeneration = db.prepare("SELECT value FROM index_format_meta WHERE key='semanticGeneration'").get();
  if (!storedGeneration || canonicalSemanticJson(JSON.parse(storedGeneration.value)) !== canonicalSemanticJson(generation)) {
    throw Object.assign(new Error('SQLite semantic generation mismatch.'), { code: 'ERR_SEMANTIC_GENERATION_MISMATCH' });
  }
  if (!Number.isSafeInteger(maxRowBytes) || maxRowBytes < 1 || maxRowBytes > 16 * 1024 * 1024) throw new TypeError('Invalid semantic SQLite row allowance.');
  if (!Number.isSafeInteger(maxHydrationBytes) || maxHydrationBytes < 1 || maxHydrationBytes > 16 * 1024 * 1024) throw new TypeError('Invalid semantic SQLite hydration allowance.');
  const outputLimit = () => Object.assign(new Error('SQLite semantic payload exceeds hydration allowance.'), { code: 'ERR_SEMANTIC_OUTPUT_LIMIT' });
  // SQL admits encoded bytes before exporting text to JavaScript. A window
  // over the selected page also rejects oversized aggregates before hydration;
  // this bounds exported bytes, not SQLite's own native evaluation work.
  const boundedPage = (query, columns = '') => 'SELECT ' + columns + 'length(CAST(payload AS BLOB)) AS payloadBytes, '
    + 'CASE WHEN length(CAST(payload AS BLOB))<=? AND SUM(length(CAST(payload AS BLOB))) OVER ()<=? '
    + 'THEN payload ELSE NULL END AS payload FROM (' + query + ') ORDER BY hydrationOrdinal';
  const createHydration = (metrics = null) => {
    let bytes = 0;
    return {
      allowance: () => Math.min(maxRowBytes, maxHydrationBytes - bytes),
      remaining: () => maxHydrationBytes - bytes,
      parse: stored => {
        if (stored.payload === null || !Number.isSafeInteger(stored.payloadBytes) || stored.payloadBytes < 0
          || stored.payloadBytes > maxRowBytes || stored.payloadBytes > maxHydrationBytes - bytes) throw outputLimit();
        bytes += stored.payloadBytes;
        if (metrics) {
          metrics.hydratedRows = (metrics.hydratedRows || 0) + 1;
          metrics.hydratedBytes = (metrics.hydratedBytes || 0) + stored.payloadBytes;
        }
        try { return JSON.parse(stored.payload); }
        catch (cause) { throw Object.assign(new Error('Invalid SQLite semantic JSON payload.', { cause }), { code: 'ERR_SEMANTIC_INTEGRITY' }); }
      }
    };
  };
  const statement = db.prepare('SELECT length(CAST(payload AS BLOB)) AS payloadBytes, CASE WHEN length(CAST(payload AS BLOB))<=? THEN payload ELSE NULL END AS payload FROM semantic_records WHERE partition_id = ? AND local_id = ?');
  const partition = db.prepare('SELECT descriptor FROM semantic_analysis WHERE partition_id = ?');
  const getRecords = async (refs, fields = ['span', 'scope', 'data'], { signal = null, metrics = null } = {}) => {
    refs = captureSemanticRecordRefs(refs, maxRecords, requestError);
    fields = captureSemanticDetailFields(fields, requestError);
    const result = [];
    const hydration = createHydration(metrics);
    for (const ref of refs) {
      throwIfAborted(signal);
      if (!partition.get(ref.partitionId)) throw new Error('Record partition is not in the pinned generation.');
      const stored = statement.get(hydration.allowance(),ref.partitionId, ref.localId);
      if (!stored) { result.push(null); continue; }
      const row = hydration.parse(stored);
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
  const coverage = db.prepare(boundedPage('SELECT ordinal AS hydrationOrdinal,payload FROM semantic_coverage WHERE partition_id = ? ORDER BY ordinal LIMIT 513'));
  const getCoverage = async (partitionIds, { signal = null, metrics = null } = {}) => {
    if (partitionIds.length > maxRecords) throw new Error('Coverage request exceeds allowance.');
    const result = [];
    const hydration = createHydration(metrics);
    const sources = new Set(partitionIds.map(id => { const row = partition.get(id); return row ? JSON.parse(row.descriptor).sourceUnitId : null; }));
    for (const entry of physicalPartitions.filter(entry => sources.has(JSON.parse(entry.descriptor).sourceUnitId))) {
      const id = entry.partition_id;
      throwIfAborted(signal);
      for (const row of coverage.iterate(maxRowBytes,hydration.remaining(),id)) {
        throwIfAborted(signal);
        const parsed=hydration.parse(row);
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
  const inventoryHashes = rows => [...rows].sort((a,b)=>a.partitionId.localeCompare(b.partitionId));
  const descriptors = physicalPartitions.map(entry=>JSON.parse(entry.descriptor));
  const sourceUnitsByPartition = new Map(descriptors.map(descriptor => [descriptor.partitionId, descriptor.sourceUnitId]));
  if (manifest && (canonicalSemanticJson(manifest.generation)!==canonicalSemanticJson(generation)
    || canonicalSemanticJson(inventoryHashes(manifest.partitions))!==canonicalSemanticJson(inventoryHashes(descriptors)))) {
    throw Object.assign(new Error('SQLite semantic inventory differs from the published family.'),{code:'ERR_SEMANTIC_GENERATION_MISMATCH'});
  }
  const sourceRows = db.prepare('SELECT length(CAST(payload AS BLOB)) AS payloadBytes,CASE WHEN length(CAST(payload AS BLOB))<=? THEN payload ELSE NULL END AS payload FROM semantic_sources WHERE source_id=?');
  const taskRows = db.prepare(boundedPage('SELECT task_id AS hydrationOrdinal,task_id,payload FROM semantic_frontier WHERE partition_id=? AND task_id>? ORDER BY task_id LIMIT ?', 'task_id,'));
  const iterateRows = async function* (partitionId, member, {signal=null,batchRows=1}={}) {
    const stored=partition.get(partitionId);
    if(!stored||!['semantic_sources','semantic_frontier'].includes(member)||!Number.isSafeInteger(batchRows)||batchRows<1||batchRows>maxRecords)throw new TypeError('Invalid SQLite source/frontier request.');
    const descriptor=JSON.parse(stored.descriptor);
    if(member==='semantic_sources'){
      throwIfAborted(signal);const row=sourceRows.get(Math.min(maxRowBytes,maxHydrationBytes),descriptor.sourceUnitId);
      if(!row)throw Object.assign(new Error('SQLite source manifest missing.'),{code:'ERR_SEMANTIC_INTEGRITY'});
      const source=assertSemanticEnvelope('source',createHydration().parse(row));
      if(source.sourceUnitId!==descriptor.sourceUnitId)throw new Error('SQLite source identity mismatch.');
      yield source;return;
    }
    let after='';
    for(;;){
      throwIfAborted(signal);const hydration=createHydration();
      const rows=taskRows.iterate(maxRowBytes,hydration.remaining(),partitionId,after,batchRows);
      let read=0;
      for(const row of rows){
        throwIfAborted(signal);const task=assertSemanticTask(hydration.parse(row));read++;
        if(task.taskId!==row.task_id||task.baseBuildId!==generation.baseBuildId||!task.sourceUnits.includes(descriptor.sourceUnitId))throw new Error('SQLite frontier source/generation mismatch.');
        after=task.taskId;yield task;
      }
      if(!read)return;
    }
  };
  const getSourceReference = createSourceReferenceReader({
    sourceUnitForPartition: id => {
      const stored = partition.get(id);
      return stored ? JSON.parse(stored.descriptor).sourceUnitId : null;
    }, iterateRows
  });
  const getExplainInventory=()=>manifest||{generation,partitions:descriptors,completedTasks:null};
  const incident = 'SELECT rowid, payload FROM semantic_edges INDEXED BY semantic_edges_forward WHERE partition_id = ? AND from_partition = ? AND from_id = ? UNION SELECT rowid, payload FROM semantic_edges INDEXED BY semantic_edges_reverse WHERE partition_id = ? AND to_partition = ? AND to_id = ?';
  const relatedQueries = Object.fromEntries(Object.entries({
    semantic_edges: 'SELECT rowid AS hydrationOrdinal,payload FROM (' + incident + ') ORDER BY rowid LIMIT ? OFFSET ?',
    semantic_records: "SELECT rowid AS hydrationOrdinal,payload FROM semantic_records WHERE partition_id = ? AND record_kind = 'occurrence' AND json_extract(payload, '$.data.expression.partitionId') = ? AND json_extract(payload, '$.data.expression.localId') = ? ORDER BY rowid LIMIT ? OFFSET ?",
    semantic_operands: 'SELECT rowid AS hydrationOrdinal,payload FROM semantic_operands WHERE partition_id = ? AND parent_partition = ? AND parent_id = ? ORDER BY rowid LIMIT ? OFFSET ?',
    semantic_ownership: 'SELECT rowid AS hydrationOrdinal,payload FROM semantic_ownership WHERE partition_id = ? AND record_partition = ? AND local_id = ? ORDER BY rowid LIMIT ? OFFSET ?',
    semantic_lookup: 'SELECT rowid AS hydrationOrdinal,payload FROM semantic_lookup WHERE partition_id = ? AND partition_id = ? AND local_id = ? ORDER BY rowid LIMIT ? OFFSET ?'
  }).map(([member, query]) => [member, db.prepare(boundedPage(query))]));
  const relatedCounts = {
    semantic_edges: db.prepare('SELECT COUNT(*) AS n FROM (' + incident + ')'),
    semantic_records: db.prepare("SELECT COUNT(*) AS n FROM semantic_records WHERE partition_id = ? AND record_kind = 'occurrence' AND json_extract(payload, '$.data.expression.partitionId') = ? AND json_extract(payload, '$.data.expression.localId') = ?"),
    semantic_operands: db.prepare('SELECT COUNT(*) AS n FROM semantic_operands WHERE partition_id = ? AND parent_partition = ? AND parent_id = ?'),
    semantic_ownership: db.prepare('SELECT COUNT(*) AS n FROM semantic_ownership WHERE partition_id = ? AND record_partition = ? AND local_id = ?'),
    semantic_lookup: db.prepare('SELECT COUNT(*) AS n FROM semantic_lookup WHERE partition_id = ? AND partition_id = ? AND local_id = ?')
  };
  const getRelatedPage = async (ref, member, { offset = 0, limit = 128, signal = null, metrics = null } = {}) => {
    ref = captureSemanticRecordRef(ref, requestError);
    if (!partition.get(ref.partitionId)
      || !Object.hasOwn(relatedQueries, member) || !Number.isSafeInteger(offset) || offset < 0
      || !Number.isSafeInteger(limit) || limit < 1 || limit > 512) throw new Error('Invalid related semantic request.');
    const rows = [];
    const hydration = createHydration(metrics);
    let remainingOffset = offset, total = 0;
    for (const entry of physicalPartitions) {
      throwIfAborted(signal);
      const args = [entry.partition_id, ref.partitionId, ref.localId, ...(member === 'semantic_edges' ? [entry.partition_id, ref.partitionId, ref.localId] : [])];
      const count = relatedCounts[member].get(...args).n;
      total += count;
      if (remainingOffset >= count) { remainingOffset -= count; continue; }
      if (rows.length >= limit) continue;
      const values = relatedQueries[member].iterate(maxRowBytes, hydration.remaining(), ...args, limit - rows.length, remainingOffset);
      remainingOffset = 0;
      const descriptor = JSON.parse(entry.descriptor);
      for (const stored of values) {
        throwIfAborted(signal);
        const row = hydration.parse(stored);
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
    selector = captureOperationSelector(selector,offset,limit); throwIfAborted(signal);
    if (['typeExpression', 'literalValue'].includes(selector.field)) {
      if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='semantic_discovery'").get()) {
        throw Object.assign(new Error('Typed/value discovery index unavailable; rebuild the pinned generation.'), { code: 'ERR_SEMANTIC_UNAVAILABLE' });
      }
      const rows = db.prepare('SELECT partition_id,local_id FROM semantic_discovery WHERE field=? AND value=? ORDER BY partition_id,local_id LIMIT ? OFFSET ?')
        .all(selector.field,selector.value,limit+1,offset);
      return { refs: rows.slice(0,limit).map(row => ({partitionId:row.partition_id,localId:row.local_id})),
        offset: offset+Math.min(limit,rows.length),done: rows.length<=limit };
    }
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
  return { findOperations, iterateRows, getExplainInventory, getPartitionSourceUnitId: id => sourceUnitsByPartition.get(id) || null,
    backend: 'sqlite', storeId: indexPath, cursorScope: semanticHash('semantic.store-inventory.v1', physicalPartitions.map(entry => { const descriptor = JSON.parse(entry.descriptor); return { partitionId: descriptor.partitionId, canonicalHash: descriptor.canonicalHash }; })), repoRoot, generation: { ...generation }, getRecords, getSourceReference, getCoverage, getRelatedPage, getNeighbors: createNeighborReader(getRelatedPage) };
};
