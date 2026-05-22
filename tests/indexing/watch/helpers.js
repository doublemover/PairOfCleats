import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';

import { buildIgnoreMatcher } from '../../../src/index/build/ignore.js';
import { watchIndex } from '../../../src/index/build/watch.js';
import { getRepoCacheRoot } from '../../../tools/shared/dict-utils.js';
import { applyTestEnv } from '../../helpers/test-env.js';

export const normalizeAbsPath = (value) => path.resolve(String(value || '')).replace(/\\/g, '/').toLowerCase();

export const waitFor = async (predicate, timeoutMs = 5000) => {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Timed out waiting for condition.');
};

export const createTempWatchRepo = async ({ prefix, files }) => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  applyTestEnv({ cacheRoot: tempRoot });

  const repoRoot = path.join(tempRoot, 'repo');
  const entries = {};
  for (const [name, spec] of Object.entries(files)) {
    const rel = spec.rel;
    const abs = path.join(repoRoot, rel);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, spec.content);
    entries[name] = {
      abs,
      rel,
      stat: await fs.stat(abs)
    };
  }

  return {
    tempRoot,
    repoRoot,
    files: entries
  };
};

export const createWatchRuntime = async ({ repoRoot, userConfig = {} }) => {
  const { ignoreMatcher } = await buildIgnoreMatcher({ root: repoRoot, userConfig });
  const repoCacheRoot = getRepoCacheRoot(repoRoot, userConfig);
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

export const createWatchDeps = ({
  entries,
  buildIndexForMode,
  backend = 'chokidar',
  validateIndexArtifacts = async () => ({ ok: true, issues: [], warnings: [] }),
  promoteBuild = async () => ({})
}) => {
  let onEventRef = null;
  return {
    deps: {
      resolveWatcherBackend: () => ({
        requested: backend,
        resolved: backend,
        warning: null,
        pollingEnabled: false
      }),
      discoverFilesForModes: async () => ({
        code: entries
      }),
      startWatcher: async ({ onEvent }) => {
        onEventRef = onEvent;
        return { close: async () => {} };
      },
      buildIndexForMode,
      validateIndexArtifacts,
      promoteBuild
    },
    getOnEvent: () => onEventRef
  };
};

export const startCodeWatch = ({ runtime, deps, debounceMs = 10, onStateChange }) => {
  let readyResolve;
  const ready = new Promise((resolve) => { readyResolve = resolve; });
  const abortController = new AbortController();
  const watchPromise = watchIndex({
    runtime,
    modes: ['code'],
    pollMs: 0,
    debounceMs,
    abortSignal: abortController.signal,
    handleSignals: false,
    deps,
    onReady: () => readyResolve(),
    onStateChange
  });
  return {
    abortController,
    ready,
    watchPromise
  };
};
