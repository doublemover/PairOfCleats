import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createSemanticDiskAccount } from '../../../src/index/build/artifacts/writers/semantic/partition.js';
import { writeSemanticQueryIndex } from '../../../src/index/build/artifacts/writers/semantic/query-index.js';
import { openJsonlRowReader } from '../../../src/shared/artifact-io/offsets.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = resolveTestCachePath(process.cwd(), 'ordered-evidence-parts-disk-admission');
await fs.rm(root, { recursive: true, force: true }); await fs.mkdir(root, { recursive: true });
const rows = Array.from({ length: 30 }, (_, index) => ({ schemaVersion: 1, graph: 'callGraph', from: 'caller',
  to: 'target-' + String(index).padStart(4, '0') }));
const options = { generation: null, partitions: [], store: null, batchRows: 3, batchBytes: 512,
  directoryPrefix: 'ordered-edges-', offsetsSuffix: '.offsets.bin',
  compareRows: (a, b) => a.to < b.to ? -1 : a.to > b.to ? 1 : 0,
  keyForRow: row => row.to, validateIndex: value => value };
try {
  const account = createSemanticDiskAccount(1024 * 1024), metrics = {};
  const descriptor = await writeSemanticQueryIndex({ ...options, root, diskAccount: account, orderedEntries: rows, metrics });
  assert.equal(descriptor.rowCount, rows.length);
  assert.equal(metrics.peakWorkingBytes || 0, 0, 'an ordered source does not create another sorted spill copy');
  const actual = [];
  for (const piece of descriptor.pieces) {
    assert.ok(piece.count <= 3 && piece.bytes <= 512);
    const reader = await openJsonlRowReader(path.join(root, piece.path), path.join(root, piece.offsetsPath), { containedRoot: root });
    try {
      await reader.verify({ jsonlBytes: piece.bytes, offsetsBytes: piece.count * 8, jsonlHash: piece.hash, offsetsHash: piece.offsetsHash });
      await reader.validateOffsets();
      actual.push(...await reader.readRows(Array.from({ length: piece.count }, (_, i) => i), { maxBytes: 512 }));
    } finally { await reader.close(); }
  }
  assert.deepEqual(actual, rows);
  assert.equal(account.used, descriptor.pieces.reduce((sum, piece) => sum + piece.bytes + piece.count * 8, 0));
  const tiny = createSemanticDiskAccount(1);
  await assert.rejects(writeSemanticQueryIndex({ ...options, root, diskAccount: tiny, orderedEntries: rows }), { code: 'ERR_SEMANTIC_DISK_LIMIT' });
  assert.equal(tiny.used, 0, 'failed admission cannot turn an unwritten part into retained credit');
  const invalid = createSemanticDiskAccount(1024 * 1024);
  await assert.rejects(writeSemanticQueryIndex({ ...options, root, diskAccount: invalid, orderedEntries: [...rows].reverse() }), /unordered/);
  assert.equal(invalid.used, 0, 'ordered-entry reuse still validates order and releases only after deletion');
  const controller = new AbortController(), canceled = createSemanticDiskAccount(1024 * 1024);
  const interrupted = (async function* () { for (const [index, row] of rows.entries()) { yield row; if (index === 5) controller.abort(); } })();
  await assert.rejects(writeSemanticQueryIndex({ ...options, root, diskAccount: canceled, orderedEntries: interrupted,
    signal: controller.signal }), { name: 'AbortError' });
  assert.equal(canceled.used, 0);
  const partial = createSemanticDiskAccount(350), remove = fs.rm;
  try {
    fs.rm = async (file, options) => {
      if (path.basename(String(file)).startsWith('ordered-edges-')) throw Object.assign(new Error('injected cleanup refusal'), { code: 'EACCES' });
      return remove(file, options);
    };
    await assert.rejects(writeSemanticQueryIndex({ ...options, root, diskAccount: partial, orderedEntries: rows }), error => {
      assert.equal(error.code, 'ERR_SEMANTIC_DISK_LIMIT'); assert.equal(error.cleanupError?.code, 'EACCES'); return true;
    });
    assert.ok(partial.used > 0, 'failed deletion retains credits for the still-owned partial evidence');
  } finally { fs.rm = remove; }
} finally { await fs.rm(root, { recursive: true, force: true }); }
console.log('ordered retained evidence part admission test passed');
