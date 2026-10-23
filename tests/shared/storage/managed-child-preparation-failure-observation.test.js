import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { resolveStorageLayout } from '../../../src/shared/storage/layout.js';
import { planManagedChildStorage, prepareManagedChildStorage } from '../../../src/shared/storage/child-environment.js';
import { observeStorageResource } from '../../../src/shared/storage/failure-observation.js';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';

const temporary = await makeTempDir('poc-child-preparation-failure-');
const originalMkdir = fs.mkdir;
try {
  const layout = resolveStorageLayout({ home: temporary, env: {} });
  const plan = planManagedChildStorage({ layout, managed: true, command: 'pip', toolId: 'fixture-python',
    toolIdentity: 'fixture@1', runId: 'fixture-run', baseEnv: {} });
  let released = false, calls = 0;
  const primary = Object.freeze(Object.assign(new Error('original preparation descriptor remains pending'), {
    cacheOwnershipPending: true, cacheOwnershipReleased() { assert.equal(this, primary); calls += 1; return released; }
  }));
  fs.mkdir = async () => { throw primary; };
  let failure;
  try { await prepareManagedChildStorage(plan, { authorizedRoots: [temporary] }); }
  catch (error) { failure = error; }
  assert.equal(failure.cause, primary, 'frozen producer failure stays the original cause');
  assert.deepEqual(failure.recovery, { scratch: plan.scratch, preserved: true });
  const observation = observeStorageResource(failure, { phase: 'fixture-preparation-observer' });
  assert.throws(() => observation.requireSettled(), /original preparation descriptor remains pending/);
  assert.equal(calls > 0, true);
  released = true;
  assert.doesNotThrow(() => observation.requireSettled(), 'only the original preparation owner can settle the resource');
  assert.equal(Object.hasOwn(primary, 'recovery'), false, 'failure diagnostics do not mutate the producer');
} finally { fs.mkdir = originalMkdir; await rmDirRecursive(temporary); }
console.log('managed child preparation failure observation passed');
