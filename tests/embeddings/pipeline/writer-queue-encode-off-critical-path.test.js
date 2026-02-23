#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  encodeCacheEntryPayload,
  readCacheEntryFile,
  resolveCacheEntryPath,
  writeCacheEntry
} from '../../../tools/build/embeddings/cache.js';
import { createBoundedWriterQueue } from '../../../tools/build/embeddings/writer-queue.js';
import { applyTestEnv } from '../../helpers/test-env.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';

applyTestEnv({ testing: '1' });

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'embeddings-writer-queue-encode-off-critical-path');
const cacheDir = path.join(tempRoot, 'files');
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(cacheDir, { recursive: true });

const payloadA = {
  key: 'cache-a',
  file: 'src/a.js',
  hash: 'hash-a',
  chunkSignature: 'sig-a',
  chunkHashes: ['ha'],
  cacheMeta: { identityKey: 'identity:test' },
  codeVectors: [[1, 2]],
  docVectors: [[3, 4]],
  mergedVectors: [[5, 6]]
};
const payloadB = {
  key: 'cache-b',
  file: 'src/b.js',
  hash: 'hash-b',
  chunkSignature: 'sig-b',
  chunkHashes: ['hb'],
  cacheMeta: { identityKey: 'identity:test' },
  codeVectors: [[7, 8]],
  docVectors: [[9, 10]],
  mergedVectors: [[11, 12]]
};

const encodedA = await encodeCacheEntryPayload(payloadA);
const encodedB = await encodeCacheEntryPayload(payloadB);
assert.ok(Buffer.isBuffer(encodedA) && encodedA.length > 0, 'expected encoded buffer for payload A');
assert.ok(Buffer.isBuffer(encodedB) && encodedB.length > 0, 'expected encoded buffer for payload B');

const ioOrder = [];
const writerQueue = createBoundedWriterQueue({
  scheduleIo: async (fn) => {
    ioOrder.push('io:start');
    await delay(10);
    const result = await fn();
    ioOrder.push('io:end');
    return result;
  },
  maxPending: 1
});

await Promise.all([
  writerQueue.enqueue(async () => {
    ioOrder.push('write:a');
    await writeCacheEntry(cacheDir, 'cache-a', { malformed: true }, { encodedBuffer: encodedA });
  }),
  writerQueue.enqueue(async () => {
    ioOrder.push('write:b');
    await writeCacheEntry(cacheDir, 'cache-b', { malformed: true }, { encodedBuffer: encodedB });
  })
]);
await writerQueue.onIdle();

const pathA = resolveCacheEntryPath(cacheDir, 'cache-a');
const pathB = resolveCacheEntryPath(cacheDir, 'cache-b');
assert.ok(pathA && pathB, 'expected cache entry paths');
const decodedA = await readCacheEntryFile(pathA);
const decodedB = await readCacheEntryFile(pathB);

assert.equal(decodedA?.hash, payloadA.hash, 'expected payload A write to succeed with pre-encoded buffer');
assert.equal(decodedB?.hash, payloadB.hash, 'expected payload B write to succeed with pre-encoded buffer');
assert.deepEqual(
  ioOrder.filter((entry) => entry.startsWith('write:')),
  ['write:a', 'write:b'],
  'expected writer queue ordering to remain deterministic'
);

console.log('embeddings writer queue encode off critical path test passed');
