import assert from 'node:assert/strict';
import { setImmediate as turn } from 'node:timers/promises';
import { createJobController } from '../../tools/tui/supervisor/jobs.js';
import { formatProgressEvent } from '../../src/shared/cli/progress-events.js';

const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};
const fixture = () => {
  const state = { jobs: new Map() }, events = [];
  const controller = createJobController({ state, runId: 'retry-attempt-owner', root: process.cwd(),
    emit: (event, payload, context) => events.push(formatProgressEvent(event, { ...payload, jobId: context?.jobId })),
    emitLog: () => {}, buildFlowSnapshot: () => ({}) });
  return { state, events, controller };
};

const originalTimeout = globalThis.setTimeout, originalClearTimeout = globalThis.clearTimeout;
const timers = new Set();
globalThis.setTimeout = (callback, milliseconds) => {
  assert.equal(milliseconds, 30000, 'only the explicit retry wait may allocate a timer');
  const timer = { callback, milliseconds }; timers.add(timer); return timer;
};
globalThis.clearTimeout = timer => { timers.delete(timer); };
try {
  for (const failure of ['result', 'throw']) {
    const f = fixture(), finish = deferred(), secondStarted = deferred();
    let attempts = 0, oldCallbacks;
    await f.controller.startJob({ jobId: failure, argv: ['--version'], retry: { maxAttempts: 2, delayMs: 30000 } }, {
      execute: async callbacks => {
        attempts++;
        if (attempts === 1) {
          oldCallbacks = callbacks;
          callbacks.onActivity({ current: 3, total: 20, unit: 'files', stage: 'first' });
          if (failure === 'throw') throw new Error('first attempt failed');
          return { exitCode: 1, stdout: '', signal: null };
        }
        callbacks.onActivity({ current: 1, unit: 'responses', stage: 'replacement' });
        secondStarted.resolve(); await finish.promise;
        return { exitCode: 0, stdout: '', signal: null };
      }
    });
    const job = f.state.jobs.get(failure);
    await turn();
    assert.equal(attempts, 1); assert.equal(timers.size, 1);
    const retry = f.events.find(event => event.event === 'task:start' && event.taskId === 'supervisor:retry');
    assert.equal(retry.state, 'waiting'); assert.equal(retry.current, undefined); assert.equal(retry.total, undefined);
    assert.ok(f.events.some(event => event.event === 'task:end' && event.taskId === 'native-owner' && event.status === 'failed'));
    const retainedEvents = f.events.length;
    oldCallbacks.onSpawn({ pid: 999999 }); oldCallbacks.onActivity({ current: 999, total: 999 });
    oldCallbacks.onStdout(JSON.stringify(formatProgressEvent('task:progress', { taskId: 'stale' })) + '\n');
    assert.equal(f.events.length, retainedEvents, 'settled attempt callbacks cannot publish while waiting to retry');
    [...timers][0].callback(); await secondStarted.promise;
    assert.equal(timers.size, 0); assert.equal(attempts, 2);
    const starts = f.events.filter(event => event.event === 'task:start' && event.taskId === 'native-owner');
    assert.equal(starts.length, 2, 'replacement measurements start a new task instance');
    assert.equal(starts[1].current, 1); assert.equal(starts[1].total, undefined);
    const replacedEvents = f.events.length;
    oldCallbacks.onActivity({ current: 1000 }); oldCallbacks.onStderr('stale log\n');
    assert.equal(f.events.length, replacedEvents, 'callbacks retain their original attempt even after replacement starts');
    finish.resolve(); await job.settlement;
    assert.equal(f.events.filter(event => event.event === 'job:end').length, 1);
    assert.equal(f.events.find(event => event.event === 'job:end').status, 'done');
    const endedEvents = f.events.length;
    oldCallbacks.onActivity({ current: 1001 }); assert.equal(f.events.length, endedEvents);
    assert.equal(f.state.jobs.has(failure), false);
  }

  for (const failure of ['result', 'throw']) {
    const f = fixture(); let attempts = 0;
    await f.controller.startJob({ jobId: `cancel-${failure}`, argv: ['--version'],
      retry: { maxAttempts: 2, delayMs: 30000 } }, { execute: async () => {
      attempts++;
      if (failure === 'throw') throw new Error('settled first attempt failure');
      return { exitCode: 1, stdout: '', signal: null };
    } });
    const job = f.state.jobs.get(`cancel-${failure}`);
    await turn(); assert.equal(timers.size, 1);
    f.controller.cancelJob(job.id, 'user_cancel');
    await job.settlement;
    assert.equal(attempts, 1, 'cancelling the wait must not start a replacement execution');
    assert.equal(timers.size, 0, 'retry cancellation must release the exact wait timer');
    const end = f.events.find(event => event.event === 'job:end');
    assert.equal(end.status, 'cancelled'); assert.equal(end.attempts, 1); assert.equal(end.exitCode, 130);
    assert.equal(f.events.find(event => event.event === 'task:end' && event.taskId === 'supervisor:retry').status, 'cancelled');
  }
} finally {
  globalThis.setTimeout = originalTimeout; globalThis.clearTimeout = originalClearTimeout;
}

{
  const f = fixture(), admission = deferred(); let executions = 0;
  await f.controller.startJob({ jobId: 'preflight-cancel', argv: ['--version'] }, {
    beforeRun: () => admission.promise,
    execute: async () => { executions++; return { exitCode: 0, stdout: '', signal: null }; }
  });
  const job = f.state.jobs.get('preflight-cancel');
  f.controller.cancelJob(job.id, 'user_cancel'); admission.resolve(); await job.settlement;
  assert.equal(executions, 0, 'a cancellation during preflight cannot start the native owner afterward');
  assert.equal(f.events.find(event => event.event === 'job:end').status, 'cancelled');
}
{
  const f = fixture();
  await f.controller.startJob({ jobId: 'signalled', argv: ['--version'] }, {
    execute: async () => ({ exitCode: 0, stdout: '', signal: 'SIGTERM' })
  });
  const job = f.state.jobs.get('signalled'); await job.settlement;
  assert.equal(f.events.find(event => event.event === 'job:end').status, 'failed', 'signal evidence cannot become host success');
}
console.log('supervisor retry waits are observable, cancellable and isolated from retired attempt callbacks');
