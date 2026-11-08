import assert from 'node:assert/strict';
import { createJobController } from '../../tools/tui/supervisor/jobs.js';

const state = { jobs: new Map(), shuttingDown: false }, events = [];
const controller = createJobController({ state, root: process.cwd(), runId: 'operation-lifecycle',
  emit: (event, payload, context) => events.push({ event, ...payload, jobId: context.jobId }),
  emitLog: () => {}, buildFlowSnapshot: () => ({}) });
const wait = async predicate => {
  const deadline = Date.now() + 2000;
  while (!predicate()) {
    assert.ok(Date.now() < deadline, 'operation must settle and leave the registry');
    await new Promise(resolve => setTimeout(resolve, 5));
  }
};
const end = id => events.find(row => row.event === 'job:end' && row.jobId === id);
const run = (id, execute, options) => controller.startOperation({ jobId: id, method: 'inspect' }, execute, options);
let release;
await run('cancel', ({ signal }) => new Promise(resolve => {
  assert.equal(signal.aborted, false);
  release = () => resolve({ validation: { ok: true } });
}));
await assert.rejects(run('cancel', () => assert.fail('duplicate must not execute')));
assert.equal(controller.cancelJob('cancel'), true);
release();
await wait(() => !state.jobs.has('cancel'));
assert.equal(end('cancel').status, 'cancelled');
assert.equal(end('cancel').result, null);

await run('saved', () => new Promise(resolve => { release = () => resolve({ saved: true }); }));
controller.cancelJob('saved'); release();
await wait(() => !state.jobs.has('saved'));
assert.equal(end('saved').status, 'done', 'late cancellation cannot undo an already committed file');
assert.equal(end('saved').result.data.saved, true);
await controller.startOperation({ jobId: 'selected', method: 'select' }, () => new Promise(resolve => {
  release = () => resolve({ id: 'committed-scope' });
}), { isCommitted: data => data?.id === 'committed-scope' });
controller.cancelJob('selected'); release();
await wait(() => !state.jobs.has('selected'));
assert.equal(end('selected').result.data.id, 'committed-scope', 'late abort cannot conceal a scope selection that completed');

await run('timeout', ({ signal }) => new Promise((resolve, reject) => {
  signal.addEventListener('abort', () => reject(Error('private raw error')), { once: true });
}), { timeoutMs: 20 });
await wait(() => !state.jobs.has('timeout'));
assert.equal(end('timeout').status, 'failed');
assert.equal(end('timeout').error.code, 'ERR_TUI_OPERATION_TIMEOUT');
await run('failure', () => { throw Object.assign(Error('secret in a subprocess error'), { code: 0 }); });
await wait(() => !state.jobs.has('failure'));
assert.deepEqual(end('failure').error, { code: '0' }, 'preserve defined error codes, including zero');
await run('oversized', () => ({ content: 'x'.repeat(1024 * 1024) }));
await wait(() => !state.jobs.has('oversized'));
assert.equal(end('oversized').error.code, 'ERR_TUI_OPERATION_OUTPUT');
await run('invalid-output', () => { const cyclic = {}; cyclic.self = cyclic; return cyclic; });
await wait(() => !state.jobs.has('invalid-output'));
assert.equal(end('invalid-output').status, 'failed');
assert.equal(JSON.stringify(events).includes('secret'), false);
for (const id of ['cancel', 'saved', 'selected', 'timeout', 'failure', 'oversized', 'invalid-output']) {
  assert.equal(events.filter(row => row.event === 'job:start' && row.jobId === id).length, 1);
  assert.equal(events.filter(row => row.event === 'job:end' && row.jobId === id).length, 1);
  assert.equal(end(id).internal, true);
}
console.log('Internal operations preserve cancellation, committed saves, timeout, privacy and exactly-once finalization');
