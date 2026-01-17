#!/usr/bin/env node
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { getEnvConfig } from '../src/shared/env.js';
import { getRuntimeConfig, loadUserConfig, resolveRuntimeEnv } from './dict-utils.js';
import { parseBenchLanguageArgs } from './bench/language/cli.js';
import { loadBenchConfig } from './bench/language/config.js';
import { checkIndexLock, formatLockDetail } from './bench/language/locks.js';
import {
  ensureLongPathsSupport,
  needsIndexArtifacts,
  needsSqliteArtifacts,
  resolveCloneTool,
  resolveRepoCacheRoot,
  resolveRepoDir
} from './bench/language/repos.js';
import { isInside, isRootPath } from './path-utils.js';
import { createProcessRunner } from './bench/language/process.js';
import {
  buildLineStats,
  formatDuration,
  formatGb,
  formatMetricSummary,
  getRecommendedHeapMb,
  stripMaxOldSpaceFlag,
  validateEncodingFixtures
} from './bench/language/metrics.js';
import { buildReportOutput, printSummary } from './bench/language/report.js';
import { createDisplay } from '../src/shared/cli/display.js';

const parseList = (value) => {
  if (!value) return [];
  return String(value)
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
};

const {
  argv,
  scriptRoot,
  configPath,
  reposRoot,
  cacheRoot,
  resultsRoot,
  logPath,
  cloneEnabled,
  dryRun,
  keepCache,
  logWindowSize,
  lockMode,
  lockWaitMs,
  lockStaleMs,
  backendList,
  wantsSqlite,
  indexProfile,
  suppressProfileEnv
} = parseBenchLanguageArgs();

const baseEnv = { ...process.env };
const envConfig = getEnvConfig();
const quietMode = argv.quiet === true || argv.json === true;
const display = createDisplay({
  stream: process.stderr,
  progressMode: argv.progress,
  verbose: argv.verbose === true,
  quiet: quietMode,
  logWindowSize,
  json: argv.json === true
});
const exitWithDisplay = (code) => {
  display.close();
  process.exit(code);
};
const heapArgRaw = argv['heap-mb'];
const heapArg = Number.isFinite(Number(heapArgRaw)) ? Math.floor(Number(heapArgRaw)) : null;
const heapRecommendation = getRecommendedHeapMb();
let heapLogged = false;

let logStream = null;
const initLog = () => {
  if (logStream) return;
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  logStream = fs.createWriteStream(logPath, { flags: 'a' });
  logStream.write(`\n=== Bench run ${new Date().toISOString()} ===\n`);
  logStream.write(`Config: ${configPath}\n`);
  logStream.write(`Repos: ${reposRoot}\n`);
  logStream.write(`Cache: ${cacheRoot}\n`);
  logStream.write(`Results: ${resultsRoot}\n`);
};

const writeLog = (line) => {
  if (!logStream) initLog();
  if (!logStream) return;
  logStream.write(`${line}\n`);
};

