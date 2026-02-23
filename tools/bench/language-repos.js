#!/usr/bin/env node
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { getBenchMirrorRefreshMs } from '../../src/shared/env.js';
import { getRuntimeConfig, loadUserConfig, resolveRuntimeEnv } from '../shared/dict-utils.js';
import { parseBenchLanguageArgs } from './language/cli.js';
import { loadBenchConfig } from './language/config.js';
import { checkIndexLock, formatLockDetail } from './language/locks.js';
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
import { buildReportOutput, printSummary } from './language/report.js';
import { retainCrashArtifacts } from '../../src/index/build/crash-log.js';
import { createToolDisplay } from '../shared/cli-display.js';
import { parseCommaList } from '../shared/text-utils.js';

const ensureBenchConfig = async (repoPath, cacheRoot) => {
  const configPath = path.join(repoPath, '.pairofcleats.json');
  if (fs.existsSync(configPath)) return;
  const payload = { cache: { root: cacheRoot } };
  await fsPromises.writeFile(configPath, JSON.stringify(payload, null, 2), 'utf8');
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

const closeRepoLog = () => {
  if (!repoLogStream) return;
  try {
    repoLogStream.end();
  } catch {}
  repoLogStream = null;
  repoLogPath = null;
};

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
const clampBenchFraction = (value) => {
  if (!Number.isFinite(value)) return 0;
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
};
const deriveBenchFraction = (event) => {
  const current = Number.isFinite(event?.current) ? Number(event.current) : 0;
  const total = Number.isFinite(event?.total) ? Number(event.total) : 0;
  if (total <= 0) return null;
  return clampBenchFraction(current / total);
};
const setBenchInFlightFraction = (value, { refresh = true } = {}) => {
  const next = clampBenchFraction(value);
  if (next === benchInFlightFraction) return;
  benchInFlightFraction = next;
  if (refresh) updateBenchProgress();
};

const formatEtaSeconds = (value) => {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds < 0) return null;
  const whole = Math.floor(seconds);
  const mins = Math.floor(whole / 60);
  const secs = whole % 60;
  return `${mins}m${String(secs).padStart(2, '0')}s`;
};

