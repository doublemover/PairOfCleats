import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createJsonlBatchWriter } from '../../../src/shared/json-stream/jsonl-batch.js';
import { JsonlCompressionPool } from '../../../src/shared/json-stream/jsonl-compression-pool.js';
import { readJsonLinesArray } from '../../../src/shared/artifact-io/json.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv({ testing: '1' });
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-codec-publish-'));
const nativeCreate = fsSync.createWriteStream, nativeRename = fs.rename;
const nativeClose = JsonlCompressionPool.prototype.close;
const gate = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};
const contains = (error, expected) => {
  const pending = [error], seen = new Set();
  while (pending.length) {
    const entry = pending.pop();
    if (entry === expected) return true;
    if (!entry || typeof entry !== 'object' || seen.has(entry)) continue;
    seen.add(entry); pending.push(entry.cause, ...(entry.errors || []));
  }
  return false;
};
let files = [], events = [], target = null, closeFailure = null, replaceFailure = null;
const releases = [], pendingClosures = [];
fsSync.createWriteStream = function (...args) {
  const stream = nativeCreate.apply(this, args); files.push(stream);
  if (closeFailure) {
    const failure = closeFailure, destroy = stream._destroy;
    stream._destroy = function (error, callback) {
      destroy.call(this, error, actual => callback(actual || failure));
    };
  }
  return stream;
};
fs.rename = async function (source, destination, ...args) {
  if (destination === target) {
    events.push('replace');
    if (replaceFailure) throw replaceFailure;
  }
  return nativeRename.call(this, source, destination, ...args);
};
try {
  for (const scenario of ['success', 'teardown-existing', 'teardown-new', 'abort', 'destination', 'replace']) {
    target = path.join(root, `${scenario}.jsonl.zst`);
    const existed = scenario !== 'teardown-new';
    if (existed) await fs.writeFile(target, 'previous good artifact');
    files = []; events = [];
    const entered = gate(), release = gate();
    releases.push(release.resolve);
    const teardownFailure = Object.freeze(new Error('controlled owned codec teardown failed'));
    closeFailure = scenario === 'destination' ? Object.freeze(new Error('controlled destination close failed')) : null;
    replaceFailure = scenario === 'replace' ? Object.freeze(Object.assign(new Error('controlled replacement failed'), { code: 'EIO' })) : null;
    const closures = new WeakMap();
    JsonlCompressionPool.prototype.close = function () {
      if (closures.has(this)) return closures.get(this);
      const pending = (async () => {
        // The original owner actually joins its workers. The controlled gate
        // delays its public settlement receipt without leaking native work.
        await nativeClose.call(this);
        events.push('codec-entered'); entered.resolve();
        if (scenario !== 'destination') {
          assert.ok(files.every(file => file.closed), 'seal output before owned codec settlement');
          events.push('sealed');
          await release.promise;
        }
        if (scenario.startsWith('teardown-')) throw teardownFailure;
        events.push('codec-settled');
      })();
      closures.set(this, pending); return pending;
    };
    const controller = new AbortController();
    const writer = createJsonlBatchWriter(target, { compression: 'zstd', atomic: true,
      workerCount: 1, signal: controller.signal });
    const rows = [{ id: 1, text: '雪😀' }, { id: 2 }];
    for (const row of rows) await writer.writeLine(JSON.stringify(row));
    const closing = writer.close();
    pendingClosures.push(closing);
    closing.catch(() => {});
    assert.equal(writer.close(), closing, 'repeated close shares its publication owner');
    await entered.promise;
    if (existed) assert.equal(await fs.readFile(target, 'utf8'), 'previous good artifact');
    else await assert.rejects(fs.stat(target), { code: 'ENOENT' });
    assert.equal(events.includes('replace'), false);
    if (scenario === 'abort') controller.abort();
    release.resolve();
    if (scenario === 'success') {
      await closing;
      assert.deepEqual(events, ['codec-entered', 'sealed', 'codec-settled', 'replace']);
      assert.deepEqual(await readJsonLinesArray(target), rows);
    } else {
      const expected = scenario.startsWith('teardown-') ? teardownFailure : closeFailure || replaceFailure;
      await assert.rejects(closing, error => scenario === 'abort' ? error.code === 'ABORT_ERR' : contains(error, expected));
      if (existed) assert.equal(await fs.readFile(target, 'utf8'), 'previous good artifact');
      else await assert.rejects(fs.stat(target), { code: 'ENOENT' });
    }
    assert.ok(files.every(file => file.closed));
    assert.deepEqual((await fs.readdir(root)).filter(name => name.includes('.tmp-')), []);
  }
  JsonlCompressionPool.prototype.close = nativeClose;
  target = path.join(root, 'borrowed.jsonl.zst'); files = []; events = ['codec-settled'];
  closeFailure = null; replaceFailure = null;
  const borrowed = new JsonlCompressionPool({ compression: 'zstd', workerCount: 1 });
  let borrowedCloses = 0;
  borrowed.close = () => { borrowedCloses++; return nativeClose.call(borrowed); };
  try {
    const writer = createJsonlBatchWriter(target, { compression: 'zstd', atomic: true, pool: borrowed });
    await writer.writeLine('{"borrowed":true}'); await writer.close();
    assert.equal(borrowedCloses, 0, 'individual publication joins its tasks without closing a borrowed pool');
    assert.equal(borrowed.stats().reservedBytes, 0);
    assert.deepEqual(await readJsonLinesArray(target), [{ borrowed: true }]);
    assert.equal(borrowed.closed, false);
  } finally { await borrowed.close(); }
} finally {
  for (const release of releases) release();
  await Promise.allSettled(pendingClosures);
  JsonlCompressionPool.prototype.close = nativeClose;
  fsSync.createWriteStream = nativeCreate; fs.rename = nativeRename;
  await fs.rm(root, { recursive: true, force: true });
}
console.log('Standalone atomic JSONL publication follows sealed output and owned codec settlement.');
