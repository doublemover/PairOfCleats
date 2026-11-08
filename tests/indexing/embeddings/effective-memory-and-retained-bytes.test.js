#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readEffectiveMemory, estimateRetainedBytes } from '../../../src/shared/effective-memory.js';
import { resolveRuntimeMemoryPolicy } from '../../../src/index/build/runtime/workers.js';
import { resolveWorkerResourceLimits } from '../../../src/index/build/workers/config.js';
import { createEmbeddingTextReuseCache } from '../../../tools/build/embeddings/runner.js';
import { createBoundedWriterQueue } from '../../../tools/build/embeddings/writer-queue.js';
import { createBuildScheduler } from '../../../src/shared/concurrency/scheduler-core.js';

const MB = 1024 * 1024;
const snapshot = readEffectiveMemory({ hostTotalBytes: 64 * 1024 * MB, hostFreeBytes: 48 * 1024 * MB,
  constrainedBytes: 512 * MB, configuredLimitBytes: 384 * MB, availableBytes: 256 * MB, rssBytes: 64 * MB });
assert.equal(snapshot.totalBytes, 384 * MB);
assert.equal(snapshot.freeBytes, 256 * MB);
assert.equal(snapshot.constrained, true);
assert.equal(readEffectiveMemory({ ...snapshot, availableBytes: 0 }).freeBytes, 0,
  'zero available memory is pressure rather than missing telemetry');
// macOS process availability includes inactive/purgeable pages; raw host free
// pages must not discard that authoritative headroom. Keep every hard bound.
const reclaimable = { hostTotalBytes: 8 * 1024 * MB, hostFreeBytes: 256 * MB,
  constrainedBytes: Number.NaN, configuredLimitBytes: 4 * 1024 * MB,
  availableBytes: 3 * 1024 * MB, rssBytes: 512 * MB };
assert.equal(readEffectiveMemory(reclaimable).freeBytes, 3 * 1024 * MB,
  'process-available headroom includes memory the OS can reclaim');
assert.equal(readEffectiveMemory({ ...reclaimable, availableBytes: Number.NaN }).freeBytes, 256 * MB,
  'unknown process availability falls back to measured host free memory');
assert.equal(readEffectiveMemory({ ...reclaimable, availableBytes: 0 }).freeBytes, 0);
assert.equal(readEffectiveMemory({ ...reclaimable, availableBytes: 64 * MB }).freeBytes, 64 * MB,
  'smaller process allowance still wins over optimistic host telemetry');
assert.equal(readEffectiveMemory({ ...reclaimable, constrainedBytes: 1024 * MB,
  configuredLimitBytes: 768 * MB, rssBytes: 256 * MB }).freeBytes, 512 * MB,
'container/configured headroom still caps reclaimable availability');
const policy = resolveRuntimeMemoryPolicy({ indexingConfig: {}, cpuConcurrency: 2, memorySnapshot: snapshot });
assert.ok(policy.maxGlobalRssMb < 384, 'the old 2-GiB floor cannot override a constrained budget');
assert.ok(policy.reserveRssMb < 128);
assert.ok(policy.perWorkerCacheMb + policy.perWorkerWriteBufferMb + policy.effectiveWorkerHeapMb
  <= (policy.maxGlobalRssMb - policy.reserveRssMb) / 2 + 1);
const limits = resolveWorkerResourceLimits(2, { targetPerWorkerMb: 128, minPerWorkerMb: 128,
  maxPerWorkerMb: 128, memorySnapshot: snapshot });
assert.ok(limits.maxOldGenerationSizeMb <= 128);
const backing = new ArrayBuffer(4096), view = new Uint8Array(backing, 0, 4);
assert.ok(estimateRetainedBytes(view) >= 4096, 'subarray retention/IPC includes its entire backing allocation');

const cache = createEmbeddingTextReuseCache({ maxEntries: 10000, maxBytes: 4096 });
for (let round = 0; round < 4; round++) {
  for (let i = 0; i < 1000; i++) cache.set(`round${round}-text${i}`, new Float32Array(16));
  assert.ok(cache.stats().retainedBytes <= 4096, 'small deterministic retained storage plateaus below the byte cap');
}
cache.set('oversized', new Float32Array(4096));
assert.equal(cache.get('oversized'), null);
cache.clear(); assert.equal(cache.stats().retainedBytes, 0);