const formatChildTaskMessage = (event) => {
  if (!event || typeof event !== 'object') return null;
  const explicit = typeof event.message === 'string' ? event.message.trim() : '';
  if (explicit) return explicit;
  const throughputChunks = Number(event?.throughput?.chunksPerSec ?? event?.chunksPerSec);
  const throughputFiles = Number(event?.throughput?.filesPerSec ?? event?.filesPerSec);
  const etaText = formatEtaSeconds(event?.etaSeconds);
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
const normalizeSelectorToken = (value) => String(value || '').trim().toLowerCase();
const languageFilter = new Set(
  parseCommaList(argv.languages || argv.language)
    .map(normalizeSelectorToken)
    .filter(Boolean)
);
let tierFilter = parseCommaList(argv.tier)
  .map(normalizeSelectorToken)
  .filter(Boolean);
const repoFilter = parseCommaList(argv.only || argv.repos).map((entry) => entry.toLowerCase());
const knownTiers = new Set();
for (const entry of Object.values(config)) {
  for (const tier of Object.keys(entry?.repos || {})) {
    knownTiers.add(normalizeSelectorToken(tier));
  }
}
if (!tierFilter.length && Array.isArray(argv._) && argv._.length) {
  const positionalTiers = argv._
    .map((entry) => normalizeSelectorToken(entry))
    .filter((entry) => knownTiers.has(entry));
  if (positionalTiers.length) tierFilter = positionalTiers;
}
tierFilter = [...new Set(tierFilter)];

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

const tasks = [];
for (const [language, entry] of Object.entries(config)) {
  if (languageFilter.size) {
    const selectors = collectLanguageSelectors(language, entry);
    const matchesLanguage = [...languageFilter].some((token) => selectors.has(token));
    if (!matchesLanguage) continue;
  }
  const queriesPath = argv.queries
    ? path.resolve(argv.queries)
    : path.resolve(scriptRoot, entry.queries || '');
  if (!fs.existsSync(queriesPath)) {
    display.error(`Missing queries file: ${queriesPath}`);
    exitWithDisplay(1);
  }
  const repoGroups = entry.repos || {};
  for (const [tier, repos] of Object.entries(repoGroups)) {
    if (tierFilter.length && !tierFilter.includes(tier.toLowerCase())) continue;
    for (const repo of repos) {
      if (repoFilter.length && !repoFilter.includes(repo.toLowerCase())) continue;
      tasks.push({ language, label: entry.label || language, tier, repo, queriesPath });
    }
  }
}

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

const countSlugs = (slugs) => {
  const counts = new Map();
  for (const slug of slugs) {
    if (!slug) continue;
    counts.set(slug, (counts.get(slug) || 0) + 1);
  }
  return counts;
};

if (repoLogsEnabled && tasks.length) {
  const baseSlugs = tasks.map((task) => toSafeLogSlug(getRepoShortName(task.repo)) || 'repo');
  const fullSlugs = tasks.map((task) => {
    const raw = String(task.repo || '').replace(/[\\/]+/g, '__');
    return toSafeLogSlug(raw) || 'repo';
  });
  const baseCounts = countSlugs(baseSlugs);
  const fullCounts = countSlugs(fullSlugs);

  const initial = tasks.map((task, idx) => {
    const base = baseSlugs[idx];
    if (base && baseCounts.get(base) === 1) return base;
    return fullSlugs[idx] || base || 'repo';
  });
  const initialCounts = countSlugs(initial);

  const withLang = tasks.map((task, idx) => {
    const slug = initial[idx] || 'repo';
    if (initialCounts.get(slug) === 1) return slug;
    const lang = toSafeLogSlug(task.language);
    return [slug, lang].filter(Boolean).join('-');
  });
  const withLangCounts = countSlugs(withLang);

  const withTier = tasks.map((task, idx) => {
    const slug = withLang[idx] || 'repo';
    if (withLangCounts.get(slug) === 1) return slug;
    const tier = toSafeLogSlug(task.tier);
    return [slug, tier].filter(Boolean).join('-');
  });
  const withTierCounts = countSlugs(withTier);

  const final = tasks.map((task, idx) => {
    const slug = withTier[idx] || 'repo';
    if (withTierCounts.get(slug) === 1) return slug;
    return `${slug}-${idx + 1}`;
  });

  tasks.forEach((task, idx) => {
    task.logSlug = final[idx];
    task.repoShortName = getRepoShortName(task.repo);
    if (fullCounts.get(fullSlugs[idx]) > 1) {
      task.repoLogNameCollision = true;
    }
  });
}

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

const formatBenchTierTag = (tier) => {
  if (!tier) return '';
  const label = String(tier).trim().toLowerCase();
  return label || '';
};
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
const completeBenchRepo = () => {
  setBenchInFlightFraction(0, { refresh: false });
  completed += 1;
  updateBenchProgress();
};
updateBenchProgress();

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
    await fsPromises.rm(resolvedRepoCacheRoot, { recursive: true, force: true });
    appendLog(`[cache] cleaned ${repoLabel}.`);
  } catch (err) {
    appendLog(`[cache] cleanup failed for ${repoLabel}: ${err?.message || err}`, 'warn');
  }
};

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

