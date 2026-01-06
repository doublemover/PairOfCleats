import fs from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { parseBuildArgs } from '../../index/build/args.js';
import { buildIndexForMode } from '../../index/build/indexer.js';
import { acquireIndexLock } from '../../index/build/lock.js';
import { discoverFilesForModes } from '../../index/build/discover.js';
import { createBuildRuntime } from '../../index/build/runtime.js';
import { watchIndex } from '../../index/build/watch.js';
import { log as defaultLog } from '../../shared/progress.js';
import { shutdownPythonAstPool } from '../../lang/python.js';
import { getCacheRoot, getRepoCacheRoot, loadUserConfig, resolveRepoRoot } from '../../../tools/dict-utils.js';
import { ensureQueueDir, enqueueJob } from '../../../tools/service/queue.js';
import { runBuildSqliteIndex } from '../../../tools/build-sqlite-index.js';
import { runSearchCli } from '../../retrieval/cli.js';
import { getStatus } from './status.js';

const buildRawArgs = (options = {}) => {
  const args = [];
  if (options.mode) args.push('--mode', String(options.mode));
  if (options.stage) args.push('--stage', String(options.stage));
  if (options.threads !== undefined) args.push('--threads', String(options.threads));
  if (options.incremental) args.push('--incremental');
  if (options['stub-embeddings'] || options.stubEmbeddings) args.push('--stub-embeddings');
  if (options.watch) args.push('--watch');
  if (options['watch-poll'] !== undefined) args.push('--watch-poll', String(options['watch-poll']));
  if (options['watch-debounce'] !== undefined) args.push('--watch-debounce', String(options['watch-debounce']));
  if (options.sqlite === true) args.push('--sqlite');
  if (options.sqlite === false) args.push('--no-sqlite');
  if (options.model) args.push('--model', String(options.model));
  return args;
};

const pushFlag = (args, name, value) => {
  if (value === undefined || value === null) return;
  if (value === true) {
    args.push(`--${name}`);
  } else if (value === false) {
    args.push(`--no-${name}`);
  } else {
    args.push(`--${name}`, String(value));
  }
};

  const buildSearchArgs = (params = {}) => {
    const args = [];
  pushFlag(args, 'mode', params.mode);
  pushFlag(args, 'backend', params.backend);
  pushFlag(args, 'ann', params.ann);
  pushFlag(args, 'json', params.json);
  pushFlag(args, 'json-compact', params.jsonCompact);
  pushFlag(args, 'explain', params.explain);
  pushFlag(args, 'context', params.context);
  pushFlag(args, 'n', params.n);
  pushFlag(args, 'case', params.case);
  pushFlag(args, 'case-file', params.caseFile);
  pushFlag(args, 'case-tokens', params.caseTokens);
  pushFlag(args, 'path', params.path);
  pushFlag(args, 'file', params.file);
  pushFlag(args, 'ext', params.ext);
  pushFlag(args, 'lang', params.lang);
  if (params.args) args.push(...params.args);
    return args;
  };

const normalizeStage = (raw) => {
    const value = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
    if (!value) return null;
    if (value === '1' || value === 'stage1' || value === 'sparse') return 'stage1';
    if (value === '2' || value === 'stage2' || value === 'enrich' || value === 'full') return 'stage2';
  return null;
};

const resolveEnrichmentStatePath = (repoCacheRoot) => path.join(repoCacheRoot, 'enrichment_state.json');

const updateEnrichmentState = async (repoCacheRoot, patch) => {
  if (!repoCacheRoot) return null;
  let state = {};
  try {
    state = JSON.parse(await fs.readFile(resolveEnrichmentStatePath(repoCacheRoot), 'utf8'));
  } catch {}
  const next = {
    ...state,
    ...patch,
    updatedAt: new Date().toISOString()
  };
  try {
    await fs.mkdir(repoCacheRoot, { recursive: true });
    await fs.writeFile(resolveEnrichmentStatePath(repoCacheRoot), JSON.stringify(next, null, 2));
  } catch {}
  return next;
};

const buildStage2Args = ({ root, argv, rawArgv }) => {
  const args = ['--repo', root, '--stage', 'stage2'];
  if (argv.mode && argv.mode !== 'all') args.push('--mode', argv.mode);
  const stageThreads = Number(argv.threads);
  if (Number.isFinite(stageThreads) && stageThreads > 0) {
    args.push('--threads', String(stageThreads));
  }
  if (argv.incremental) args.push('--incremental');
  if (rawArgv.includes('--stub-embeddings')) args.push('--stub-embeddings');
  if (typeof argv.sqlite === 'boolean') args.push(argv.sqlite ? '--sqlite' : '--no-sqlite');
  if (argv.model) args.push('--model', String(argv.model));
  return args;
};

