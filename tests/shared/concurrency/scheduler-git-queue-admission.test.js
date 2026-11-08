import assert from 'node:assert/strict';
import { setImmediate as tick } from 'node:timers/promises';
import { createBuildScheduler } from '../../../src/shared/concurrency/scheduler-core.js';
import { currentSchedulerTaskLease, withSchedulerCpuSuspended } from '../../../src/shared/concurrency/scheduler-task-scope.js';
import { runWithTimeout } from '../../../src/shared/promise-timeout.js';
import { runGitTask } from '../../../src/index/scm/providers/git/config.js';
import { setScmRuntimeConfig } from '../../../src/index/scm/runtime.js';
import { runScmCommand } from '../../../src/index/scm/runner.js';
import { buildStage1SchedulerStallSnapshot, formatStage1SchedulerStallSummary } from '../../../src/index/build/indexer/steps/process-files/stall-diagnostics.js';

setScmRuntimeConfig({ maxConcurrentProcesses: 1 });
const scheduler = createBuildScheduler({ cpuTokens: 2, memoryTokens: 4,
  queues: { 'stage1.proc': { concurrency: 1 } } });
const firstStarted = Promise.withResolvers();
const releaseFirst = Promise.withResolvers();
const leases = [];
let running = 0;
let peakRunning = 0;
const requests = [];
try {
  for (let index = 0; index < 3; index++) {
    if (index === 1) await firstStarted.promise;
    requests.push(scheduler.schedule('stage1.proc', { cpu: 1, mem: 1, bytes: 10 }, async () => {
      const owner = currentSchedulerTaskLease();
      leases[index] = owner;
      return runGitTask(async () => {
        assert.equal(currentSchedulerTaskLease(), owner, 'queued work must execute under its own file lease');
        assert.ok(owner.used.cpu > 0, 'provider work requires reacquired compute admission');
        running++;
        peakRunning = Math.max(peakRunning, running);
        try {
          if (index === 0) {
            firstStarted.resolve();
            await withSchedulerCpuSuspended(() => releaseFirst.promise);
          }
          const result = await runScmCommand(process.execPath, ['-e', `process.stdout.write('${index}')`], {
            outputMode: 'string', captureStdout: true, captureStderr: true
          });
          assert.equal(currentSchedulerTaskLease(), owner);
          assert.ok(owner.used.cpu > 0, 'command parsing requires compute admission');
          return result.stdout;
        } finally { running--; }
      });
    }));
    requests.at(-1).catch(() => {});
  }
  await tick();
  assert.equal(running, 1, 'Git concurrency remains bounded while other files wait');
  assert.ok(scheduler.stats().tokens.mem.used > 0, 'waiting files retain memory ownership');
  assert.ok(scheduler.stats().activity.inFlightBytes > 0, 'waiting files retain source bytes');
  const snapshot = buildStage1SchedulerStallSnapshot({ scheduler });
  const proc = snapshot.highlightedQueues.find(queue => queue.name === 'stage1.proc');
  assert.ok(proc.suspendedCpu > 0, 'stall evidence includes suspended process owners');
  assert.equal(proc.activeComputeRunning, proc.running - proc.suspendedCpu);
  assert.ok(formatStage1SchedulerStallSummary(snapshot).includes('stage1.proc='));
  releaseFirst.resolve();
  assert.deepEqual(await runWithTimeout(() => Promise.all(requests), {
    timeoutMs: 1500, errorFactory: () => new Error('Git queue admission deadlocked scheduler CPU reacquisition')
  }), ['0', '1', '2']);
  assert.equal(new Set(leases).size, 3, 'every file retains a distinct owner');
  assert.equal(peakRunning, 1);
  assert.equal(scheduler.stats().tokens.cpu.used, 0);
  assert.equal(scheduler.stats().tokens.mem.used, 0);
  assert.equal(scheduler.stats().activity.inFlightBytes, 0);
} finally {
  releaseFirst.resolve();
  // Failure-only teardown must also drain the original deadlocking owner.
  await scheduler.shutdown({ awaitRunning: true, timeoutMs: 1000 });
  setScmRuntimeConfig(null);
}

// A canceled admission must relinquish its Git slot without invoking provider
// work. A failed provider must preserve the exact error and release that slot.
setScmRuntimeConfig({ maxConcurrentProcesses: 1 });
const cancellationScheduler = createBuildScheduler({ cpuTokens: 2, memoryTokens: 3,
  queues: { 'stage1.proc': { concurrency: 1 } } });
const occupying = Promise.withResolvers();
const releaseOccupying = Promise.withResolvers();
const waiting = Promise.withResolvers();
const controller = new AbortController();
let canceledInvocations = 0;
try {
  const first = cancellationScheduler.schedule('stage1.proc', { cpu: 1, mem: 1 }, () => runGitTask(async () => {
    occupying.resolve();
    await withSchedulerCpuSuspended(() => releaseOccupying.promise);
  }));
  await occupying.promise;
  const second = cancellationScheduler.schedule('stage1.proc', { cpu: 1, mem: 1, signal: controller.signal }, async () => {
    waiting.resolve();
    return runGitTask(() => { canceledInvocations++; });
  });
  const canceled = assert.rejects(second, error => error.name === 'AbortError' || error.code === 'ABORT_ERR');
  await waiting.promise;
  await tick();
  controller.abort();
  releaseOccupying.resolve();
  await first;
  await canceled;
  assert.equal(canceledInvocations, 0);
  const primary = Object.freeze(new Error('provider failed'));
  await assert.rejects(cancellationScheduler.schedule('stage1.proc', { cpu: 1, mem: 1 }, () => runGitTask(() => {
    throw primary;
  })), error => error === primary);
  assert.equal(await runGitTask(() => 'after failure'), 'after failure');
  assert.equal(await runGitTask(() => 'direct', { useQueue: false }), 'direct');
  assert.equal(cancellationScheduler.stats().tokens.cpu.used, 0);
  assert.equal(cancellationScheduler.stats().tokens.mem.used, 0);
} finally {
  releaseOccupying.resolve();
  await cancellationScheduler.shutdown({ awaitRunning: true, timeoutMs: 1000 });
  setScmRuntimeConfig(null);
}
console.log('Git queue admission retains file ownership without blocking scheduler CPU reacquisition');
