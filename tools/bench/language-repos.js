#!/usr/bin/env node
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { getBenchMirrorRefreshMs } from '../../src/shared/env.js';
import { getRuntimeConfig, loadUserConfig, resolveRuntimeEnv } from '../shared/dict-utils.js';
import { parseBenchLanguageArgs } from './language/cli.js';
import { loadBenchConfig } from './language/config.js';
import { checkIndexLock, formatLockDetail } from './language/locks.js';
import { formatEtaSeconds } from '../../src/shared/perf/eta.js';
import {
  buildNonInteractiveGitEnv,
  ensureLongPathsSupport,
  ensureRepoBenchmarkReady,
  needsIndexArtifacts,
  needsSqliteArtifacts,
  resolveCloneTool,
  resolveMirrorCacheRoot,
  resolveMirrorRefreshMs,
  resolveRepoCacheRoot,
  resolveRepoDir,
  tryMirrorClone
} from './language/repos.js';
import { isInside, isRootPath } from '../shared/path-utils.js';
import { createProcessRunner } from './language/process.js';
import { buildBenchEnvironmentMetadata } from './language/logging.js';
import {
  buildLineStats,
  formatGb,
  formatMetricSummary,
  getRecommendedHeapMb,
  validateEncodingFixtures
} from './language/metrics.js';
import { sanitizeBenchNodeOptions } from './language/node-options.js';
import { resolveAdaptiveBenchTimeoutMs, summarizeBenchLineStats } from './language/timeout.js';
import { buildReportOutput, printSummary } from './language/report.js';
import { retainCrashArtifacts } from '../../src/index/build/crash-log.js';
import { removePathWithRetry } from '../../src/shared/io/remove-path-with-retry.js';
import { createToolDisplay } from '../shared/cli-display.js';
import { parseCommaList } from '../shared/text-utils.js';
import { readQueryFileSafe } from '../shared/query-file-utils.js';

/**
 * @typedef {object} BenchTaskDescriptor
 * @property {string} language
 * @property {string} label
 * @property {string} tier
 * @property {string} repo
 * @property {string} queriesPath
 * @property {string} [logSlug]
 * @property {string} [repoShortName]
 * @property {boolean} [repoLogNameCollision]
 */

/**
 * @typedef {object} BenchExecutionPlan
 * @property {BenchTaskDescriptor} task
 * @property {string} repoPath
 * @property {string} repoLabel
 * @property {string} tierLabel
 * @property {string} repoCacheRoot
 * @property {string} outDir
 * @property {string} outFile
 * @property {string} fallbackLogSlug
 */

/**
 * @typedef {object} BenchProgressEvent
 * @property {string} [event]
 * @property {string} [status]
 * @property {string} [name]
 * @property {string} [taskId]
 * @property {string} [stage]
 * @property {string} [mode]
 * @property {number} [current]
 * @property {number} [total]
 * @property {string} [message]
 * @property {number} [etaSeconds]
 * @property {object} [throughput]
 * @property {number} [chunksPerSec]
 * @property {number} [filesPerSec]
 * @property {object} [cache]
 * @property {number} [cacheHitRate]
 * @property {object} [writer]
 * @property {number} [writerPending]
 * @property {number} [writerMaxPending]
 * @property {object} [meta]
 * @property {boolean} [ephemeral]
 */

/**
 * Ensure repository-local benchmark config exists so bench runs inherit the
 * shared cache root even when a repo has no local settings yet.
 *
 * @param {string} repoPath
 * @param {string} cacheRoot
 * @returns {Promise<void>}
 */
const ensureBenchConfig = async (repoPath, cacheRoot) => {
  const configPath = path.join(repoPath, '.pairofcleats.json');
  if (fs.existsSync(configPath)) return;
  const payload = { cache: { root: cacheRoot } };
  await fsPromises.writeFile(configPath, JSON.stringify(payload, null, 2), 'utf8');
};

const queryCountCache = new Map();

const resolveBenchQueryCount = async (queriesPath, { limit = 0 } = {}) => {
  const target = typeof queriesPath === 'string' ? path.resolve(queriesPath) : '';
  if (!target) return 0;
  if (!queryCountCache.has(target)) {
    const loaded = await readQueryFileSafe(target, { allowJson: false });
    queryCountCache.set(target, Array.isArray(loaded) ? loaded.length : 0);
  }
  const total = Math.max(0, Number(queryCountCache.get(target)) || 0);
  const normalizedLimit = Number.isFinite(Number(limit))
    ? Math.max(0, Math.floor(Number(limit)))
    : 0;
  if (normalizedLimit > 0) return Math.min(total, normalizedLimit);
  return total;
};

const USR_GUARDRAIL_BENCHMARKS = Object.freeze([
  {
    item: 35,
    label: 'Per-framework edge canonicalization',
    script: 'tools/bench/usr/item35-framework-canonicalization.js',
    report: 'item35-framework-canonicalization.json'
  },
  {
    item: 36,
    label: 'Mandatory backward-compatibility matrix',
    script: 'tools/bench/usr/item36-backcompat-matrix.js',
    report: 'item36-backcompat-matrix.json'
  },
  {
    item: 37,
    label: 'Decomposed contract governance',
    script: 'tools/bench/usr/item37-governance-drift.js',
    report: 'item37-governance-drift.json'
  },
  {
    item: 38,
    label: 'Core language/framework catalog',
    script: 'tools/bench/usr/item38-catalog-contract.js',
    report: 'item38-catalog-contract.json'
  },
  {
    item: 39,
    label: 'Core normalization/linking/identity',
    script: 'tools/bench/usr/item39-normalization-linking-identity.js',
    report: 'item39-normalization-linking-identity.json'
  },
  {
    item: 40,
    label: 'Core pipeline/incremental/transforms',
    script: 'tools/bench/usr/item40-pipeline-incremental-transforms.js',
    report: 'item40-pipeline-incremental-transforms.json'
  }
]);

const {
  argv,
  scriptRoot,
  runSuffix,
  configPath,
  reposRoot,
  cacheRoot,
  resultsRoot,
  logPath: masterLogPath,
  cloneEnabled,
  dryRun,
  keepCache,
  logWindowSize,
  lockMode,
  lockWaitMs,
  lockStaleMs,
  benchTimeoutMs,
  backendList,
  wantsSqlite
} = parseBenchLanguageArgs();
const mirrorCacheRoot = resolveMirrorCacheRoot({ reposRoot });
const mirrorRefreshMs = resolveMirrorRefreshMs(getBenchMirrorRefreshMs());

const baseEnv = { ...process.env };
const benchEnvironmentMetadata = buildBenchEnvironmentMetadata(baseEnv);
const quietMode = argv.quiet === true || argv.json === true;
const display = createToolDisplay({
  argv,
  stream: process.stderr,
  displayOptions: {
    quiet: quietMode,
    logWindowSize,
    json: argv.json === true
  }
});
const exitWithDisplay = (code) => {
  display.close();
  process.exit(code);
};
const heapArgRaw = argv['heap-mb'];
const heapArg = Number.isFinite(Number(heapArgRaw)) ? Math.floor(Number(heapArgRaw)) : null;
const heapRecommendation = getRecommendedHeapMb();
let heapLogged = false;

