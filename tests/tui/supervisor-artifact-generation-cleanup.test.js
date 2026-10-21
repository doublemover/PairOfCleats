import assert from 'node:assert/strict';
import { createJobController } from '../../tools/tui/supervisor/jobs.js';
import { ensureTestingEnv } from '../helpers/test-env.js';

ensureTestingEnv(process.env);
const state = { jobs: new Map() }, events = [], pending = new Map();
let generation = 0;
const controller = createJobController({ state, root: process.cwd(), runId: 'generation-cleanup',
  emit: (event, data, options) => events.push({ event, ...data, ...options }), emitLog: () => {},
  buildFlowSnapshot: () => ({}), beginArtifactJob: () => ++generation,
  captureArtifactInventory: ({ generation, artifacts }) => new Promise(resolve => pending.set(generation,
    () => resolve({ artifacts, inventoryId: `generation-${generation}` }))) });
const wait = async predicate => {
  const deadline = Date.now() + 5000;
  while (!predicate()) { assert.ok(Date.now() < deadline, 'actual job/capture lifecycle exceeded its bound');
    await new Promise(resolve => setTimeout(resolve, 10)); }
};
const request = { jobId: 'reused', command: process.execPath, args: ['-e', 'process.exit(0)'], argv: [] };
try {
  await controller.startJob(request); await wait(() => pending.has(1));
  const original = state.jobs.get('reused'); assert.equal(original.finalized, true);
  controller.cancelJob('reused'); assert.equal(state.jobs.size, 0);
  await controller.startJob(request); await wait(() => pending.has(2));
  const replacement = state.jobs.get('reused'); assert.equal(replacement.finalized, true);
  pending.get(1)();
  // Wait for the old scheduled finally block, not just its capture resolution.
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(state.jobs.get('reused'), replacement, 'old cleanup cannot delete a newer finalized job while its inventory is pending');
  assert.equal(events.some(event => event.inventoryId === 'generation-1'), false, 'old completion cannot overwrite a reused job inventory');
  pending.get(2)(); await wait(() => state.jobs.size === 0);
  assert.deepEqual(events.filter(event => event.event === 'job:artifacts').map(event => event.inventoryId), ['generation-2']);
  assert.equal(events.filter(event => event.event === 'job:end').length, 2);
} finally {
  for (const resolve of pending.values()) resolve();
  for (const job of state.jobs.values()) controller.cancelJob(job.id);
}
console.log('artifact cleanup preserves exact job-generation ownership');