const writeLogSync = (line) => {
  try {
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.appendFileSync(logPath, `${line}\n`);
  } catch {}
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
const appendLog = (line, level = 'info') => {
  if (!line) return;
  writeLog(line);
  if (level === 'error') {
    display.error(line);
  } else if (level === 'warn') {
    display.warn(line);
  } else {
    display.log(line);
  }
  logHistory.push(line);
  if (logHistory.length > logHistoryLimit) logHistory.shift();
};
const handleProgressEvent = (event) => {
  if (!event || typeof event !== 'object') return;
  if (event.event === 'log') {
    const message = event.message || '';
    const level = event.level || 'info';
    appendLog(message, level);
    return;
  }
  const name = event.name || event.taskId || 'task';
  const total = Number.isFinite(event.total) && event.total > 0 ? event.total : null;
  const task = display.task(name, {
    taskId: event.taskId || name,
    stage: event.stage,
    mode: event.mode,
    total,
    ephemeral: event.ephemeral === true
  });
  const current = Number.isFinite(event.current) ? event.current : 0;
  if (event.event === 'task:start') {
    task.set(current, total, { message: event.message });
    return;
  }
  if (event.event === 'task:progress') {
    task.set(current, total, { message: event.message });
    return;
  }
  if (event.event === 'task:end') {
    if (event.status === 'failed') {
      task.fail(new Error(event.message || 'failed'));
    } else {
      task.done({ message: event.message });
    }
  }
};
let processRunner = null;
processRunner = createProcessRunner({
  appendLog,
  writeLog,
  writeLogSync,
  logHistory,
  logPath,
  onProgressEvent: handleProgressEvent
});

process.on('exit', (code) => {
  processRunner.logExit('exit', code);
  if (logStream) logStream.end();
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
    initLog();
  } catch {}
  try {
    const details = err?.stack || String(err);
    // Make failures visible even in interactive mode.
    display.error(`[bench-language] Fatal: ${label}`);
    display.error(details);
    display.error(`[bench-language] Details logged to: ${logPath}`);
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

const config = loadBenchConfig(configPath);
await validateEncodingFixtures(scriptRoot);
const languageFilter = parseList(argv.languages || argv.language).map((entry) => entry.toLowerCase());
let tierFilter = parseList(argv.tier).map((entry) => entry.toLowerCase());
const repoFilter = parseList(argv.only || argv.repos).map((entry) => entry.toLowerCase());
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

if (argv.list) {
  const payload = {
    config: configPath,
    repoRoot: reposRoot,
    cacheRoot,
    resultsRoot,
    languages: Object.keys(config),
    tasks
  };
  if (argv.json) {
    console.log(JSON.stringify(payload, null, 2));
  } else {
    console.log('Benchmark targets');
    console.log(`- config: ${configPath}`);
    console.log(`- repos: ${reposRoot}`);
    console.log(`- cache: ${cacheRoot}`);
    console.log(`- results: ${resultsRoot}`);
    for (const task of tasks) {
      console.log(`- ${task.language} ${task.tier} ${task.repo}`);
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
  ensureLongPathsSupport();
  cloneTool = resolveCloneTool();
}
await fsPromises.mkdir(reposRoot, { recursive: true });
await fsPromises.mkdir(resultsRoot, { recursive: true });
await fsPromises.mkdir(cacheRoot, { recursive: true });
initLog();
appendLog(`Clone tool: ${cloneTool ? cloneTool.label : 'disabled'}`);

const benchScript = path.join(scriptRoot, 'tests', 'perf', 'bench', 'run.test.js');
const results = [];
const startTime = Date.now();
let completed = 0;

const benchTask = display.task('Repos', { total: tasks.length, stage: 'bench' });
const updateBenchProgress = (label) => {
  const elapsed = formatDuration(Date.now() - startTime);
  const message = label ? `${label} | elapsed ${elapsed}` : `elapsed ${elapsed}`;
  benchTask.set(completed, tasks.length, { message });
};
updateBenchProgress('pending');

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
  const phaseLabel = `repo ${repoLabel} (${task.tier})`;
  updateBenchProgress(`starting ${phaseLabel}`);
  const repoCacheRoot = resolveRepoCacheRoot({ repoPath, cacheRoot });

  try {
    if (!fs.existsSync(repoPath)) {
      if (!cloneEnabled && !dryRun) {
        display.error(`Missing repo ${task.repo} at ${repoPath}. Re-run with --clone.`);
        exitWithDisplay(1);
      }
      updateBenchProgress(`cloning ${phaseLabel}`);
      if (!dryRun && cloneEnabled && cloneTool) {
        const args = cloneTool.buildArgs(task.repo, repoPath);
        const cloneResult = await processRunner.runProcess(`clone ${task.repo}`, cloneTool.label, args, {
          env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
          continueOnError: true
        });
        if (!cloneResult.ok) {
          appendLog(`[error] Clone failed for ${repoLabel}; continuing to next repo.`, 'error');
          completed += 1;
          updateBenchProgress(`failed ${phaseLabel}`);
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

    const repoUserConfig = loadUserConfig(
      repoPath,
      indexProfile ? { profile: indexProfile } : {}
    );
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
      && !envConfig.maxOldSpaceMb
      && !hasHeapFlag
    ) {
      heapOverride = heapRecommendation.recommendedMb;
      if (!heapLogged) {
        appendLog(
          `[auto-heap] Using ${formatGb(heapOverride)} (${heapOverride} MB) for Node heap. `
            + 'Override with --heap-mb or PAIROFCLEATS_MAX_OLD_SPACE_MB.'
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
    if (suppressProfileEnv && repoEnvBase.PAIROFCLEATS_PROFILE) {
      delete repoEnvBase.PAIROFCLEATS_PROFILE;
    }
    if (heapOverride) {
      repoEnvBase.PAIROFCLEATS_MAX_OLD_SPACE_MB = String(heapOverride);
    }
    if (indexProfile) {
      repoEnvBase.PAIROFCLEATS_PROFILE = indexProfile;
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
      updateBenchProgress(`skipped ${phaseLabel}`);
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
    if (indexProfile) benchArgs.push('--index-profile', indexProfile);
    if (argv['stub-embeddings']) {
      benchArgs.push('--stub-embeddings');
      progress.appendLog('[bench] Stub embeddings enabled; results are not comparable to real-embeddings runs.');
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
    if (argv['stub-embeddings']) {
      appendLog('[bench] Stub embeddings requested; ignored for heavy language benchmarks.');
    }
    if (argv.ann) benchArgs.push('--ann');
    if (argv['no-ann']) benchArgs.push('--no-ann');
    if (argv.backend) benchArgs.push('--backend', String(argv.backend));
    if (argv.top) benchArgs.push('--top', String(argv.top));
    if (argv.limit) benchArgs.push('--limit', String(argv.limit));
    if (argv['bm25-k1']) benchArgs.push('--bm25-k1', String(argv['bm25-k1']));
    if (argv['bm25-b']) benchArgs.push('--bm25-b', String(argv['bm25-b']));
    if (argv['fts-profile']) benchArgs.push('--fts-profile', String(argv['fts-profile']));
    if (argv['fts-weights']) benchArgs.push('--fts-weights', String(argv['fts-weights']));
    if (argv.threads) benchArgs.push('--threads', String(argv.threads));
    if (argv['no-index-profile']) benchArgs.push('--no-index-profile');
    const childProgressMode = argv.progress === 'off' ? 'off' : 'jsonl';
    benchArgs.push('--progress', childProgressMode);
    if (argv.verbose) benchArgs.push('--verbose');
    if (argv.quiet || argv.json) benchArgs.push('--quiet');

    updateBenchProgress(`bench ${phaseLabel}`);

    let summary = null;
    if (dryRun) {
      appendLog(`[dry-run] node ${benchArgs.join(' ')}`);
    } else {
      const benchResult = await processRunner.runProcess(`bench ${repoLabel}`, process.execPath, benchArgs, {
        cwd: scriptRoot,
        env: {
          ...repoEnvBase,
          PAIROFCLEATS_CACHE_ROOT: cacheRoot,
          ...(Number.isFinite(Number(argv.threads)) && Number(argv.threads) > 0
            ? { PAIROFCLEATS_THREADS: String(argv.threads) }
            : {})
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
        updateBenchProgress(`failed ${phaseLabel}`);
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
        updateBenchProgress(`failed ${phaseLabel}`);
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
    updateBenchProgress(`finished ${phaseLabel}`);
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

display.close();

if (!quietMode) {
  console.log('\nGrouped summary');
  for (const [language, payload] of Object.entries(output.groupedSummary)) {
    if (!payload.summary) continue;
    printSummary(payload.label, payload.summary, payload.count, quietMode);
  }
  printSummary('Overall', output.overallSummary, results.length, quietMode);
}

if (argv.out) {
  const outPath = path.resolve(argv.out);
  await fsPromises.mkdir(path.dirname(outPath), { recursive: true });
  await fsPromises.writeFile(outPath, JSON.stringify(output, null, 2));
}

if (argv.json) {
  console.log(JSON.stringify(output, null, 2));
} else {
  console.log(`\nCompleted ${results.length} benchmark runs.`);
  if (argv.out) console.log(`Summary written to ${path.resolve(argv.out)}`);
}
