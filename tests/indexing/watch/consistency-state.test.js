#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { applyTestEnv } from '../../helpers/test-env.js';
import { buildIgnoreMatcher } from '../../../src/index/build/ignore.js';
import { watchIndex } from '../../../src/index/build/watch.js';
import { getRepoCacheRoot } from '../../../tools/shared/dict-utils.js';

const waitFor = async (predicate, timeoutMs = 7000) => {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Timed out waiting for condition.');
};

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-watch-consistency-state-'));
applyTestEnv({ cacheRoot: tempRoot });

const repoRoot = path.join(tempRoot, 'repo');
await fs.mkdir(path.join(repoRoot, 'src'), { recursive: true });
const fileA = path.join(repoRoot, 'src', 'a.js');
const fileB = path.join(repoRoot, 'src', 'b.js');
await fs.writeFile(fileA, 'export const a = 1;\n');
await fs.writeFile(fileB, 'export const b = 2;\n');
const statA = await fs.stat(fileA);
const statB = await fs.stat(fileB);

const userConfig = {};
const { ignoreMatcher } = await buildIgnoreMatcher({ root: repoRoot, userConfig });
const repoCacheRoot = getRepoCacheRoot(repoRoot, userConfig);
const runtime = {
  root: repoRoot,
  repoCacheRoot,
  userConfig,
  ignoreMatcher,
  maxFileBytes: null,
  fileCaps: { default: {} },
  guardrails: {},
  recordsDir: path.join(repoCacheRoot, 'triage', 'records'),
  recordsConfig: {},
  ignoreFiles: [],
  ignoreWarnings: [],
  stage: null,
  configHash: 'test',
  toolInfo: { version: 'test' }
};

let onEventRef = null;
let readyResolve;
const ready = new Promise((resolve) => { readyResolve = resolve; });
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

const deps = {
  resolveWatcherBackend: () => ({
    requested: 'chokidar',
    resolved: 'chokidar',
    warning: null,
    pollingEnabled: false
  }),
  discoverFilesForModes: async () => ({
    code: [
      { abs: fileA, rel: 'src/a.js', stat: statA },
      { abs: fileB, rel: 'src/b.js', stat: statB }
    ]
  }),
  startWatcher: async ({ onEvent }) => {
    onEventRef = onEvent;
    return { close: async () => {} };
  },
  buildIndexForMode: async () => {
    buildCount += 1;
    if (buildCount === 1) {
      await releaseFirstBuild;
    }
  },
  validateIndexArtifacts: async () => ({ ok: true, issues: [], warnings: [] }),
  promoteBuild: async () => ({})
};

const abortController = new AbortController();
const watchPromise = watchIndex({
  runtime,
  modes: ['code'],
  pollMs: 0,
  debounceMs: 10,
  abortSignal: abortController.signal,
  handleSignals: false,
  deps,
  onReady: () => readyResolve(),
  onStateChange: (snapshot) => {
    stateSnapshots.push(snapshot);
  }
});

let testError = null;
try {
  await ready;
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