let release;
const held = new Promise(resolve => { release = resolve; });
const queue = createBoundedWriterQueue({ maxPending: 1, maxPendingBytes: 1024,
  scheduleIo: fn => fn() });
let encoded = 0;
await queue.enqueue(() => held, { bytes: 512 });
const waiting = queue.enqueuePrepared({ estimateBytes: 512, prepare: () => { encoded++; return Buffer.alloc(128); }, write() {} });
await Promise.resolve();
assert.equal(encoded, 0, 'waiting producers cannot allocate encoded payload before byte/count admission');
assert.equal(queue.stats().waitingProducerBytes, 512);
release(); await waiting; await queue.onIdle();
assert.equal(encoded, 1);
for (const key of ['pending', 'pendingBytes', 'producers', 'waitingProducerBytes', 'preparing']) assert.equal(queue.stats()[key], 0);
await queue.enqueuePrepared({ estimateBytes: 512, prepare: () => { throw new Error('controlled encoding failure'); }, write() {} });
await queue.onIdle(); assert.equal(queue.stats().failed, 1);
assert.equal(queue.stats().pendingBytes, 0);
await assert.rejects(queue.enqueuePrepared({ estimateBytes: 2048, prepare() { throw new Error('must not encode'); }, write() {} }), /byte budget/);

const cancel = new AbortController();
let finishWrite;
let enterWrite;
const activeWrite = new Promise(resolve => { finishWrite = resolve; });
const writeEntered = new Promise(resolve => { enterWrite = resolve; });
const cancelledQueue = createBoundedWriterQueue({ maxPending: 1, maxPendingBytes: 512, signal: cancel.signal });
await cancelledQueue.enqueue(() => { enterWrite(); return activeWrite; }, { bytes: 512 });
await writeEntered;
const waitingForCancel = cancelledQueue.enqueuePrepared({ estimateBytes: 512,
  prepare() { assert.fail('cancelled waiting producer must never encode'); }, write() {} });
cancel.abort();
await assert.rejects(waitingForCancel, { name: 'AbortError' });
assert.equal(cancelledQueue.stats().waitingProducerBytes, 0);
finishWrite(); await assert.rejects(cancelledQueue.onIdle(), { code: 'ABORT_ERR' });
assert.equal(cancelledQueue.stats().cancelled, 1);
assert.equal(cancelledQueue.stats().pendingBytes, 0);

const deferredCancel = new AbortController();
const deferredQueue = createBoundedWriterQueue({ maxPending: 1, signal: deferredCancel.signal });
const admitted = deferredQueue.enqueuePrepared({ estimateBytes: 512,
  prepare() { assert.fail('cancelled admitted producer must never encode'); }, write() {} });
deferredCancel.abort();
await admitted; await assert.rejects(deferredQueue.onIdle(), { code: 'ABORT_ERR' });
assert.equal(deferredQueue.stats().failed, 1);
assert.equal(deferredQueue.stats().cancelled, 1);
assert.equal(deferredQueue.stats().pendingBytes, 0);

let now = 1000;
const scheduler = createBuildScheduler({ enabled: true, adaptive: true, now: () => now,
  cpuTokens: 8, ioTokens: 8, memoryTokens: 8, maxMemoryTokens: 8, adaptiveMemoryReserveMb: 0,
  adaptiveMemoryPerTokenMb: 64, memoryBudget: { hostTotalBytes: 64 * 1024 * MB,
    hostFreeBytes: 48 * 1024 * MB, constrainedBytes: 128 * MB, availableBytes: 16 * MB, rssBytes: 112 * MB } });
await scheduler.schedule('memory-fixture', { mem: 1 }, () => { now += 1000; });
assert.ok(scheduler.stats().tokens.mem.total <= 1, 'effective headroom caps admission below optimistic host defaults');
await scheduler.shutdown({ awaitRunning: true });
console.log('Effective constrained memory, retained-byte plateau and pre-encoding producer admission pass.');