const repoLogsEnabled = !(typeof argv.log === 'string' && argv.log.trim());
let masterLogStream = null;
let repoLogStream = null;
let repoLogPath = null;
const runDiagnosticsRoot = path.join(resultsRoot, 'logs', 'bench-language', `${runSuffix}-diagnostics`);

/**
 * Lazily initialize the run-level master log stream.
 *
 * @returns {void}
 */
const initMasterLog = () => {
  if (masterLogStream) return;
  fs.mkdirSync(path.dirname(masterLogPath), { recursive: true });
  masterLogStream = fs.createWriteStream(masterLogPath, { flags: 'a' });
  masterLogStream.write(`\n=== Bench run ${new Date().toISOString()} ===\n`);
  masterLogStream.write(`Config: ${configPath}\n`);
  masterLogStream.write(`Repos: ${reposRoot}\n`);
  masterLogStream.write(`Cache: ${cacheRoot}\n`);
  masterLogStream.write(`Results: ${resultsRoot}\n`);
  if (repoLogsEnabled) {
    masterLogStream.write(`Repo logs: ${path.dirname(masterLogPath)}\n`);
  }
};

/**
 * Rotate and initialize per-repo logs so each benchmark target gets an isolated
 * log file while still forwarding all lines to the run master log.
 *
 * @param {{label:string,tier?:string,repoPath:string,slug:string}} input
 * @returns {string|null}
 */
const initRepoLog = ({ label, tier, repoPath: repoDir, slug }) => {
  if (!repoLogsEnabled) return null;
  try {
    if (repoLogStream) repoLogStream.end();
  } catch {}
  repoLogStream = null;
  repoLogPath = path.join(path.dirname(masterLogPath), `${runSuffix}-${slug}.log`);
  fs.mkdirSync(path.dirname(repoLogPath), { recursive: true });
  repoLogStream = fs.createWriteStream(repoLogPath, { flags: 'a' });
  repoLogStream.write(`\n=== Bench run ${new Date().toISOString()} ===\n`);
  repoLogStream.write(`Target: ${label}${tier ? ` tier=${tier}` : ''}\n`);
  repoLogStream.write(`Repo path: ${repoDir}\n`);
  repoLogStream.write(`Config: ${configPath}\n`);
  repoLogStream.write(`Cache: ${cacheRoot}\n`);
  repoLogStream.write(`Results: ${resultsRoot}\n`);
  repoLogStream.write(`Master log: ${masterLogPath}\n`);
  initMasterLog();
  masterLogStream?.write(`[log] Repo log for ${label}: ${repoLogPath}\n`);
  return repoLogPath;
};

/**
 * Close and clear the active per-repo log stream.
 *
 * @returns {void}
 */
const closeRepoLog = () => {
  if (!repoLogStream) return;
  try {
    repoLogStream.end();
  } catch {}
  repoLogStream = null;
  repoLogPath = null;
};

/**
 * Write a line to active asynchronous log streams.
 *
 * @param {string} line
 * @returns {void}
 */
const writeLog = (line) => {
  if (!masterLogStream) initMasterLog();
  if (masterLogStream) masterLogStream.write(`${line}\n`);
  if (repoLogStream) repoLogStream.write(`${line}\n`);
};

const appendToLogFileSync = (filePath, line) => {
  if (!filePath) return;
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.appendFileSync(filePath, `${line}\n`);
  } catch {}
};

const writeLogSync = (line) => {
  appendToLogFileSync(masterLogPath, line);
  if (repoLogPath && repoLogPath !== masterLogPath) {
    appendToLogFileSync(repoLogPath, line);
  }
};

const logHistory = [];
const logHistoryLimit = 50;
const isDiskFullMessage = (line) => {
  if (!line) return false;
  const text = String(line).toLowerCase();
  return text.includes('no space left on device')
    || text.includes('disk full')
    || text.includes('database or disk is full')
    || text.includes('sqlite_full')
    || text.includes('enospc')
    || text.includes('insufficient free space');
};

/**
 * Unified log sink for display + file streams.
 *
 * @param {string} line
 * @param {'info'|'warn'|'error'} [level]
 * @param {object|null} [meta]
 * @returns {void}
 */
const appendLog = (line, level = 'info', meta = null) => {
  if (!line) return;
  const fileOnlyLine = meta && typeof meta === 'object' && typeof meta.fileOnlyLine === 'string'
    ? meta.fileOnlyLine
    : null;
  writeLog(fileOnlyLine || line);
  if (level === 'error') {
    display.error(line, meta);
  } else if (level === 'warn') {
    display.warn(line, meta);
  } else {
    if (meta && typeof meta === 'object' && meta.kind === 'status') {
      display.logLine(line, meta);
    } else {
      display.log(line, meta);
    }
  }
  logHistory.push(line);
  if (logHistory.length > logHistoryLimit) logHistory.shift();
};
const writeListLine = (line) => {
  appendLog(line, 'info', { forceOutput: true });
};
let benchInFlightFraction = 0;
let updateBenchProgress = () => {};

/**
 * Clamp a bench progress value to [0, 1].
 *
 * @param {number} value
 * @returns {number}
 */
const clampBenchFraction = (value) => {
  if (!Number.isFinite(value)) return 0;
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
};

/**
 * Derive fractional completion from progress events.
 *
 * @param {BenchProgressEvent|object|null} event
 * @returns {number|null}
 */
const deriveBenchFraction = (event) => {
  const current = Number.isFinite(event?.current) ? Number(event.current) : 0;
  const total = Number.isFinite(event?.total) ? Number(event.total) : 0;
  if (total <= 0) return null;
  return clampBenchFraction(current / total);
};

/**
 * Track fractional completion for the currently running repo benchmark.
 *
 * @param {number} value
 * @param {{refresh?:boolean}} [options]
 * @returns {void}
 */
const setBenchInFlightFraction = (value, { refresh = true } = {}) => {
  const next = clampBenchFraction(value);
  if (next === benchInFlightFraction) return;
  benchInFlightFraction = next;
  if (refresh) updateBenchProgress();
};

/**
 * Build a compact status line from structured child task telemetry.
 *
 * @param {BenchProgressEvent|object|null} event
 * @returns {string|null}
 */
