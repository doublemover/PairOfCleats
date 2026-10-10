import { retainSemanticSource } from '../../../../semantic/source-storage.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createJsonlBatchWriter } from '../../../../../shared/json-stream/jsonl-batch.js';
import { validateOffsetsAgainstFile } from '../../../../../shared/artifact-io/offsets.js';
import { throwIfAborted } from '../../../../../shared/abort.js';
import { canonicalSemanticJson, semanticHash } from '../../../../semantic/identity.js';
import { validateSemanticRecord } from '../../../../../contracts/validators/semantic.js';
import { assertSemanticEnvelope } from '../../../../../contracts/validators/semantic-envelopes.js';
import { SEMANTIC_MEMBER_NAMES } from '../../../../../contracts/schemas/semantic-envelopes.js';

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
  stagingRoot, source, sourceBytes, partitionId, producerHash, contextHash = null, policyHash,
  structuralSlots = [], diskAccount, batchRows = 4096, batchBytes = 1048576,
  signal = null, byteAdmission = null, scheduleIo = (fn) => fn()
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
  const prefix = path.basename(directory);
  const members = Object.fromEntries(SEMANTIC_MEMBER_NAMES.map((name) => [name, []]));
  const counts = Object.fromEntries(SEMANTIC_MEMBER_NAMES.map((name) => [name, 0]));
  const hashes = Object.fromEntries(SEMANTIC_MEMBER_NAMES.map((name) => [name, createHash('sha256')]));
  let sequence = 0;
  let reserved = 0;
  let closed = false;
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
  const writePart = async (member, rows) => {
    if (!rows.length) return;
    throwIfAborted(signal);
    const buffers = rows.map((row) => Buffer.from(canonicalSemanticJson(row), 'utf8'));
    const bytes = buffers.reduce((sum, buffer) => sum + buffer.length + 1, 0);
    const offsets = Buffer.alloc(rows.length * 8);
    let offset = 0;
    for (let i = 0; i < buffers.length; i += 1) {
      offsets.writeBigUInt64LE(BigInt(offset), i * 8);
      offset += buffers[i].length + 1;
    }
    reserve(bytes + offsets.length);
    const filename = member + '-' + String(members[member].length).padStart(6, '0') + '.jsonl';
    const filePath = path.join(directory, filename);
    const offsetsPath = filePath + '.offsets';
    const hash = createHash('sha256');
    await scheduleIo(async () => {
      const writer = createJsonlBatchWriter(filePath, { signal, compression: null, atomic: false });
      try {
        for (const buffer of buffers) {
          throwIfAborted(signal);
          await writer.writeLine(buffer, buffer.length + 1);
          hash.update(buffer).update('\n');
          hashes[member].update(buffer).update('\n');
        }
        await writer.close();
      } catch (error) {
        await writer.destroy(error);
        throw error;
      }
      const offsetsHandle = await fs.open(offsetsPath, 'wx');
      try { await offsetsHandle.writeFile(offsets); await offsetsHandle.sync(); }
      finally { await offsetsHandle.close(); }
      const dataHandle = await fs.open(filePath, 'r+');
      try { await dataHandle.sync(); } finally { await dataHandle.close(); }
      await validateOffsetsAgainstFile(filePath, offsetsPath);
    });
    throwIfAborted(signal);
    members[member].push({
      path: prefix + '/' + filename, offsetsPath: prefix + '/' + filename + '.offsets',
      hash: hash.digest('hex'), offsetsHash: createHash('sha256').update(offsets).digest('hex'),
      count: rows.length, bytes, firstRow: counts[member]
    });
    counts[member] += rows.length;
  };
  const abort = async () => {
    if (busy) throw fail('Await the active semantic sink operation before aborting.');
    if (closed) return;
    closed = true;
    await fs.rm(directory, { recursive: true, force: true });
    diskAccount.release(reserved);
    reserved = 0;
  };
  const appendBatch = async (batch) => {
    if (closed || busy) throw fail('Semantic sink is closed or already writing.');
    throwIfAborted(signal);
    if (batch.partitionId !== partitionId || batch.sequence !== sequence
      || !Array.isArray(batch.rows) || batch.rows.length > batchRows || !batch.rows.length) {
      throw fail('Invalid semantic producer batch identity, sequence or row count.');
    }
    // Check the complete bounded batch before any write. Long operands are rows,
    // never a reason to erase an argument list or truncate a source payload.
    const measured = batch.rows.reduce((sum, entry) => sum + Buffer.byteLength(canonicalSemanticJson(entry)) + 1, 0);
    if (measured > batchBytes || batch.byteCount !== measured) throw fail('Semantic batch byte limit/count mismatch.');
    const groups = Object.fromEntries(Object.values(MEMBERS).map((name) => [name, []]));
    let nextNode = counts.semantic_records;
    let nextEdge = edgeId;
    for (const { family, row } of batch.rows) {
      if (!Object.hasOwn(MEMBERS, family)) throw fail('Unsupported semantic row family: ' + family);
      const validation = validateSemanticRecord(family, row, { sourceLength: source.textLength, structuralSlots });
      if (!validation.ok) throw fail(validation.errors.join('; '));
      if (family === 'node' && row.id !== nextNode++) throw fail('Semantic nodes must have contiguous preorder IDs.');
      if (family === 'edge' && row.id !== nextEdge++) throw fail('Analysis edges must have contiguous IDs.');
      groups[MEMBERS[family]].push(row);
    }
    for (const { family, row } of batch.rows) inspectReferences(family, row);
    busy = true;
    let release = null;
    try {
      release = await byteAdmission?.acquire(measured, { signal });
      for (const [member, rows] of Object.entries(groups)) await writePart(member, rows);
      edgeId = nextEdge;
      sequence += 1;
    } catch (error) {
      busy = false;
      await abort();
      throw error;
    } finally { release?.(); busy = false; }
  };
  const finalizeSource = async () => {
    if (closed || busy) throw fail('Semantic sink is closed or already writing.');
    throwIfAborted(signal);
    if (maxLocalReference >= counts.semantic_records) throw fail('Dangling local semantic reference.');
    busy = true;
    try {
      await retainSemanticSource({ root: stagingRoot, source, bytes: sourceBytes, diskAccount, signal });
      await writePart('semantic_sources', [source]);
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
      throwIfAborted(signal);
      closed = true;
      return descriptor;
    } catch (error) {
      busy = false;
      await abort();
      throw error;
    } finally { busy = false; }
  };
  return { appendBatch, finalizeSource, abort };
};
