import assert from 'node:assert/strict';
import { createJobController } from '../../tools/tui/supervisor/jobs.js';

const state = { jobs: new Map() }, events = [];
const controller = createJobController({ state, root: process.cwd(), runId: 'safe-search-failures',
  emit: (event, payload, context) => events.push({ event, ...payload, jobId: context.jobId }),
  emitLog: () => {}, buildFlowSnapshot: () => ({}) });
const run = async (id, execute, options = {}) => {
  const admission = controller.startOperation({ jobId: id, method: 'query' }, execute,
    { title: 'Search', failureProjection: 'search', ...options });
  const job = state.jobs.get(id);
  await admission; await job.settlement;
  const end = events.find(event => event.event === 'job:end' && event.jobId === id);
  assert.equal(events.filter(event => event.event === 'job:end' && event.jobId === id).length, 1);
  return end;
};
for (const [code, reason] of [['NO_INDEX', 'missing-index'], ['ERR_TUI_SCOPE_INVALID', 'invalid-repository'],
  ['ERR_TUI_SEARCH_REQUEST', 'invalid-request'], ['CAPABILITY_MISSING', 'missing-capability'],
  ['ERR_INDEX_FORMAT_UNSUPPORTED', 'unsupported-format'], ['PRIVATE_SECRET_TOKEN', 'unknown']]) {
  const end = await run(`code-${reason}`, () => { throw Object.assign(Error('PRIVATE_SECRET_TOKEN\x1b C:\\private'), { code }); });
  assert.equal(end.status, 'failed'); assert.equal(end.result, null);
  assert.equal(end.error.failure.reason, reason);
  if (reason === 'unknown') assert.equal(end.error.code, 'ERR_TUI_OPERATION_FAILED');
}
const cancelled = await run('cancel', ({ operationJobId }) => {
  controller.cancelJob(operationJobId); return { hits: [] };
});
assert.equal(cancelled.error.failure.outcome, 'cancelled');
const timeout = await run('timeout', ({ signal }) => new Promise((resolve, reject) => {
  signal.addEventListener('abort', () => reject(Error('PRIVATE_SECRET_TOKEN')), { once: true });
}), { timeoutMs: 10 });
assert.equal(timeout.error.failure.outcome, 'timed-out');
const oversized = await run('oversized', () => ({ value: 'x'.repeat(1024 * 1024) }));
assert.equal(oversized.error.failure.reason, 'incomplete-response');
const empty = await run('empty-success', () => ({ hits: [] }));
assert.equal(empty.status, 'done'); assert.deepEqual(empty.result.data.hits, []);
assert.equal(empty.error, undefined);
let released = false;
const original = Object.freeze(Object.assign(Error('PRIVATE_SECRET_TOKEN'), { code: 'NO_INDEX',
  cacheOwnershipPending: true, cacheOwnershipReleased: () => released }));
const pending = await run('pending', () => { throw original; });
assert.equal(pending.error.failure.reason, 'resource-pending');
assert.ok(!pending.error.failure.actions.includes('retry'));
assert.ok(state.jobs.has('pending'));
let executed = false;
await assert.rejects(controller.startOperation({ jobId: 'rejected', method: 'query' }, () => { executed = true; }),
  { code: 'ERR_TUI_RESOURCE_PENDING' });
assert.equal(executed, false);
assert.equal(controller.rejectSearchOperation('rejected', original), true);
assert.equal(events.find(event => event.jobId === 'rejected').admission, 'rejected');
const count = events.length;
assert.equal(controller.rejectSearchOperation('pending', original), false);
assert.equal(controller.rejectSearchOperation('bad\njob', original), false);
assert.equal(events.length, count, 'duplicates must not terminalize or replace accepted work');
let status;
const statusAdmission = controller.startOperation({ jobId: 'status', method: 'status' }, context => {
  status = context.hasPendingResources(); return { resourcePending: status };
}, { failureProjection: 'search' });
const statusJob = state.jobs.get('status'); await statusAdmission; await statusJob.settlement;
assert.equal(status, true);
released = true;
const clearAdmission = controller.startOperation({ jobId: 'status-clear', method: 'status' }, context => {
  status = context.hasPendingResources(); return { resourcePending: status };
}, { failureProjection: 'search' });
const clearJob = state.jobs.get('status-clear'); await clearAdmission; await clearJob.settlement;
assert.equal(status, false);
assert.equal(state.jobs.size, 0);
assert.equal(JSON.stringify(events).includes('PRIVATE_SECRET_TOKEN'), false);
console.log('Search settlement reports closed causes, cancellation, timeout, actual pending resources and fresh admission rejection');