const formatChildTaskMessage = (event) => {
  if (!event || typeof event !== 'object') return null;
  const explicit = typeof event.message === 'string' ? event.message.trim() : '';
  if (explicit) return explicit;
  const throughputChunks = Number(event?.throughput?.chunksPerSec ?? event?.chunksPerSec);
  const throughputFiles = Number(event?.throughput?.filesPerSec ?? event?.filesPerSec);
  const etaText = formatEtaSeconds(event?.etaSeconds, { preferHours: false });
  const cacheHitRate = Number(event?.cache?.hitRate ?? event?.cacheHitRate);
  const writerPending = Number(event?.writer?.pending ?? event?.writerPending);
  const writerMax = Number(event?.writer?.currentMaxPending ?? event?.writerMaxPending);
  const parts = [];
  if (Number.isFinite(throughputFiles) && throughputFiles > 0) {
    parts.push(`${throughputFiles.toFixed(1)} files/s`);
  }
  if (Number.isFinite(throughputChunks) && throughputChunks > 0) {
    parts.push(`${throughputChunks.toFixed(1)} chunks/s`);
  }
  if (etaText) {
    parts.push(`eta ${etaText}`);
  }
  if (Number.isFinite(cacheHitRate)) {
    parts.push(`cache ${cacheHitRate.toFixed(1)}%`);
  }
  if (Number.isFinite(writerPending) && Number.isFinite(writerMax) && writerMax > 0) {
    parts.push(`writer ${writerPending}/${writerMax}`);
  }
  return parts.length ? parts.join(' | ') : null;
};

/**
 * Consume child progress events and map them onto the interactive bench task
 * renderer plus repo-level in-flight progress state.
 *
 * @param {object} event
 * @returns {void}
 */
const handleProgressEvent = (event) => {
  if (!event || typeof event !== 'object') return;
  if (event.event === 'log') {
    const message = event.message || '';
    const level = event.level || 'info';
    const meta = event.meta && typeof event.meta === 'object' ? event.meta : null;
    appendLog(message, level, meta);
    return;
  }
  const rawName = event.name || event.taskId || 'task';
  const isOverall = (event.stage || '').toLowerCase() === 'overall'
    || String(rawName).trim().toLowerCase() === 'overall';
  if (isOverall) {
    const fraction = deriveBenchFraction(event);
    if (event.event === 'task:end') {
      setBenchInFlightFraction(event.status === 'failed' ? 0 : 1);
    } else if (fraction !== null) {
      setBenchInFlightFraction(fraction);
    } else if (event.event === 'task:start') {
      setBenchInFlightFraction(0);
    }
  }
  const name = isOverall && benchRepoLabel ? benchRepoLabel : rawName;
  const taskId = isOverall && benchRepoLabel ? 'bench:current' : (event.taskId || name);
  const total = Number.isFinite(event.total) && event.total > 0 ? event.total : null;
  const task = display.task(name, {
    taskId,
    stage: event.stage,
    mode: event.mode,
    total,
    ephemeral: event.ephemeral === true
  });
  const taskMessage = formatChildTaskMessage(event);
  const taskMeta = {
    ...event,
    message: taskMessage,
    name
  };
  const current = Number.isFinite(event.current) ? event.current : 0;
  if (event.event === 'task:start') {
    task.set(current, total, taskMeta);
    return;
  }
  if (event.event === 'task:progress') {
    task.set(current, total, taskMeta);
    return;
  }
  if (event.event === 'task:end') {
    if (event.status === 'failed') {
      task.fail(new Error(taskMessage || 'failed'));
    } else {
      task.done(taskMeta);
    }
  }
};
let processRunner = null;
processRunner = createProcessRunner({
  appendLog,
  writeLog,
  writeLogSync,
  logHistory,
  logPath: masterLogPath,
  getLogPaths: () => {
    const paths = [masterLogPath];
    if (repoLogPath && repoLogPath !== masterLogPath) paths.push(repoLogPath);
    return paths;
  },
  onProgressEvent: handleProgressEvent
});

process.on('exit', (code) => {
  processRunner.logExit('exit', code);
  closeRepoLog();
  if (masterLogStream) masterLogStream.end();
});
process.on('SIGINT', () => {
  writeLogSync('[signal] SIGINT received');
  const active = processRunner.getActiveChild();
  if (active) {
    writeLogSync(`[signal] terminating ${processRunner.getActiveLabel()}`);
    processRunner.killProcessTree(active.pid);
  }
  processRunner.logExit('SIGINT', 130);
  exitWithDisplay(130);
});
process.on('SIGTERM', () => {
  writeLogSync('[signal] SIGTERM received');
  const active = processRunner.getActiveChild();
  if (active) {
    writeLogSync(`[signal] terminating ${processRunner.getActiveLabel()}`);
    processRunner.killProcessTree(active.pid);
  }
  processRunner.logExit('SIGTERM', 143);
  exitWithDisplay(143);
});

const reportFatal = (label, err) => {
  try {
    // Ensure the log has the run header paths even on early crashes.
    initMasterLog();
  } catch {}
  try {
    const details = err?.stack || String(err);
    // Make failures visible even in interactive mode.
    display.error(`[bench-language] Fatal: ${label}`);
    display.error(details);
    const paths = [masterLogPath];
    if (repoLogPath && repoLogPath !== masterLogPath) paths.push(repoLogPath);
    const names = paths.map((entry) => path.basename(entry));
    display.error(`[bench-language] Details logged (${names.join(', ')})`);
  } catch {}
};

process.on('uncaughtException', (err) => {
  reportFatal('uncaughtException', err);
  writeLogSync(`[error] uncaughtException: ${err?.stack || err}`);
  processRunner.logExit('uncaughtException', 1);
  exitWithDisplay(1);
});
process.on('unhandledRejection', (err) => {
  reportFatal('unhandledRejection', err);
  writeLogSync(`[error] unhandledRejection: ${err?.stack || err}`);
  processRunner.logExit('unhandledRejection', 1);
  exitWithDisplay(1);
});

/**
 * Run configured USR guardrail benchmark scripts and collect summary rows.
 * Failures are recorded per-item so language benchmark execution can continue.
 *
 * @returns {Promise<Array<object>>}
 */
const runUsrGuardrailBenchmarks = async () => {
  if (!USR_GUARDRAIL_BENCHMARKS.length) return [];
  const outputDir = path.join(resultsRoot, 'usr');
  const rows = [];
  appendLog(`[usr-bench] running ${USR_GUARDRAIL_BENCHMARKS.length} guardrail snapshot(s).`);
  if (!dryRun) {
    await fsPromises.mkdir(outputDir, { recursive: true });
  }
  for (const bench of USR_GUARDRAIL_BENCHMARKS) {
    const scriptPath = path.join(scriptRoot, bench.script);
    const outPath = path.join(outputDir, bench.report);
    if (dryRun) {
      appendLog(`[dry-run] node ${bench.script} --json ${outPath} --quiet`);
      rows.push({
        item: bench.item,
        label: bench.label,
        script: bench.script,
        outFile: outPath,
        dryRun: true
      });
      continue;
    }

    const runResult = await processRunner.runProcess(
      `usr-bench item ${bench.item}`,
      process.execPath,
      [scriptPath, '--json', outPath, '--quiet'],
      {
        cwd: scriptRoot,
        env: { ...baseEnv },
        timeoutMs: benchTimeoutMs,
        continueOnError: true
      }
    );
    if (!runResult.ok) {
      appendLog(`[usr-bench] item ${bench.item} failed; continuing.`, 'warn');
      rows.push({
        item: bench.item,
        label: bench.label,
        script: bench.script,
        outFile: outPath,
        ok: false
      });
      continue;
    }

    try {
      const payload = JSON.parse(await fsPromises.readFile(outPath, 'utf8'));
      rows.push({
        item: bench.item,
        label: bench.label,
        script: bench.script,
        outFile: outPath,
        ok: true,
        generatedAt: payload.generatedAt || null,
        metrics: payload.metrics || null,
        sourceDigest: payload.sourceDigest || null
      });
    } catch {
      appendLog(`[usr-bench] item ${bench.item} report parse failed; continuing.`, 'warn');
      rows.push({
        item: bench.item,
        label: bench.label,
        script: bench.script,
        outFile: outPath,
        ok: false
      });
    }
  }
  return rows;
};

