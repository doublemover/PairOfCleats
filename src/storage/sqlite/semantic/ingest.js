import { createHash } from 'node:crypto';
import { SEMANTIC_MEMBER_NAMES } from '../../../contracts/schemas/semantic-envelopes.js';
import { canonicalSemanticJson, semanticHash } from '../../../index/semantic/identity.js';
import { throwIfAborted } from '../../../shared/abort.js';
import { assertSemanticEnvelope } from '../../../contracts/validators/semantic-envelopes.js';

const TABLES = ['semantic_records', 'semantic_operands', 'semantic_edges',
  'semantic_ownership', 'semantic_coverage', 'semantic_analysis'];
let savepointSequence = 0;

/**
 * One canonical ingestor for artifact/bundle/incremental callers. The caller owns
 * the outer staging transaction and publication; this savepoint rolls back this
 * complete partition on validation, cancellation or I/O failure.
 */
export const ingestSemanticPartition = async ({ db, store, descriptor, signal = null }) => {
  if (!db.inTransaction) throw new Error('Semantic ingestion requires a caller-owned transaction.');
  assertSemanticEnvelope('partition', descriptor);
  const partitionId = descriptor.partitionId;
  for (const member of ['semantic_lookup', 'semantic_frontier']) {
    if (descriptor.members[member].some((piece) => piece.count !== 0)) {
      throw new Error('Semantic SQLite ingestion does not yet support nonempty ' + member + '.');
    }
  }
  const memberHashes = Object.fromEntries(SEMANTIC_MEMBER_NAMES.map((name) => [name, createHash('sha256')]));
  const readRows = async function* (member) {
    let count = 0;
    for await (const row of store.iterateRows(partitionId, member, { signal })) {
      throwIfAborted(signal);
      memberHashes[member].update(canonicalSemanticJson(row)).update('\n');
      count += 1;
      yield row;
    }
    if (count !== descriptor.members[member].reduce((sum, piece) => sum + piece.count, 0)) {
      throw new Error('Semantic member count mismatch.');
    }
  };
  const savepoint = 'semantic_ingest_' + (++savepointSequence);
  db.exec('SAVEPOINT ' + savepoint);
  try {
    for (const table of TABLES) db.prepare('DELETE FROM ' + table + ' WHERE partition_id = ?').run(partitionId);
    const sourceInsert = db.prepare('INSERT INTO semantic_sources(source_id, byte_hash, payload) VALUES (?, ?, ?) ON CONFLICT(source_id) DO NOTHING');
    const sourceRead = db.prepare('SELECT payload FROM semantic_sources WHERE source_id = ?');
    let sources = 0;
    for await (const row of readRows('semantic_sources')) {
      if (row.sourceUnitId !== descriptor.sourceUnitId) throw new Error('Semantic source/partition mismatch.');
      const payload = canonicalSemanticJson(row);
      const existing = sourceRead.get(row.sourceUnitId);
      if (existing && existing.payload !== payload) throw new Error('Conflicting immutable source identity.');
      sourceInsert.run(row.sourceUnitId, row.byteHash, payload);
      sources += 1;
    }
    if (sources !== 1) throw new Error('Semantic partition requires exactly one source manifest.');
    const insertNode = db.prepare('INSERT INTO semantic_records VALUES (?, ?, ?, ?)');
    let nextNode = 0;
    for await (const row of readRows('semantic_records')) {
      throwIfAborted(signal);
      if (row.id !== nextNode++) throw new Error('Noncontiguous semantic record IDs.');
      insertNode.run(partitionId, row.id, row.kind, canonicalSemanticJson(row));
    }
    const insertOperand = db.prepare('INSERT INTO semantic_operands VALUES (?, ?, ?, ?, ?, ?)');
    for await (const row of readRows('semantic_operands')) {
      insertOperand.run(partitionId, row.parent.partitionId, row.parent.localId,
        row.slot, row.ordinal, canonicalSemanticJson(row));
    }
    const insertEdge = db.prepare('INSERT INTO semantic_edges VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    for await (const row of readRows('semantic_edges')) {
      insertEdge.run(partitionId, row.id, row.kind, row.from.partitionId, row.from.localId,
        row.to.partitionId, row.to.localId, canonicalSemanticJson(row));
    }
    const insertOwner = db.prepare('INSERT INTO semantic_ownership VALUES (?, ?, ?, ?, ?, ?)');
    for await (const row of readRows('semantic_ownership')) {
      insertOwner.run(partitionId, row.recordRef.partitionId, row.recordRef.localId,
        row.chunkUid, row.role, canonicalSemanticJson(row));
    }
    const insertCoverage = db.prepare('INSERT INTO semantic_coverage VALUES (?, ?, ?, ?, ?)');
    let coverageOrdinal = 0;
    for await (const row of readRows('semantic_coverage')) {
      insertCoverage.run(partitionId, coverageOrdinal++, row.phase, row.state, canonicalSemanticJson(row));
    }
    const hashes = Object.fromEntries(SEMANTIC_MEMBER_NAMES.map((name) => [name, memberHashes[name].digest('hex')]));
    const canonicalHash = semanticHash('pairofcleats.semantic.partition-content.v1', {
      partitionId, sourceUnitId: descriptor.sourceUnitId, producerHash: descriptor.producerHash,
      contextHash: descriptor.contextHash, policyHash: descriptor.policyHash, memberHashes: hashes
    });
    if (canonicalHash !== descriptor.canonicalHash) throw new Error('Semantic canonical content hash mismatch.');
    db.prepare('INSERT INTO semantic_analysis VALUES (?, ?, ?, ?)').run(
      partitionId, descriptor.sourceUnitId, descriptor.canonicalHash, canonicalSemanticJson(descriptor)
    );
    throwIfAborted(signal);
    db.exec('RELEASE ' + savepoint);
    return { partitionId, canonicalHash: descriptor.canonicalHash, records: nextNode };
  } catch (error) {
    db.exec('ROLLBACK TO ' + savepoint);
    db.exec('RELEASE ' + savepoint);
    throw error;
  }
};

/** Remove zero-chunk/removed sources by identity inside the caller transaction. */
export const removeSemanticSource = ({ db, sourceUnitId }) => {
  if (!db.inTransaction) throw new Error('Semantic removal requires a caller-owned transaction.');
  const partitions = db.prepare('SELECT partition_id FROM semantic_analysis WHERE source_id = ?').all(sourceUnitId);
  for (const { partition_id: partitionId } of partitions) {
    for (const table of TABLES) db.prepare('DELETE FROM ' + table + ' WHERE partition_id = ?').run(partitionId);
  }
  db.prepare('DELETE FROM semantic_sources WHERE source_id = ?').run(sourceUnitId);
};
