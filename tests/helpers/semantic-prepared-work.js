import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createSemanticSourceSnapshot } from '../../src/index/semantic/source.js';
import { createSyntaxPartitionId, canonicalSemanticJson } from '../../src/index/semantic/identity.js';
import { prepareSemanticProducerEntry, semanticBatchEntryBytes } from '../../src/index/semantic/prepared-batch.js';
import { createSemanticPartitionSink, createSemanticDiskAccount } from '../../src/index/build/artifacts/writers/semantic/partition.js';
import { semanticNode } from './semantic-recovery.js';

export const semanticWorkDigest = value => createHash('sha256').update(value).digest('hex');
export const createPreparedWorkInput = shape => {
  assert.ok(['small', 'nodes', 'operands', 'mixed'].includes(shape));
  const literal = 'quoted " slash \\ newline\n界😀 '.repeat(256);
  const text = shape === 'operands' ? `f(${Array.from({ length: 32 }, () => JSON.stringify(literal)).join(',')});` : 'f();\n'.repeat(512);
  const bytes = Buffer.from(text);
  const { manifest: source, sourceCapability } = createSemanticSourceSnapshot({ bytes,
    repositoryNamespace: 'fixture:prepared-work', path: 'input.js', language: 'javascript' });
  const partitionId = createSyntaxPartitionId({ sourceUnitId: source.sourceUnitId,
    parser: { family: 'fixture', version: '1', options: {} }, extractor: { schemaVersion: 1, version: '1' }, structuralPolicy: { structure: 'complete' } });
  const ref = localId => ({ partitionId, localId });
  let rows;
  if (shape === 'operands') {
    const call = semanticNode(0, source.textLength);
    Object.assign(call.row.data, { astKind: 'CallExpression', invocationKind: 'call', syntacticArgumentCount: 32 });
    rows = [call, ...Array.from({ length: 32 }, (_, ordinal) => ({ family: 'node', row: {
      id: ordinal + 1, kind: 'literal', span: [0, source.textLength], scope: null,
      data: { literalKind: 'string', textRef: { span: [0, source.textLength] }, scalar: { type: 'string', representation: literal } }
    } })), ...Array.from({ length: 32 }, (_, ordinal) => ({ family: 'operand', row: {
      parent: ref(0), slot: 'argument', ordinal, child: ref(ordinal + 1), flags: []
    } }))];
  } else {
    const count = shape === 'small' ? 8 : shape === 'nodes' ? 512 : 128;
    rows = Array.from({ length: count }, (_, id) => semanticNode(id, source.textLength));
    if (shape === 'mixed') rows.push(
      ...Array.from({ length: count }, (_, id) => ({ family: 'lookup', row: { kind: 'name', id, value: `name${id}_界😀` } })),
      ...Array.from({ length: count }, (_, id) => ({ family: 'ownership', row: { recordRef: ref(id), chunkUid: `fixture-chunk-${id}`, role: 'primary' } })),
      ...Array.from({ length: 64 }, (_, id) => ({ family: 'edge', row: { id, kind: 'flowsTo', from: ref(id), to: ref(id + 1),
        callSite: null, operandOrdinal: null, contextKey: null, condition: null, evidence: null, certainty: 'modeled' } })),
      { family: 'coverage', row: { scope: { sourceUnitId: source.sourceUnitId }, phase: 'syntax', state: 'complete',
        reason: null, observedCount: count, completedCount: count, frontierRef: null } }
    );
  }
  return { bytes, source, sourceCapability, partitionId, rows,
    inputDigest: semanticWorkDigest(canonicalSemanticJson({ source, rows })) };
};

/** Actual current sink, with its trusted prepared or untrusted plain-row path.
 * Only physical mkdtemp names differ; every payload, offset and identity agrees. */
export const writePreparedWork = async (root, input, arm, { phase = () => {}, mutate = null, shortWrites = false } = {}) => {
  assert.ok(['prepared', 'plain'].includes(arm));
  const account = createSemanticDiskAccount(16 * 1024 * 1024), metrics = {};
  const sink = await createSemanticPartitionSink({ stagingRoot: root, source: input.source, sourceBytes: input.bytes,
    sourceCapability: input.sourceCapability, partitionId: input.partitionId, producerHash: 'a'.repeat(64), policyHash: 'b'.repeat(64),
    diskAccount: account, metrics, batchRows: 64, batchBytes: 65536,
    byteAdmission: mutate ? { async acquire() { mutate(); return () => {}; } } : null });
  const originalOpen = fs.open;
  if (shortWrites) fs.open = async (...args) => {
    const handle = await originalOpen(...args);
    if (String(args[0]).endsWith('.building')) {
      const write = handle.write.bind(handle);
      handle.write = (buffer, offset, length, position) => write(buffer, offset, Math.max(1, Math.floor(length / 2)), position);
    }
    return handle;
  };
  let batch = [], byteCount = 0, sequence = 0;
  const flush = async () => {
    if (!batch.length) return;
    phase('sink'); await sink.appendBatch({ partitionId: input.partitionId, sequence: sequence++, rows: batch, byteCount });
    batch = []; byteCount = 0;
  };
  try {
    for (const row of input.rows) {
      phase('producer');
      const entry = arm === 'prepared' ? prepareSemanticProducerEntry(row, 65536) : row;
      const bytes = arm === 'prepared' ? semanticBatchEntryBytes(entry) : Buffer.byteLength(canonicalSemanticJson(entry)) + 1;
      if (batch.length && (batch.length >= 64 || byteCount + bytes > 65536)) await flush();
      batch.push(entry); byteCount += bytes;
    }
    await flush(); phase('finalize');
    const descriptor = await sink.finalizeSource(); phase('observe');
    const members = {};
    for (const [member, pieces] of Object.entries(descriptor.members)) members[member] = await Promise.all(pieces.map(async piece => {
      const data = await fs.readFile(path.join(root, piece.path)), offsets = await fs.readFile(path.join(root, piece.offsetsPath));
      assert.equal(semanticWorkDigest(data), piece.hash); assert.equal(semanticWorkDigest(offsets), piece.offsetsHash);
      assert.equal(data.length, piece.bytes); assert.equal(offsets.length, piece.count * 8);
      const { path: physicalPath, offsetsPath: physicalOffsets, ...identity } = piece;
      assert.ok(physicalPath.startsWith('semantic-part-') && physicalOffsets === physicalPath + '.offsets');
      return { identity, data: data.toString('base64'), offsets: offsets.toString('base64') };
    }));
    return { descriptor, projection: { schemaVersion: descriptor.schemaVersion, semanticSchemaVersion: descriptor.semanticSchemaVersion,
      partitionId: descriptor.partitionId, sourceUnitId: descriptor.sourceUnitId, producerHash: descriptor.producerHash,
      contextHash: descriptor.contextHash, policyHash: descriptor.policyHash, structuralSlots: descriptor.structuralSlots,
      canonicalHash: descriptor.canonicalHash, members }, metrics, diskBytes: account.used, account };
  } catch (error) { await sink.abort(); throw error; }
  finally { fs.open = originalOpen; }
};