const config = loadBenchConfig(configPath, { onLog: appendLog });
await validateEncodingFixtures(scriptRoot, { onLog: appendLog });

/**
 * Normalize user selector tokens so language/tier/repo filters can match
 * across CLI flags and config labels in a case-insensitive way.
 *
 * @param {unknown} value
 * @returns {string}
 */
const normalizeSelectorToken = (value) => String(value || '').trim().toLowerCase();

/**
 * Collect all known tier keys from bench config for positional-argument fallback.
 *
 * @param {object} benchConfig
 * @returns {Set<string>}
 */
const collectKnownTiers = (benchConfig) => {
  const tiers = new Set();
  for (const entry of Object.values(benchConfig || {})) {
    for (const tier of Object.keys(entry?.repos || {})) {
      tiers.add(normalizeSelectorToken(tier));
    }
  }
  return tiers;
};

/**
 * Resolve effective tier filter from `--tier` and positional args.
 *
 * @param {{argvTier?:string|string[]|null,positionalArgs?:unknown[],knownTiers:Set<string>}} input
 * @returns {string[]}
 */
const resolveTierFilter = ({ argvTier, positionalArgs, knownTiers }) => {
  let resolved = parseCommaList(argvTier)
    .map(normalizeSelectorToken)
    .filter(Boolean);
  if (!resolved.length && Array.isArray(positionalArgs) && positionalArgs.length) {
    const positionalTiers = positionalArgs
      .map((entry) => normalizeSelectorToken(entry))
      .filter((entry) => knownTiers.has(entry));
    if (positionalTiers.length) resolved = positionalTiers;
  }
  return [...new Set(resolved)];
};

/**
 * Collect normalized selector aliases for a language config entry.
 *
 * @param {string} language
 * @param {object} entry
 * @returns {Set<string>}
 */
const collectLanguageSelectors = (language, entry) => {
  const selectors = new Set();
  selectors.add(normalizeSelectorToken(language));
  const rawLabel = normalizeSelectorToken(entry?.label);
  if (rawLabel) {
    selectors.add(rawLabel);
    for (const part of rawLabel.split(/[\\/,|&()]+/g).map((token) => token.trim()).filter(Boolean)) {
      selectors.add(part);
    }
  }
  return selectors;
};
const languageFilter = new Set(
  parseCommaList(argv.languages || argv.language)
    .map(normalizeSelectorToken)
    .filter(Boolean)
);
const languageFilterTokens = [...languageFilter];
const hasLanguageFilter = languageFilterTokens.length > 0;
const tierFilter = resolveTierFilter({
  argvTier: argv.tier,
  positionalArgs: argv._,
  knownTiers: collectKnownTiers(config)
});
const tierFilterSet = new Set(tierFilter);
const hasTierFilter = tierFilterSet.size > 0;
const repoFilterSet = new Set(
  parseCommaList(argv.only || argv.repos)
    .map((entry) => String(entry || '').toLowerCase())
    .filter(Boolean)
);
const hasRepoFilter = repoFilterSet.size > 0;

/**
 * Check whether a config entry matches the selected language tokens.
 *
 * @param {string} language
 * @param {object} entry
 * @returns {boolean}
 */
const matchesLanguageFilter = (language, entry) => {
  if (!hasLanguageFilter) return true;
  const selectors = collectLanguageSelectors(language, entry);
  for (const token of languageFilterTokens) {
    if (selectors.has(token)) return true;
  }
  return false;
};

/**
 * Expand bench config into per-repo execution tasks after applying CLI filters.
 *
 * @param {object} benchConfig
 * @returns {BenchTaskDescriptor[]}
 */
const buildTaskCatalog = (benchConfig) => {
  const plannedTasks = [];
  const queryOverridePath = argv.queries ? path.resolve(argv.queries) : null;
  for (const [language, entry] of Object.entries(benchConfig || {})) {
    if (!matchesLanguageFilter(language, entry)) continue;
    const queriesPath = queryOverridePath || path.resolve(scriptRoot, entry.queries || '');
    if (!fs.existsSync(queriesPath)) {
      display.error(`Missing queries file: ${queriesPath}`);
      exitWithDisplay(1);
    }
    const repoGroups = entry.repos || {};
    for (const [tier, repos] of Object.entries(repoGroups)) {
      if (hasTierFilter && !tierFilterSet.has(normalizeSelectorToken(tier))) continue;
      for (const repo of repos) {
        if (hasRepoFilter && !repoFilterSet.has(String(repo || '').toLowerCase())) continue;
        plannedTasks.push({ language, label: entry.label || language, tier, repo, queriesPath });
      }
    }
  }
  return plannedTasks;
};

const tasks = buildTaskCatalog(config);

/**
 * In-place Fisher-Yates shuffle used by `--random` execution mode.
 *
 * @template T
 * @param {T[]} items
 * @returns {void}
 */
const shuffleInPlace = (items) => {
  for (let idx = items.length - 1; idx > 0; idx -= 1) {
    const swapIdx = Math.floor(Math.random() * (idx + 1));
    if (swapIdx === idx) continue;
    const temp = items[idx];
    items[idx] = items[swapIdx];
    items[swapIdx] = temp;
  }
};

if (argv.random) {
  shuffleInPlace(tasks);
}

const toSafeLogSlug = (value) => String(value || '')
  .replace(/[^a-z0-9-_]+/gi, '_')
  .replace(/^_+|_+$/g, '')
  .toLowerCase();

const getRepoShortName = (repo) => {
  if (!repo) return '';
  return String(repo).split('/').filter(Boolean).pop() || String(repo);
};

/**
 * Count slug collisions.
 *
 * @param {string[]} slugs
 * @returns {Map<string,number>}
 */
const countSlugs = (slugs) => {
  const counts = new Map();
  for (const slug of slugs) {
    if (!slug) continue;
    counts.set(slug, (counts.get(slug) || 0) + 1);
  }
  return counts;
};

/**
 * Assign deterministic per-task log slug metadata while avoiding filename
 * collisions across repo names, languages, and tiers.
 *
 * @param {BenchTaskDescriptor[]} plannedTasks
 * @returns {void}
 */
