import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { writeJsonLinesFile } from '../../../src/shared/json-stream/jsonl-write.js';
import { readJsonlRowAt, readJsonlRowsAt, openJsonlRowReader, validateOffsetsAgainstFile,
  readOffsetsAt } from '../../../src/shared/artifact-io/offsets.js';
import { loadSymbolOccurrencesByFile } from '../../../src/shared/artifact-io/loaders/per-file.js';
import { ARTIFACT_SURFACE_VERSION } from '../../../src/contracts/versioning.js';

// Source-authored acceptance. Run through the normal repository test runner.
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-jsonl-consumer-short-read-'));
const nativeOpen = fs.open;
let opened = 0, closed = 0, readCalls = 0, cancel = null, eofFile = null;
const pathsRead = new Set();
fs.open = async (...args) => {
  const handle = await nativeOpen(...args), nativeRead = handle.read.bind(handle), nativeClose = handle.close.bind(handle);
  opened++;
  handle.read = async (buffer, offset, length, position) => {
    readCalls++; pathsRead.add(args[0]);
    if (args[0] === eofFile && position > 8) return { bytesRead: 0, buffer };
    const result = await nativeRead(buffer, offset, Math.min(3, length), position);
    cancel?.abort();
    return result;
  };
  handle.close = async () => { closed++; return nativeClose(); };
  return handle;
};
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
try {
  for (const large of [false, true]) {
    const prefix = large ? 'large' : 'small';
    const data = path.join(root, `${prefix}.jsonl`), offsets = `${data}.offsets.bin`;
    const rows = [0, 1, 2].map(id => ({ id, text: `雪😀-${id}` + 'x'.repeat(large ? 24000 : 3) }));
    await writeJsonLinesFile(data, rows, { offsets: { path: offsets } });
    assert.deepEqual(await readJsonlRowAt(data, offsets, 1), rows[1]);
    assert.deepEqual(await readJsonlRowsAt(data, offsets, [2, 0, 2, 1]), [rows[2], rows[0], rows[2], rows[1]]);
    await validateOffsetsAgainstFile(data, offsets);
    const raw = await fs.readFile(data), sidecar = await fs.readFile(offsets);
    const reader = await openJsonlRowReader(data, offsets);
    try {
      await reader.verify({ jsonlBytes: raw.length, offsetsBytes: sidecar.length,
        jsonlHash: hash(raw), offsetsHash: hash(sidecar) });
      assert.deepEqual(await reader.readRows([2, 0, 1]), [rows[2], rows[0], rows[1]]);
      await reader.validateOffsets();
    } finally { await reader.close(); }
    assert.equal(opened, closed, 'unverified, snapshot and verified block readers close their original descriptor sets');
    cancel = new AbortController();
    await assert.rejects(readJsonlRowsAt(data, offsets, [0, 1], { signal: cancel.signal }), { name: 'AbortError' });
    cancel = null;
    assert.equal(opened, closed, 'abort during positive short-read progress settles both files');
    eofFile = offsets;
    await assert.rejects(validateOffsetsAgainstFile(data, offsets), { code: 'ERR_OFFSETS_INVALID' });
    eofFile = null;
    assert.equal(opened, closed);
  }
  // The actual per-file consumer crosses both its varint index and JSONL row
  // sidecars. A positive short read must not silently omit the second row.
  const data = path.join(root, 'symbol_occurrences.jsonl'), offsets = `${data}.offsets.bin`;
  const rows = [0, 1, 2].map(id => ({ v: 1, host: { file: 'src/a.js', chunkUid: `c-${id}` }, role: 'decl', ref: { name: `雪-${id}` } }));
  await writeJsonLinesFile(data, rows, { offsets: { path: offsets } });
  const indexData = path.join(root, 'by-file.bin'), indexOffsets = path.join(root, 'by-file.offsets.bin');
  await fs.writeFile(indexData, Buffer.from([0, 2]));
  const indexBytes = Buffer.alloc(16); indexBytes.writeBigUInt64LE(2n, 8); await fs.writeFile(indexOffsets, indexBytes);
  await fs.writeFile(path.join(root, 'by-file.meta.json'), JSON.stringify({ data: 'by-file.bin',
    offsets: { path: 'by-file.offsets.bin' }, jsonl: { parts: ['symbol_occurrences.jsonl'], counts: [3],
      offsets: ['symbol_occurrences.jsonl.offsets.bin'] } }));
  const manifest = { version: 2, artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION, pieces: [
    { name: 'symbol_occurrences', type: 'symbols', format: 'jsonl', path: 'symbol_occurrences.jsonl' },
    { name: 'symbol_occurrences_by_file_meta', type: 'symbols', format: 'json', path: 'by-file.meta.json' }
  ] };
  assert.deepEqual(await loadSymbolOccurrencesByFile(root, { fileId: 0, filePath: 'src/a.js', manifest }), [rows[0], rows[2]]);
  for (const filename of [data, offsets, indexData, indexOffsets]) assert.ok(pathsRead.has(filename));
  assert.ok(readCalls > 10);
  assert.equal(opened, closed);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(readOffsetsAt(indexOffsets, [0, 1], { signal: controller.signal }), { name: 'AbortError' });
} finally { fs.open = nativeOpen; await fs.rm(root, { recursive: true, force: true }); }
console.log('JSONL random-row, verified-window, validation and per-file consumers complete positive short reads.');
