import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGunzip, createZstdDecompress } from 'node:zlib';
import { writeJsonLinesSharded, writeJsonLinesShardedAsync } from '../../../src/shared/json-stream/jsonl-sharded.js';
import { JsonlCompressionPool } from '../../../src/shared/json-stream/jsonl-compression-pool.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';

const compression = process.env.PAIROFCLEATS_TEST_ID?.split('/').at(-1);
assert.ok(['plain', 'gzip', 'zstd'].includes(compression));
const { dir } = await prepareIsolatedTestCacheDir('sharded-serialization-work-' + compression);
const count = 4097, samples = [];
const reference = id => ({ id, text: '雪😀-stream-'.repeat(1 + id % 256) });
const expected = createHash('sha256');
for (let id = 0; id < count; id++) expected.update(JSON.stringify(reference(id)) + '\n');
const expectedHash = expected.digest('hex');
const pool = compression === 'zstd' ? new JsonlCompressionPool({ compression, workerCount: 1 }) : null;
try {
  for (const reused of [false, true]) for (const asynchronous of [false, true]) {
    const outDir = path.join(dir, `${reused}-${asynchronous}`); await fs.mkdir(outDir);
    let advances = 0, serializations = 0, maxUnserializedRows = 0;
    const source = function* () {
      const shared = { id: 0, text: '' };
      for (let id = 0; id < count; id++) {
        assert.equal(advances, serializations, 'source cannot advance before its prior yield is serialized');
        const data = reused ? shared : {};
        Object.assign(data, reference(id)); advances++;
        maxUnserializedRows = Math.max(maxUnserializedRows, advances - serializations);
        yield { toJSON() { serializations++; return { id: data.id, text: data.text }; } };
      }
      shared.id = -1; shared.text = 'cleared at done';
    };
    const input = asynchronous ? (async function* () { yield* source(); })() : source();
    const cpu = process.cpuUsage(), started = performance.now(), memoryBefore = process.memoryUsage();
    const result = await (asynchronous ? writeJsonLinesShardedAsync : writeJsonLinesSharded)({
      dir: outDir, partsDirName: 'parts', partPrefix: 'part-', items: input,
      compression: compression === 'plain' ? null : compression, pool,
      maxBytes: 512 * 1024, maxItems: 1024, offsets: compression === 'plain' ? { suffix: 'offsets.bin' } : null });
    await pool?.waitForIdle();
    const sample = { compression, reused, asynchronous, rows: result.total,
      elapsedMs: performance.now() - started, cpu: process.cpuUsage(cpu), memoryBefore, memoryAfterWrite: process.memoryUsage(),
      advances, serializations, maxUnserializedRows, parts: result.parts.length, bytesWritten: result.totalBytes, pool: pool?.stats() || null };
    assert.equal(advances, count); assert.equal(serializations, count); assert.equal(maxUnserializedRows, 1);
    assert.equal(result.total, count); assert.ok(result.counts.every(value => value > 0));
    assert.ok(result.parts.length > 2, 'mixed-size producer crosses actual shard boundaries');
    const observed = createHash('sha256'); let decodedBytes = 0;
    for (const part of result.parts) {
      const sink = new Writable({ write(chunk, _encoding, done) { observed.update(chunk); decodedBytes += chunk.length; done(); } });
      const source = createReadStream(path.join(outDir, part));
      if (compression === 'plain') await pipeline(source, sink);
      else await pipeline(source, compression === 'gzip' ? createGunzip() : createZstdDecompress(), sink);
    }
    assert.equal(observed.digest('hex'), expectedHash, 'raw decoded JSONL bytes match an independent streaming reference');
    if (pool) { assert.equal(pool.stats().reservedBytes, 0); assert.ok(pool.stats().highWaterBytes <= pool.stats().maxReservedBytes); }
    samples.push({ ...sample, decodedBytes });
  }
  console.log(JSON.stringify({ kind: 'serial-sharded-serialization-work', scope: 'one serialization/current yield, bounded writer admission and observed small producer work; no full indexing speed claim', samples }));
} finally { await pool?.close(); await fs.rm(dir, { recursive: true, force: true }); }
