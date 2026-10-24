#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { Writable } from 'node:stream';
import { finished } from 'node:stream/promises';
import { registerHooks } from 'node:module';
import { createArtifactWriter } from '../../../src/index/build/artifacts/writer.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';

const { dir } = await prepareIsolatedTestCacheDir('artifact-keep-raw-fanout');
const createWriter = (outDir, jobs, pieces) => createArtifactWriter({ outDir,
  enqueueWrite(label, job, meta) { jobs.push(async () => {
    const result = await job();
    for (const piece of meta.publishedPieces) pieces.push({ ...piece.entry, filePath: piece.filePath, ...result });
    return result;
  }); },
  addPieceFile(entry, filePath) { pieces.push({ ...entry, filePath }); },
  formatArtifactLabel: value => path.basename(value), compressionEnabled: true,
  compressionMode: 'gzip', compressionKeepRaw: true, compressibleArtifacts: new Set(['chunk_meta'])
});
try {
  for (const kind of ['generator', 'array', 'object']) {
    for (const concurrent of [false, true]) {
      const outDir = path.join(dir, `${kind}-${concurrent}`), jobs = [], pieces = [];
      let visits = 0;
      const rows = Array.from({ length: 100 }, (_, id) => ({ toJSON() { visits++; return { id }; } }));
      const iterator = function *() { yield* rows; };
      const writer = createWriter(outDir, jobs, pieces);
      const piece = { name: 'chunk_meta', type: 'chunks', count: rows.length };
      if (kind === 'object') writer.enqueueJsonObject('chunk_meta', { fields: { version: 1 }, arrays: { rows: iterator() } }, { piece });
      else writer.enqueueJsonArray('chunk_meta', kind === 'array' ? rows : iterator(), { piece });
      if (concurrent) await Promise.all(jobs.map(job => job()));
      else for (const job of jobs) await job();
      const raw = await fs.readFile(path.join(outDir, 'chunk_meta.json'));
      const compressed = await fs.readFile(path.join(outDir, 'chunk_meta.json.gz'));
      assert.deepEqual(raw, gunzipSync(compressed), 'both representations own the identical complete byte stream');
      assert.equal((kind === 'object' ? JSON.parse(raw).rows : JSON.parse(raw)).length, 100);
      assert.equal(visits, 100, 'dual output serializes each row exactly once');
      assert.equal(jobs.length, 1, 'one scheduled producer owns both sinks');
      assert.equal(pieces.length, 2);
      for (const entry of pieces) {
        const bytes = await fs.readFile(entry.filePath);
        const checksum = crypto.createHash('sha1').update(bytes).digest('hex');
        assert.equal(entry.bytes, bytes.length);
        assert.ok(entry.checksum === checksum || entry.checksum === `sha1:${checksum}`);
      }
    }
  }
  const jobs = [], pieces = [];
  const writer = createWriter(path.join(dir, 'failed'), jobs, pieces);
  writer.enqueueJsonArray('chunk_meta', (function *() { yield { id: 1 }; throw new Error('producer fault'); })(),
    { piece: { name: 'chunk_meta', type: 'chunks' } });
  await assert.rejects(jobs[0](), /producer fault/);
  assert.equal(pieces.length, 0, 'failed production publishes neither representation');

  // Control the I/O boundary to verify asymmetric backpressure and late sink
  // failures without a real codec or filesystem fault, using the real encoder.
  const key = Symbol.for('poc.tests.keep-raw-sinks');
  const streamsUrl = new URL('../../../src/shared/json-stream/streams.js', import.meta.url).href;
  const writersUrl = new URL('../../../src/shared/json-stream/json-writers.js', import.meta.url).href;
  const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier === './streams.js' && context.parentURL === `${writersUrl}?sinks`) {
        return { url: `${streamsUrl}?sinks`, shortCircuit: true };
      }
      return nextResolve(specifier, context);
    },
    load(url, context, nextLoad) {
      if (url === `${streamsUrl}?sinks`) return { format: 'module', shortCircuit: true,
        source: `export { writeChunk } from ${JSON.stringify(streamsUrl)};
export const createJsonWriteStream = (file, options) => globalThis[Symbol.for(${JSON.stringify(Symbol.keyFor(key))})](file, options);` };
      return nextLoad(url, context);
    }
  });
  try {
    const { writeJsonArrayFile } = await import(`${writersUrl}?sinks`);
    for (const slow of ['raw', 'compressed']) {
      for (const fault of [null, 'write', 'final', 'abort']) {
        const controller = new AbortController();
        const outputs = new Map();
        let queuedPeak = 0, produced = 0, consumed = 0;
        globalThis[key] = file => {
          const chunks = [];
          const stream = new Writable({ highWaterMark: 32,
            write(chunk, encoding, callback) {
              chunks.push(Buffer.from(chunk));
              const finish = () => {
                if (file === slow) consumed += chunk.length;
                if (fault === 'write' && file === slow && chunks.length === 5) callback(new Error('sink write fault'));
                else callback();
              };
              if (file === slow) setImmediate(finish);
              else finish();
            },
            final(callback) { callback(fault === 'final' && file === slow ? new Error('sink final fault') : null); }
          });
          controller.signal.addEventListener('abort', () => stream.destroy(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true });
          const done = finished(stream);
          done.catch(() => {});
          outputs.set(file, chunks);
          return { stream, done, getBytesWritten: () => Buffer.concat(chunks).length,
            getChecksum: () => null, checksumAlgo: null };
        };
        const rows = (function *() {
          for (let id = 0; id < 2000; id++) {
            const row = { id, value: 'x'.repeat(40) };
            produced += Buffer.byteLength(JSON.stringify(row)) + 1;
            queuedPeak = Math.max(queuedPeak, produced - consumed);
            if (fault === 'abort' && id === 10) controller.abort();
            yield row;
          }
        })();
        const run = writeJsonArrayFile('compressed', rows, { highWaterMark: 128, signal: controller.signal,
          additionalOutputs: [{ filePath: 'raw' }] });
        if (fault) await assert.rejects(run, /fault|abort/);
        else {
          await run;
          assert.deepEqual(Buffer.concat(outputs.get('raw')), Buffer.concat(outputs.get('compressed')));
          assert.ok(queuedPeak < 4096, `slow ${slow} bounds producer lead (${queuedPeak})`);
        }
      }
    }
  } finally { hooks.deregister(); delete globalThis[key]; }
} finally { await fs.rm(dir, { recursive: true, force: true }); }
console.log('Artifact single-pass raw/compressed fanout, sink faults and bounded backpressure passed.');
