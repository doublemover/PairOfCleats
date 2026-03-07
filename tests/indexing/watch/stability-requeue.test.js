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
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('Timed out waiting for condition.');
};

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-watch-stability-requeue-'));
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
let buildCount = 0;

const deps = {
  resolveWatcherBackend: () => ({
    requested: 'parcel',
    resolved: 'parcel',
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
    buildCount += 1;
  },
  validateIndexArtifacts: async () => ({ ok: true, issues: [], warnings: [] }),
  promoteBuild: async () => ({})
};

const abortController = new AbortController();
const watchPromise = watchIndex({
  runtime,
  modes: ['code'],
  pollMs: 0,
  debounceMs: 120,
  abortSignal: abortController.signal,
  handleSignals: false,
  deps,
  onReady: () => readyResolve()
});

let churnTimer = null;
let stopChurnTimer = null;
let testError = null;
try {
  await ready;
  assert.ok(onEventRef, 'expected watcher to register event handler');
  churnTimer = setInterval(() => {
    void fs.appendFile(fileA, '// churn\n').catch(() => {});
  }, 25);
  stopChurnTimer = setTimeout(() => {
    clearInterval(churnTimer);
    churnTimer = null;
  }, 700);
  await onEventRef({ type: 'change', absPath: fileA });
  await waitFor(() => buildCount >= 1, 7000);
} catch (error) {
  testError = error;
} finally {
  if (stopChurnTimer) clearTimeout(stopChurnTimer);
  if (churnTimer) clearInterval(churnTimer);
  abortController.abort();
  await watchPromise;
  await fs.rm(tempRoot, { recursive: true, force: true });
}

if (testError) {
  throw testError;
}

assert.ok(buildCount >= 1, 'expected unstable updates to be requeued until stable');
console.log('watch stability requeue test passed');
