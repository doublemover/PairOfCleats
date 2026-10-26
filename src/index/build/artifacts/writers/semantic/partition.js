import { readPreparedSemanticBatchEntry } from '../../../../semantic/prepared-batch.js';
import { syncParentDirectory } from '../../../../../shared/io/persistence-helpers.js';
import { retainSemanticSource } from '../../../../semantic/source-storage.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createSemanticPartBuilders } from './part-builder.js';
import { throwIfAborted } from '../../../../../shared/abort.js';
import { canonicalSemanticJson, semanticHash } from '../../../../semantic/identity.js';
import { validateSemanticRecord } from '../../../../../contracts/validators/semantic.js';
import { assertSemanticEnvelope } from '../../../../../contracts/validators/semantic-envelopes.js';
import { SEMANTIC_MEMBER_NAMES } from '../../../../../contracts/schemas/semantic-envelopes.js';
import { observeStorageResource } from '../../../../../shared/storage/failure-observation.js';
import { addStorageFailureContext } from '../../../../../shared/storage/operation-error.js';

const MEMBERS = Object.freeze({
  lookup: 'semantic_lookup', node: 'semantic_records', operand: 'semantic_operands', edge: 'semantic_edges',
  coverage: 'semantic_coverage', ownership: 'semantic_ownership', frontier: 'semantic_frontier'
});
const fail = (message, code = 'ERR_SEMANTIC_CONTRACT') => Object.assign(new Error(message), { code });
const checkedBytes = (value) => {
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError('Expected nonnegative safe byte count.');
  return value;
};

/** Shared accounting object: callers must reuse it for staging, merge and final parts. */
export const createSemanticDiskAccount = (limit) => {
  checkedBytes(limit);
  let used = 0;
  return {
    reserve(bytes) {
      checkedBytes(bytes);
      if (bytes > limit - used) throw fail('Semantic disk working set exhausted.', 'ERR_SEMANTIC_DISK_LIMIT');
      used += bytes;
    },
    release(bytes) {
      checkedBytes(bytes);
      if (bytes > used) throw new Error('Semantic disk accounting underflow.');
      used -= bytes;
    },
    get used() { return used; },
    limit
  };
};

/**
 * Write bounded, completed immutable staging parts. A descriptor is returned only
 * after all data/offset writes and fsyncs finish. The existing generation publisher
 * owns promotion; this sink never changes a live pointer or overwrites a part.
 */
