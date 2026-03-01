#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { applyTestEnv } from '../../helpers/test-env.js';
import { buildIgnoreMatcher } from '../../../src/index/build/ignore.js';
import { watchIndex } from '../../../src/index/build/watch.js';
import { getRepoCacheRoot } from '../../../tools/shared/dict-utils.js';

const waitFor = async (predicate, timeoutMs = 5000) => {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Timed out waiting for condition.');
};

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-watch-retry-failed-cycle-'));
applyTestEnv({ cacheRoot: tempRoot });

const repoRoot = path.join(tempRoot, 'repo');
await fs.mkdir(path.join(repoRoot, 'src'), { recursive: true });
const fileA = path.join(repoRoot, 'src', 'a.js');
await fs.writeFile(fileA, 'export const a = 1;\n');
const statA = await fs.stat(fileA);

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
let buildAttempts = 0;

const deps = {
  resolveWatcherBackend: () => ({
    requested: 'chokidar',
    resolved: 'chokidar',
    warning: null,
    pollingEnabled: false
  }),
  discoverFilesForModes: async () => ({
    code: [{ abs: fileA, rel: 'src/a.js', stat: statA }]
  }),
  startWatcher: async ({ onEvent }) => {
    onEventRef = onEvent;
    return { close: async () => {} };
  },
  buildIndexForMode: async () => {
    buildAttempts += 1;
    if (buildAttempts === 1) {
      throw new Error('synthetic watch build failure');
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
  onReady: () => readyResolve()
});

let testError = null;
try {
  await ready;
  assert.ok(onEventRef, 'expected watcher to register event handler');
  await onEventRef({ type: 'change', absPath: fileA });
  await waitFor(() => buildAttempts >= 2, 5000);
} catch (error) {
  testError = error;
} finally {
  abortController.abort();
  await watchPromise;
  await fs.rm(tempRoot, { recursive: true, force: true });
}

if (testError) {
  throw testError;
}

assert.ok(buildAttempts >= 2, 'expected failed cycle to replay queued backlog');
console.log('watch retry on failed cycle test passed');
