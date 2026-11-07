import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createVfsColdStartSeries } from '../../../tools/bench/vfs/cold-start-cache.js';
import { observeStorageResource } from '../../../src/shared/storage/failure-observation.js';
import { applyTestEnv } from '../../helpers/test-env.js';
applyTestEnv();
const work = { docs: 3, docBytes: 8, samples: 3, content: 'ascii' }, calls = [];
// Explicit inert scenario adapter: this proves scheduler/root/receipt ownership,
// not disk content, native process or performance qualification.
const observation = mode => ({ mode, pid: 5000 + calls.length, state: 'qualified-phase',
  workload: { docs: 3, bytes: 24 }, consumerParity: { state: 'byte-identical', sha256: 'b'.repeat(64), bytes: 24 },
  counts: { documents: 3 }, phases: { totalMs: 1, cacheLoadMs: 0, warmupMs: 0, documentAccessMs: 1, flushMs: 0 } });
const series = await createVfsColdStartSeries(work, { runChild: async request => { calls.push(request); return observation(request.mode); } });
await assert.rejects(series.complete(), { code: 'ERR_VFS_BENCH_INCOMPLETE' });
for (let step = 0; step < 9; step++) {
  const result = await series.runNext(); result.observation.counts.documents = 1000;
  const copied = series.snapshot(); copied.order.push({ sample: 1000, mode: 'fake' });
}
assert.equal(series.done, true);
await assert.rejects(series.runNext(), RangeError);
const report = await series.complete();
assert.deepEqual(calls.map(row => row.mode), ['cold', 'warm', 'hot', 'cold', 'hot', 'warm', 'cold', 'warm', 'hot']);
assert.deepEqual(calls.map(row => path.basename(row.rootDir)), ['sample-1', 'sample-1', 'sample-1',
  'sample-2', 'sample-2', 'sample-2', 'sample-3', 'sample-3', 'sample-3']);
assert.equal(new Set(calls.map(row => row.rootDir)).size, 3);
assert.equal(report.cold.completedDocuments, 9); assert.equal(report.order.length, 9);
await assert.rejects(fs.stat(series.fixtureRoot), { code: 'ENOENT' });
await assert.rejects(series.runNext(), /already closed/u);

let settle;
const primary = Object.freeze(new Error('cancelled qualification owner'));
const blocked = await createVfsColdStartSeries({ ...work, samples: 1 }, { runChild: () => new Promise(resolve => { settle = resolve; }) });
const pending = blocked.runNext();
// Marker creation is real asynchronous I/O. Wait only for the named adapter's
// actual admission before requesting closure, not an arbitrary timing sleep.
while (!settle) await new Promise(resolve => setImmediate(resolve));
await assert.rejects(blocked.runNext(), { code: 'ERR_VFS_BENCH_PENDING' });
let failure;
try { await blocked.abort(primary); } catch (error) { failure = error; }
assert.equal(observeStorageResource(failure).isSettled(), false);
assert.ok((await fs.stat(blocked.fixtureRoot)).isDirectory());
settle(observation('cold')); await pending;
await assert.rejects(blocked.abort(primary), error => error === primary);
await assert.rejects(fs.stat(blocked.fixtureRoot), { code: 'ENOENT' });
console.log('Original VFS series owns all9ordered scenarios, immutable observations and settlement-before-cleanup.');
