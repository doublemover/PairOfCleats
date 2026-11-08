import assert from 'node:assert/strict';
import { setImmediate as turn } from 'node:timers/promises';
import { createJobController } from '../../tools/tui/supervisor/jobs.js';

const state = { jobs: new Map() }, events = [];
let releaseCapture, captureStarted;
const captureReady = new Promise(resolve => { captureStarted = resolve; });
const captureDone = new Promise(resolve => { releaseCapture = resolve; });
const controller = createJobController({ state, root: process.cwd(), runId: 'settlement-owner',
  emit: (event, payload) => events.push({ event, payload }), emitLog: () => {}, buildFlowSnapshot: () => ({}),
  beginArtifactJob: () => 'exact-generation', captureArtifactInventory: async ({ artifacts }) => {
    captureStarted(); await captureDone; return { artifacts };
  } });
await controller.startJob({ jobId: 'owned', argv: ['search', '--help'] },
  { execute: async () => ({ exitCode: 0, stdout: '', signal: null }) });
await captureReady;
const owned = state.jobs.get('owned');
assert.equal(owned.finalized, true);
assert.equal(owned.settled, undefined);
assert.equal(events.some(event => event.event === 'job:end'), true);
controller.cancelJob('owned');
controller.cleanupFinalizedJob('owned');
assert.equal(state.jobs.get('owned'), owned, 'cancelling terminal work cannot release a still-active artifact owner');
await assert.rejects(controller.startJob({ jobId: 'owned', argv: ['search', '--help'] }), { code: 'ERR_TUI_JOB_EXISTS' });
let settled = false;
owned.settlement.then(() => { settled = true; });
await turn(); assert.equal(settled, false);
releaseCapture(); await owned.settlement;
assert.equal(owned.settled, true);
assert.equal(state.jobs.has('owned'), false);
assert.equal(events.filter(event => event.event === 'job:end').length, 1);

let finishOperation;
await controller.startOperation({ jobId: 'operation', method: 'inspect' }, () => new Promise(resolve => { finishOperation = resolve; }));
await turn();
const operation = state.jobs.get('operation');
controller.cancelJob('operation');
finishOperation({ inspected: true }); await operation.settlement;
assert.equal(operation.settled, true);
assert.equal(state.jobs.has('operation'), false);
console.log('Job settlement includes actual post-run artifact work and internal operation cleanup');
