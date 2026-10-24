import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { streamJsonlRowsFromSources } from '../../../src/shared/artifact-io/loaders/core-array-payload.js';
import { openJsonlRowReader, validateOffsetsAgainstFile } from '../../../src/shared/artifact-io/offsets.js';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';

const root = await makeTempDir('offset-loader-proof-');
const dataPath = path.join(root, 'rows.jsonl'), sidecar = path.join(root, 'rows.offsets.bin');
const expected = [{ id: 0 }, { id: 1 }], rows = expected.map(row => JSON.stringify(row) + '\n');
const encode = offsets => {
  const buffer = Buffer.alloc(offsets.length * 8);
  offsets.forEach((offset, index) => buffer.writeBigUInt64LE(BigInt(offset), index * 8));
  return buffer;
};
const offsets = encode([0, Buffer.byteLength(rows[0])]);
const collect = async (options = {}) => {
  const out = [];
  for await (const row of streamJsonlRowsFromSources([dataPath], [sidecar], {
    maxBytes: 4096, containedRoot: root, ...options
  })) out.push(row);
  return out;
};
const reset = async () => {
  await fs.writeFile(dataPath, rows.join('')); await fs.writeFile(sidecar, offsets);
  await fs.utimes(sidecar, 1000000000, 1000000000);
};
const originalOpen = fs.open;
let opened = 0, closed = 0, abortOnRead = null;
try {
  await reset();
  fs.open = async (...args) => {
    const handle = await originalOpen(...args); opened += 1;
    const close = handle.close.bind(handle), read = handle.read.bind(handle);
    handle.close = async () => { closed += 1; return close(); };
    handle.read = async (...input) => { const result = await read(...input); abortOnRead?.abort(); return result; };
    return handle;
  };
  assert.deepEqual(await collect(), expected);
  const firstOpens = opened;
  assert.deepEqual(await collect(), expected);
  assert.ok(opened >= firstOpens + 2, 'each invocation owns fresh bounded validation, with no permanent path proof');
  for (const invalid of [[1, Buffer.byteLength(rows[0])], [0, 0], [0, Buffer.byteLength(rows[0]) - 1]]) {
    await reset(); assert.deepEqual(await collect(), expected);
    await fs.writeFile(sidecar, encode(invalid));
    await fs.utimes(sidecar, 1000000000, 1000000000);
    await assert.rejects(collect(), { code: 'ERR_OFFSETS_INVALID' });
    await assert.rejects(validateOffsetsAgainstFile(dataPath, sidecar, { containedRoot: root }), { code: 'ERR_OFFSETS_INVALID' });
    assert.equal(opened, closed);
  }
  await reset(); await collect();
  await fs.unlink(sidecar); await assert.rejects(collect(), { code: 'ENOENT' });
  await fs.writeFile(sidecar, encode([0, 0])); // Replacement at the previously validated path.
  await assert.rejects(collect(), { code: 'ERR_OFFSETS_INVALID' });
  await reset(); await collect();
  const otherRoot = path.join(root, 'different-authority'); await fs.mkdir(otherRoot);
  await assert.rejects(collect({ containedRoot: otherRoot }), { code: 'ERR_UNSAFE_FILE_PATH' });
  const cancelled = new AbortController(); cancelled.abort();
  await assert.rejects(collect({ signal: cancelled.signal }), { name: 'AbortError' });
  abortOnRead = new AbortController();
  await assert.rejects(collect({ signal: abortOnRead.signal }), { name: 'AbortError' });
  abortOnRead = null;
  assert.deepEqual(await collect(), expected, 'cancelled validation leaves no successful proof');
  assert.equal(opened, closed, 'all original validation and stream descriptors settle');

  // The paired-empty contract is shared by direct and retained row readers.
  for (const [data, positions, valid] of [['', [], true], [rows[0], [], false], ['', [0], false], [rows[0], [0], true]]) {
    await fs.writeFile(dataPath, data); await fs.writeFile(sidecar, encode(positions));
    const reader = await openJsonlRowReader(dataPath, sidecar, { containedRoot: root });
    try {
      if (valid) { assert.equal(await reader.validateOffsets(), true); assert.equal(await validateOffsetsAgainstFile(dataPath, sidecar), true); }
      else {
        await assert.rejects(reader.validateOffsets(), { code: 'ERR_OFFSETS_INVALID' });
        await assert.rejects(validateOffsetsAgainstFile(dataPath, sidecar), { code: 'ERR_OFFSETS_INVALID' });
        await assert.rejects(collect(), { code: 'ERR_OFFSETS_INVALID' });
      }
    } finally { await reader.close(); }
  }
  assert.equal(opened, closed);
} finally { fs.open = originalOpen; await rmDirRecursive(root); }
console.log('Loader validation honors current sidecar bytes, authority, cancellation and paired-empty cardinality.');
