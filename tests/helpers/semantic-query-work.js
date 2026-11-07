import { SEMANTIC_OPERATION_INDEX_VERSION } from '../../src/semantic/source-order.js';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { registerHooks } from 'node:module';
import { canonicalSemanticJson } from '../../src/index/semantic/identity.js';
import { compareQueryIndexRows } from '../../src/semantic/query-index.js';
import { compareOperationIndexRows } from '../../src/semantic/operation-index.js';
import { assertSemanticOperationIndex } from '../../src/contracts/validators/semantic-operation-index.js';
import { createSemanticDiskAccount } from '../../src/index/build/artifacts/writers/semantic/partition.js';
import { semanticWorkDigest } from './semantic-prepared-work.js';

export const createQueryWorkInput = kind => {
  assert.ok(['query', 'operation'].includes(kind));
  const partitionId = 'sy1:' + 'a'.repeat(64);
  const entries = Array.from({ length: 32 }, (_, id) => kind === 'query'
    ? { owner: { partitionId, localId: id }, member: 'semantic_lookup', partitionId, rowOrdinal: id }
    : { field: 'astKind', value: 'CallExpression-' + String(id).padStart(3, '0') + '-界😀', ref: { partitionId, localId: id } });
  return { kind, entries, compare: kind === 'query' ? compareQueryIndexRows : compareOperationIndexRows,
    partitions: [{ partitionId, canonicalHash: 'b'.repeat(64) }], inputDigest: semanticWorkDigest(canonicalSemanticJson(entries)) };
};

/** Reencoding control differs only in the final flush's redundant encoding.
 * Both arms retain current ordering, immutable snapshots, spill/merge and IO. */
export const loadQueryWorkArm = async arm => {
  assert.ok(['encoded', 'reencoded'].includes(arm));
  const owner = new URL('../../src/index/build/artifacts/writers/semantic/query-index.js', import.meta.url);
  owner.searchParams.set('serialization-audit', arm);
  const hooks = registerHooks({ load(url, context, next) {
    const result = next(url, context);
    if (url !== owner.href) return result;
    let source = String(result.source).replaceAll('\r\n', '\n');
    for (const [marker, stage] of [
      ['      const line = canonicalSemanticJson(entry);\n      reserveWork', 'intake'],
      ['              const line = canonicalSemanticJson(entry), bytes', 'merge'],
      ['      const rows = runs.length ?', 'final']
    ]) {
      if (!source.includes(marker)) throw new Error('Query work phase owner changed: ' + stage);
      source = source.replace(marker, `globalThis[Symbol.for('pairofcleats.test.semantic-query-stage')]?.('${stage}');\n` + marker);
    }
    if (arm === 'reencoded') {
      const marker = 'const { line, length } = batch[i];';
      if (!source.includes(marker)) throw new Error('Final query encoded batch owner changed.');
      source = source.replace(marker, 'const { length } = batch[i]; const line = canonicalSemanticJson(JSON.parse(batch[i].line));');
    }
    return { ...result, source };
  } });
  try { return (await import(owner.href)).writeSemanticQueryIndex; }
  finally { hooks.deregister(); }
};

export const queryWorkOptions = (input, extra = {}) => ({
  generation: { baseBuildId: 'query-work-fixture', semanticRevision: 0 }, partitions: input.partitions,
  ...(input.kind === 'operation' ? { compareRows: input.compare, keyForRow: row => row,
    validateIndex: assertSemanticOperationIndex, directoryPrefix: 'semantic-operation-index-', schemaVersion: SEMANTIC_OPERATION_INDEX_VERSION } : {}), ...extra
});

export const readQueryWork = async (root, index) => {
  const pieces = [], rows = [];
  for (const piece of index.pieces) {
    const data = await fs.readFile(path.join(root, piece.path)), offsets = await fs.readFile(path.join(root, piece.offsetsPath));
    assert.equal(semanticWorkDigest(data), piece.hash); assert.equal(semanticWorkDigest(offsets), piece.offsetsHash);
    assert.equal(data.length, piece.bytes); assert.equal(offsets.length, piece.count * 8);
    let position = 0;
    for (const line of data.toString('utf8').trimEnd().split('\n')) {
      assert.equal(Number(offsets.readBigUInt64LE((rows.length - piece.firstRow) * 8)), position);
      rows.push(JSON.parse(line)); position += Buffer.byteLength(line) + 1;
    }
    const { path: physicalPath, offsetsPath: physicalOffsets, ...identity } = piece;
    assert.ok(physicalOffsets.startsWith(path.dirname(physicalPath)));
    pieces.push({ ...identity, data: data.toString('base64'), offsets: offsets.toString('base64') });
  }
  const { pieces: physicalPieces, ...identity } = index;
  return { projection: { ...identity, pieces }, rows };
};

export const writeQueryWork = async (writer, root, input, layout) => {
  assert.ok(['memory', 'merged'].includes(layout));
  const base = createSemanticDiskAccount(16 * 1024 * 1024), metrics = {};
  let diskHighWater = 0;
  const account = { reserve(bytes) { base.reserve(bytes); diskHighWater = Math.max(diskHighWater, base.used); },
    release: bytes => base.release(bytes), get used() { return base.used; } };
  const index = await writer(queryWorkOptions(input, { root, diskAccount: account, entries: [...input.entries].reverse(),
    batchRows: layout === 'memory' ? 64 : 4, batchBytes: 65536, maxOpenRuns: 2, metrics }));
  globalThis[Symbol.for('pairofcleats.test.semantic-query-stage')]?.('observe');
  const read = await readQueryWork(root, index);
  assert.deepEqual(read.rows, input.entries);
  assert.equal(index.rowCount, input.entries.length);
  assert.equal(account.used, index.pieces.reduce((sum, part) => sum + part.bytes + part.count * 8, 0));
  assert.equal(metrics.workingBytes, 0);
  assert.equal(metrics.finalRowsEncoded, input.entries.length);
  assert.ok(metrics.finalEncodedBytesHighWater <= 2 * 65536, 'one bounded encoded batch plus one lookahead row');
  if (layout === 'merged') assert.ok(metrics.mergePasses >= 2);
  else assert.equal(metrics.mergePasses || 0, 0);
  for (const piece of index.pieces) {
    const first = input.entries[piece.firstRow], last = input.entries[piece.firstRow + piece.count - 1];
    assert.deepEqual(piece.firstKey, first); assert.deepEqual(piece.lastKey, last);
  }
  return { ...read, index, metrics, diskBytes: account.used, diskHighWater };
};
