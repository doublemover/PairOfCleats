import assert from 'node:assert/strict';
import { setImmediate as turn } from 'node:timers/promises';
import { createSupervisorShutdown } from '../../tools/tui/supervisor/shutdown.js';

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
{
  const jobDone = deferred(), readerDone = deferred(), calls = [], exits = [];
  const job = { id: 'exact-owned', finalized: true, settlement: jobDone.promise };
  const state = { jobs: new Map([[job.id, job]]) };
  const shutdown = createSupervisorShutdown({ state, now: () => 17,
    cancelJob: (id, reason) => calls.push(['cancel', id, reason]),
    closeOwners: () => ({ search: async () => { calls.push('search'); await readerDone.promise; },
      settings: () => { calls.push('settings'); throw Object.assign(new Error('private'), { code: 'ERR_CLOSE' }); },
      recordings: () => calls.push('recordings') }),
    stopMetrics: () => calls.push('metrics'),
    output: { drain: async () => { calls.push('drain'); return { complete: true }; } },
    recorder: { finalize: reason => calls.push(['finalize', reason]) }, exit: code => exits.push(code) });
  const result = shutdown('stdin_closed', 0);
  assert.equal(state.shuttingDown, true, 'admission is fenced before any asynchronous cleanup');
  assert.equal(state.shutdownStartedAt, 17);
  assert.equal(shutdown('stdout_failed', 1), result, 'simultaneous shutdown callers share actual settlement');
  await turn();
  assert.ok(calls.includes('recordings'), 'one rejected closer cannot skip another owner');
  assert.deepEqual(exits, []);
  readerDone.resolve(); await turn();
  assert.deepEqual(exits, [], 'job:end does not prove post-run owner settlement');
  jobDone.resolve();
  assert.deepEqual(await result, { reason: 'stdin_closed', exitCode: 1, transport: { complete: true },
    settled: false, failures: [{ owner: 'settings', code: 'ERR_CLOSE' }] });
  assert.deepEqual(exits, [1]);
  assert.equal(calls.filter(value => Array.isArray(value) && value[0] === 'cancel').length, 1);
  assert.ok(calls.indexOf('drain') > calls.indexOf('recordings'));
}
{
  const exits = [];
  const shutdown = createSupervisorShutdown({ state: { jobs: new Map() }, cancelJob: () => {}, closeOwners: () => ({}),
    output: { drain: async () => ({ complete: false, failed: true, pendingWrites: 2 }) }, exit: code => exits.push(code) });
  const first = shutdown('sigint', 130);
  shutdown('stdout_failed', 1);
  assert.equal((await first).exitCode, 130, 'cleanup cannot replace an existing signal exit contract');
  assert.deepEqual(exits, [130]);
}
{
  const shutdown = createSupervisorShutdown({ state: { jobs: new Map() }, cancelJob: () => {}, closeOwners: () => ({}),
    output: { drain: async () => ({ complete: true }) }, exit: () => {} });
  assert.throws(() => shutdown({ reason: 'invalid' }), { code: 'ERR_TUI_CANCEL_REASON' });
  assert.equal((await shutdown('shutdown', 0)).exitCode, 0);
}
console.log('Supervisor shutdown fences admission, shares lifetime and attempts every exact owner before exit');
