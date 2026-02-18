#!/usr/bin/env node
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { getRuntimeConfig, loadUserConfig, resolveRuntimeEnv } from '../shared/dict-utils.js';
import { parseBenchLanguageArgs } from './language/cli.js';
import { loadBenchConfig } from './language/config.js';
import { checkIndexLock, formatLockDetail } from './language/locks.js';
import {
  ensureLongPathsSupport,
  ensureRepoBenchmarkReady,
  needsIndexArtifacts,
  needsSqliteArtifacts,
  resolveCloneTool,
  resolveRepoCacheRoot,
  resolveRepoDir
} from './language/repos.js';
import { isInside, isRootPath } from '../shared/path-utils.js';
import { createProcessRunner } from './language/process.js';
import {
  buildLineStats,
  formatGb,
  formatMetricSummary,
  getRecommendedHeapMb,
  stripMaxOldSpaceFlag,
  validateEncodingFixtures
} from './language/metrics.js';
import { buildReportOutput, printSummary } from './language/report.js';
import { createToolDisplay } from '../shared/cli-display.js';
import { parseCommaList } from '../shared/text-utils.js';

const ensureBenchConfig = async (repoPath, cacheRoot) => {
  const configPath = path.join(repoPath, '.pairofcleats.json');
  if (fs.existsSync(configPath)) return;
  const payload = { cache: { root: cacheRoot } };
  await fsPromises.writeFile(configPath, JSON.stringify(payload, null, 2), 'utf8');
};

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
  backendList,
  wantsSqlite
} = parseBenchLanguageArgs();

