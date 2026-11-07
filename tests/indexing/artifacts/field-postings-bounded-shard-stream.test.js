import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { streamFieldPostingsShardBody } from '../../../src/index/build/artifacts/field-postings-shard-stream.js';
import { ensureTestingEnv } from '../../helpers/test-env.js';
ensureTestingEnv(process.env);
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-field-shard-stream-'));
const filename = path.join(root, 'part.json');
const receipt = bytes => ({ bytes: bytes.length, checksum: createHash('sha1').update(bytes).digest('hex'), checksumAlgo: 'sha1' });
const field = { vocab: Array.from({ length: 12000 }, (_, index) => `Unicode-λ-${index}`), postings: [], docLengths: [], avgDocLen: 0, totalDocs: 0 };
const encoded = Buffer.from(JSON.stringify({ fields: { 'body,"λ': field } }) + '\n');
const expected = receipt(encoded);
try {
  await fs.writeFile(filename, encoded);
  const chunks = []; const metrics = {};
  const originalRead = fs.readFile;
  fs.readFile = async function (name, ...args) {
    if (path.resolve(name) === filename) throw new Error('whole-shard read forbidden');
    return originalRead.call(this, name, ...args);
  };
  try {
    assert.equal(await streamFieldPostingsShardBody({ root, filename, expected, metrics,
      onChunk: bytes => { chunks.push(bytes); } }), true);
  } finally { fs.readFile = originalRead; }
  assert.ok(chunks.length > 1);
  assert.deepEqual(Buffer.concat([Buffer.from('{"fields":{'), ...chunks, Buffer.from('}}\n')]), encoded);
  assert.ok(metrics.readChunkBytesHighWater <= 65536);
  assert.equal(metrics.readBytes, encoded.length);
  assert.equal(metrics.shardsRead, 1);
  assert.equal(chunks[0].buffer === chunks[1].buffer, false, 'queued output owns bytes after input scratch advances');
  await assert.rejects(streamFieldPostingsShardBody({ root, filename, expected: { ...expected, checksum: '0'.repeat(40) }, onChunk: () => {} }), { code: 'ERR_FIELD_POSTINGS_SHARD_INTEGRITY' });
  await fs.writeFile(filename, encoded.subarray(0, encoded.length - 1));
  await assert.rejects(streamFieldPostingsShardBody({ root, filename, expected, onChunk: () => {} }), { code: 'ERR_FIELD_POSTINGS_SHARD_INTEGRITY' });
  await fs.writeFile(filename, encoded);
  const controller = new AbortController();
  await assert.rejects(streamFieldPostingsShardBody({ root, filename, expected, signal: controller.signal,
    onChunk: () => controller.abort(new Error('cancel merge')) }), { name: 'AbortError' });
  await assert.rejects(streamFieldPostingsShardBody({ root, filename, expected, onChunk: () => { throw new Error('output refused'); } }), /output refused/);
  const originalLstat = fsSync.lstatSync;
  fsSync.lstatSync = function (name, ...args) {
    const stat = originalLstat.call(this, name, ...args);
    if (path.resolve(name) !== filename) return stat;
    return new Proxy(stat, { get(target, key) {
      if (key === 'isSymbolicLink') return () => true;
      const value = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value;
    } });
  };
  try { await assert.rejects(streamFieldPostingsShardBody({ root, filename, expected, onChunk: () => {} }), { code: 'ERR_UNSAFE_FILE_PATH' }); }
  finally { fsSync.lstatSync = originalLstat; }
  const empty = Buffer.from('{"fields":{}}\n'); await fs.writeFile(filename, empty);
  let started = false;
  assert.equal(await streamFieldPostingsShardBody({ root, filename, expected: receipt(empty),
    onStart: () => { started = true; }, onChunk: () => assert.fail('empty body') }), false);
  assert.equal(started, false, 'empty shards do not introduce compatibility delimiters');
} finally { await fs.rm(root, { recursive: true, force: true }); }
console.log('field shard merge remains bounded and bound to completed source integrity');
