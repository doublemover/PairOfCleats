import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { markBuildPhase } from '../../../src/index/build/build-state.js';
import { promoteBuild } from '../../../src/index/build/promotion.js';
import { seedPublishedArtifacts } from '../../helpers/artifact-publication.js';
import { createTempWatchRepo, createWatchDeps, createWatchRuntime, startCodeWatch } from './helpers.js';

for (const boundary of ['promote', 'watch']) {
  const fixture = await createTempWatchRepo({ prefix: 'poc-watch-post-commit-',
    files: { source: { rel: 'one.js', content: 'export const value = 1;' } } });
  const runtime = await createWatchRuntime({ repoRoot: fixture.repoRoot });
  const roots = [];
  let state, controller, injected = false, validations = 0;
  const { deps, getOnEvent } = createWatchDeps({ entries: [fixture.files.source],
    buildIndexForMode: async ({ runtime: attempt }) => {
      roots.push(attempt.buildRoot);
      await seedPublishedArtifacts({ buildRoot: attempt.buildRoot, buildId: attempt.buildId, mode: 'code' });
      await fs.writeFile(path.join(attempt.buildRoot, 'owned-sentinel'), 'published bytes');
    },
    validateIndexArtifacts: async () => ({ ok: ++validations === 1,
      issues: validations === 1 ? [] : ['controlled next-attempt validation failure'], warnings: [] }),
    promoteBuild
  });
  deps.markBuildPhase = async (...args) => {
    if (!injected && args[1] === boundary && args[2] === 'done') {
      injected = true;
      throw new Error(`controlled ${boundary}-done bookkeeping failure`);
    }
    return markBuildPhase(...args);
  };
  const watch = startCodeWatch({ runtime, deps, onStateChange: value => {
    state = structuredClone(value);
    if (roots.length >= 2 && !value.running && value.lastAttemptedGeneration?.buildRoot === roots[1]) controller?.abort();
  } });
  controller = watch.abortController;
  try {
    await watch.ready;
    await getOnEvent()({ type: 'change', absPath: fixture.files.source.abs });
    await watch.watchPromise;
    assert.equal(injected, true, boundary);
    assert.equal(validations, 2, 'the following validation fails before publication');
    const pointer = JSON.parse(await fs.readFile(path.join(runtime.repoCacheRoot, 'builds/current.json'), 'utf8'));
    assert.equal(path.resolve(runtime.repoCacheRoot, pointer.buildRootsByMode.code), path.resolve(roots[0]));
    assert.equal(await fs.readFile(path.join(roots[0], 'owned-sentinel'), 'utf8'), 'published bytes');
    assert.equal(state.lastConsistentGeneration.buildRoot, roots[0]);
    assert.equal(state.lastConsistentGeneration.publicationCommitted, true);
    assert.equal(state.lastAttemptedGeneration.publicationCommitted, false);
    assert.equal(state.lastAttemptedGeneration.status, 'error');
  } finally {
    controller.abort();
    await watch.watchPromise;
    await fs.rm(fixture.tempRoot, { recursive: true, force: true });
  }
}
console.log('Post-commit phase failures retain the published watch generation through the next failed attempt.');
