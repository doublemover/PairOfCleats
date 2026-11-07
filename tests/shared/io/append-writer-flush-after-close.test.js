#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { createQueuedAppendWriter } from '../../../src/shared/io/append-writer.js';
import { ensureTestingEnv } from '../../helpers/test-env.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

ensureTestingEnv(process.env);

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, `append-writer-flush-after-close-${process.pid}-${Date.now()}`);
const filePath = path.join(tempRoot, 'events.log');
const errors = [];

await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });

const writer = createQueuedAppendWriter({
  filePath,
  syncOnFlush: true,
  onError(stage, err) {
    errors.push({
      stage,
      code: err?.code || null,
      message: err?.message || String(err)
    });
  }
});

await writer.enqueue('first\n');
await writer.close();
await writer.flush();
await writer.enqueue('late\n');
await writer.flush();

const text = await fs.readFile(filePath, 'utf8');
assert.equal(text, 'first\n', 'writer should ignore flush/enqueue calls after close');
assert.deepEqual(errors, [], 'flush after close should not touch a closed handle');
const originalOpen = fs.open;
const observed = new Map();
fs.open = async (filename, ...args) => {
  const handle = await originalOpen(filename, ...args);
  const key = path.resolve(filename);
  if (!key.startsWith(tempRoot + path.sep)) return handle;
  const counts = observed.get(key) || { writes: 0, syncs: 0, closes: 0, fds: [], events: [] };
  counts.fds.push(handle.fd);
  observed.set(key, counts);
  for (const [method, counter] of [['write', 'writes'], ['writeFile', 'writes'], ['sync', 'syncs'], ['close', 'closes']]) {
    const original = handle[method];
    handle[method] = async function (...values) {
      counts[counter] += 1;
      counts.events.push(method);
      return Reflect.apply(original, this, values);
    };
  }
  return handle;
};
try {
  const drainPath = path.join(tempRoot, 'accepted-before-close.ndjson');
  const drain = createQueuedAppendWriter({ filePath: drainPath, syncOnFlush: true,
    onError: (stage, err) => errors.push({ stage, code: err?.code || null }) });
  const records = Array.from({ length: 8 }, (_, index) => JSON.stringify({ index, text: 'accepted λ😀' }) + '\n');
  const pending = records.map(record => drain.enqueue(record));
  await Promise.all([drain.close(), drain.close(), ...pending]);
  assert.equal(await fs.readFile(drainPath, 'utf8').catch(err => {
    if (err.code !== 'ENOENT') throw err;
    return '';
  }), records.join(''), 'close drains accepted records even before the descriptor opens');
  const drainCounts = observed.get(drainPath);
  assert.ok(drainCounts && drainCounts.syncs > 0, 'drained records are synchronized before close');
  assert.equal(drainCounts.closes, 1, 'concurrent close calls retain one descriptor owner');
  assert.ok(drainCounts.events.indexOf('sync') < drainCounts.events.indexOf('close'),
    'accepted records are synchronized before the descriptor closes');
  for (const fd of drainCounts.fds) assert.throws(() => fsSync.fstatSync(fd), { code: 'EBADF' });
  await drain.flush();
  await drain.enqueue('late\n');
  assert.equal(await fs.readFile(drainPath, 'utf8'), records.join(''));

  const burstPath = path.join(tempRoot, 'bounded-burst.ndjson');
  const burst = createQueuedAppendWriter({ filePath: burstPath, syncOnFlush: true,
    onError: (stage, err) => errors.push({ stage, code: err?.code || null }) });
  const lines = Array.from({ length: 5000 }, (_, index) => JSON.stringify({ index, text: 'ordered λ😀' }) + '\n');
  lines.unshift('\ud83d', '\ude00');
  lines.splice(2500, 0, JSON.stringify({ index: 'large', text: 'λ'.repeat(40000) }) + '\n');
  try {
    await Promise.all(lines.map(line => burst.enqueue(line)));
    await burst.flush();
  } finally { await burst.close(); }
  assert.deepEqual(await fs.readFile(burstPath), Buffer.concat(lines.map(line => Buffer.from(line))),
    'each accepted string keeps its own UTF-8 encoding, including split surrogates, bounded batches and a larger record');
  const burstCounts = observed.get(burstPath);
  assert.ok(burstCounts.writes <= 16, `5003 queued records must use bounded aggregate I/O, observed ${burstCounts.writes} writes`);
  assert.equal(burstCounts.closes, 1);
  assert.equal(burstCounts.fds.length, 1, 'burst writes reuse one descriptor');
  for (const fd of burstCounts.fds) assert.throws(() => fsSync.fstatSync(fd), { code: 'EBADF' });
  assert.deepEqual(errors, [], 'drain, flush and close do not touch a closed descriptor');
} finally {
  fs.open = originalOpen;
  await fs.rm(tempRoot, { recursive: true, force: true });
}

console.log('append writer drain, bounded batching and flush-after-close contracts passed');
