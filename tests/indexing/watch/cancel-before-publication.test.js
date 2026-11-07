import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { markBuildPhase, updateBuildState } from '../../../src/index/build/build-state.js';
import { createTempWatchRepo, createWatchDeps, createWatchRuntime, startCodeWatch } from './helpers.js';

for (const boundary of ['validation-running-phase', 'validation', 'validation-state', 'validated-phase', 'promote-phase', 'after-commit']) {
  const fixture = await createTempWatchRepo({ prefix: 'poc-watch-publish-cancel-',
    files: { source: { rel: 'one.js', content: 'export const value = 1;' } } });
  const runtime = await createWatchRuntime({ repoRoot: fixture.repoRoot });
  const pointer = path.join(runtime.repoCacheRoot, 'builds', 'current.json');
  await fs.mkdir(path.dirname(pointer), { recursive: true });
  await fs.writeFile(pointer, 'prior-pointer');
  let promotions = 0, state, controller, validationSignal, promotionSignal;
  const { deps, getOnEvent } = createWatchDeps({ entries: [fixture.files.source], buildIndexForMode: async () => {},
    validateIndexArtifacts: async ({ abortSignal }) => {
      validationSignal = abortSignal;
      if (boundary === 'validation') {
        let finish;
        const held = new Promise(resolve => { finish = resolve; });
        queueMicrotask(() => { controller.abort(); finish(); });
        await held;
      }
      return { ok: true, issues: [], warnings: [] };
    },
    promoteBuild: async ({ abortSignal }) => {
      promotionSignal = abortSignal;
      promotions++;
      await fs.writeFile(pointer, 'committed-pointer');
      if (boundary === 'after-commit') controller.abort();
    } });
  deps.updateBuildState = async (...args) => {
    const result = await updateBuildState(...args);
    if (boundary === 'validation-state' && args[1]?.validation) controller.abort();
    return result;
  };
  deps.markBuildPhase = async (...args) => {
    const result = await markBuildPhase(...args);
    if ((boundary === 'validation-running-phase' && args[1] === 'validation' && args[2] === 'running')
      || (boundary === 'validated-phase' && args[1] === 'validation' && args[2] === 'done')
      || (boundary === 'promote-phase' && args[1] === 'promote' && args[2] === 'running')) controller.abort();
    return result;
  };
  const watch = startCodeWatch({ runtime, deps, onStateChange: value => { state = structuredClone(value); } });
  controller = watch.abortController;
  try {
    await watch.ready;
    await getOnEvent()({ type: 'change', absPath: fixture.files.source.abs });
    await watch.watchPromise;
    const committed = boundary === 'after-commit';
    assert.equal(promotions, committed ? 1 : 0, boundary);
    assert.equal(await fs.readFile(pointer, 'utf8'), committed ? 'committed-pointer' : 'prior-pointer', boundary);
    assert.equal(state.lastAttemptedGeneration.status, committed ? 'ok' : 'aborted', boundary);
    if (boundary === 'validation-running-phase') assert.equal(validationSignal, undefined, 'cancelled phase setup cannot start validation');
    else assert.ok(validationSignal, 'validation receives the owned build signal');
    if (committed) assert.ok(promotionSignal, 'promotion receives the owned build signal');
    assert.equal(await fs.stat(path.join(runtime.repoCacheRoot, 'locks', 'index.lock')).then(() => true, error => {
      if (error.code === 'ENOENT') return false; throw error;
    }), false, 'watch releases the index lock after cancellation');
  } finally {
    controller.abort();
    await watch.watchPromise;
    await fs.rm(fixture.tempRoot, { recursive: true, force: true });
  }
}
console.log('Watch cancellation at validation/state/publication boundaries retains the prior pointer and post-commit success');