const assignRepoLogMetadata = (plannedTasks) => {
  if (!repoLogsEnabled || !plannedTasks.length) return;
  const slugPlans = plannedTasks.map((task) => {
    const repoShortName = getRepoShortName(task.repo);
    const baseSlug = toSafeLogSlug(repoShortName) || 'repo';
    const fullSlugRaw = String(task.repo || '').replace(/[\\/]+/g, '__');
    const fullSlug = toSafeLogSlug(fullSlugRaw) || 'repo';
    const languageSlug = toSafeLogSlug(task.language);
    const tierSlug = toSafeLogSlug(task.tier);
    return {
      task,
      repoShortName,
      baseSlug,
      fullSlug,
      languageSlug,
      tierSlug
    };
  });
  const baseCounts = countSlugs(slugPlans.map((plan) => plan.baseSlug));
  const fullCounts = countSlugs(slugPlans.map((plan) => plan.fullSlug));
  const initial = slugPlans.map((plan) => {
    if (plan.baseSlug && baseCounts.get(plan.baseSlug) === 1) return plan.baseSlug;
    return plan.fullSlug || plan.baseSlug || 'repo';
  });
  const initialCounts = countSlugs(initial);
  const withLang = slugPlans.map((plan, idx) => {
    const slug = initial[idx] || 'repo';
    if (initialCounts.get(slug) === 1) return slug;
    return [slug, plan.languageSlug].filter(Boolean).join('-');
  });
  const withLangCounts = countSlugs(withLang);
  const withTier = slugPlans.map((plan, idx) => {
    const slug = withLang[idx] || 'repo';
    if (withLangCounts.get(slug) === 1) return slug;
    return [slug, plan.tierSlug].filter(Boolean).join('-');
  });
  const withTierCounts = countSlugs(withTier);
  for (let idx = 0; idx < slugPlans.length; idx += 1) {
    const plan = slugPlans[idx];
    const slug = withTier[idx] || 'repo';
    plan.task.logSlug = withTierCounts.get(slug) === 1 ? slug : `${slug}-${idx + 1}`;
    plan.task.repoShortName = plan.repoShortName;
    if ((fullCounts.get(plan.fullSlug) || 0) > 1) {
      plan.task.repoLogNameCollision = true;
    }
  }
};
assignRepoLogMetadata(tasks);

if (argv.list) {
  const payload = {
    config: configPath,
    repoRoot: reposRoot,
    cacheRoot,
    cloneMirrorCacheRoot: mirrorCacheRoot,
    cloneMirrorRefreshMs: mirrorRefreshMs,
    resultsRoot,
    logsRoot: path.dirname(masterLogPath),
    diagnosticsRoot: runDiagnosticsRoot,
    runSuffix,
    randomizedOrder: argv.random === true,
    masterLog: masterLogPath,
    languages: Object.keys(config),
    usrGuardrailBenchmarks: USR_GUARDRAIL_BENCHMARKS,
    tasks
  };
  if (argv.json) {
    console.log(JSON.stringify(payload, null, 2));
  } else {
    writeListLine('Benchmark targets');
    writeListLine(`- config: ${configPath}`);
    writeListLine(`- repos: ${reposRoot}`);
    writeListLine(`- cache: ${cacheRoot}`);
    writeListLine(`- clone mirror cache: ${mirrorCacheRoot}`);
    writeListLine(`- clone mirror refresh ms: ${mirrorRefreshMs}`);
    writeListLine(`- results: ${resultsRoot}`);
    writeListLine(`- diagnostics: ${runDiagnosticsRoot}`);
    if (USR_GUARDRAIL_BENCHMARKS.length) {
      writeListLine('- usr guardrail benchmarks:');
      for (const bench of USR_GUARDRAIL_BENCHMARKS) {
        writeListLine(`- item ${bench.item}: ${bench.script}`);
      }
    }
    for (const task of tasks) {
      writeListLine(`- ${task.language} ${task.tier} ${task.repo}`);
    }
  }
  exitWithDisplay(0);
}

if (!tasks.length) {
  display.error('No benchmark targets match the requested filters.');
  exitWithDisplay(1);
}

let cloneTool = null;
if (cloneEnabled && !dryRun) {
  ensureLongPathsSupport({ onLog: appendLog });
  cloneTool = resolveCloneTool({ onLog: appendLog });
}
const cloneCommandEnv = buildNonInteractiveGitEnv(process.env);
await fsPromises.mkdir(reposRoot, { recursive: true });
await fsPromises.mkdir(resultsRoot, { recursive: true });
await fsPromises.mkdir(cacheRoot, { recursive: true });
if (cloneEnabled && !dryRun && cloneTool?.supportsMirrorClone) {
  await fsPromises.mkdir(mirrorCacheRoot, { recursive: true });
}
initMasterLog();
appendLog(`[clone] tool=${cloneTool ? cloneTool.label : 'disabled'}`);
if (cloneEnabled && !dryRun && cloneTool?.supportsMirrorClone) {
  appendLog(`[clone] mirror cache=${mirrorCacheRoot} refresh-ms=${mirrorRefreshMs}`);
}
const usrGuardrailBenchmarks = await runUsrGuardrailBenchmarks();

const benchScript = path.join(scriptRoot, 'tests', 'perf', 'bench', 'run.test.js');
const results = [];
const startTime = Date.now();
let completed = 0;

/**
 * Normalize tier labels for progress header rendering.
 *
 * @param {unknown} tier
 * @returns {string}
 */
const formatBenchTierTag = (tier) => {
  if (!tier) return '';
  const label = String(tier).trim().toLowerCase();
  return label || '';
};

/**
 * Create a short repo-specific progress task label.
 *
 * @param {unknown} repo
 * @returns {string}
 */
const formatBenchRepoLabel = (repo) => {
  if (!repo) return 'Benching';
  const repoName = String(repo).split('/').filter(Boolean).pop() || repo;
  return `Benching ${repoName}`;
};

let benchTierTag = '';
let benchRepoLabel = '';
const benchTask = display.task('Repos', { total: tasks.length, stage: 'bench' });
updateBenchProgress = () => {
  const reposLabel = benchTierTag ? `Repos (${benchTierTag})` : 'Repos';
  const effectiveCompleted = Math.min(tasks.length, completed + benchInFlightFraction);
  benchTask.set(effectiveCompleted, tasks.length, { name: reposLabel });
};

/**
 * Mark current repo benchmark as complete and advance top-level progress.
 *
 * @returns {void}
 */
const completeBenchRepo = () => {
  setBenchInFlightFraction(0, { refresh: false });
  completed += 1;
  updateBenchProgress();
};
updateBenchProgress();
const executionPlans = tasks.map((task) => {
  const repoPath = resolveRepoDir({ reposRoot, repo: task.repo, language: task.language });
  const outDir = path.join(resultsRoot, task.language);
  return {
    task,
    repoPath,
    repoLabel: `${task.language}/${task.repo}`,
    tierLabel: String(task.tier || '').trim(),
    repoCacheRoot: resolveRepoCacheRoot({ repoPath, cacheRoot }),
    outDir,
    outFile: path.join(outDir, `${task.repo.replace('/', '__')}.json`),
    fallbackLogSlug: task.logSlug || toSafeLogSlug(getRepoShortName(task.repo)) || 'repo'
  };
});
const precreateDirs = new Set();
for (const plan of executionPlans) {
  precreateDirs.add(path.dirname(plan.repoPath));
  precreateDirs.add(plan.outDir);
}
await Promise.all(
  [...precreateDirs].map((dir) => fsPromises.mkdir(dir, { recursive: true }))
);
const heapArgEnabled = Number.isFinite(heapArg) && heapArg > 0;
const baseNodeOptionsForRun = heapArgEnabled
  ? stripMaxOldSpaceFlag(baseEnv.NODE_OPTIONS || '')
  : (baseEnv.NODE_OPTIONS || '');
