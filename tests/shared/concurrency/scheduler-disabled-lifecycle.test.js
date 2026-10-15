#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createBuildScheduler } from '../../../src/shared/concurrency/scheduler-core.js';
import { createEmbeddingsScheduler } from '../../../tools/build/embeddings/scheduler.js';

for (const enabled of [true, false]) {
  const scheduler = createBuildScheduler({ enabled, cpuTokens: 1 });
  let executions = 0;
  const before = new AbortController(); before.abort();
  await assert.rejects(scheduler.schedule('fixture', { cpu: 1, signal: before.signal }, () => executions++), { name: 'AbortError' });
  const deferred = new AbortController();
  const deferredWork = scheduler.schedule('fixture', { cpu: 1, signal: deferred.signal }, () => executions++);
  deferred.abort();
  await assert.rejects(deferredWork, { name: 'AbortError' });
  assert.equal(executions, 0);
  let release, entered;
  const ready = new Promise(resolve => { entered = resolve; });
  const held = new Promise(resolve => { release = resolve; });
  const runningAbort = new AbortController();
  const running = scheduler.schedule('fixture', { cpu: 1, signal: runningAbort.signal }, async () => {
    executions++; entered(); await held; return 'drained';
  });
  await ready;
  runningAbort.abort();
  let drained = false;
  const shutdown = Promise.resolve(scheduler.shutdown({ awaitRunning: true, timeoutMs: 1000 })).then(() => { drained = true; });
  await assert.rejects(scheduler.schedule('fixture', { cpu: 1 }, () => executions++), /shut down/);
  await Promise.resolve();
  assert.equal(drained, false, 'shutdown joins already-running inline and scheduled handlers');
  release();
  assert.equal(await running, 'drained', 'running arbitrary handlers remain cooperatively cancellable');
  await shutdown;
  assert.equal(executions, 1);
  const bounded = createBuildScheduler({ enabled, cpuTokens: 1 });
  let unblock, begin;
  const begun = new Promise(resolve => { begin = resolve; });
  const blocked = new Promise(resolve => { unblock = resolve; });
  const live = bounded.schedule('fixture', { cpu: 1 }, async () => { begin(); await blocked; });
  await begun;
  try {
    await assert.rejects(bounded.shutdown({ awaitRunning: true, timeoutMs: 10 }),
      { code: 'ERR_SCHEDULER_DRAIN_TIMEOUT', runningTasks: 1 });
    assert.equal(bounded.stats().runningTasks, 1, 'deadline expiry does not imply handler completion');
    await assert.rejects(bounded.schedule('fixture', () => {}), /shut down/);
  } finally { unblock(); await live; await bounded.shutdown({ awaitRunning: true, timeoutMs: 1000 }); }
  assert.equal(bounded.stats().runningTasks, 0);
}
const aborted = new AbortController(); aborted.abort();
const stage3 = createEmbeddingsScheduler({ argv: { scheduler: false, threads: 1 }, rawArgv: ['--no-scheduler'],
  userConfig: {}, rawEnv: {}, envConfig: { schedulerEnabled: false }, indexingConfig: {}, signal: aborted.signal });
await assert.rejects(stage3.scheduleCompute(() => { throw new Error('must not start'); }), { name: 'AbortError' });
await assert.rejects(stage3.scheduleIo(() => { throw new Error('must not start'); }), { name: 'AbortError' });
stage3.scheduler.shutdown();
console.log('Enabled/disabled scheduler and Stage3 wrapper admission/drain parity pass.');
