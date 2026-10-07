#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createTempWatchRepo, createWatchDeps, createWatchRuntime, startCodeWatch, waitFor } from './helpers.js';

const { tempRoot, repoRoot, files } = await createTempWatchRepo({
  prefix: 'poc-watch-consistency-state-',
  files: {
    a: {
      rel: 'src/a.js',
      content: 'export const a = 1;\n'
    },
    b: {
      rel: 'src/b.js',
      content: 'export const b = 2;\n'
    }
  }
});
const fileA = files.a.abs;
const fileB = files.b.abs;
const runtime = await createWatchRuntime({ repoRoot });
const { repoCacheRoot } = runtime;
const watchStatePath = path.join(repoCacheRoot, 'watch-state.json');

const stateSnapshots = [];
let releaseFirstBuildResolve;
let firstBuildReleased = false;
const releaseFirstBuild = new Promise((resolve) => {
  releaseFirstBuildResolve = () => {
    if (firstBuildReleased) return;
    firstBuildReleased = true;
    resolve();
  };
});
let buildCount = 0;

const { deps, getOnEvent } = createWatchDeps({
  entries: [files.a, files.b],
  buildIndexForMode: async () => {
    buildCount += 1;
    if (buildCount === 1) {
      await releaseFirstBuild;
    }
  }
});

const {
  abortController,
  ready,
  watchPromise
} = startCodeWatch({
  runtime,
  deps,
  onStateChange: (snapshot) => {
    stateSnapshots.push(snapshot);
  }
});

let testError = null;
try {
  await ready;
  const onEventRef = getOnEvent();
  assert.ok(onEventRef, 'expected watcher to register event handler');

  await onEventRef({ type: 'change', absPath: fileA });
  await waitFor(() => runtime.watchState?.activeGeneration?.buildId);
  assert.equal(runtime.watchState.consistency, 'catching-up');
  assert.equal(runtime.watchState.quiescent, false);
  assert.ok(runtime.watchState.lastAttemptedGeneration?.buildId, 'expected last attempted generation');
  assert.equal(
    runtime.watchState.activeGeneration.buildId,
    runtime.watchState.lastAttemptedGeneration.buildId,
    'expected active generation to match last attempted generation'
  );

  await onEventRef({ type: 'change', absPath: fileB });
  await waitFor(() => runtime.watchState?.pendingReplay === true && runtime.watchState?.backlogDepth >= 2);
  assert.equal(runtime.watchState.consistency, 'catching-up');

  releaseFirstBuildResolve();

  await waitFor(() => buildCount >= 2);
  await waitFor(() => (
    runtime.watchState?.consistency === 'consistent'
    && runtime.watchState?.quiescent === true
    && runtime.watchState?.backlogDepth === 0
  ));
  assert.ok(runtime.watchState.lastConsistentGeneration?.buildId, 'expected last consistent generation');
  assert.equal(runtime.watchState.lastAttemptedGeneration?.status, 'ok');
  assert.equal(runtime.watchState.activeGeneration, null);
  const persistedWatchState = JSON.parse(await fs.readFile(watchStatePath, 'utf8'));
  assert.equal(persistedWatchState.consistency, 'consistent');
  assert.equal(persistedWatchState.quiescent, true);
  assert.equal(persistedWatchState.backlogDepth, 0);
  assert.equal(
    persistedWatchState.lastConsistentGeneration?.buildId,
    runtime.watchState.lastConsistentGeneration?.buildId,
    'expected persisted watch state to expose the same last consistent generation'
  );
  assert.ok(
    stateSnapshots.some((snapshot) => snapshot.pendingReplay === true && snapshot.backlogDepth >= 2),
    'expected emitted watch states to include a replaying backlog snapshot'
  );
} catch (error) {
  testError = error;
} finally {
  releaseFirstBuildResolve();
  abortController.abort();
  await watchPromise;
  await fs.rm(tempRoot, { recursive: true, force: true });
}

if (testError) {
  throw testError;
}

console.log('watch consistency state test passed');
