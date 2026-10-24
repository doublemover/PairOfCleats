import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { writeJsonArrayFile, writeJsonObjectFile } from '../../../src/shared/json-stream/json-writers.js';
import { writeJsonLinesFile } from '../../../src/shared/json-stream/jsonl-write.js';
import { createJsonlBatchWriter } from '../../../src/shared/json-stream/jsonl-batch.js';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-json-output-owned-'));
const contains = (error, expected) => {
  const pending = [error], visited = new Set();
  while (pending.length) {
    const value = pending.pop(); if (value === expected) return true;
    if (!value || typeof value !== 'object' || visited.has(value)) continue;
    visited.add(value); pending.push(value.cause, ...(Array.isArray(value.errors) ? value.errors : []));
  }
  return false;
};
try {
  for (const object of [false, true]) {
    const rawPath = path.join(root, object ? 'object.json' : 'array.json'), compressed = `${rawPath}.gz`;
    let advances = 0, encodes = 0, closed = 0;
    const rows = (async function* () {
      const nested = { value: '' }, row = { id: 0, nested,
        toJSON() { encodes++; return { id: this.id, nested: this.nested }; } };
      try {
        for (let id = 0; id < 3; id++) { advances++; row.id = id; nested.value = `雪😀-${id}`; yield row; }
      } finally { closed++; row.id = -1; nested.value = 'cleared'; }
    })();
    if (object) await writeJsonObjectFile(compressed, { fields: { version: 1 }, arrays: { rows }, compression: 'gzip',
      atomic: true, additionalOutputs: [{ filePath: rawPath, atomic: true }] });
    else await writeJsonArrayFile(compressed, rows, { compression: 'gzip', atomic: true,
      additionalOutputs: [{ filePath: rawPath, atomic: true }] });
    const raw = await fs.readFile(rawPath); assert.deepEqual(gunzipSync(await fs.readFile(compressed)), raw);
    assert.deepEqual(object ? JSON.parse(raw).rows : JSON.parse(raw), [0, 1, 2].map(id => ({ id, nested: { value: `雪😀-${id}` } })));
    assert.equal(advances, 3); assert.equal(encodes, 3); assert.equal(closed, 1);
  }
  for (const compression of [null, 'gzip']) {
    const filename = path.join(root, `batch-${compression || 'plain'}`);
    const writer = createJsonlBatchWriter(filename, { compression });
    const row = Buffer.from('{"id":1}');
    await writer.writeLine(row, 0); row.fill(0x78);
    const large = '{"text":"' + '雪😀'.repeat(180000) + '"}';
    await writer.writeLine(large, Infinity);
    const firstClose = writer.close(), secondClose = writer.close();
    assert.equal(firstClose, secondClose, 'all close callers join the same finalizer');
    await firstClose;
    const bytes = await fs.readFile(filename);
    assert.equal((compression ? gunzipSync(bytes) : bytes).toString('utf8'), '{"id":1}\n' + large + '\n',
      'line bytes are independent of a bad hint and mutation after admission');
  }
  for (const useJsonl of [false, true]) {
    const filename = path.join(root, useJsonl ? 'failure.jsonl' : 'failure.json');
    await fs.writeFile(filename, 'old authority');
    const primary = Object.freeze(new Error('source advance failed')), cleanup = Object.freeze(new Error('source close failed'));
    let advances = 0, closes = 0;
    const rows = { [Symbol.asyncIterator]() { return this; }, async next() { advances++; throw primary; },
      async return() { closes++; throw cleanup; } };
    await assert.rejects(useJsonl ? writeJsonLinesFile(filename, rows, { atomic: true })
      : writeJsonArrayFile(filename, rows, { atomic: true }), error => contains(error, primary) && contains(error, cleanup));
    assert.equal(advances, 1); assert.equal(closes, 1);
    assert.equal(await fs.readFile(filename, 'utf8'), 'old authority');
  }
  const primary = path.join(root, 'constructor.json'), secondary = path.join(root, 'constructor-raw.json');
  await fs.writeFile(primary, 'old compressed authority'); await fs.writeFile(secondary, 'old raw authority');
  await assert.rejects(writeJsonArrayFile(primary, [{ id: 1 }], { atomic: true,
    additionalOutputs: [{ filePath: secondary, atomic: true, compression: 'unsupported' }] }), /Unsupported JSON stream compression/);
  assert.equal(await fs.readFile(primary, 'utf8'), 'old compressed authority');
  assert.equal(await fs.readFile(secondary, 'utf8'), 'old raw authority');
} finally { await fs.rm(root, { recursive: true, force: true }); }
console.log('Async fanout, producer cleanup and owned JSONL batch buffers preserve complete bytes and original failures.');
