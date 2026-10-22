import assert from 'node:assert/strict';
import { setImmediate as turn } from 'node:timers/promises';
import { createTuiServiceControls } from '../../tools/tui/operator/service-controls.js';
import { assertTuiWorkflowRequest } from '../../src/contracts/validators/tui-workflow.js';

const scopeId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', jobs = new Map(), cancelled = [];
const controls = createTuiServiceControls({ requireScope: id => assert.equal(id, scopeId), getJob: id => jobs.get(id),
  cancelJob: (id, reason) => { cancelled.push({ id, reason }); jobs.get(id).abortController.abort(reason); return true; } });
const job = id => {
  let finish;
  const owner = { id, status: 'running', internal: false, finalized: false, abortController: new AbortController(),
    settlement: new Promise(resolve => { finish = resolve; }) };
  jobs.set(id, owner); return { owner, finish };
};
{
  const original = job('same-id');
  const id = controls.register({ scopeId, kind: 'api', jobId: 'same-id', inspectClosure: () => ({ closed: true }) });
  const replacement = job('same-id');
  await assert.rejects(controls.stop({ scopeId, serviceId: id, confirmed: true }), { code: 'ERR_TUI_SERVICE_STALE' });
  assert.deepEqual(cancelled, [], 'stale capability cannot cancel a new owner with the same job ID');
  assert.equal(replacement.owner.abortController.signal.aborted, false);
  original.finish(); replacement.finish(); jobs.clear();
}
{
  const running = job('owned-mcp');
  const id = controls.register({ scopeId, kind: 'mcp', jobId: running.owner.id, inspectClosure: () => ({ closed: true }) });
  assertTuiWorkflowRequest('stop-service', { scopeId, serviceId: id, confirmed: true });
  assert.throws(() => assertTuiWorkflowRequest('stop-service', { scopeId, serviceId: id, confirmed: false }),
    { code: 'ERR_TUI_WORKFLOW_REQUEST' });
  assert.throws(() => assertTuiWorkflowRequest('stop-service', { scopeId, serviceId: id, confirmed: true, pid: 123 }),
    { code: 'ERR_TUI_WORKFLOW_REQUEST' });
  await assert.rejects(controls.stop({ scopeId, serviceId: id, confirmed: false }), { code: 'ERR_TUI_SERVICE_CONFIRMATION' });
  let returned = false;
  const stopping = controls.stop({ scopeId, serviceId: id, confirmed: true }).then(result => { returned = true; return result; });
  const repeat = controls.stop({ scopeId, serviceId: id, confirmed: true });
  await turn();
  assert.equal(returned, false, 'abort request is not a settlement witness');
  assert.equal(controls.list(scopeId)[0].stopRequested, true);
  assert.equal(controls.list(scopeId)[0].canStop, false);
  assert.deepEqual(cancelled, [{ id: 'owned-mcp', reason: 'user_cancel' }]);
  running.owner.status = 'cancelled'; running.owner.finalized = true; running.owner.settled = true;
  running.finish();
  const result = await stopping;
  assert.equal(result.settled, true); assert.equal(result.readinessClaim, false);
  assert.deepEqual(await repeat, result);
  assert.deepEqual(controls.list(scopeId), []);
  jobs.clear();
}
{
  const running = job('pending-api');
  const id = controls.register({ scopeId, kind: 'api', jobId: running.owner.id, inspectClosure: () => ({ closed: false }) });
  const stopping = controls.stop({ scopeId, serviceId: id, confirmed: true });
  running.owner.status = 'failed'; running.owner.finalized = true; running.owner.settled = true; running.finish();
  const result = await stopping;
  assert.equal(result.executionSettled, true);
  assert.equal(result.settled, false, 'a terminal job with a retained resource cannot claim service closure');
  assert.equal(result.pending, true);
  assert.equal(result.errorCode, 'ERR_TUI_SERVICE_CLOSURE_PENDING');
  assert.equal(controls.list(scopeId).some(service => service.serviceId === id), true,
    'terminal execution does not erase an unconfirmed resource or free its control slot');
  assert.equal(controls.list(scopeId).find(service => service.serviceId === id).canStop, false);
  assert.equal(controls.list(scopeId).find(service => service.serviceId === id).settlementPending, true);
  assert.equal(controls.list(scopeId).find(service => service.serviceId === id).resourceClosure, 'unconfirmed');
  jobs.clear();
}
{
  const disabled = createTuiServiceControls({ requireScope: () => {} });
  assert.equal(disabled.enabled, false);
  assert.equal(disabled.register({ scopeId, kind: 'api', jobId: 'discovered' }), null);
  await assert.rejects(disabled.stop({ scopeId, serviceId: scopeId, confirmed: true }), { code: 'ERR_TUI_SERVICE_CONTROL_UNAVAILABLE' });
}
{
  const bounded = createTuiServiceControls({ requireScope: () => {}, getJob: id => jobs.get(id), cancelJob: () => true });
  let first;
  for (let i = 0; i < 6; i++) {
    const running = job('bounded-' + i);
    const service = bounded.register({ scopeId, kind: 'api', jobId: running.owner.id,
      inspectClosure: () => { throw new Error('unknown protocol observation'); } });
    if (i === 0) first = service;
  }
  assert.equal(bounded.register({ scopeId, kind: 'api', jobId: 'bounded-0', inspectClosure: () => ({ closed: true }) }), first,
    're-registering the same exact owner cannot consume another slot at capacity');
  jobs.get('bounded-0').settled = true;
  assert.equal(bounded.list(scopeId).length, 6, 'unknown resource observation cannot free a terminal owner slot');
  const seventh = job('bounded-6');
  assert.throws(() => bounded.register({ scopeId, kind: 'api', jobId: seventh.owner.id,
    inspectClosure: () => ({ closed: true }) }), { code: 'ERR_TUI_SERVICE_CONTROL_LIMIT' });
  bounded.clear(); jobs.clear();
}
console.log('Native service capabilities bind exact jobs, reject discovered PID authority and await real settlement');
