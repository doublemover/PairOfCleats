import assert from 'node:assert/strict';
import { setImmediate as turn } from 'node:timers/promises';
import { createJobController } from '../../tools/tui/supervisor/jobs.js';
import { combineOwnedErrors, ownedCleanupIsPending, settleOwnedActions } from '../../tools/tui/operator/settle-owned.js';

{
  const state = { jobs: new Map() }, events = [];
  let closed = false, captures = 0, attempts = 0;
  const original = Object.assign(new Error('original exact native resource'), { code: 'ORIGINAL_RESOURCE', cacheOwnershipPending: false });
  Object.defineProperty(original, 'cacheOwnershipReleased', { configurable: true, get: () => {
    captures++; return function () { assert.equal(this, original); return closed; };
  } });
  const controller = createJobController({ state, runId: 'original-resource', root: process.cwd(),
    emit: (event, payload) => events.push({ event, payload }), emitLog: () => {}, buildFlowSnapshot: () => ({}) });
  await controller.startJob({ jobId: 'retained', argv: ['--version'], retry: { maxAttempts: 3, delayMs: 0 } }, {
    execute: async ({ onActivity }) => { attempts++; onActivity({ stage: 'native', current: 2, total: 10 }); throw original; }
  });
  const job = state.jobs.get('retained'); await job.settlement;
  assert.equal(attempts, 1, 'a false advisory marker cannot authorize retry over the original observer');
  assert.equal(captures, 1, 'capture the exact observer once, with its original receiver');
  assert.equal(job.resourceError, original); assert.equal(job.cleanupPending(), true);
  assert.equal(events.find(event => event.event === 'job:end').payload.error.code, 'ERR_TUI_RESOURCE_PENDING');
  assert.equal(events.find(event => event.event === 'job:artifacts').payload.artifactsIndexed, false);
  Object.defineProperty(original, 'cacheOwnershipReleased', { value: () => true });
  await assert.rejects(controller.startOperation({ jobId: 'new', method: 'query' }, () => ({})), error =>
    error.code === 'ERR_TUI_RESOURCE_PENDING' && error.cause === original && !error.cacheOwnershipReleased());
  controller.cleanupFinalizedJob(job.id, job); assert.equal(state.jobs.get(job.id), job);
  closed = true; controller.cleanupFinalizedJob(job.id, job); assert.equal(state.jobs.has(job.id), false);
}
{
  let resourceClosed = false;
  const cleanup = Object.assign(new Error('independent cleanup'), { cacheOwnershipPending: false,
    cacheOwnershipReleased: () => resourceClosed });
  const error = combineOwnedErrors(null, [cleanup]);
  assert.equal(error.cause, null); assert.equal(error.errors[0], null);
  cleanup.cacheOwnershipReleased = () => true;
  assert.equal(ownedCleanupIsPending(error), true);
  resourceClosed = true; assert.equal(ownedCleanupIsPending(error), false);
}
{
  let finish, closed = false;
  const gate = new Promise(resolve => { finish = resolve; });
  const original = Object.assign(new Error('first close failed'), { cacheOwnershipPending: true,
    cacheOwnershipReleased: () => closed });
  const settling = settleOwnedActions({ first: () => { throw original; }, delayed: () => gate });
  const rejected = assert.rejects(settling, error => error === original);
  await turn();
  original.cacheOwnershipPending = false; original.cacheOwnershipReleased = () => true;
  finish(); await rejected;
  assert.equal(ownedCleanupIsPending(original), true, 'waiting for a sibling cannot allow original authority replacement');
  closed = true; assert.equal(ownedCleanupIsPending(original), false);
}
{
  let ownerClosed = false, inspectionClosed = false;
  const inspection = Object.assign(new Error('independent observer resource'), { cacheOwnershipReleased: () => inspectionClosed });
  const original = Object.assign(new Error('observer failed'), { cacheOwnershipReleased: () => {
    if (!ownerClosed) throw inspection;
    return true;
  } });
  assert.equal(ownedCleanupIsPending(original), true);
  ownerClosed = true; assert.equal(ownedCleanupIsPending(original), true);
  inspectionClosed = true; assert.equal(ownedCleanupIsPending(original), false);
}
console.log('supervisor and sibling settlement preserve original observers, receivers, falsey causes and independent inspection owners');
