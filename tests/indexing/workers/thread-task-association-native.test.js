import assert from 'node:assert/strict';
import path from 'node:path';
import { performance, monitorEventLoopDelay } from 'node:perf_hooks';
import { setImmediate as tick } from 'node:timers/promises';
import Piscina from 'piscina';
import { createIndexerThreadPool } from '../../../src/index/build/workers/thread-pool.js';
import { createBuildScheduler } from '../../../src/shared/concurrency/scheduler-core.js';

const gate = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const pool = createIndexerThreadPool(Piscina, { filename: path.resolve('tests/indexing/workers/thread-task-association-worker.js'), minThreads: 1, maxThreads: 1 });
const scheduler = createBuildScheduler({ cpuTokens: 1, memoryTokens: 1, maxInFlightBytes: 128 });
const control = new AbortController(), started = new SharedArrayBuffer(8), flags = new Int32Array(started);
const terminateEntered = gate(), permitTerminate = gate(), observedFailure = gate();
const samples = [];
const loopDelay = monitorEventLoopDelay({ resolution: 10 });
let original, terminate, exitCount = 0, publicSettled = false, peerStarted = false, failure, parent;
const observe = phase => samples.push({ phase, atMs: performance.now(), originalThreadId: original?.threadId,
  retainedOriginals: pool.threads.length, nativeVisible: pool.pool.threads.length,
  liveKnownOriginalAndReplacement: new Set([...pool.threads, ...pool.pool.threads]).size,
  cpu: scheduler.stats().tokens.cpu.used, memory: scheduler.stats().tokens.mem.used,
  bytes: scheduler.stats().activity.inFlightBytes, rss: process.memoryUsage().rss });
pool.pool.on('workerCreate', () => observe('native-worker-create'));
pool.pool.on('workerDestroy', () => observe('native-worker-destroy'));
try {
  parent = scheduler.schedule('native-original', { cpu: 1, mem: 1, bytes: 128 }, async () => {
    try { return await pool.run({ gate: started, tag: 'never publish' }, { signal: control.signal }); }
    catch (error) { failure = error; observedFailure.resolve(); throw error; }
  }).finally(() => { publicSettled = true; });
  const rejected = assert.rejects(parent, error => error === failure && error.name === 'AbortError');
  if (Atomics.load(flags, 0) === 0) await Atomics.waitAsync(flags, 0, 0).value;
  original = pool.pool.threads.find(worker => worker.threadId > 0); assert.ok(original);
  const originalId = original.threadId;
  const queuedController = new AbortController();
  const queued = pool.run({ tag: 'queued task must not run' }, { signal: queuedController.signal });
  queuedController.abort();
  await assert.rejects(queued, error => error.name === 'AbortError' && !Object.hasOwn(error, 'workerSettlement'));
  assert.equal(original.threadId, originalId, 'queued cancellation cannot retire an unrelated running Worker');
  const pre = new AbortController(); pre.abort();
  await assert.rejects(pool.run({ tag: 'pre-aborted' }, { signal: pre.signal }), error => error.name === 'AbortError' && !Object.hasOwn(error, 'workerSettlement'));
  original.once('exit', () => { exitCount++; observe('actual-original-exit'); });
  terminate = original.terminate;
  original.terminate = function () { terminateEntered.resolve(); return permitTerminate.promise.then(() => terminate.call(original)); };
  observe('actual-task-running'); control.abort(); await terminateEntered.promise; await observedFailure.promise; await tick();
  observe('abort-rejected-original-exit-held');
  assert.equal(publicSettled, false); assert.equal(exitCount, 0); assert.equal(failure.workerOwnershipReleased(), false);
  assert.equal(scheduler.stats().tokens.cpu.used, 1); assert.equal(scheduler.stats().activity.inFlightBytes, 128);
  const peer = scheduler.schedule('native-peer', { cpu: 1, mem: 1, bytes: 128 }, async () => {
    peerStarted = true; return pool.run({ tag: 'replacement' });
  });
  await tick(); assert.equal(peerStarted, false);
  observe('competing-admission-still-blocked'); observe('original-termination-permitted'); permitTerminate.resolve(); await rejected;
  const replacement = await peer;
  assert.notEqual(replacement.threadId, originalId); assert.equal(replacement.tag, 'replacement');
  assert.equal(exitCount, 1); assert.equal(failure.workerOwnershipReleased(), true); assert.equal(pool.fatal, null);
  observe('original-exited-replacement-task-completed');
  const began = performance.now(), utilization = performance.eventLoopUtilization(), cpu = process.cpuUsage();
  loopDelay.enable();
  for (let n = 0; n < 32; n++) assert.equal((await pool.run({ tag: n })).tag, n);
  loopDelay.disable();
  const ordinaryElapsedMs = performance.now() - began;
  console.log(JSON.stringify({ samples, ordinaryTasks: 32, ordinaryElapsedMs, ordinaryTasksPerSecond: 32000 / ordinaryElapsedMs,
    ordinaryCpuMicroseconds: process.cpuUsage(cpu), eventLoopUtilization: performance.eventLoopUtilization(utilization),
    eventLoopDelay: { count: loopDelay.count, meanNs: loopDelay.count ? loopDelay.mean : null, maxNs: loopDelay.count ? loopDelay.max : null },
    peakObservedOriginalAndReplacement: Math.max(...samples.map(row => row.liveKnownOriginalAndReplacement)),
    qualification: 'actual locked Piscina/Node with an explicit pre-termination gate; endpoint RSS and controlled hold latency are not a representative throughput/peak-memory claim' }));
} finally {
  loopDelay.disable();
  control.abort();
  permitTerminate.resolve(); Atomics.store(flags, 1, 1); Atomics.notify(flags, 1);
  if (original && terminate) original.terminate = terminate;
  await parent?.catch(() => {}); await pool.destroy(); await scheduler.shutdown({ awaitRunning: true, timeoutMs: 1000 });
}