const baseNodeOptionsHasHeapFlag = baseNodeOptionsForRun.includes('--max-old-space-size');
const baseEnvForRepoRuntime = { ...baseEnv };
if (typeof baseEnv.NODE_OPTIONS === 'string' || baseNodeOptionsForRun) {
  baseEnvForRepoRuntime.NODE_OPTIONS = baseNodeOptionsForRun;
}
const wantsMemoryBackend = backendList.includes('memory');
const buildRequested = Boolean(argv.build);
const buildIndexFlag = Boolean(argv['build-index']);
const buildSqliteFlag = Boolean(argv['build-sqlite']);
const buildIndexRequested = buildRequested || buildIndexFlag;
const buildSqliteRequested = buildRequested || buildSqliteFlag;
const autoBuildEnabled = !(buildRequested || buildIndexFlag || buildSqliteFlag);
const benchArgsPrefix = [argv['stub-embeddings'] ? '--stub-embeddings' : '--real-embeddings'];
const benchArgsSuffix = [];
if (argv.incremental) benchArgsSuffix.push('--incremental');
if (argv.ann) benchArgsSuffix.push('--ann');
if (argv['no-ann']) benchArgsSuffix.push('--no-ann');
if (argv.backend) benchArgsSuffix.push('--backend', String(argv.backend));
if (argv.top) benchArgsSuffix.push('--top', String(argv.top));
if (argv.limit) benchArgsSuffix.push('--limit', String(argv.limit));
if (argv.threads) benchArgsSuffix.push('--threads', String(argv.threads));
const childProgressMode = argv.progress === 'off' ? 'off' : 'jsonl';
benchArgsSuffix.push('--progress', childProgressMode);
if (argv.verbose) benchArgsSuffix.push('--verbose');
if (argv.quiet || argv.json) benchArgsSuffix.push('--quiet');

/**
 * Build child bench command args for one repo plan.
 *
 * @param {{repoPath:string,queriesPath:string,outFile:string,autoBuildIndex:boolean,autoBuildSqlite:boolean}} input
 * @returns {string[]}
 */
const buildBenchArgs = ({ repoPath, queriesPath, outFile, autoBuildIndex, autoBuildSqlite }) => {
  const args = [
    benchScript,
    '--repo',
    repoPath,
    '--queries',
    queriesPath,
    '--write-report',
    '--out',
    outFile,
    ...benchArgsPrefix
  ];
  if (buildRequested) {
    args.push('--build');
  } else {
    if (buildIndexFlag || autoBuildIndex) args.push('--build-index');
    if (buildSqliteFlag || autoBuildSqlite) args.push('--build-sqlite');
  }
  args.push(...benchArgsSuffix);
  return args;
};

/**
 * Remove a repo-scoped cache directory after a bench run while guarding
 * against deleting paths outside the configured cache root.
 *
 * @param {{repoCacheRoot:string,repoLabel:string}} input
 * @returns {Promise<void>}
 */
const cleanRepoCache = async ({ repoCacheRoot, repoLabel }) => {
  if (keepCache || dryRun || !repoCacheRoot) return;
  try {
    const resolvedCacheRoot = path.resolve(cacheRoot);
    const resolvedRepoCacheRoot = path.resolve(repoCacheRoot);
    if (!isInside(resolvedCacheRoot, resolvedRepoCacheRoot) || isRootPath(resolvedRepoCacheRoot)) {
      appendLog('[cache] skip cleanup; repo cache path escaped cache root.', 'warn', {
        fileOnlyLine: `[cache] Skip cleanup; repo cache path not under cache root (${resolvedRepoCacheRoot}).`
      });
      return;
    }
    if (!fs.existsSync(resolvedRepoCacheRoot)) return;
    const removeResult = await removePathWithRetry(resolvedRepoCacheRoot, {
      recursive: true,
      force: true,
      attempts: 20,
      baseDelayMs: 40,
      maxDelayMs: 1200
    });
    if (!removeResult.ok) {
      const code = removeResult.error?.code ? ` (${removeResult.error.code})` : '';
      appendLog(
        `[cache] cleanup failed for ${repoLabel} after ${removeResult.attempts} attempts${code}: ${removeResult.error?.message || 'unknown error'}`,
        'warn'
      );
      return;
    }
    appendLog(`[cache] cleaned ${repoLabel} (attempts=${removeResult.attempts}).`);
  } catch (err) {
    appendLog(`[cache] cleanup failed for ${repoLabel}: ${err?.message || err}`, 'warn');
  }
};

/**
 * Persist crash diagnostics bundle metadata for a failed repo run.
 *
 * @param {{
 *   task:BenchTaskDescriptor,
 *   repoLabel:string,
 *   repoPath:string,
 *   repoCacheRoot:string,
 *   outFile:string|null,
 *   failureReason:string,
 *   failureCode?:number|null,
 *   schedulerEvents?:object[]
 * }} input
 * @returns {Promise<object|null>}
 */
const attachCrashRetention = async ({
  task,
  repoLabel,
  repoPath,
  repoCacheRoot,
  outFile,
  failureReason,
  failureCode = null,
  schedulerEvents = []
}) => {
  if (dryRun || !repoCacheRoot) return null;
  try {
    const crashRetention = await retainCrashArtifacts({
      repoCacheRoot,
      diagnosticsRoot: runDiagnosticsRoot,
      repoLabel,
      repoSlug: task?.logSlug || null,
      runId: runSuffix,
      failure: {
        reason: failureReason || 'unknown',
        code: Number.isFinite(Number(failureCode)) ? Number(failureCode) : null
      },
      runtime: {
        runSuffix,
        language: task?.language || null,
        tier: task?.tier || null,
        repo: task?.repo || null,
        repoPath,
        repoCacheRoot,
        outFile: outFile || null
      },
      environment: benchEnvironmentMetadata,
      schedulerEvents: Array.isArray(schedulerEvents) ? schedulerEvents : [],
      logTail: logHistory.slice(-20)
    });
    if (crashRetention?.bundlePath) {
      appendLog(`[diagnostics] retained crash evidence for ${repoLabel}.`, 'warn', {
        fileOnlyLine: `[diagnostics] Crash bundle: ${crashRetention.bundlePath}`
      });
    }
    return crashRetention;
  } catch (err) {
    appendLog(`[diagnostics] retention failed for ${repoLabel}: ${err?.message || err}`, 'warn');
    return null;
  }
};

