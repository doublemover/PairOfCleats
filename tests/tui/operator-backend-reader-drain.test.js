import assert from 'node:assert/strict';
import { setImmediate as turn } from 'node:timers/promises';
import { drainTuiBackendReaders } from '../../tools/tui/operator/backend-reader-drain.js';

const fixture = () => {
  const maintenance = { id: 'maintenance', finalized: false, internal: false };
  const launcher = { id: 'launcher', finalized: false, internal: true };
  const jobs = new Map([[maintenance.id, maintenance], [launcher.id, launcher]]);
  const calls = [];
  return { maintenance, launcher, jobs, calls, input: { jobs, jobId: maintenance.id, launcherJob: launcher,
    leaseId: 'retained-exact-lease', closeSearch: async () => { calls.push('search'); },
    closeArtifactActions: async () => { calls.push('actions'); },
    resetArtifactRegistry: async () => { calls.push('registry'); return { beginJob: id => `fresh-${id}` }; } } };
};
{
  const f = fixture();
  let finish, returned = false;
  const closing = new Promise(resolve => { finish = resolve; });
  const draining = drainTuiBackendReaders({ ...f.input, closeSearch: async () => {
    f.calls.push('search'); await closing;
  } }).then(receipt => { returned = true; return receipt; });
  await turn();
  assert.equal(returned, false, 'a disposal request is not an actual owner drain');
  assert.deepEqual(f.calls, ['search']);
  finish();
  assert.deepEqual(await draining, { drained: true, pending: false, leaseId: 'retained-exact-lease' });
  assert.deepEqual(f.calls, ['search', 'actions', 'registry']);
  assert.equal(f.maintenance.artifactGeneration, 'fresh-maintenance');
}
{
  const f = fixture();
  f.jobs.set('launcher', { id: 'launcher', finalized: false, internal: false });
  await assert.rejects(drainTuiBackendReaders(f.input), { code: 'ERR_TUI_BACKEND_ACTIVE_JOBS' });
  assert.deepEqual(f.calls, [], 'reused launcher ID cannot exclude a different live job');
}
{
  const f = fixture();
  await assert.rejects(drainTuiBackendReaders({ ...f.input,
    closeArtifactActions: async () => { throw new Error('Actual resource close failed.'); } }),
  /Actual resource close failed/);
  assert.equal(f.calls.includes('registry'), false);
  assert.equal(f.maintenance.artifactGeneration, undefined);
}
{
  const f = fixture();
  await assert.rejects(drainTuiBackendReaders({ ...f.input, closeSearch: async () => {
    f.jobs.set('late-work', { id: 'late-work', finalized: false });
  } }), { code: 'ERR_TUI_BACKEND_ACTIVE_JOBS' });
  assert.equal(f.maintenance.artifactGeneration, undefined, 'late foreign work prevents an exact lease receipt');
}
console.log('Native backend drain awaits actual owners and binds exact maintenance/launcher instances');