const baseEnv = { ...process.env };
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
  writeLog(line);
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
  const current = Number.isFinite(event.current) ? event.current : 0;
  if (event.event === 'task:start') {
    task.set(current, total, { message: event.message, name });
    return;
  }
  if (event.event === 'task:progress') {
    task.set(current, total, { message: event.message, name });
    return;
  }
  if (event.event === 'task:end') {
    if (event.status === 'failed') {
      task.fail(new Error(event.message || 'failed'));
    } else {
      task.done({ message: event.message, name });
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
    display.error(`[bench-language] Details logged to: ${paths.join(' ')}`);
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

const config = loadBenchConfig(configPath, { onLog: appendLog });
await validateEncodingFixtures(scriptRoot, { onLog: appendLog });
const languageFilter = parseCommaList(argv.languages || argv.language).map((entry) => entry.toLowerCase());
let tierFilter = parseCommaList(argv.tier).map((entry) => entry.toLowerCase());
const repoFilter = parseCommaList(argv.only || argv.repos).map((entry) => entry.toLowerCase());
if (!tierFilter.length && Array.isArray(argv._) && argv._.length) {
  const positionalTiers = argv._
    .map((entry) => String(entry).toLowerCase())
    .filter((entry) => entry === 'large' || entry === 'typical' || entry === 'small' || entry === 'tiny');
  if (positionalTiers.length) tierFilter = positionalTiers;
}

const tasks = [];
for (const [language, entry] of Object.entries(config)) {
  if (languageFilter.length && !languageFilter.includes(language.toLowerCase())) continue;
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
    resultsRoot,
    logsRoot: path.dirname(masterLogPath),
    runSuffix,
    masterLog: masterLogPath,
    languages: Object.keys(config),
    tasks
  };
  if (argv.json) {
    console.log(JSON.stringify(payload, null, 2));
  } else {
    display.log('Benchmark targets');
    display.log(`- config: ${configPath}`);
    display.log(`- repos: ${reposRoot}`);
    display.log(`- cache: ${cacheRoot}`);
    display.log(`- results: ${resultsRoot}`);
    for (const task of tasks) {
      display.log(`- ${task.language} ${task.tier} ${task.repo}`);
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
initMasterLog();
appendLog(`Clone tool: ${cloneTool ? cloneTool.label : 'disabled'}`);

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
const updateBenchProgress = () => {
  const reposLabel = benchTierTag ? `Repos (${benchTierTag})` : 'Repos';
  benchTask.set(completed, tasks.length, { name: reposLabel });
};
updateBenchProgress();

const cleanRepoCache = async ({ repoCacheRoot, repoLabel }) => {
  if (keepCache || dryRun || !repoCacheRoot) return;
  try {
    const resolvedCacheRoot = path.resolve(cacheRoot);
    const resolvedRepoCacheRoot = path.resolve(repoCacheRoot);
    if (!isInside(resolvedCacheRoot, resolvedRepoCacheRoot) || isRootPath(resolvedRepoCacheRoot)) {
      appendLog(`[cache] Skip cleanup; repo cache path not under cache root (${resolvedRepoCacheRoot}).`, 'warn');
      return;
    }
    if (!fs.existsSync(resolvedRepoCacheRoot)) return;
    await fsPromises.rm(resolvedRepoCacheRoot, { recursive: true, force: true });
    appendLog(`[cache] Cleaned repo cache for ${repoLabel}.`);
  } catch (err) {
    appendLog(`[cache] Failed to clean repo cache for ${repoLabel}: ${err?.message || err}`, 'warn');
  }
};

for (const task of tasks) {
  const repoPath = resolveRepoDir({ reposRoot, repo: task.repo, language: task.language });
  await fsPromises.mkdir(path.dirname(repoPath), { recursive: true });
  const repoLabel = `${task.language}/${task.repo}`;
  const tierLabel = String(task.tier || '').trim();
  benchTierTag = formatBenchTierTag(tierLabel) || benchTierTag;
  benchRepoLabel = formatBenchRepoLabel(task.repo);
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
      display.log(`[logs] ${repoLabel} -> ${repoLogPath}`);
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
        const args = cloneTool.buildArgs(task.repo, repoPath);
        const cloneResult = await processRunner.runProcess(`clone ${task.repo}`, cloneTool.label, args, {
          env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
          continueOnError: true
        });
        if (!cloneResult.ok) {
          appendLog(`[error] Clone failed for ${repoLabel}; continuing to next repo.`, 'error');
          completed += 1;
          updateBenchProgress();
          appendLog('[metrics] failed (clone)');
          results.push({
            ...task,
            repoPath,
            outFile: null,
            summary: null,
            failed: true,
            failureReason: 'clone',
            failureCode: cloneResult.code ?? null
          });
          continue;
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
    let baseNodeOptions = baseEnv.NODE_OPTIONS || '';
    if (Number.isFinite(heapArg) && heapArg > 0) {
      baseNodeOptions = stripMaxOldSpaceFlag(baseNodeOptions);
    }
    const hasHeapFlag = baseNodeOptions.includes('--max-old-space-size');
    let heapOverride = null;
    if (Number.isFinite(heapArg) && heapArg > 0) {
      heapOverride = heapArg;
      if (!heapLogged) {
        appendLog(`[heap] Using ${formatGb(heapOverride)} (${heapOverride} MB) from --heap-mb.`);
        heapLogged = true;
      }
    } else if (
      !Number.isFinite(repoRuntimeConfig.maxOldSpaceMb)
      && !hasHeapFlag
    ) {
      heapOverride = heapRecommendation.recommendedMb;
      if (!heapLogged) {
        appendLog(
          `[auto-heap] Using ${formatGb(heapOverride)} (${heapOverride} MB) for Node heap. `
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
      repoEnvBase.NODE_OPTIONS = stripMaxOldSpaceFlag(repoEnvBase.NODE_OPTIONS || '');
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
      appendLog('[auto-build] sqlite build requires index artifacts; enabling build-index.');
    }
    if (!argv.build && !argv['build-index'] && !argv['build-sqlite']) {
      if (missingIndex && wantsMemory) autoBuildIndex = true;
      if (missingSqlite) autoBuildSqlite = true;
      if (autoBuildSqlite && missingIndex) autoBuildIndex = true;
      if (autoBuildIndex || autoBuildSqlite) {
        appendLog(
          `[auto-build] missing artifacts${autoBuildIndex ? ' index' : ''}${autoBuildSqlite ? ' sqlite' : ''}; enabling build.`
        );
      }
    }

    const shouldBuildIndex = argv.build || argv['build-index'] || autoBuildIndex;
    if (shouldBuildIndex && !dryRun) {
      try {
        appendLog(`[metrics] Collecting line counts for ${repoLabel}...`);
        const stats = await buildLineStats(repoPath, repoUserConfig);
        const totals = stats.totals || {};
        const parts = [
          `code=${Number(totals.code || 0).toLocaleString()}`,
          `prose=${Number(totals.prose || 0).toLocaleString()}`,
          `extracted-prose=${Number(totals['extracted-prose'] || 0).toLocaleString()}`,
          `records=${Number(totals.records || 0).toLocaleString()}`
        ];
        appendLog(`[metrics] Line totals: ${parts.join(' ')}`);
      } catch (err) {
        appendLog(`[metrics] Line counts unavailable: ${err?.message || err}`);
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
      completed += 1;
      updateBenchProgress();
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
      const benchResult = await processRunner.runProcess(`bench ${repoLabel}`, process.execPath, benchArgs, {
        cwd: scriptRoot,
        env: {
          ...repoEnvBase
        },
        continueOnError: true
      });
      if (!benchResult.ok) {
        const diskFull = logHistory.some((line) => isDiskFullMessage(line));
        if (diskFull) {
          appendLog(`[error] Disk space exhausted while benchmarking ${repoLabel}; continuing.`, 'error');
        }
        appendLog(`[error] Bench failed for ${repoLabel}; continuing to next repo.`, 'error');
        completed += 1;
        updateBenchProgress();
        appendLog('[metrics] failed (bench)');
        results.push({
          ...task,
          repoPath,
          outFile,
          summary: null,
          failed: true,
          failureReason: diskFull ? 'disk-full' : 'bench',
          failureCode: benchResult.code ?? null
        });
        continue;
      }
      try {
        const raw = await fsPromises.readFile(outFile, 'utf8');
        summary = JSON.parse(raw).summary || null;
      } catch (err) {
        appendLog(`[error] Failed to read bench report for ${repoLabel}; continuing.`, 'error');
        if (err && err.message) display.error(err.message);
        completed += 1;
        updateBenchProgress();
        appendLog('[metrics] failed (report)');
        results.push({
          ...task,
          repoPath,
          outFile,
          summary: null,
          failed: true,
          failureReason: 'report',
          failureCode: null
        });
        continue;
      }
    }

    completed += 1;
    updateBenchProgress();
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

if (!quietMode) {
  appendLog('\nGrouped summary');
  for (const [language, payload] of Object.entries(output.groupedSummary)) {
    if (!payload.summary) continue;
    printSummary(payload.label, payload.summary, payload.count, quietMode, {
      writeLine: (line) => appendLog(line)
    });
  }
  printSummary('Overall', output.overallSummary, results.length, quietMode, {
    writeLine: (line) => appendLog(line)
  });
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
  appendLog(`\nCompleted ${results.length} benchmark runs.`);
  if (argv.out) appendLog(`Summary written to ${path.resolve(argv.out)}`);
  display.close();
}
