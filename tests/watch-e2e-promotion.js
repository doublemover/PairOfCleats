#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { applyTestEnv } from './helpers/test-env.js';
import { buildIgnoreMatcher } from '../src/index/build/ignore.js';
import { watchIndex } from '../src/index/build/watch.js';
import { promoteBuild } from '../src/index/build/promotion.js';
import { getRepoCacheRoot } from '../tools/dict-utils.js';

const waitFor = async (predicate, timeoutMs = 5000) => {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Timed out waiting for condition.');
};

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-watch-e2e-'));
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
const currentPath = path.join(buildsRoot, 'current.json');
const events = [];
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
    code: [{ abs: filePath, rel: 'src/index.js', stat: fileStat }]
  }),
  startWatcher: async ({ onEvent }) => {
    onEventRef = onEvent;
    return { close: async () => {} };
  },
  buildIndexForMode: async ({ runtime: runtimeRef }) => {
    events.push('build');
    await fs.mkdir(runtimeRef.buildRoot, { recursive: true });
  },
  validateIndexArtifacts: async () => {
    events.push('validate');
    assert.equal(fsSync.existsSync(currentPath), false, 'expected current.json to be absent before promotion');
    return { ok: true, issues: [], warnings: [] };
  },
  promoteBuild: async (args) => {
    events.push('promote');
    return promoteBuild(args);
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
assert.ok(onEventRef, 'expected watcher to register event handler');
await onEventRef({ type: 'change', absPath: filePath });

await waitFor(() => events.includes('promote'));
abortController.abort();
await watchPromise;

const currentRaw = await fs.readFile(currentPath, 'utf8');
const current = JSON.parse(currentRaw);
const promotedRoot = current.buildRoot ? path.join(repoCacheRoot, current.buildRoot) : null;
assert.ok(promotedRoot, 'expected current.json buildRoot');
assert.ok(fsSync.existsSync(promotedRoot), 'expected promoted build root to exist');
assert.ok(events.indexOf('promote') > events.indexOf('validate'), 'expected promote after validate');

console.log('watch e2e promotion test passed');