/**
 * Build file-backed indexes for a repo.
 * @param {string} repoRoot
 * @param {object} [options]
 * @returns {Promise<object>}
 */
export async function buildIndex(repoRoot, options = {}) {
  const root = repoRoot ? path.resolve(repoRoot) : resolveRepoRoot(process.cwd());
  const defaults = parseBuildArgs([]).argv;
  const baseArgv = { ...defaults, ...options, repo: root };
  const explicitStage = normalizeStage(baseArgv.stage);
  const argv = explicitStage ? { ...baseArgv, stage: explicitStage } : baseArgv;
  const mode = argv.mode || 'all';
  const modes = mode === 'all' ? ['prose', 'code'] : [mode];
  const rawArgv = options.rawArgv || buildRawArgs(options);
  const log = typeof options.log === 'function' ? options.log : defaultLog;

  if (argv.watch) {
    const runtime = await createBuildRuntime({ root, argv, rawArgv });
    const pollMs = Number.isFinite(Number(argv['watch-poll'])) ? Number(argv['watch-poll']) : 2000;
    const debounceMs = Number.isFinite(Number(argv['watch-debounce'])) ? Number(argv['watch-debounce']) : 500;
    await watchIndex({ runtime, modes, pollMs, debounceMs });
    return { modes, watch: true };
  }

  const userConfig = loadUserConfig(root);
  const repoCacheRoot = getRepoCacheRoot(root, userConfig);
  const twoStageConfig = userConfig?.indexing?.twoStage || {};
  const twoStageEnabled = twoStageConfig.enabled === true;
  const runStage = async (stage, { allowSqlite = true } = {}) => {
    const stageArgv = stage ? { ...argv, stage } : argv;
    const runtime = await createBuildRuntime({ root, argv: stageArgv, rawArgv });
    const lock = await acquireIndexLock({ repoCacheRoot: runtime.repoCacheRoot, log });
    if (!lock) throw new Error('Index lock unavailable.');
    let sqliteResult = null;
    try {
      let sharedDiscovery = null;
      if (modes.includes('code') && modes.includes('prose')) {
        const skippedByMode = { code: [], prose: [] };
        const entriesByMode = await runtime.queues.io.add(() => discoverFilesForModes({
          root: runtime.root,
          modes: ['code', 'prose'],
          ignoreMatcher: runtime.ignoreMatcher,
          skippedByMode,
          maxFileBytes: runtime.maxFileBytes,
          fileCaps: runtime.fileCaps
        }));
        sharedDiscovery = {
          code: { entries: entriesByMode.code, skippedFiles: skippedByMode.code },
          prose: { entries: entriesByMode.prose, skippedFiles: skippedByMode.prose }
        };
      }
      for (const modeItem of modes) {
        const discovery = sharedDiscovery ? sharedDiscovery[modeItem] : null;
        await buildIndexForMode({ mode: modeItem, runtime, discovery });
      }
      if (allowSqlite) {
        const sqliteConfigured = runtime.userConfig?.sqlite?.use !== false;
        const shouldBuildSqlite = typeof stageArgv.sqlite === 'boolean' ? stageArgv.sqlite : sqliteConfigured;
        const sqliteModes = modes.filter((modeItem) => modeItem === 'code' || modeItem === 'prose');
        if (shouldBuildSqlite && sqliteModes.length) {
          sqliteResult = await buildSqliteIndex(root, {
            mode: sqliteModes.length === 1 ? sqliteModes[0] : 'all',
            incremental: stageArgv.incremental === true,
            emitOutput: options.emitOutput !== false,
            exitOnError: false
          });
        }
      }
    } finally {
      await lock.release();
      if (runtime.workerPool) {
        try {
          await runtime.workerPool.destroy();
        } catch {}
      }
      shutdownPythonAstPool();
    }

    if (twoStageEnabled) {
      const now = new Date().toISOString();
      if (stage === 'stage1') {
        await updateEnrichmentState(runtime.repoCacheRoot, {
          status: 'pending',
          stage1At: now,
          queued: false
        });
      }
      if (stage === 'stage2') {
        await updateEnrichmentState(runtime.repoCacheRoot, {
          status: 'done',
          stage2At: now,
          queued: false
        });
      }
    }
    return { modes, sqlite: sqliteResult, repo: runtime.root, stage };
  };

  if (explicitStage || !twoStageEnabled) {
    return runStage(explicitStage, { allowSqlite: true });
  }

  const stage1Result = await runStage('stage1', { allowSqlite: false });
  if (twoStageConfig.background === true) {
    const stage2Args = buildStage2Args({ root, argv, rawArgv });
    const queueEnabled = twoStageConfig.queue !== false;
    if (queueEnabled) {
      const queueDir = userConfig?.indexing?.embeddings?.queue?.dir
        ? path.resolve(userConfig.indexing.embeddings.queue.dir)
        : path.join(getCacheRoot(), 'service', 'queue');
      const maxQueuedRaw = Number(userConfig?.indexing?.embeddings?.queue?.maxQueued);
      const maxQueued = Number.isFinite(maxQueuedRaw) ? Math.max(0, Math.floor(maxQueuedRaw)) : null;
      const jobId = `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
      await ensureQueueDir(queueDir);
      const result = await enqueueJob(
        queueDir,
        {
          id: jobId,
          createdAt: new Date().toISOString(),
          repo: root,
          mode: argv.mode || 'all',
          reason: 'stage2',
          stage: 'stage2',
          args: stage2Args
        },
        maxQueued,
        'index'
      );
      if (result.ok) {
        await updateEnrichmentState(repoCacheRoot, {
          queued: true,
          queueId: jobId
        });
        log('Two-stage indexing: stage2 queued for background enrichment.');
        return { modes, stage1: stage1Result, stage2: { queued: true, queueId: jobId }, repo: root };
      }
    }
    const stage2ArgsWithScript = [path.join(root, 'build_index.js'), ...stage2Args];
    spawn(process.execPath, stage2ArgsWithScript, { stdio: 'ignore', detached: true }).unref();
    return { modes, stage1: stage1Result, stage2: { background: true }, repo: root };
  }

  const stage2Result = await runStage('stage2', { allowSqlite: true });
  return { modes, stage1: stage1Result, stage2: stage2Result, repo: root };
}

/**
 * Build or update SQLite indexes for a repo.
 * @param {string} repoRoot
 * @param {object} [options]
 * @returns {Promise<object>}
 */
export async function buildSqliteIndex(repoRoot, options = {}) {
  const root = repoRoot ? path.resolve(repoRoot) : resolveRepoRoot(process.cwd());
  const rawArgs = Array.isArray(options.args) ? options.args.slice() : [];
  if (!options.args) {
    if (options.mode) rawArgs.push('--mode', String(options.mode));
    if (options.incremental) rawArgs.push('--incremental');
    if (options.compact) rawArgs.push('--compact');
    if (options.out) rawArgs.push('--out', String(options.out));
    if (options.codeDir) rawArgs.push('--code-dir', String(options.codeDir));
    if (options.proseDir) rawArgs.push('--prose-dir', String(options.proseDir));
  }
  return runBuildSqliteIndex(rawArgs, {
    root,
    emitOutput: options.emitOutput !== false,
    exitOnError: options.exitOnError === true
  });
}

/**
 * Execute a search for a repo.
 * @param {string} repoRoot
 * @param {object} params
 * @returns {Promise<object>}
 */
export async function search(repoRoot, params = {}) {
  const rootOverride = repoRoot
    ? path.resolve(repoRoot)
    : (params.root ? path.resolve(params.root) : null);
  const rawArgs = Array.isArray(params.args) ? params.args.slice() : buildSearchArgs(params);
  const query = typeof params.query === 'string' ? params.query : '';
  if (query) rawArgs.push(query);
  return runSearchCli(rawArgs, {
    root: rootOverride || undefined,
    emitOutput: params.emitOutput === true,
    exitOnError: params.exitOnError === true,
    indexCache: params.indexCache,
    sqliteCache: params.sqliteCache
  });
}

/**
 * Report artifact status for a repo.
 * @param {string} repoRoot
 * @param {object} [options]
 * @returns {Promise<object>}
 */
export async function status(repoRoot, options = {}) {
  const root = repoRoot ? path.resolve(repoRoot) : resolveRepoRoot(process.cwd());
  return getStatus({ repoRoot: root, includeAll: options.all === true });
}
