import path from 'node:path';
import { createCli } from '../../../src/shared/cli.js';
import { BENCH_OPTIONS, mergeCliOptions, validateBenchArgs } from '../../../src/shared/cli-options.js';
import { resolveToolRoot } from '../../shared/dict-utils.js';

const parseMs = (value, fallback) => {
  const parsed = Number(value);
  if (Number.isFinite(parsed) && parsed >= 0) return Math.floor(parsed);
  return fallback;
};

const normalizeLockMode = (value) => {
  if (!value) return 'fail-fast';
  const raw = String(value).trim().toLowerCase();
  if (raw === 'wait' || raw === 'retry') return 'wait';
  if (raw === 'stale-clear' || raw === 'stale') return 'stale-clear';
  return 'fail-fast';
};

const resolveBackendList = (value) => {
  if (!value) return ['memory', 'sqlite'];
  const trimmed = String(value).trim().toLowerCase();
  if (!trimmed) return ['memory', 'sqlite'];
  if (trimmed === 'all') return ['memory', 'sqlite', 'sqlite-fts'];
  return trimmed
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
};

const buildRunSuffix = () => {
  const now = new Date();
  const stamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0')
  ].join('');
  const time = [
    String(now.getHours()).padStart(2, '0'),
    String(now.getMinutes()).padStart(2, '0'),
    String(now.getSeconds()).padStart(2, '0')
  ].join('');
  return `run-${stamp}-${time}`;
};

export const parseBenchLanguageArgs = (rawArgs = process.argv.slice(2)) => {
  const benchOptions = mergeCliOptions(
    BENCH_OPTIONS,
    {
      list: { type: 'boolean', default: false },
      clone: { type: 'boolean', default: true },
      'no-clone': { type: 'boolean', default: false },
      'dry-run': { type: 'boolean', default: false },
      'cache-run': { type: 'boolean', default: false },
      'keep-cache': { type: 'boolean', default: false },
      config: { type: 'string' },
      root: { type: 'string' },
      'cache-root': { type: 'string' },
      'cache-suffix': { type: 'string' },
      results: { type: 'string' },
      log: { type: 'string' },
      language: { type: 'string' },
      languages: { type: 'string' },
      tier: { type: 'string' },
      repos: { type: 'string' },
      only: { type: 'string' },
      'log-lines': { type: 'number' },
      'lock-mode': { type: 'string' },
      'lock-wait-ms': { type: 'number' },
      'lock-stale-ms': { type: 'number' }
    }
  );
  const argv = createCli({
    scriptName: 'bench-language',
    options: benchOptions,
    argv: ['node', 'tools/bench/language-repos.js', ...(rawArgs || [])]
  }).parse();
  validateBenchArgs(argv, { allowedOptions: benchOptions });

  const scriptRoot = resolveToolRoot();
  const runSuffix = buildRunSuffix();
  const configPath = path.resolve(argv.config || path.join(scriptRoot, 'benchmarks', 'repos.json'));
  const reposRoot = path.resolve(argv.root || path.join(scriptRoot, 'benchmarks', 'repos'));
  const cacheRootBase = path.resolve(argv['cache-root'] || path.join(scriptRoot, 'benchmarks', 'cache'));
  const cacheSuffixRaw = typeof argv['cache-suffix'] === 'string' ? argv['cache-suffix'].trim() : '';
  const cacheRun = argv['cache-run'] === true;
  const cacheSuffix = cacheSuffixRaw || (cacheRun ? runSuffix : '');
  const cacheRoot = cacheSuffix ? path.resolve(cacheRootBase, cacheSuffix) : cacheRootBase;
  const resultsRoot = path.resolve(argv.results || path.join(scriptRoot, 'benchmarks', 'results'));
  const logRoot = path.join(resultsRoot, 'logs', 'bench-language');
  const logPath = argv.log
    ? path.resolve(argv.log)
    : path.join(logRoot, `${runSuffix}-all.log`);

  const cloneEnabled = argv['no-clone'] ? false : argv.clone !== false;
  const dryRun = argv['dry-run'] === true;
  const keepCache = argv['keep-cache'] === true;
  const quietMode = argv.quiet === true || argv.json === true;
  const progressMode = argv.progress || 'auto';

  const logLineArg = Number.parseInt(argv['log-lines'], 10);
  const logWindowSize = Number.isFinite(logLineArg)
    ? Math.max(3, Math.min(50, logLineArg))
    : 20;

  const lockMode = normalizeLockMode(
    argv['lock-mode']
    || ((argv.build || argv['build-index'] || argv['build-sqlite']) ? 'stale-clear' : '')
  );
  const lockWaitMs = parseMs(argv['lock-wait-ms'], 5 * 60 * 1000);
  const lockStaleMs = parseMs(argv['lock-stale-ms'], 30 * 60 * 1000);

  const backendList = resolveBackendList(argv.backend);
  const wantsSqlite = backendList.includes('sqlite')
    || backendList.includes('sqlite-fts')
    || backendList.includes('fts');

  return {
    argv,
    scriptRoot,
    runSuffix,
    configPath,
    reposRoot,
    cacheRoot,
    resultsRoot,
    logRoot,
    logPath,
    cloneEnabled,
    dryRun,
    keepCache,
    quietMode,
    progressMode,
    logWindowSize,
    lockMode,
    lockWaitMs,
    lockStaleMs,
    backendList,
    wantsSqlite
  };
};
