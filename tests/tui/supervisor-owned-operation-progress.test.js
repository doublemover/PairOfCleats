import assert from 'node:assert/strict';
import { setImmediate as turn } from 'node:timers/promises';
import { createJobController } from '../../tools/tui/supervisor/jobs.js';
import { formatProgressEvent, isProgressEvent } from '../../src/shared/cli/progress-events.js';

const state = { jobs: new Map(), shuttingDown: false }, frames = [];
let finishExecution, terminal;
const execution = new Promise(resolve => { finishExecution = resolve; });
const ended = new Promise(resolve => { terminal = resolve; });
const owner = createJobController({ state, runId: 'fixture', root: process.cwd(),
  emit: (name, payload, context) => {
    const frame = formatProgressEvent(name, { ...payload, jobId: context?.jobId }); frames.push(frame);
    if (name === 'job:end') terminal(frame);
  }, emitLog: () => {}, buildFlowSnapshot: () => ({}) });
let observedSignal;
await owner.startJob({ jobId: 'owned-operation', argv: ['--version'], retry: { maxAttempts: 1 },
  resultPolicy: { captureStdout: 'json', maxBytes: 8192 } }, {
  execute: async ({ signal, onActivity }) => {
    observedSignal = signal;
    onActivity({ current: 1, unit: 'verified responses', stage: 'initialize' });
    onActivity({ current: 2, unit: 'verified responses', stage: 'health' });
    await execution;
    return { exitCode: 130, stdout: JSON.stringify({ stopped: true }), signal: null };
  } });
await turn();
assert.deepEqual(frames.filter(frame => frame.event.startsWith('task:')).map(frame => frame.event), ['task:start', 'task:progress']);
assert.equal(frames.some(frame => !isProgressEvent(frame)), false, 'internal activity uses only canonical progress events');
owner.cancelJob('owned-operation', 'user_cancel');
assert.equal(observedSignal.aborted, true);
assert.equal(state.jobs.get('owned-operation').finalized, false, 'cancellation retains job ownership while execution tears down');
finishExecution();
const result = await ended;
assert.equal(result.status, 'cancelled');
assert.equal(frames.find(frame => frame.event === 'task:end').status, 'cancelled');
assert.equal(frames.findIndex(frame => frame.event === 'task:end') < frames.findIndex(frame => frame.event === 'job:end'), true);
await turn();
assert.equal(state.jobs.has('owned-operation'), false);
{
  const pendingState = { jobs: new Map(), shuttingDown: false }, pendingFrames = [];
  let ended, settle;
  const terminal = new Promise(resolve => { ended = resolve; });
  const closing = new Promise(resolve => { settle = resolve; });
  let blocked = false;
  const actor = createJobController({ state: pendingState, runId: 'pending', root: process.cwd(),
    emit: (name, payload) => { pendingFrames.push({ name, payload }); if (name === 'job:end') ended(payload); },
    emitLog: () => {}, buildFlowSnapshot: () => ({}), assertWorkAdmission: () => {
      if (blocked) throw Object.assign(new Error('Cache ownership pending.'), { code: 'ERR_TUI_BACKEND_OWNERSHIP_PENDING' });
    } });
  await actor.startJob({ jobId: 'pending-backend', argv: ['--version'], retry: { maxAttempts: 1 } }, {
    execute: async ({ signal, onActivity }) => {
      onActivity({ stage: 'running' });
      await closing;
      assert.equal(signal.aborted, true);
      blocked = true;
      throw Object.assign(new Error('Child closed without native closure receipt.'),
        { code: 'ERR_TUI_BACKEND_OWNERSHIP_PENDING', cacheOwnershipPending: true });
    }, afterRun: async () => ({ workflow: { maintenance: { pending: true, blocked: true } } }) });
  await turn(); actor.cancelJob('pending-backend', 'user_cancel'); settle();
  const result = await terminal;
  assert.equal(result.status, 'cancelled');
  assert.equal(result.error.code, 'ERR_TUI_BACKEND_OWNERSHIP_PENDING', 'late cancellation preserves the unresolved ownership diagnosis');
  assert.match(pendingFrames.find(frame => frame.name === 'task:end').payload.message, /unresolved backend ownership/);
  await turn();
  assert.equal(pendingFrames.find(frame => frame.name === 'job:artifacts').payload.artifactsIndexed, false,
    'artifact collection is fenced before it can probe cache paths');
  await assert.rejects(actor.startOperation({ jobId: 'foreign-work', method: 'query' }, () => {}),
    { code: 'ERR_TUI_BACKEND_OWNERSHIP_PENDING' });
  assert.equal(pendingState.jobs.has('foreign-work'), false);
}
console.log('Trusted owned operations use canonical task progress and retain cancellation until actual settlement');
