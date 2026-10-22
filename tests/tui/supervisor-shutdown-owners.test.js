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
  const jobDone = deferred(), calls = [], exits = [];
  const shutdown = createSupervisorShutdown({ state: { jobs: new Map([
    ['first', { id: 'first', settlement: jobDone.promise }],
    ['second', { id: 'second', settlement: Promise.resolve() }]
  ]) },
  stopMetrics: () => { throw Object.assign(new Error('metrics failed'), { code: 'ERR_METRICS' }); },
  cancelJob: async id => { calls.push(['cancel', id]); if (id === 'first') await jobDone.promise; },
  closeOwners: () => { calls.push('owners'); throw Object.assign(new Error('registry failed'), { code: 'ERR_REGISTRY' }); },
  output: { drain: async () => { calls.push('drain'); throw Object.assign(new Error('pipe failed'), { code: 'EPIPE' }); } },
  recorder: { finalize: () => calls.push('recording') }, exit: code => exits.push(code) });
  const pending = shutdown('stdin_closed', 0);
  await turn();
  assert.deepEqual(calls.slice(0, 2), [['cancel', 'first'], ['cancel', 'second']],
    'an unfinished cancellation does not prevent the next admitted job from receiving cancellation');
  assert.equal(calls.includes('owners'), true);
  assert.equal(calls.includes('drain'), false, 'registry failure cannot bypass actual admitted job settlement');
  assert.deepEqual(exits, []);
  jobDone.resolve();
  const result = await pending;
  assert.deepEqual(result.failures, [
    { owner: 'metrics', code: 'ERR_METRICS' },
    { owner: 'owner-registry', code: 'ERR_REGISTRY' },
    { owner: 'event-transport', code: 'EPIPE' }
  ]);
  assert.deepEqual(calls.slice(-2), ['drain', 'recording'], 'failed transport still permits final recording');
  assert.equal(result.transport.complete, false);
  assert.equal(result.settled, false);
  assert.deepEqual(exits, [1]);
}
{
  const finalized = [];
  const shutdown = createSupervisorShutdown({ state: { jobs: new Map() }, cancelJob: () => {}, closeOwners: () => ({}),
    output: { drain: async () => null }, recorder: { finalize: reason => finalized.push(reason) }, exit: () => {} });
  const result = await shutdown('shutdown', 0);
  assert.deepEqual(result.failures, [{ owner: 'event-transport', code: 'ERR_TUI_OUTPUT_DRAIN' }]);
  assert.deepEqual(finalized, ['shutdown']);
  assert.equal(result.exitCode, 1, 'a missing drain receipt cannot become a successful flush');
}
{
  const shutdown = createSupervisorShutdown({ state: { jobs: new Map() }, cancelJob: () => {}, closeOwners: () => ({}),
    output: { drain: async () => ({ complete: true }) }, exit: () => {} });
  assert.throws(() => shutdown({ reason: 'invalid' }), { code: 'ERR_TUI_CANCEL_REASON' });
  assert.equal((await shutdown('shutdown', 0)).exitCode, 0);
}
console.log('Supervisor shutdown fences admission, shares lifetime and attempts every exact owner before exit');
