import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { registerHooks } from 'node:module';
import { gunzipSync, createZstdDecompress } from 'node:zlib';
import { Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv();
const { dir } = await prepareIsolatedTestCacheDir('jsonl-byte-authority-and-bounds');
const batch = new URL('../../../src/shared/json-stream/jsonl-batch.js', import.meta.url).href;
const streams = new URL('../../../src/shared/json-stream/streams.js', import.meta.url).href;
const route = 'jsonl-byte-authority:streams';
const state = { writes: [], abort: null }; globalThis.jsonlByteAuthority = state;
const hooks = registerHooks({ resolve(specifier, context, next) {
  if (context.parentURL === batch && specifier === './streams.js') return { url: route, shortCircuit: true };
  return next(specifier, context);
}, load(url, context, next) {
  if (url === route) return { format: 'module', shortCircuit: true, source: `
    export * from ${JSON.stringify(streams)};
    import {writeChunk as real} from ${JSON.stringify(streams)};
    export const writeChunk=(stream,chunk,...rest)=>{
      const state=globalThis.jsonlByteAuthority;state.writes.push(chunk.byteLength);
      const abort=state.abort;state.abort=null;abort?.();return real(stream,chunk,...rest);
    };` };
  return next(url, context);
} });
const blockSize = 1024 * 1024, samples = [];
let pool;
try {
  const { createJsonlBatchWriter } = await import(batch);
  const { JsonlCompressionPool } = await import('../../../src/shared/json-stream/jsonl-compression-pool.js');
  const sized = length => '{"value":"' + 'x'.repeat(length - Buffer.byteLength('{"value":""}')) + '"}';
  const rows = [JSON.stringify({ text: '雪😀-É' }), ...Array(11).fill('[1,true,"雪😀"]'), sized(blockSize - 1), sized(blockSize * 2 + 17)];
  const hints = [undefined, null, undefined, -1, 0, 1, 999999999, NaN, Infinity, -Infinity, '2', 4.5, 1, -12];
  const expected = rows.join('\n') + '\n';
  for (const compression of [null, 'gzip', 'zstd']) {
    if (compression === 'zstd') pool = new JsonlCompressionPool({ compression, workerCount: 1 });
    const file = path.join(dir, `data.jsonl${compression === 'gzip' ? '.gz' : compression === 'zstd' ? '.zst' : ''}`);
    state.writes.length = 0;
    const writer = createJsonlBatchWriter(file, { compression, atomic: true, blockSize, pool,
      workerMaxInFlight: 1 });
    for (let index = 0; index < rows.length; index++) {
      const input = index % 2 ? Buffer.from(rows[index]) : rows[index];
      if (index === 0) await writer.writeLine(input); else await writer.writeLine(input, hints[index]);
      if (Buffer.isBuffer(input)) input.fill(0x23); // ownership returns only after writeLine settles
    }
    await writer.close(); await pool?.waitForIdle();
    assert.ok(state.writes.length >= 4); assert.ok(Math.max(...state.writes) <= blockSize + 64 * 1024);
    let actual;
    if (compression === 'zstd') {
      const chunks = [];
      await pipeline(createReadStream(file), createZstdDecompress(), new Writable({ write(chunk, _encoding, done) {
        chunks.push(Buffer.from(chunk)); done();
      } }));
      actual = Buffer.concat(chunks).toString('utf8');
    } else actual = (compression === 'gzip' ? gunzipSync(await fs.readFile(file)) : await fs.readFile(file)).toString('utf8');
    assert.equal(actual, expected, `${compression}: wrong hints cannot truncate, pad, drop or corrupt rows`);
    const capacity = pool?.stats();
    if (capacity) { assert.equal(capacity.reservedBytes, 0); assert.ok(capacity.highWaterBytes <= capacity.maxReservedBytes); }
    samples.push({ compression: compression || 'plain', rows: rows.length, decodedBytes: Buffer.byteLength(expected),
      largestWrite: Math.max(...state.writes), admittedBlockBytes: blockSize, pool: capacity || null });
    const old = path.join(dir, `${compression || 'plain'}-abort`); await fs.writeFile(old, 'previous good generation');
    const controller = new AbortController();
    const interrupted = createJsonlBatchWriter(old, { compression, atomic: true, blockSize, pool,
      workerMaxInFlight: 1, signal: controller.signal });
    state.abort = () => controller.abort();
    await assert.rejects(interrupted.writeLine(rows.at(-1), 0));
    await assert.rejects(interrupted.close()); await pool?.waitForIdle();
    if (pool) assert.equal(pool.stats().reservedBytes, 0, 'aborted writer releases its own blocks after admitted codec work settles');
    assert.equal(await fs.readFile(old, 'utf8'), 'previous good generation', 'abort cannot publish a partial replacement');
    await pool?.close(); pool = null;
  }
  const controller = new AbortController(); controller.abort();
  assert.throws(() => createJsonlBatchWriter(path.join(dir, 'never-created'), { signal: controller.signal }), { name: 'AbortError' });
  await assert.rejects(fs.stat(path.join(dir, 'never-created')), { code: 'ENOENT' });
  console.log(JSON.stringify({ kind: 'actual-jsonl-byte-and-capacity-observations', samples }));
} finally { state.abort = null; await pool?.close(); hooks.deregister(); delete globalThis.jsonlByteAuthority;
  await fs.rm(dir, { recursive: true, force: true }); }
