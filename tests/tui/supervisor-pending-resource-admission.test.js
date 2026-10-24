// Actual job/shutdown owners with inert executions; UNVALIDATED.
import assert from 'node:assert/strict';
import { createJobController } from '../../tools/tui/supervisor/jobs.js';
import { createSupervisorShutdown } from '../../tools/tui/supervisor/shutdown.js';

const fixture = () => {
  const state = { jobs: new Map() }, events = [];
  const controller = createJobController({ state, root: process.cwd(), runId: 'pending-resource',
    emit: (event, payload) => events.push({ event, payload }), emitLog: () => {}, buildFlowSnapshot: () => ({}),
    beginArtifactJob: () => 'owned-artifact-generation',
    captureArtifactInventory: async () => assert.fail('unconfirmed child cannot authorize artifact observations') });
  return { state, events, controller };
};
const delayedClose = () => {
  let closed = false;
  return { close: () => { closed = true; }, error: Object.assign(new Error('exact child close remains unknown'), {
    code: 'SUBPROCESS_TIMEOUT', cacheOwnershipPending: true, cacheOwnershipReleased: () => closed
  }) };
};
{
  const f = fixture(), delayed = delayedClose();
  let attempts = 0, observations = 0;
  await f.controller.startJob({ jobId: 'owned', argv: ['search', '--help'], retry: { maxAttempts: 3, delayMs: 0 } }, {
    execute: async () => { attempts++; throw delayed.error; }, afterRun: () => { observations++; }
  });
  const original = f.state.jobs.get('owned');
  await original.settlement;
  assert.equal(attempts, 1, 'pending resource cleanup cannot start the configured second/third execution');
  assert.equal(observations, 0, 'post-run observations cannot read while the old child still owns resources');
  assert.equal(original.settled, true, 'execution promise completion remains distinct from cleanup');
  assert.equal(original.cleanupPending(), true);
  f.controller.cleanupFinalizedJob('owned');
  assert.equal(f.state.jobs.get('owned'), original);
  await assert.rejects(f.controller.startJob({ jobId: 'next', argv: ['search', '--help'] }), { code: 'ERR_TUI_RESOURCE_PENDING' });
  await assert.rejects(f.controller.startOperation({ jobId: 'mutating', method: 'commit' }, () => ({})),
    { code: 'ERR_TUI_RESOURCE_PENDING' });
  await f.controller.startOperation({ jobId: 'status', method: 'status' }, () => ({ visible: true }));
  await f.state.jobs.get('status').settlement;
  assert.equal(f.events.some(value => value.event === 'job:end' && value.payload.result?.data?.visible), true,
    'read-only diagnosis remains usable while work admission is fenced');

  const exits = [];
  const shutdown = createSupervisorShutdown({ state: { jobs: new Map([['owned', original]]) },
    cancelJob: () => true, closeOwners: () => ({}), output: { drain: async () => ({ complete: true }) },
    exit: code => exits.push(code) });
  const result = await shutdown('shutdown', 0);
  assert.equal(result.settled, false, 'shutdown cannot relabel finished execution as resource closure');
  assert.deepEqual(result.failures, [{ owner: 'job:owned', code: 'SUBPROCESS_TIMEOUT' }]);
  assert.deepEqual(exits, [1]);

  delayed.close();
  let completeReplacement;
  await f.controller.startJob({ jobId: 'owned', argv: ['search', '--help'] }, {
    execute: () => new Promise(resolve => { completeReplacement = resolve; })
  });
  const replacement = f.state.jobs.get('owned');
  f.controller.cleanupFinalizedJob('owned', original);
  assert.equal(f.state.jobs.get('owned'), replacement, 'old cleanup cannot remove a newer same-ID job');
  // This replacement has confirmed completion and does not need artifact capture.
  replacement.artifactGeneration = null;
  completeReplacement({ exitCode: 0, stdout: '' });
  await replacement.settlement;
}
for (const owner of ['after-run', 'internal']) {
  const f = fixture(), delayed = delayedClose();
  if (owner === 'after-run') {
    await f.controller.startJob({ jobId: owner, argv: ['search', '--help'] }, {
      execute: async () => ({ exitCode: 0, stdout: '' }), afterRun: async () => { throw delayed.error; }
    });
  } else await f.controller.startOperation({ jobId: owner, method: 'launch' }, async () => { throw delayed.error; });
  const job = f.state.jobs.get(owner);
  await job.settlement;
  assert.equal(job.cleanupPending(), true);
  assert.equal(f.state.jobs.get(owner), job);
  assert.equal(job.status, 'failed');
  delayed.close();
  f.controller.cleanupFinalizedJob(owner, job);
  assert.equal(f.state.jobs.has(owner), false);
}
console.log('Pending cleanup prevents retries, artifact reads, job removal and mutating admission.');
