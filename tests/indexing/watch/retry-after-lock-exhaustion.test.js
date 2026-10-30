import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promoteBuild } from '../../../src/index/build/promotion.js';
import { acquireIndexLockWithBackoff } from '../../../src/index/build/watch/lock.js';
import { seedPublishedArtifacts } from '../../helpers/artifact-publication.js';
import { createTempWatchRepo, createWatchDeps, createWatchRuntime, startCodeWatch, waitFor } from './helpers.js';

const fixture = await createTempWatchRepo({ prefix: 'watch-lock-exhaustion-',
  files: { source: { rel: 'edited.js', content: 'export const retained = 42;' } } });
const runtime = await createWatchRuntime({ repoRoot: fixture.repoRoot });
let acquisitions = 0, builds = 0, promoted = null;
const { deps, getOnEvent } = createWatchDeps({ entries: [fixture.files.source],
  buildIndexForMode: async ({ runtime: attempt }) => {
    builds += 1;
    await seedPublishedArtifacts({ buildRoot: attempt.buildRoot, buildId: attempt.buildId, mode: 'code' });
    await fs.writeFile(path.join(attempt.buildRoot, 'retained-edit'), '42');
  },
  promoteBuild: async (attempt, options) => { const result = await promoteBuild(attempt, options); promoted = attempt; return result; }
});
deps.acquireIndexLockWithBackoff = async (options) => ++acquisitions === 1 ? null : acquireIndexLockWithBackoff(options);
const watch = startCodeWatch({ runtime, deps });
try {
  await watch.ready;
  await getOnEvent()({ type: 'change', absPath: fixture.files.source.abs });
  await waitFor(() => promoted !== null, 5000);
  assert.equal(acquisitions, 2, 'the same retained edit retries after exhaustion without another event');
  assert.equal(builds, 1);
  assert.equal(await fs.readFile(path.join(promoted.buildRoot, 'retained-edit'), 'utf8'), '42');
  const pointer = JSON.parse(await fs.readFile(path.join(runtime.repoCacheRoot, 'builds/current.json'), 'utf8'));
  assert.equal(path.resolve(runtime.repoCacheRoot, pointer.buildRootsByMode.code), path.resolve(promoted.buildRoot));
} finally {
  watch.abortController.abort();
  await watch.watchPromise;
  await fs.rm(fixture.tempRoot, { recursive: true, force: true });
}
console.log('Watch retries retained work after bounded lock exhaustion');
