#!/usr/bin/env node
import assert from 'node:assert/strict';
import { setImmediate as tick } from 'node:timers/promises';
import { orderedBundleShardWindow } from '../../../src/storage/sqlite/build/bundle-pipeline.js';
import { measureBundleProjectionBytes } from '../../../src/storage/sqlite/build/bundle-projection-size.js';
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const head = deferred(), consumed = deferred(), events = [], metrics = {}; let closed = 0;
const tasks = [0, 1, 2, 3].map(index => ({ index, reservedBytes: 4 }));
const output = [];
const run = (async () => {
  for await (const result of orderedBundleShardWindow({ source: tasks, concurrency: 3, maxBytes: 12, metrics,
    close: async () => { closed++; }, load: async task => {
      events.push('start-' + task.index);
      if (task.index === 0) await head.promise;
      events.push('done-' + task.index);
      return { index: task.index, encodedBytes: 1, projectionBytes: 2 };
    } })) {
    output.push(result.index);
    if (result.index === 0) { consumed.resolve(); await tick(); }
  }
})();
await tick();
assert.deepEqual(events.filter(value => value.startsWith('start')), ['start-0', 'start-1', 'start-2']);
assert.deepEqual(output, []); assert.equal(metrics.currentReservedBytes, 12, 'completed out-of-order shards retain credit');
head.resolve(); await consumed.promise; await run;
assert.deepEqual(output, [0, 1, 2, 3]); assert.equal(closed, 1);
assert.equal(metrics.peakReservedBytes, 12); assert.equal(metrics.currentReservedBytes, 0);
assert.ok(events.indexOf('start-3') < events.indexOf('done-3'));
const budget = {};
for await (const unused of orderedBundleShardWindow({ source: [{ reservedBytes: 20 }, { reservedBytes: 1 }],
  concurrency: 2, maxBytes: 10, metrics: budget, load: async () => ({}) })) void unused;
assert.equal(budget.oversizeSingleShards, 1); assert.equal(budget.peakPendingShards, 1);
const failure = new Error('later corrupt shard'), failureMetrics = {}; let drained = false;
await assert.rejects(async () => {
  for await (const item of orderedBundleShardWindow({ source: tasks, concurrency: 2, maxBytes: 8, metrics: failureMetrics,
    close: async () => { drained = true; }, load: async task => { if (task.index === 1) throw failure; return { index: task.index }; }
  })) void item;
}, error => error === failure);
assert.equal(drained, true); assert.equal(failureMetrics.currentReservedBytes, 0);
const data = { typed: new Uint32Array([1, 2]), rows: [{ value: 'α' }], map: new Map([['x', 1]]) };
const bytes = measureBundleProjectionBytes(data);
assert.ok(bytes > 8); assert.equal(data.typed.byteLength, 8);
assert.throws(() => measureBundleProjectionBytes(data, bytes - 1), { code: 'ERR_SQLITE_BUNDLE_DECODE_BUDGET' });
const controller = new AbortController(); controller.abort();
await assert.rejects(async () => {
  for await (const item of orderedBundleShardWindow({ source: tasks, concurrency: 2, maxBytes: 8,
    signal: controller.signal, load: async () => assert.fail('aborted work cannot decode') })) void item;
}, { code: 'ABORT_ERR' });

const liveController = new AbortController(), liveGate = deferred(), liveStarted = deferred();
let liveClosed = false;
const live = (async () => {
  for await (const item of orderedBundleShardWindow({ source: [{ reservedBytes: 4 }], concurrency: 1, maxBytes: 4,
    signal: liveController.signal, close: async () => { liveClosed = true; liveGate.resolve(); },
    load: async () => { liveStarted.resolve(); await liveGate.promise; return {}; } })) void item;
})();
const cancelled = assert.rejects(live, { code: 'ABORT_ERR' });
await liveStarted.promise; liveController.abort(); await cancelled;
assert.equal(liveClosed, true, 'cancellation initiates close before waiting for the decode response');
const primaryFailure = new Error('primary decode'), cleanupFailure = new Error('retirement incomplete'), retained = {};
await assert.rejects(async () => {
  for await (const item of orderedBundleShardWindow({ source: [{ reservedBytes: 4 }], concurrency: 1,
    maxBytes: 4, metrics: retained, load: async () => { throw primaryFailure; },
    close: async () => { throw cleanupFailure; } })) void item;
}, error => error === primaryFailure && error.bundlePipelineTeardownError === cleanupFailure);
assert.equal(retained.currentReservedBytes, 4); assert.equal(retained.retainedOnTeardownFailureBytes, 4);
