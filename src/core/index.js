import path from 'node:path';
import { parseBuildArgs } from '../indexer/build/args.js';
import { buildIndexForMode } from '../indexer/build/indexer.js';
import { acquireIndexLock } from '../indexer/build/lock.js';
import { discoverFilesForModes } from '../indexer/build/discover.js';
import { createBuildRuntime } from '../indexer/build/runtime.js';
import { watchIndex } from '../indexer/build/watch.js';
import { log as defaultLog } from '../shared/progress.js';
import { shutdownPythonAstPool } from '../lang/python.js';
import { resolveRepoRoot } from '../../tools/dict-utils.js';
import { runBuildSqliteIndex } from '../../tools/build-sqlite-index.js';
import { runSearchCli } from '../search/cli.js';
import { getStatus } from './status.js';

const buildRawArgs = (options = {}) => {
  const args = [];
  if (options.mode) args.push('--mode', String(options.mode));
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

/**
 * Build file-backed indexes for a repo.
 * @param {string} repoRoot
 * @param {object} [options]
 * @returns {Promise<object>}
 */
export async function buildIndex(repoRoot, options = {}) {
  const root = repoRoot ? path.resolve(repoRoot) : resolveRepoRoot(process.cwd());
  const defaults = parseBuildArgs([]).argv;
  const argv = { ...defaults, ...options, repo: root };
  const mode = argv.mode || 'all';
  const modes = mode === 'all' ? ['prose', 'code'] : [mode];
  const rawArgv = options.rawArgv || buildRawArgs(options);
  const log = typeof options.log === 'function' ? options.log : defaultLog;

  const runtime = await createBuildRuntime({ root, argv, rawArgv });
  if (argv.watch) {
    const pollMs = Number.isFinite(Number(argv['watch-poll'])) ? Number(argv['watch-poll']) : 2000;
    const debounceMs = Number.isFinite(Number(argv['watch-debounce'])) ? Number(argv['watch-debounce']) : 500;
    await watchIndex({ runtime, modes, pollMs, debounceMs });
    return { modes, watch: true };
  }

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
        maxFileBytes: runtime.maxFileBytes
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
    const sqliteConfigured = runtime.userConfig?.sqlite?.use !== false;
    const shouldBuildSqlite = typeof argv.sqlite === 'boolean' ? argv.sqlite : sqliteConfigured;
    const sqliteModes = modes.filter((modeItem) => modeItem === 'code' || modeItem === 'prose');
    if (shouldBuildSqlite && sqliteModes.length) {
      sqliteResult = await buildSqliteIndex(root, {
        mode: sqliteModes.length === 1 ? sqliteModes[0] : 'all',
        incremental: argv.incremental === true,
        emitOutput: options.emitOutput !== false,
        exitOnError: false
      });
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

  return { modes, sqlite: sqliteResult, repo: runtime.root };
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