for (const plan of executionPlans) {
  const {
    task,
    repoPath,
    repoLabel,
    tierLabel,
    repoCacheRoot,
    outFile,
    fallbackLogSlug
  } = plan;
  benchTierTag = formatBenchTierTag(tierLabel) || benchTierTag;
  benchRepoLabel = formatBenchRepoLabel(task.repo);
  setBenchInFlightFraction(0, { refresh: false });
  display.resetTasks({ preserveStages: ['bench'] });
  updateBenchProgress();

  // Reset per-repo transient history so failure summaries and disk-full detection reflect
  // only the currently executing repo.
  logHistory.length = 0;
  if (repoLogsEnabled) {
    initRepoLog({
      label: repoLabel,
      tier: tierLabel,
      repoPath,
      slug: fallbackLogSlug
    });
    if (!quietMode && repoLogPath) {
      appendLog(`[logs] ${repoLabel}: ${path.basename(repoLogPath)}`, 'info', {
        fileOnlyLine: `[logs] ${repoLabel} -> ${repoLogPath}`
      });
    }
  }

  try {
    if (!fs.existsSync(repoPath)) {
      if (!cloneEnabled && !dryRun) {
        display.error(`Missing repo ${task.repo} at ${repoPath}. Re-run with --clone.`);
        exitWithDisplay(1);
      }
      updateBenchProgress();
      if (!dryRun && cloneEnabled && cloneTool) {
        let clonedFromMirror = false;
        if (cloneTool.supportsMirrorClone) {
          const mirrorClone = tryMirrorClone({
            repo: task.repo,
            repoPath,
            mirrorCacheRoot,
            mirrorRefreshMs,
            onLog: appendLog
          });
          if (mirrorClone.ok) {
            clonedFromMirror = true;
            appendLog(`[clone] mirror ${mirrorClone.mirrorAction} for ${repoLabel}.`, 'info', {
              fileOnlyLine: `[clone] mirror ${mirrorClone.mirrorAction} ${task.repo} -> ${repoPath} (${mirrorClone.mirrorPath})`
            });
          } else if (mirrorClone.attempted) {
            const mirrorAction = mirrorClone.mirrorAction || 'mirror-failed';
            const mirrorReason = mirrorClone.reason || 'unknown';
            appendLog(
              `[clone] mirror unavailable for ${repoLabel}; falling back to direct clone (${mirrorAction}: ${mirrorReason}).`,
              'warn'
            );
            try {
              await fsPromises.rm(repoPath, { recursive: true, force: true });
            } catch {}
          }
        }
        if (!clonedFromMirror) {
          const args = cloneTool.buildArgs(task.repo, repoPath);
          const cloneResult = await processRunner.runProcess(`clone ${task.repo}`, cloneTool.label, args, {
            env: cloneCommandEnv,
            continueOnError: true
          });
          if (!cloneResult.ok) {
            appendLog(`[error] clone failed for ${repoLabel}; continuing.`, 'error');
            const crashRetention = await attachCrashRetention({
              task,
              repoLabel,
              repoPath,
              repoCacheRoot,
              outFile: null,
              failureReason: 'clone',
              failureCode: cloneResult.code ?? null,
              schedulerEvents: cloneResult.schedulerEvents || []
            });
            completeBenchRepo();
            appendLog('[metrics] failed (clone)');
            results.push({
              ...task,
              repoPath,
              outFile: null,
              summary: null,
              failed: true,
              failureReason: 'clone',
              failureCode: cloneResult.code ?? null,
              ...(crashRetention
                ? { diagnostics: { crashRetention } }
                : {})
            });
            continue;
          }
        }
      }
    }

    if (!dryRun) {
      ensureRepoBenchmarkReady({
        repoPath,
        onLog: appendLog
      });
    }

    await ensureBenchConfig(repoPath, cacheRoot);

    const repoUserConfig = loadUserConfig(repoPath);
    const repoRuntimeConfig = getRuntimeConfig(repoPath, repoUserConfig);
    const hasHeapFlag = baseNodeOptionsHasHeapFlag;
    let heapOverride = null;
    if (heapArgEnabled) {
      heapOverride = heapArg;
      if (!heapLogged) {
        appendLog(`[heap] using ${formatGb(heapOverride)} (${heapOverride} MB) from --heap-mb.`);
        heapLogged = true;
      }
    } else if (
      !Number.isFinite(repoRuntimeConfig.maxOldSpaceMb)
      && !hasHeapFlag
    ) {
      heapOverride = heapRecommendation.recommendedMb;
      if (!heapLogged) {
        appendLog(
          `[auto-heap] using ${formatGb(heapOverride)} (${heapOverride} MB). `
            + 'Override with --heap-mb.'
        );
        heapLogged = true;
      }
    }
    const runtimeConfigForRun = heapOverride
      ? { ...repoRuntimeConfig, maxOldSpaceMb: heapOverride }
      : repoRuntimeConfig;

    const repoEnvBase = resolveRuntimeEnv(runtimeConfigForRun, baseEnvForRepoRuntime);
    if (heapOverride) {
      repoEnvBase.NODE_OPTIONS = sanitizeBenchNodeOptions(repoEnvBase.NODE_OPTIONS || '', {
        stripHeap: true
      });
      repoEnvBase.NODE_OPTIONS = [repoEnvBase.NODE_OPTIONS, `--max-old-space-size=${heapOverride}`].filter(Boolean).join(' ').trim();
    }

    const missingIndex = needsIndexArtifacts(repoPath);
    const missingSqlite = wantsSqlite && needsSqliteArtifacts(repoPath);
    let autoBuildIndex = false;
    let autoBuildSqlite = false;
    if (buildSqliteRequested && !buildIndexRequested && missingIndex) {
      autoBuildIndex = true;
      appendLog('[auto-build] sqlite needs index artifacts; enabling --build-index.');
    }
    if (autoBuildEnabled) {
      if (missingIndex && wantsMemoryBackend) autoBuildIndex = true;
      if (missingSqlite) autoBuildSqlite = true;
      if (autoBuildSqlite && missingIndex) autoBuildIndex = true;
      if (autoBuildIndex || autoBuildSqlite) {
        appendLog(
          `[auto-build] missing artifacts (${autoBuildIndex ? 'index' : ''}${autoBuildIndex && autoBuildSqlite ? ', ' : ''}${autoBuildSqlite ? 'sqlite' : ''}); enabling build steps.`
        );
      }
    }

    const shouldBuildIndex = buildIndexRequested || autoBuildIndex;
    if (shouldBuildIndex && !dryRun) {
      try {
        appendLog(`[metrics] scanning lines for ${repoLabel}...`);
        lineStats = await buildLineStats(repoPath, repoUserConfig);
        const totals = lineStats.totals || {};
        const parts = [
          `code=${Number(totals.code || 0).toLocaleString()}`,
          `prose=${Number(totals.prose || 0).toLocaleString()}`,
          `extracted-prose=${Number(totals['extracted-prose'] || 0).toLocaleString()}`,
          `records=${Number(totals.records || 0).toLocaleString()}`
        ];
        appendLog(`[metrics] lines ${parts.join(' ')}`);
      } catch (err) {
        appendLog(`[metrics] line scan unavailable: ${err?.message || err}`);
      }
    }

    const lockCheck = await checkIndexLock({
      repoCacheRoot,
      repoLabel,
      lockMode,
      lockWaitMs,
      lockStaleMs,
      onLog: appendLog
    });
    if (!lockCheck.ok) {
      const detail = formatLockDetail(lockCheck.detail);
      const message = `Skipping ${repoLabel}: index lock held ${detail}`.trim();
      appendLog(`[lock] ${message}`);
      if (!quietMode) display.error(message);
      completeBenchRepo();
      appendLog('[metrics] skipped (lock)');
      results.push({
        ...task,
        repoPath,
        outFile,
        summary: null,
        skipped: true,
        skipReason: 'lock',
        lock: lockCheck.detail || null
      });
      continue;
    }

    const benchArgs = buildBenchArgs({
      repoPath,
      queriesPath: task.queriesPath,
      outFile,
      autoBuildIndex,
      autoBuildSqlite
    });

    updateBenchProgress();

    let summary = null;
    let queryCount = 0;
    try {
      queryCount = await resolveBenchQueryCount(task.queriesPath, { limit: argv.limit });
    } catch (err) {
      appendLog(`[metrics] query count unavailable: ${err?.message || err}`);
    }
    const backendCount = backendList.length || 1;
    const queryConcurrency = Number.isFinite(Number(argv['query-concurrency']))
      && Number(argv['query-concurrency']) > 0
      ? Math.floor(Number(argv['query-concurrency']))
      : 4;
    const realEmbeddingsEnabled = argv['stub-embeddings'] !== true;
    const effectiveBenchTimeoutMs = resolveAdaptiveBenchTimeoutMs({
      baseTimeoutMs: benchTimeoutMs,
      lineStats,
      buildIndex: shouldBuildIndex,
      buildSqlite: Boolean(argv.build || argv['build-sqlite'] || autoBuildSqlite || wantsSqlite),
      queryCount,
      backendCount,
      queryConcurrency,
      realEmbeddings: realEmbeddingsEnabled
    });
    if (effectiveBenchTimeoutMs > benchTimeoutMs) {
      const timeoutMinutes = (effectiveBenchTimeoutMs / (60 * 1000)).toFixed(1);
      const baseMinutes = (benchTimeoutMs / (60 * 1000)).toFixed(1);
      const summaryStats = summarizeBenchLineStats(lineStats);
      appendLog(
        `[timeout] auto-raised ${repoLabel} timeout ${baseMinutes}m -> ${timeoutMinutes}m `
          + `(lines=${summaryStats.totalLines.toLocaleString()}, files=${summaryStats.totalFiles.toLocaleString()}, `
          + `queries=${queryCount}, backends=${backendCount}, qConcurrency=${queryConcurrency}).`
      );
    }
    if (dryRun) {
      appendLog(`[dry-run] node ${benchArgs.join(' ')}`);
    } else {
      const benchProcessEnv = { ...repoEnvBase };
      if (!Object.prototype.hasOwnProperty.call(benchProcessEnv, 'PAIROFCLEATS_CRASH_LOG_ANNOUNCE')) {
        benchProcessEnv.PAIROFCLEATS_CRASH_LOG_ANNOUNCE = '0';
      }
      const benchResult = await processRunner.runProcess(`bench ${repoLabel}`, process.execPath, benchArgs, {
        cwd: scriptRoot,
        env: benchProcessEnv,
        timeoutMs: effectiveBenchTimeoutMs,
        continueOnError: true
      });
      if (!benchResult.ok) {
        const diskFull = logHistory.some((line) => isDiskFullMessage(line));
        if (diskFull) {
          appendLog(`[error] disk full while benchmarking ${repoLabel}; continuing.`, 'error');
        }
        appendLog(`[error] benchmark failed for ${repoLabel}; continuing.`, 'error');
        const failureReason = diskFull ? 'disk-full' : 'bench';
        const crashRetention = await attachCrashRetention({
          task,
          repoLabel,
          repoPath,
          repoCacheRoot,
          outFile,
          failureReason,
          failureCode: benchResult.code ?? null,
          schedulerEvents: benchResult.schedulerEvents || []
        });
        completeBenchRepo();
        appendLog('[metrics] failed (bench)');
        results.push({
          ...task,
          repoPath,
          outFile,
          summary: null,
          failed: true,
          failureReason,
          failureCode: benchResult.code ?? null,
          ...(crashRetention
            ? { diagnostics: { crashRetention } }
            : {})
        });
        continue;
      }
      try {
        const raw = await fsPromises.readFile(outFile, 'utf8');
        summary = JSON.parse(raw).summary || null;
      } catch (err) {
        appendLog(`[error] failed to read bench report for ${repoLabel}; continuing.`, 'error');
        if (err && err.message) display.error(err.message);
        const crashRetention = await attachCrashRetention({
          task,
          repoLabel,
          repoPath,
          repoCacheRoot,
          outFile,
          failureReason: 'report',
          failureCode: null,
          schedulerEvents: benchResult.schedulerEvents || []
        });
        completeBenchRepo();
        appendLog('[metrics] failed (report)');
        results.push({
          ...task,
          repoPath,
          outFile,
          summary: null,
          failed: true,
          failureReason: 'report',
          failureCode: null,
          ...(crashRetention
            ? { diagnostics: { crashRetention } }
            : {})
        });
        continue;
      }
    }

    completeBenchRepo();
    appendLog(`[metrics] ${formatMetricSummary(summary)}`);

    results.push({ ...task, repoPath, outFile, summary });
  } finally {
    await cleanRepoCache({ repoCacheRoot, repoLabel });
  }
}

