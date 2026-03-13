#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { applyTestEnv } from '../../helpers/test-env.js';
import { buildIgnoreMatcher } from '../../../src/index/build/ignore.js';
import { watchIndex } from '../../../src/index/build/watch.js';
import { getRepoCacheRoot } from '../../../tools/shared/dict-utils.js';

const normalizeAbsPath = (value) => path.resolve(String(value || '')).replace(/\\/g, '/').toLowerCase();

const waitFor = async (predicate, timeoutMs = 5000) => {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Timed out waiting for condition.');
};

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-watch-update-queue-'));
applyTestEnv({ cacheRoot: tempRoot });

const repoRoot = path.join(tempRoot, 'repo');
await fs.mkdir(path.join(repoRoot, 'src'), { recursive: true });
const fileA = path.join(repoRoot, 'src', 'a.js');
const fileB = path.join(repoRoot, 'src', 'b.js');
const fileBKey = normalizeAbsPath(fileB);
await fs.writeFile(fileA, 'export const a = 1;\n');
await fs.writeFile(fileB, 'export const b = 2;\n');
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

const observedBuildSnapshots = [];
let onEventRef = null;
let readyResolve;
const ready = new Promise((resolve) => { readyResolve = resolve; });

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
  buildIndexForMode: async ({ discovery }) => {
    const entries = Array.isArray(discovery?.entries)
      ? discovery.entries.map((entry) => normalizeAbsPath(entry.abs)).filter(Boolean).sort()
      : [];
    const skipped = Array.isArray(discovery?.skippedFiles)
      ? discovery.skippedFiles.map((entry) => normalizeAbsPath(entry.file)).filter(Boolean).sort()
      : [];
    observedBuildSnapshots.push({ entries, skipped });
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

await ready;
assert.ok(onEventRef, 'expected watcher to register event handler');

const originalArrayFrom = Array.from;
let injectedSecondEvent = false;

Array.from = function patchedArrayFrom(value, ...rest) {
  const output = originalArrayFrom.call(Array, value, ...rest);
  if (
    !injectedSecondEvent
    && value instanceof Set
    && output.includes(fileA)
    && !output.includes(fileB)
    && onEventRef
  ) {
    injectedSecondEvent = true;
    onEventRef({ type: 'change', absPath: fileB });
  }
  return output;
};

let testError = null;
try {
  await onEventRef({ type: 'change', absPath: fileA });
  await waitFor(() => observedBuildSnapshots.length >= 1);
  try {
    await waitFor(
      () => observedBuildSnapshots.some((snapshot) => (
        snapshot.entries.includes(fileBKey) || snapshot.skipped.includes(fileBKey)
      )),
      5000
    );
  } catch (error) {
    throw new Error(`Timed out waiting for fileB update. snapshots=${JSON.stringify(observedBuildSnapshots)}`, {
      cause: error
    });
  }
  assert.equal(injectedSecondEvent, true, 'expected second event injection during update flush');
} catch (error) {
  testError = error;
} finally {
  Array.from = originalArrayFrom;
  abortController.abort();
  await watchPromise;
}

if (testError) {
  throw testError;
}

console.log('watch update queue no-loss test passed');
