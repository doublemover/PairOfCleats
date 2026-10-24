import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { gzipSync, zstdCompressSync } from 'node:zlib';
import { readJsonLinesIterator, readJsonLinesEachAwait } from '../../../src/shared/artifact-io/json/read-jsonl-stream.js';

// Source-authored; native zstd qualification and timings belong to the later
// pinned-runtime validation. The zstd fixture crosses the optional-buffer path.
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-jsonl-reader-owned-'));
const nativeCreate = fsSync.createReadStream;
let sources = [], decoders = [];
let closeFailure = null;
fsSync.createReadStream = function (...args) {
  const source = nativeCreate.apply(this, args), pipe = source.pipe;
  if (closeFailure) {
    const injected = closeFailure, destroy = source._destroy;
    source._destroy = function (error, callback) {
      // Close the real descriptor before reporting an independent finalizer
      // failure; the fixture does not replace ownership with a fake stream.
      destroy.call(this, error, failure => callback(failure && failure !== error ? failure : injected));
    };
  }
  sources.push(source);
  source.pipe = function (destination, ...options) { decoders.push(destination); return pipe.call(this, destination, ...options); };
  return source;
};
const contains = (error, expected) => {
  const pending = [error], seen = new Set();
  while (pending.length) {
    const value = pending.pop(); if (value === expected) return true;
    if (!value || typeof value !== 'object' || seen.has(value)) continue;
    seen.add(value); pending.push(value.cause, ...(Array.isArray(value.errors) ? value.errors : []));
  }
  return false;
};
const assertClosed = () => {
  for (const stream of [...sources, ...decoders]) {
    assert.equal(stream.destroyed, true); assert.equal(stream.closed, true);
  }
};
try {
  for (const codec of ['plain', 'gzip', 'zstd']) {
    const payload = randomBytes(codec === 'zstd' ? 9 * 1024 * 1024 : 256 * 1024).toString('base64');
    const row = { id: 1, text: 'café 水 😀', file: 'src/雪.js' };
    const raw = Buffer.from(JSON.stringify(row) + '\r\n' + JSON.stringify({ id: 2, payload }) + '\n');
    const encode = bytes => codec === 'plain' ? bytes : codec === 'gzip' ? gzipSync(bytes) : zstdCompressSync(bytes);
    const bytes = encode(raw), filename = path.join(root, `rows.${codec === 'plain' ? 'jsonl' : codec === 'gzip' ? 'jsonl.gz' : 'jsonl.zst'}`);
    assert.ok(bytes.length > (codec === 'zstd' ? 8 * 1024 * 1024 : 128 * 1024));
    await fs.writeFile(filename, bytes);
    sources = []; decoders = [];
    for await (const entry of readJsonLinesIterator(filename, { maxInFlight: 1 })) { assert.deepEqual(entry, row); break; }
    assert.equal(sources.length, 1); assert.equal(decoders.length, codec === 'plain' ? 0 : 1); assertClosed();
    sources = []; decoders = [];
    const full = [];
    await readJsonLinesEachAwait(filename, entry => full.push(entry), { maxInFlight: 1 });
    assert.deepEqual(full, [row, { id: 2, payload }]); assertClosed();
    sources = []; decoders = [];
    const controller = new AbortController();
    await assert.rejects(async () => {
      for await (const _entry of readJsonLinesIterator(filename, { maxInFlight: 1, signal: controller.signal,
        onBackpressure: () => controller.abort() })) {
        // Cancellation must occur even if delivery keeps pace with the
        // producer and the queue never needs its backpressure callback.
        controller.abort();
      }
    }, { name: 'AbortError' });
    assert.equal(controller.signal.aborted, true);
    assertClosed();
    sources = []; decoders = [];
    await assert.rejects(readJsonLinesEachAwait(filename, () => controller.abort(), { signal: controller.signal }), { name: 'AbortError' });
    assert.equal(sources.length, 0, 'pre-aborted callbacks do not open a source');
    const malformed = encode(Buffer.from(JSON.stringify(row) + '\n{broken}\n' + payload));
    await fs.writeFile(filename, malformed);
    await assert.rejects(async () => { for await (const _entry of readJsonLinesIterator(filename, { maxInFlight: 1 })) {} }, /JSONL|JSON|line 2|:2/);
    assertClosed();
    await fs.writeFile(filename, bytes);
    if (codec !== 'plain') {
      sources = []; decoders = [];
      await assert.rejects(async () => { for await (const _entry of readJsonLinesIterator(filename,
        { maxBytes: bytes.length + 1, maxInFlight: 1 })) {} }, { code: 'ERR_JSON_TOO_LARGE' });
      assertClosed();
    }
    sources = []; decoders = [];
    closeFailure = Object.freeze(new Error(`${codec} independent close failure`));
    const iterator = readJsonLinesIterator(filename, { maxInFlight: 1 });
    assert.deepEqual((await iterator.next()).value, row);
    await assert.rejects(iterator.return(), error => contains(error, closeFailure));
    assertClosed();
    sources = []; decoders = [];
    const callbackFailure = Object.freeze(new Error(`${codec} callback failure`));
    await assert.rejects(readJsonLinesEachAwait(filename, () => { throw callbackFailure; }, { maxInFlight: 1 }),
      error => contains(error, callbackFailure) && contains(error, closeFailure));
    assertClosed();
    closeFailure = null;
  }
} finally { fsSync.createReadStream = nativeCreate; await fs.rm(root, { recursive: true, force: true }); }
console.log('Plain/gzip/zstd JSONL consumers settle sources and preserve independent return/callback cleanup failures.');