export const createSemanticPartitionSink = async ({
  stagingRoot, source, sourceBytes, sourceCapability = null, partitionId, producerHash, contextHash = null, policyHash,
  structuralSlots = [], diskAccount, batchRows = 4096, batchBytes = 1048576,
  signal = null, byteAdmission = null, scheduleIo = (fn) => fn(), metrics = {}
}) => {
  assertSemanticEnvelope('source', source);
  if (!(sourceBytes instanceof Uint8Array)) throw new TypeError('Exact source bytes are required.');
  if (!/^(sy1|sa1):[a-f0-9]{64}$/.test(partitionId)) throw fail('Invalid partition identity.');
  if (!diskAccount || typeof diskAccount.reserve !== 'function') throw new TypeError('Shared disk account required.');
  for (const value of [batchRows, batchBytes]) {
    if (!Number.isSafeInteger(value) || value <= 0) throw new TypeError('Batch limits must be positive safe integers.');
  }
  await fs.mkdir(stagingRoot, { recursive: true });
  const directory = await fs.mkdtemp(path.toNamespacedPath(path.join(stagingRoot, 'semantic-part-')));
  try { await syncParentDirectory(directory); } catch (error) {
    try { await fs.rm(directory, { recursive: true, force: true }); } catch (cleanupError) { error.cleanupError = cleanupError; }
    throw error;
  }
  const prefix = path.basename(directory);
  const members = Object.fromEntries(SEMANTIC_MEMBER_NAMES.map((name) => [name, []]));
  const counts = Object.fromEntries(SEMANTIC_MEMBER_NAMES.map((name) => [name, 0]));
  const hashes = Object.fromEntries(SEMANTIC_MEMBER_NAMES.map((name) => [name, createHash('sha256')]));
  let sequence = 0;
  let reserved = 0;
  let closed = false;
  let failed = null;
  let busy = false;
  let maxLocalReference = -1;
  let edgeId = 0;
  const reserve = (bytes) => { diskAccount.reserve(bytes); reserved += bytes; };
  const inspectRef = (ref) => {
    if (ref?.partitionId === partitionId) maxLocalReference = Math.max(maxLocalReference, ref.localId);
  };
  const inspectReferences = (family, row) => {
    if (family === 'node') {
      inspectRef(row.scope);
      for (const key of ['parent', 'owner', 'initializer', 'typeSyntax', 'expression',
        'occurrence', 'site', 'storage', 'invocation']) inspectRef(row.data[key]);
    } else {
      for (const key of ['parent', 'child', 'from', 'to', 'callSite', 'condition',
        'evidence', 'recordRef', 'scope']) inspectRef(row[key]);
    }
  };
  const builders = createSemanticPartBuilders({ directory, prefix, members, counts, hashes, reserve,
    batchRows, batchBytes, scheduleIo, signal, metrics });
  const abort = async () => {
    if (busy) throw fail('Await the active semantic sink operation before aborting.');
    if (closed) return;
    await builders.closeForAbort();
    await fs.rm(directory, { recursive: true, force: true });
    diskAccount.release(reserved);
    reserved = 0; closed = true;
  };
  const appendBatch = async (batch) => {
    if (closed || busy || failed) throw failed || fail('Semantic sink is closed or already writing.');
    throwIfAborted(signal);
    if (batch.partitionId !== partitionId || batch.sequence !== sequence
      || !Array.isArray(batch.rows) || batch.rows.length > batchRows || !batch.rows.length) {
      throw fail('Invalid semantic producer batch identity, sequence or row count.');
    }
    // Check the complete bounded batch before any write. Long operands are rows,
    // never a reason to erase an argument list or truncate a source payload.
    const prepared = [];
    let measured = 0;
    for (const entry of batch.rows) {
      const owned = readPreparedSemanticBatchEntry(entry);
      if (owned) {
        measured += owned.byteCount;
        if (measured > batchBytes) throw fail('Semantic batch byte limit/count mismatch.');
        prepared.push({ family: entry.family, row: entry.row, payload: Buffer.from(owned.rowJson, 'utf8') });
        continue;
      }
      const descriptor = Object.getOwnPropertyDescriptor(entry, 'row');
      if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw fail('Semantic row getters are not JSON.');
      const row = descriptor.value;
      let payload = null;
      const envelope = canonicalSemanticJson(entry, {
        onObjectEncoded: (value, encoded) => { if (value === row) payload = Buffer.from(encoded, 'utf8'); }
      });
      measured += Buffer.byteLength(envelope) + 1;
      if (measured > batchBytes) throw fail('Semantic batch byte limit/count mismatch.');
      if (!payload) throw fail('Semantic batch row must be an explicit JSON object.');
      prepared.push({ family: entry.family, row, payload });
    }
    if (measured > batchBytes || batch.byteCount !== measured) throw fail('Semantic batch byte limit/count mismatch.');
    const groups = Object.fromEntries(Object.values(MEMBERS).map((name) => [name, []]));
    let nextNode = counts.semantic_records;
    let nextEdge = edgeId;
    for (const { family, row, payload } of prepared) {
      if (!Object.hasOwn(MEMBERS, family)) throw fail('Unsupported semantic row family: ' + family);
      const validation = validateSemanticRecord(family, row, { sourceLength: source.textLength, structuralSlots });
      if (!validation.ok) throw fail(validation.errors.join('; '));
      if (family === 'node' && row.id !== nextNode++) throw fail('Semantic nodes must have contiguous preorder IDs.');
      if (family === 'edge' && row.id !== nextEdge++) throw fail('Analysis edges must have contiguous IDs.');
      groups[MEMBERS[family]].push(payload);
    }
    for (const { family, row } of prepared) inspectReferences(family, row);
    busy = true;
    let release = null;
    try {
      release = await byteAdmission?.acquire(measured, { signal });
      for (const [member, rows] of Object.entries(groups)) await builders.append(member, rows);
      edgeId = nextEdge;
      sequence += 1; metrics.batchesAcknowledged = sequence;
    } catch (error) {
      busy = false; failed = error;
      try { await abort(); } catch (cleanupError) {
        try { if (error && typeof error === 'object') error.cleanupError = cleanupError; } catch {}
      }
      throw error;
    } finally {
      busy = false;
      try { release?.(); } catch (releaseError) {
        if (!failed) throw releaseError;
        try { failed.releaseError = releaseError; } catch {}
      }
    }
  };
  const finalizeSource = async () => {
    if (closed || busy || failed) throw failed || fail('Semantic sink is closed or already writing.');
    throwIfAborted(signal);
    if (maxLocalReference >= counts.semantic_records) throw fail('Dangling local semantic reference.');
    busy = true;
    try {
      await retainSemanticSource({ root: stagingRoot, source, bytes: sourceBytes, sourceCapability, diskAccount, signal });
      await builders.append('semantic_sources', [Buffer.from(canonicalSemanticJson(source), 'utf8')]);
      await builders.finish();
      const memberHashes = Object.fromEntries(SEMANTIC_MEMBER_NAMES.map((name) => [name, hashes[name].digest('hex')]));
      const descriptor = {
        schemaVersion: 1, semanticSchemaVersion: 1, partitionId, sourceUnitId: source.sourceUnitId,
        producerHash, contextHash, policyHash, structuralSlots,
        canonicalHash: semanticHash('pairofcleats.semantic.partition-content.v1', {
          partitionId, sourceUnitId: source.sourceUnitId, producerHash, contextHash, policyHash, memberHashes
        }),
        members
      };
      assertSemanticEnvelope('partition', descriptor);
      await syncParentDirectory(directory);
      throwIfAborted(signal);
      closed = true;
      return descriptor;
    } catch (error) {
      busy = false; failed = error;
      try { await abort(); } catch (cleanupError) {
        try { if (error && typeof error === 'object') error.cleanupError = cleanupError; } catch {}
      }
      throw error;
    } finally { busy = false; }
  };
  return { appendBatch, finalizeSource, abort };
};

/** Preserve the producer failure while still awaiting all owned cleanup. */
export const abortSemanticPartitionOnFailure = async (sink, error) => {
  const observation = observeStorageResource(error, { phase: 'semantic-partition-failure' });
  const retained = observation.retain();
  try { await sink?.abort(); } catch (cleanupError) {
    throw addStorageFailureContext(retained, {}, cleanupError, { secondaryPresent: true });
  }
  observation.requireSettled();
  throw error;
};
