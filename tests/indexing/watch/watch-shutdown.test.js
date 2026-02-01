#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { applyTestEnv } from '../../helpers/test-env.js';
import { buildIgnoreMatcher } from '../../../src/index/build/ignore.js';
import { watchIndex } from '../../../src/index/build/watch.js';
import { getRepoCacheRoot } from '../../../tools/dict-utils.js';

const waitFor = async (predicate, timeoutMs = 5000) => {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Timed out waiting for condition.');
};

const createRuntime = async (repoRoot, repoCacheRoot) => {
  const userConfig = {};
  const { ignoreMatcher } = await buildIgnoreMatcher({ root: repoRoot, userConfig });
  return {
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
};

// Early shutdown should not throw.
{
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-watch-shutdown-early-'));
  applyTestEnv({ cacheRoot: tempRoot });
  const repoRoot = path.join(tempRoot, 'repo');
  await fs.mkdir(path.join(repoRoot, 'src'), { recursive: true });
  const filePath = path.join(repoRoot, 'src', 'index.js');
  await fs.writeFile(filePath, 'export const value = 1;\n');
  const fileStat = await fs.stat(filePath);
  const repoCacheRoot = getRepoCacheRoot(repoRoot, {});
  const runtime = await createRuntime(repoRoot, repoCacheRoot);
  const abortController = new AbortController();
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
    startWatcher: async () => ({ close: async () => {} }),
    buildIndexForMode: async () => {},
    validateIndexArtifacts: async () => ({ ok: true, issues: [], warnings: [] }),
    promoteBuild: async () => ({})
  };
  const watchPromise = watchIndex({
    runtime,
    modes: ['code'],
    pollMs: 0,
    debounceMs: 10,
    abortSignal: abortController.signal,
    handleSignals: false,
    deps
  });
  abortController.abort();
  await watchPromise;
}

// Shutdown during active build releases lock.
{
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-watch-shutdown-active-'));
  applyTestEnv({ cacheRoot: tempRoot });
  const repoRoot = path.join(tempRoot, 'repo');
  await fs.mkdir(path.join(repoRoot, 'src'), { recursive: true });
  const filePath = path.join(repoRoot, 'src', 'index.js');
  await fs.writeFile(filePath, 'export const value = 1;\n');
  const fileStat = await fs.stat(filePath);
  const repoCacheRoot = getRepoCacheRoot(repoRoot, {});
  const runtime = await createRuntime(repoRoot, repoCacheRoot);

  let onEventRef = null;
  let buildStartedResolve;
  const buildStarted = new Promise((resolve) => { buildStartedResolve = resolve; });
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
    buildIndexForMode: async ({ abortSignal }) => {
      buildStartedResolve();
      if (abortSignal?.aborted) return;
      await new Promise((resolve) => {
        abortSignal?.addEventListener('abort', resolve, { once: true });
      });
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
    deps
  });

  await waitFor(() => Boolean(onEventRef));
  await onEventRef({ type: 'change', absPath: filePath });
  await buildStarted;
  abortController.abort();
  await watchPromise;

  const lockPath = path.join(repoCacheRoot, 'locks', 'index.lock');
  assert.equal(fsSync.existsSync(lockPath), false, 'expected lock to be released');
}

console.log('watch shutdown tests passed');
