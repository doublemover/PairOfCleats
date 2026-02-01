#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { applyTestEnv } from '../../helpers/test-env.js';
import { buildIgnoreMatcher } from '../../../src/index/build/ignore.js';
import { watchIndex } from '../../../src/index/build/watch.js';
import { promoteBuild } from '../../../src/index/build/promotion.js';
import { getRepoCacheRoot } from '../../../tools/dict-utils.js';

const waitFor = async (predicate, timeoutMs = 5000) => {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Timed out waiting for condition.');
};

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-watch-atomicity-'));
applyTestEnv({ cacheRoot: tempRoot });

const repoRoot = path.join(tempRoot, 'repo');
await fs.mkdir(path.join(repoRoot, 'src'), { recursive: true });
const filePath = path.join(repoRoot, 'src', 'index.js');
await fs.writeFile(filePath, 'export const value = 1;\n');
const fileStat = await fs.stat(filePath);

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

const buildsRoot = path.join(repoCacheRoot, 'builds');
const prevRoot = path.join(buildsRoot, 'prev-build');
await fs.mkdir(prevRoot, { recursive: true });
await promoteBuild({
  repoRoot,
  userConfig,
  buildId: 'prev-build',
  buildRoot: prevRoot,
  modes: ['code']
});
const currentPath = path.join(buildsRoot, 'current.json');
const prevCurrent = JSON.parse(await fs.readFile(currentPath, 'utf8'));

let onEventRef = null;
let readyResolve;
const ready = new Promise((resolve) => { readyResolve = resolve; });
let buildCalls = 0;
const deps = {
  resolveWatcherBackend: () => ({
    requested: 'chokidar',
    resolved: 'chokidar',
    warning: null,
    pollingEnabled: false
  }),
  discoverFilesForModes: async () => ({
    code: [{ abs: filePath, rel: 'src/index.js', stat: fileStat }]
  }),
  startWatcher: async ({ onEvent }) => {
    onEventRef = onEvent;
    return { close: async () => {} };
  },
  buildIndexForMode: async () => {
    buildCalls += 1;
    throw new Error('forced build failure');
  },
  validateIndexArtifacts: async () => {
    throw new Error('validate should not be called on build failure');
  },
  promoteBuild: async () => {
    throw new Error('promote should not be called on build failure');
  }
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
await onEventRef({ type: 'change', absPath: filePath });
await waitFor(() => buildCalls >= 1);
abortController.abort();
await watchPromise;

const nextCurrent = JSON.parse(await fs.readFile(currentPath, 'utf8'));
assert.equal(nextCurrent.buildId, prevCurrent.buildId, 'expected current.json to remain unchanged');
assert.equal(nextCurrent.buildRoot, prevCurrent.buildRoot, 'expected buildRoot to remain unchanged');

console.log('watch atomicity test passed');
