import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Writable } from 'node:stream';
import { finished } from 'node:stream/promises';
import { writeJsonValue } from '../../../src/shared/json-stream/encode.js';
import { writeFieldPostingsFragments, mergeFieldPostingsFragments } from '../../../src/index/build/artifacts/field-postings-shards.js';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-large-json-strings-'));
const body = 'x'.repeat(32767) + '😀\ud800"\\\n\u0000雪'.repeat(6000) + '\udfff';
const key = 'key-' + body;
const value = { [key]: body, nested: [body, { toJSON() { return { text: body }; } }] };
const expected = JSON.stringify(value);
const originalStringify = JSON.stringify;
let largestNativeString = 0;
JSON.stringify = function (input, ...args) {
  if (typeof input === 'string') largestNativeString = Math.max(largestNativeString, input.length);
  return originalStringify.call(this, input, ...args);
};
try {
  const chunks = [];
  const sink = new Writable({ highWaterMark: 1, write(bytes, _encoding, callback) {
    chunks.push(Buffer.from(bytes)); setImmediate(callback);
  } });
  await writeJsonValue(sink, value); sink.end(); await finished(sink);
  assert.equal(Buffer.concat(chunks).toString('utf8'), expected);
  assert.ok(largestNativeString <= 32768, 'large primitive values and object keys use bounded native escaping slices');
  assert.ok(chunks.every(chunk => chunk.length <= 4 * 65536));

  const controller = new AbortController();
  const discard = new Writable({ write(_bytes, _encoding, callback) { callback(); } });
  await assert.rejects(writeJsonValue(discard, value, { signal: controller.signal,
    cooperate() { controller.abort(); } }), { name: 'AbortError' });
  discard.end(); await finished(discard);
  const directory = path.join(root, 'parts');
  const fields = { only: { vocab: [body], postings: [[[0, 1]]], docLengths: [1], totalDocs: 1, avgDocLen: 1 } };
  const result = await writeFieldPostingsFragments({ directory, fields, maxPartBytes: 4096 });
  assert.ok(result.parts.length > 1);
  assert.ok(result.parts.every(part => part.bytes <= 4096));
  const targetPath = path.join(root, 'field_postings.json');
  await mergeFieldPostingsFragments({ root: directory, parts: result.parts, targetPath });
  assert.deepEqual(await fs.readFile(targetPath), Buffer.from(originalStringify({ fields }) + '\n'));
  assert.ok(largestNativeString <= 32768);
} finally {
  JSON.stringify = originalStringify;
  await fs.rm(root, { recursive: true, force: true });
}
console.log('Large JSON strings/keys use bounded escaping slices with exact UTF-8, surrogate and field-shard output parity.');
