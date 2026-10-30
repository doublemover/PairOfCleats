import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createOffsetsWriter } from '../../../src/shared/json-stream/offsets.js';
import { writeJsonLinesSharded } from '../../../src/shared/json-stream/jsonl-sharded.js';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-offset-output-owned-'));
const nativeCreate = fsSync.createWriteStream;
let streams = [];
fsSync.createWriteStream = function (...args) { const stream = nativeCreate.apply(this, args); streams.push(stream); return stream; };
try {
  const filename = path.join(root, 'offsets.bin');
  const writer = createOffsetsWriter(filename, { atomic: true });
  for (const value of [0, 8, 100]) await writer.writeOffset(value);
  const first = writer.close(), second = writer.close();
  assert.equal(first, second); assert.deepEqual(await first, { bytes: 24 });
  assert.equal(streams[0].closed, true);
  const bytes = await fs.readFile(filename);
  assert.deepEqual([0, 1, 2].map(index => Number(bytes.readBigUInt64LE(index * 8))), [0, 8, 100]);
  await assert.rejects(writer.writeOffset(101), /closed/);
  const invalid = createOffsetsWriter(path.join(root, 'invalid.bin'), { atomic: true });
  for (const value of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) await assert.rejects(invalid.writeOffset(value), TypeError);
  await invalid.destroy(); assert.equal(streams.at(-1).closed, true);
  const badPath = path.join(root, 'directory'); await fs.mkdir(badPath);
  const unavailable = createOffsetsWriter(badPath);
  await assert.rejects(unavailable.close(), { code: 'EISDIR' });
  await assert.rejects(unavailable.destroy(), { code: 'EISDIR' }); assert.equal(streams.at(-1).closed, true);

  const options = { level: 1, mtime: 1600000000000 };
  const rows = (function* () {
    yield { id: 1 }; options.level = 9; options.mtime = 1700000000000; yield { id: 2 };
  })();
  const result = await writeJsonLinesSharded({ dir: root, partsDirName: 'parts', partPrefix: 'part-',
    items: rows, compression: 'gzip', gzipOptions: options, maxItems: 1, maxBytes: 1024 });
  for (const part of result.parts) assert.equal((await fs.readFile(path.join(root, part))).readUInt32LE(4), 1600000000,
    'one invocation snapshots codec options before a source can mutate its configuration object');
} finally { fsSync.createWriteStream = nativeCreate; await fs.rm(root, { recursive: true, force: true }); }
console.log('Offset output owns finish/error/close observations and gzip shards retain one invocation option snapshot.');
