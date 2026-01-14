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
import { createProgressState } from './bench/language/progress/state.js';
import { createProgressRenderer } from './bench/language/progress/render.js';

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
  quietMode,
  interactive,
  colorEnabled,
  logWindowSize,
  lockMode,
  lockWaitMs,
  lockStaleMs,
  wantsSqlite,
  indexProfile,
  suppressProfileEnv
} = parseBenchLanguageArgs();

const baseEnv = { ...process.env };
const envConfig = getEnvConfig();
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

const progressState = createProgressState({ logWindowSize });
let processRunner = null;
const progress = createProgressRenderer({
  state: progressState,
  interactive,
  quietMode,
  colorEnabled,
  writeLog,
  getActiveLabel: () => (processRunner ? processRunner.getActiveLabel() : '')
});
processRunner = createProcessRunner({
  appendLog: progress.appendLog,
  writeLog,
  writeLogSync,
  logHistory: progressState.logHistory,
  logPath
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
  process.exit(130);
});
process.on('SIGTERM', () => {
  writeLogSync('[signal] SIGTERM received');
  const active = processRunner.getActiveChild();
  if (active) {
    writeLogSync(`[signal] terminating ${processRunner.getActiveLabel()}`);
    processRunner.killProcessTree(active.pid);
  }
  processRunner.logExit('SIGTERM', 143);
  process.exit(143);
});
process.on('uncaughtException', (err) => {
  writeLogSync(`[error] uncaughtException: ${err?.stack || err}`);
  processRunner.logExit('uncaughtException', 1);
  process.exit(1);
});
process.on('unhandledRejection', (err) => {
  writeLogSync(`[error] unhandledRejection: ${err?.stack || err}`);
  processRunner.logExit('unhandledRejection', 1);
  process.exit(1);
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
    console.error(`Missing queries file: ${queriesPath}`);
    process.exit(1);
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
  process.exit(0);
}

if (!tasks.length) {
  console.error('No benchmark targets match the requested filters.');
  process.exit(1);
}

let cloneTool = null;
if (cloneEnabled && !dryRun) {
  ensureLongPathsSupport();
  cloneTool = resolveCloneTool();
  if (!quietMode) console.log(`Clone tool: ${cloneTool.label}`);
}
await fsPromises.mkdir(reposRoot, { recursive: true });
await fsPromises.mkdir(resultsRoot, { recursive: true });
await fsPromises.mkdir(cacheRoot, { recursive: true });
initLog();
writeLog(`Clone tool: ${cloneTool ? cloneTool.label : 'disabled'}`);

const benchScript = path.join(scriptRoot, 'tests', 'bench.js');
const results = [];
const startTime = Date.now();
let completed = 0;

progress.updateMetrics('Metrics: pending');
progress.updateProgress(`Progress: 0/${tasks.length} | elapsed ${formatDuration(0)}`);

for (const task of tasks) {
  const repoPath = resolveRepoDir({ reposRoot, repo: task.repo, language: task.language });
  await fsPromises.mkdir(path.dirname(repoPath), { recursive: true });
  const repoLabel = `${task.language}/${task.repo}`;
  const phaseLabel = `repo ${repoLabel} (${task.tier})`;
  progressState.currentRepoLabel = repoLabel;
  progress.resetBuildProgress(repoLabel);

  if (!fs.existsSync(repoPath)) {
    if (!cloneEnabled && !dryRun) {
      console.error(`Missing repo ${task.repo} at ${repoPath}. Re-run with --clone.`);
      process.exit(1);
    }
    progress.updateProgress(`Progress: ${completed}/${tasks.length} | cloning ${phaseLabel} | elapsed ${formatDuration(Date.now() - startTime)}`);
    if (!dryRun && cloneEnabled && cloneTool) {
      const args = cloneTool.buildArgs(task.repo, repoPath);
      const cloneResult = await processRunner.runProcess(`clone ${task.repo}`, cloneTool.label, args, {
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
        continueOnError: true
      });
      if (!cloneResult.ok) {
        progress.appendLog(`[error] Clone failed for ${repoLabel}; continuing to next repo.`);
        completed += 1;
        progress.updateProgress(`Progress: ${completed}/${tasks.length} | failed ${phaseLabel} | elapsed ${formatDuration(Date.now() - startTime)}`);
        progress.updateMetrics('Metrics: failed (clone)');
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
      progress.appendLog(`[heap] Using ${formatGb(heapOverride)} (${heapOverride} MB) from --heap-mb.`);
      heapLogged = true;
    }
  } else if (
    !Number.isFinite(repoRuntimeConfig.maxOldSpaceMb)
    && !envConfig.maxOldSpaceMb
    && !hasHeapFlag
  ) {
    heapOverride = heapRecommendation.recommendedMb;
    if (!heapLogged) {
      progress.appendLog(
        `[auto-heap] Using ${formatGb(heapOverride)} (${heapOverride} MB) for Node heap. `
          + 'Override with --heap-mb or PAIROFCLEATS_MAX_OLD_SPACE_MB.'
      );
      heapLogged = true;
    }
  }
  const runtimeConfigForRun = heapOverride
    ? { ...repoRuntimeConfig, maxOldSpaceMb: heapOverride }
    : repoRuntimeConfig;
  const baseEnvForRun = { ...baseEnv };
  if (baseNodeOptions) {
    baseEnvForRun.NODE_OPTIONS = baseNodeOptions;
  } else {
    delete baseEnvForRun.NODE_OPTIONS;
  }
  const repoEnvBase = resolveRuntimeEnv(runtimeConfigForRun, baseEnvForRun);
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

  const repoCacheRoot = resolveRepoCacheRoot({ repoPath, cacheRoot });
  const wantsMemory = backendList.includes('memory');
  const missingIndex = needsIndexArtifacts(repoPath);
  const missingSqlite = wantsSqlite && needsSqliteArtifacts(repoPath);
  let autoBuildIndex = false;
  let autoBuildSqlite = false;
  const buildIndexRequested = argv.build || argv['build-index'];
  const buildSqliteRequested = argv.build || argv['build-sqlite'];
  if (buildSqliteRequested && !buildIndexRequested && missingIndex) {
    autoBuildIndex = true;
    progress.appendLog('[auto-build] sqlite build requires index artifacts; enabling build-index.');
  }
  if (!argv.build && !argv['build-index'] && !argv['build-sqlite']) {
    if (missingIndex && wantsMemory) autoBuildIndex = true;
    if (missingSqlite) autoBuildSqlite = true;
    if (autoBuildSqlite && missingIndex) autoBuildIndex = true;
    if (autoBuildIndex || autoBuildSqlite) {
      progress.appendLog(
        `[auto-build] missing artifacts${autoBuildIndex ? ' index' : ''}${autoBuildSqlite ? ' sqlite' : ''}; enabling build.`
      );
    }
  }

  const shouldBuildIndex = argv.build || argv['build-index'] || autoBuildIndex;
  if (shouldBuildIndex && !dryRun) {
    try {
      progress.appendLog(`[metrics] Collecting line counts for ${repoLabel}...`);
      const stats = await buildLineStats(repoPath, repoUserConfig);
      progressState.build.lineTotals = stats.totals;
      progressState.build.linesByFile = stats.linesByFile;
      progress.appendLog(
        `[metrics] Line totals: code=${stats.totals.code.toLocaleString()} prose=${stats.totals.prose.toLocaleString()}`
      );
    } catch (err) {
      progress.appendLog(`[metrics] Line counts unavailable: ${err?.message || err}`);
    }
  }

  const lockCheck = await checkIndexLock({
    repoCacheRoot,
    repoLabel,
    lockMode,
    lockWaitMs,
    lockStaleMs,
    onLog: progress.appendLog
  });
  if (!lockCheck.ok) {
    const detail = formatLockDetail(lockCheck.detail);
    const message = `Skipping ${repoLabel}: index lock held ${detail}`.trim();
    progress.appendLog(`[lock] ${message}`);
    if (!quietMode) console.error(message);
    completed += 1;
    progress.updateProgress(`Progress: ${completed}/${tasks.length} | skipped ${phaseLabel} | elapsed ${formatDuration(Date.now() - startTime)}`);
    progress.updateMetrics('Metrics: skipped (lock)');
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
  benchArgs.push('--real-embeddings');
  if (argv.build) {
    benchArgs.push('--build');
  } else {
    if (argv['build-index'] || autoBuildIndex) benchArgs.push('--build-index');
    if (argv['build-sqlite'] || autoBuildSqlite) benchArgs.push('--build-sqlite');
  }
  if (argv.incremental) benchArgs.push('--incremental');
  if (argv['stub-embeddings']) {
    progress.appendLog('[bench] Stub embeddings requested; ignored for heavy language benchmarks.');
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

  progress.updateProgress(`Progress: ${completed}/${tasks.length} | bench ${phaseLabel} | elapsed ${formatDuration(Date.now() - startTime)}`);

  let summary = null;
  if (dryRun) {
    progress.appendLog(`[dry-run] node ${benchArgs.join(' ')}`);
  } else {
    const benchResult = await processRunner.runProcess(`bench ${repoLabel}`, process.execPath, benchArgs, {
      cwd: scriptRoot,
      env: {
        ...repoEnvBase,
        PAIROFCLEATS_CACHE_ROOT: cacheRoot,
        PAIROFCLEATS_PROGRESS_FILES: '1',
        PAIROFCLEATS_PROGRESS_LINES: '1',
        ...(Number.isFinite(Number(argv.threads)) && Number(argv.threads) > 0
          ? { PAIROFCLEATS_THREADS: String(argv.threads) }
          : {})
      },
      continueOnError: true
    });
    if (!benchResult.ok) {
      progress.appendLog(`[error] Bench failed for ${repoLabel}; continuing to next repo.`);
      completed += 1;
      progress.updateProgress(`Progress: ${completed}/${tasks.length} | failed ${phaseLabel} | elapsed ${formatDuration(Date.now() - startTime)}`);
      progress.updateMetrics('Metrics: failed (bench)');
      results.push({
        ...task,
        repoPath,
        outFile,
        summary: null,
        failed: true,
        failureReason: 'bench',
        failureCode: benchResult.code ?? null
      });
      continue;
    }
    try {
      const raw = await fsPromises.readFile(outFile, 'utf8');
      summary = JSON.parse(raw).summary || null;
    } catch (err) {
      progress.appendLog(`[error] Failed to read bench report for ${repoLabel}; continuing.`);
      if (err && err.message) console.error(err.message);
      completed += 1;
      progress.updateProgress(`Progress: ${completed}/${tasks.length} | failed ${phaseLabel} | elapsed ${formatDuration(Date.now() - startTime)}`);
      progress.updateMetrics('Metrics: failed (report)');
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
  progress.updateProgress(`Progress: ${completed}/${tasks.length} | finished ${phaseLabel} | elapsed ${formatDuration(Date.now() - startTime)}`);
  progress.updateMetrics(formatMetricSummary(summary));

  results.push({ ...task, repoPath, outFile, summary });
}

const output = buildReportOutput({
  configPath,
  cacheRoot,
  resultsRoot,
  results,
  config
});

if (!quietMode) {
  if (interactive) {
    progress.renderStatus();
    process.stdout.write('\n');
  }
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
