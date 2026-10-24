import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { writeJsonLinesSharded, writeJsonLinesShardedAsync } from '../../../src/shared/json-stream/jsonl-sharded.js';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-jsonl-row-lifetime-'));
let fixture = 0;
const run = async (items, options = {}) => {
  const dir = path.join(root, String(fixture++));
  await fs.mkdir(dir);
  const { async: useAsync = false, ...writerOptions } = options;
  const result = await (useAsync ? writeJsonLinesShardedAsync : writeJsonLinesSharded)({
    dir, partsDirName: 'parts', partPrefix: 'part-', items, maxBytes: 1024, maxItems: 2,
    ...writerOptions
  });
  const raw = await Promise.all(result.parts.map(part => fs.readFile(path.join(dir, part))));
  const content = raw.map(bytes => options.compression === 'gzip' ? gunzipSync(bytes) : bytes);
  assert.deepEqual(result.bytes, raw.map(bytes => bytes.length));
  assert.equal(result.totalBytes, raw.reduce((sum, bytes) => sum + bytes.length, 0));
  assert.equal(result.total, result.counts.reduce((sum, count) => sum + count, 0));
  assert.equal(result.parts.length, result.counts.length);
  assert.ok(result.counts.every(count => count > 0), 'no empty trailing shard');
  if (options.offsets) {
    assert.equal(result.offsets?.length || 0, result.parts.length);
    for (let index = 0; index < result.parts.length; index++) {
      const offsets = await fs.readFile(path.join(dir, result.offsets[index]));
      const lines = content[index].toString('utf8').trimEnd().split('\n');
      assert.equal(offsets.length, lines.length * 8);
      let position = 0;
      for (let row = 0; row < lines.length; row++) {
        assert.equal(offsets.readBigUInt64LE(row * 8), BigInt(position));
        position += Buffer.byteLength(lines[row]) + 1;
      }
      assert.equal(position, content[index].length);
    }
  }
  return { result, content, dir };
};
const expectedRows = [1, 2, 3].map(id => ({ id, nested: { value: `雪😀-${id}` } }));
const expected = expectedRows.map(row => JSON.stringify(row) + '\n').join('');
const contains = (error, expected) => {
  const pending = [error], seen = new Set();
  while (pending.length) {
    const value = pending.pop(); if (value === expected) return true;
    if (!value || typeof value !== 'object' || seen.has(value)) continue;
    seen.add(value); pending.push(value.cause, ...(Array.isArray(value.errors) ? value.errors : []));
  }
  return false;
};
const reusedRows = function* () {
  const row = { id: 0, nested: { value: '' } };
  for (const next of expectedRows) {
    row.id = next.id; row.nested.value = next.nested.value;
    yield row;
  }
  row.id = -1; row.nested.value = 'cleared at done';
};
try {
  for (const compression of [null, 'gzip']) {
    for (const useAsync of [false, true]) {
      const sources = [
        function* fresh() { for (const row of expectedRows) yield structuredClone(row); },
        reusedRows,
        function* nested() {
          const nested = { value: '' };
          for (const row of expectedRows) {
            nested.value = row.nested.value;
            yield { id: row.id, nested };
          }
          nested.value = 'cleared at done';
        }
      ];
      for (const source of sources) {
        const items = useAsync ? (async function* () { yield* source(); })() : source();
        const { result, content } = await run(items, {
          async: useAsync, compression, offsets: compression ? null : { suffix: 'offsets.bin' }
        });
        assert.equal(Buffer.concat(content).toString('utf8'), expected);
        assert.deepEqual(result.counts, [2, 1]);
      }
    }
  }
  const observations = [];
  const ordered = (function* () {
    for (let id = 1; id <= 3; id++) {
      observations.push(`next:${id}`);
      yield { toJSON() { observations.push(`serialize:${id}`); return { id }; } };
    }
    observations.push('done');
  })();
  await run(ordered);
  assert.deepEqual(observations, ['next:1', 'serialize:1', 'next:2', 'serialize:2', 'next:3', 'serialize:3', 'done']);

  const empty = await run([]);
  assert.deepEqual(empty.result.parts, []);
  assert.equal(empty.result.totalBytes, 0);
  const oneLine = Buffer.byteLength('{"id":1}\n');
  const exact = await run([{ id: 1 }, { id: 2 }], { maxBytes: oneLine, offsets: {} });
  assert.deepEqual(exact.result.counts, [1, 1]);
  assert.deepEqual(exact.result.bytes, [oneLine, oneLine]);
  const single = await run([{ id: 1 }], { maxBytes: oneLine, maxItems: 1 });
  assert.deepEqual(single.result.counts, [1]);
  const maxItems = await run([{ id: 1 }, { id: 2 }], { maxItems: 1 });
  assert.deepEqual(maxItems.result.counts, [1, 1]);

  const failureDir = path.join(root, 'failure'); await fs.mkdir(failureDir);
  const oldParts = path.join(failureDir, 'parts'); await fs.mkdir(oldParts);
  await fs.writeFile(path.join(oldParts, 'old'), 'retained generation');
  const cleanupError = new Error('iterator cleanup failed');
  const sourceError = new Error('source failed');
  const denied = new Error('admission failed');
  for (const failure of ['oversized', 'admission', 'serialization', 'source', 'abort', 'write']) {
    let advances = 0, closed = 0;
    const controller = new AbortController();
    const items = {
      [Symbol.iterator]() { return this; },
      next() {
        advances++;
        if (failure === 'source' && advances === 2) throw sourceError;
        if (advances > 1) return { done: true };
        const row = { id: 1, text: 'x'.repeat(failure === 'write' ? 1024 * 1024 : 20) };
        if (failure === 'serialization') row.self = row;
        return { value: row, done: false };
      },
      return() { closed++; throw cleanupError; }
    };
    const originalCreate = fsSync.createWriteStream;
    const writeError = new Error('disk write failed');
    if (failure === 'write') fsSync.createWriteStream = (...args) => {
      const stream = originalCreate(...args);
      stream._write = (_chunk, _encoding, callback) => callback(writeError);
      return stream;
    };
    try {
      await assert.rejects(writeJsonLinesSharded({ dir: failureDir, partsDirName: 'parts', partPrefix: 'part-', items,
        maxBytes: failure === 'oversized' ? 1 : failure === 'write'
          ? Buffer.byteLength(JSON.stringify({ id: 1, text: 'x'.repeat(1024 * 1024) })) + 1 : 2 * 1024 * 1024,
        signal: controller.signal,
        ...(failure === 'admission' || failure === 'abort' ? { diskAccount: {
          reserve() { if (failure === 'abort') controller.abort(); else throw denied; }, release() {}
        } } : {})
      }), error => {
        assert.ok(contains(error, cleanupError), `${failure} retains input cleanup error`);
        if (failure === 'oversized') return error.code === 'ERR_JSON_TOO_LARGE';
        if (failure === 'source') return contains(error, sourceError);
        if (failure === 'abort') return error.name === 'AbortError';
        if (failure === 'write') return contains(error, writeError);
        if (failure === 'serialization') return error instanceof TypeError || error.cause instanceof TypeError;
        return contains(error, denied);
      });
    } finally { fsSync.createWriteStream = originalCreate; }
    assert.equal(advances, failure === 'source' ? 2 : 1, `${failure} cannot request an extra row`);
    assert.equal(closed, 1);
    assert.deepEqual(await fs.readdir(failureDir), ['parts'], `${failure} retires staging directory`);
    assert.equal(await fs.readFile(path.join(oldParts, 'old'), 'utf8'), 'retained generation');
  }
  for (const useAsync of [false, true]) {
    for (const getterFailure of [false, true]) {
      const primary = Object.freeze(new Error('captured next failed'));
      const cleanup = Object.freeze(new Error('frozen iterator close failed'));
      let gets = 0, calls = 0, closes = 0;
      const iterator = { return() { closes++; throw cleanup; } };
      Object.defineProperty(iterator, 'next', { get() {
        gets++;
        if (getterFailure) throw primary;
        return function () { calls++; throw primary; };
      } });
      const items = { [useAsync ? Symbol.asyncIterator : Symbol.iterator]() { return iterator; } };
      await assert.rejects((useAsync ? writeJsonLinesShardedAsync : writeJsonLinesSharded)({
        dir: failureDir, partsDirName: 'parts', partPrefix: 'part-', items
      }), error => contains(error, primary) && contains(error, cleanup));
      assert.equal(gets, 1); assert.equal(calls, getterFailure ? 0 : 1); assert.equal(closes, 1);
      assert.deepEqual(await fs.readdir(failureDir), ['parts']);
      assert.equal(await fs.readFile(path.join(oldParts, 'old'), 'utf8'), 'retained generation');
    }
  }
} finally { await fs.rm(root, { recursive: true, force: true }); }
console.log('Sharded JSONL consumes reusable yields before advancing; exact bytes, offsets and failure ownership verified.');