for (const task of tasks) {
  const repoPath = resolveRepoDir({ reposRoot, repo: task.repo, language: task.language });
  await fsPromises.mkdir(path.dirname(repoPath), { recursive: true });
  const repoLabel = `${task.language}/${task.repo}`;
  const tierLabel = String(task.tier || '').trim();
  benchTierTag = formatBenchTierTag(tierLabel) || benchTierTag;
  benchRepoLabel = formatBenchRepoLabel(task.repo);
  setBenchInFlightFraction(0, { refresh: false });
  display.resetTasks({ preserveStages: ['bench'] });
  updateBenchProgress();
  const repoCacheRoot = resolveRepoCacheRoot({ repoPath, cacheRoot });

  // Reset per-repo transient history so failure summaries and disk-full detection reflect
  // only the currently executing repo.
  logHistory.length = 0;
  if (repoLogsEnabled) {
    initRepoLog({
      label: repoLabel,
      tier: tierLabel,
      repoPath,
      slug: task.logSlug || toSafeLogSlug(getRepoShortName(task.repo)) || 'repo'
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
            env: buildNonInteractiveGitEnv(process.env),
            timeoutMs: benchTimeoutMs,
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
    let baseNodeOptions = sanitizeBenchNodeOptions(baseEnv.NODE_OPTIONS || '', {
      stripHeap: Number.isFinite(heapArg) && heapArg > 0
    });
    const hasHeapFlag = baseNodeOptions.includes('--max-old-space-size');
    let heapOverride = null;
    if (Number.isFinite(heapArg) && heapArg > 0) {
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

    const baseEnvForRepo = { ...baseEnv };
    if (typeof baseEnv.NODE_OPTIONS === 'string' || baseNodeOptions) {
      baseEnvForRepo.NODE_OPTIONS = baseNodeOptions;
    }
    const repoEnvBase = resolveRuntimeEnv(runtimeConfigForRun, baseEnvForRepo);
    if (heapOverride) {
      repoEnvBase.NODE_OPTIONS = sanitizeBenchNodeOptions(repoEnvBase.NODE_OPTIONS || '', {
        stripHeap: true
      });
      repoEnvBase.NODE_OPTIONS = [repoEnvBase.NODE_OPTIONS, `--max-old-space-size=${heapOverride}`].filter(Boolean).join(' ').trim();
    }

    const outDir = path.join(resultsRoot, task.language);
    const outFile = path.join(outDir, `${task.repo.replace('/', '__')}.json`);
    await fsPromises.mkdir(outDir, { recursive: true });

    const wantsMemory = backendList.includes('memory');
    const missingIndex = needsIndexArtifacts(repoPath);
    const missingSqlite = wantsSqlite && needsSqliteArtifacts(repoPath);
    let autoBuildIndex = false;
    let autoBuildSqlite = false;
    const buildIndexRequested = argv.build || argv['build-index'];
    const buildSqliteRequested = argv.build || argv['build-sqlite'];
    if (buildSqliteRequested && !buildIndexRequested && missingIndex) {
      autoBuildIndex = true;
      appendLog('[auto-build] sqlite needs index artifacts; enabling --build-index.');
    }
    if (!argv.build && !argv['build-index'] && !argv['build-sqlite']) {
      if (missingIndex && wantsMemory) autoBuildIndex = true;
      if (missingSqlite) autoBuildSqlite = true;
      if (autoBuildSqlite && missingIndex) autoBuildIndex = true;
      if (autoBuildIndex || autoBuildSqlite) {
        appendLog(
          `[auto-build] missing artifacts (${autoBuildIndex ? 'index' : ''}${autoBuildIndex && autoBuildSqlite ? ', ' : ''}${autoBuildSqlite ? 'sqlite' : ''}); enabling build steps.`
        );
      }
    }

    const shouldBuildIndex = argv.build || argv['build-index'] || autoBuildIndex;
    if (shouldBuildIndex && !dryRun) {
      try {
        appendLog(`[metrics] scanning lines for ${repoLabel}...`);
        const stats = await buildLineStats(repoPath, repoUserConfig);
        const totals = stats.totals || {};
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

    const benchArgs = [
      benchScript,
      '--repo',
      repoPath,
      '--queries',
      task.queriesPath,
      '--write-report',
      '--out',
      outFile
    ];
    if (argv['stub-embeddings']) {
      benchArgs.push('--stub-embeddings');
    } else {
      benchArgs.push('--real-embeddings');
    }
    if (argv.build) {
      benchArgs.push('--build');
    } else {
      if (argv['build-index'] || autoBuildIndex) benchArgs.push('--build-index');
      if (argv['build-sqlite'] || autoBuildSqlite) benchArgs.push('--build-sqlite');
    }
    if (argv.incremental) benchArgs.push('--incremental');
    if (argv.ann) benchArgs.push('--ann');
    if (argv['no-ann']) benchArgs.push('--no-ann');
    if (argv.backend) benchArgs.push('--backend', String(argv.backend));
    if (argv.top) benchArgs.push('--top', String(argv.top));
    if (argv.limit) benchArgs.push('--limit', String(argv.limit));
    if (argv.threads) benchArgs.push('--threads', String(argv.threads));
    const childProgressMode = argv.progress === 'off' ? 'off' : 'jsonl';
    benchArgs.push('--progress', childProgressMode);
    if (argv.verbose) benchArgs.push('--verbose');
    if (argv.quiet || argv.json) benchArgs.push('--quiet');

    updateBenchProgress();

    let summary = null;
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
        timeoutMs: benchTimeoutMs,
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