const output = buildReportOutput({
  configPath,
  cacheRoot,
  resultsRoot,
  results,
  config
});
if (usrGuardrailBenchmarks.length) {
  output.usrGuardrails = {
    generatedAt: new Date().toISOString(),
    results: usrGuardrailBenchmarks
  };
}

if (!quietMode) {
  appendLog('Grouped summary');
  for (const [language, payload] of Object.entries(output.groupedSummary)) {
    if (!payload.summary) continue;
    printSummary(payload.label, payload.summary, payload.count, quietMode, {
      writeLine: (line) => appendLog(line)
    });
  }
  printSummary('Overall', output.overallSummary, results.length, quietMode, {
    writeLine: (line) => appendLog(line)
  });
  const retainedCount = Number(output?.diagnostics?.crashRetention?.retainedCount) || 0;
  if (retainedCount > 0) {
    appendLog(`[diagnostics] retained crash bundles: ${retainedCount}`);
  }
}

if (argv.out) {
  const outPath = path.resolve(argv.out);
  await fsPromises.mkdir(path.dirname(outPath), { recursive: true });
  await fsPromises.writeFile(outPath, JSON.stringify(output, null, 2));
}

if (argv.json) {
  display.close();
  console.log(JSON.stringify(output, null, 2));
} else {
  appendLog(`Completed ${results.length} benchmark runs.`);
  if (argv.out) {
    appendLog(`[summary] written (${path.basename(path.resolve(argv.out))})`, 'info', {
      fileOnlyLine: `Summary written to ${path.resolve(argv.out)}`
    });
  }
  display.close();
}
