#!/usr/bin/env node
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { getBenchMirrorRefreshMs } from '../../src/shared/env.js';
import { parseBenchLanguageArgs } from './language/cli.js';
import { loadBenchConfig } from './language/config.js';
import {
  buildNonInteractiveGitEnv,
  ensureLongPathsSupport,
  resolveCloneTool,
  resolveMirrorCacheRoot,
  resolveMirrorRefreshMs
} from './language/repos.js';
import { createProcessRunner } from './language/process.js';
import { buildBenchEnvironmentMetadata } from './language/logging.js';
import { validateEncodingFixtures } from './language/metrics.js';
import { buildReportOutput, printSummary } from './language/report.js';
import { createToolDisplay } from '../shared/cli-display.js';
import {
  assignRepoLogMetadata,
  buildExecutionPlans,
  buildTaskCatalog,
  shuffleInPlace
} from './language-repos/planning.js';
import { createBenchLogger } from './language-repos/logging.js';
import { createRepoLifecycle } from './language-repos/lifecycle.js';
import { createBenchProgressRuntime, runBenchExecutionLoop } from './language-repos/run-loop.js';

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
const repoLogsEnabled = !(typeof argv.log === 'string' && argv.log.trim());
const runDiagnosticsRoot = path.join(resultsRoot, 'logs', 'bench-language', `${runSuffix}-diagnostics`);
const exitWithDisplay = (code) => {
  display.close();
  process.exit(code);
};

const logger = createBenchLogger({
  display,
  configPath,
  reposRoot,
  cacheRoot,
  resultsRoot,
  masterLogPath,
  runSuffix,
  repoLogsEnabled
});
const {
  initMasterLog,
  initRepoLog,
  closeRepoLog,
  closeMasterLog,
  appendLog,
  writeListLine,
  writeLog,
  writeLogSync,
  clearLogHistory,
  hasDiskFullMessageInHistory,
  getRepoLogPath,
  getLogPaths,
  logHistory
} = logger;

const progressRuntime = createBenchProgressRuntime({
  display,
  appendLog,
  totalRepos: 0
});
const processRunner = createProcessRunner({
  appendLog,
  writeLog,
  writeLogSync,
  logHistory,
  logPath: masterLogPath,
  getLogPaths,
  onProgressEvent: progressRuntime.handleProgressEvent
});

const closeLogs = () => {
  closeRepoLog();
  closeMasterLog();
};

const reportFatal = (label, err) => {
  try {
    initMasterLog();
  } catch {}
  try {
    const details = err?.stack || String(err);
    display.error(`[bench-language] Fatal: ${label}`);
    display.error(details);
    const names = getLogPaths().map((entry) => path.basename(entry));
    display.error(`[bench-language] Details logged (${names.join(', ')})`);
  } catch {}
};

const SHUTDOWN_ACTIVE_CHILD_WAIT_MS = 15000;
let shutdownPromise = null;

/**
 * Shut down bench-language deterministically and await active child teardown.
 *
 * @param {{reason:string,code:number,err?:unknown,fatal?:boolean}} input
 * @returns {Promise<void>}
 */
const gracefulShutdown = ({
  reason,
  code,
  err = null,
  fatal = false
}) => {
  const exitCode = Number.isFinite(Number(code)) ? Number(code) : 1;
  const normalizedReason = typeof reason === 'string' && reason.trim()
    ? reason.trim()
    : 'shutdown';
  if (shutdownPromise) {
    if (normalizedReason === 'SIGINT' || normalizedReason === 'SIGTERM') {
      writeLogSync(`[signal] ${normalizedReason} received during shutdown; forcing exit.`);
      process.exit(exitCode);
    }
    return shutdownPromise;
  }
  shutdownPromise = (async () => {
    if (fatal) {
      reportFatal(normalizedReason, err);
      writeLogSync(`[error] ${normalizedReason}: ${err?.stack || err}`);
    } else if (normalizedReason === 'SIGINT' || normalizedReason === 'SIGTERM') {
      writeLogSync(`[signal] ${normalizedReason} received`);
    }
    const active = processRunner.getActiveChild();
    const activePid = Number(active?.pid);
    if (Number.isFinite(activePid)) {
      const activeLabel = processRunner.getActiveLabel();
      writeLogSync(`[signal] terminating ${activeLabel || `pid ${activePid}`}`);
      const termination = await processRunner.terminateActiveChild({
        timeoutMs: SHUTDOWN_ACTIVE_CHILD_WAIT_MS
      });
      if (termination?.timedOut) {
        writeLogSync(
          `[signal] timed out waiting ${SHUTDOWN_ACTIVE_CHILD_WAIT_MS}ms for pid ${activePid} to exit`
        );
      }
    }
    processRunner.logExit(normalizedReason, exitCode);
    closeLogs();
    display.close();
    process.exit(exitCode);
  })();
  return shutdownPromise;
};

process.on('exit', (code) => {
  processRunner.logExit('exit', code);
  closeLogs();
});
process.on('SIGINT', () => {
  void gracefulShutdown({
    reason: 'SIGINT',
    code: 130
  });
});
process.on('SIGTERM', () => {
  void gracefulShutdown({
    reason: 'SIGTERM',
    code: 143
  });
});

process.on('uncaughtException', (err) => {
  void gracefulShutdown({
    reason: 'uncaughtException',
    code: 1,
    err,
    fatal: true
  });
});
process.on('unhandledRejection', (err) => {
  void gracefulShutdown({
    reason: 'unhandledRejection',
    code: 1,
    err,
    fatal: true
  });
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

let tasks = [];
try {
  tasks = buildTaskCatalog({
    benchConfig: config,
    argv,
    scriptRoot
  });
} catch (err) {
  display.error(err?.message || String(err));
  exitWithDisplay(1);
}

if (argv.random) {
  shuffleInPlace(tasks);
}
assignRepoLogMetadata({
  plannedTasks: tasks,
  repoLogsEnabled
});

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
const { executionPlans, precreateDirs } = buildExecutionPlans({
  tasks,
  reposRoot,
  resultsRoot,
  cacheRoot
});
await Promise.all(precreateDirs.map((dir) => fsPromises.mkdir(dir, { recursive: true })));

const lifecycle = createRepoLifecycle({
  appendLog,
  display,
  processRunner,
  cloneEnabled,
  dryRun,
  keepCache,
  cloneTool,
  cloneCommandEnv,
  mirrorCacheRoot,
  mirrorRefreshMs,
  cacheRoot,
  runDiagnosticsRoot,
  runSuffix,
  benchEnvironmentMetadata,
  logHistory,
  exitWithDisplay
});

progressRuntime.setTotal(tasks.length);
const results = await runBenchExecutionLoop({
  executionPlans,
  argv,
  scriptRoot,
  baseEnv,
  processRunner,
  appendLog,
  display,
  quietMode,
  dryRun,
  repoLogsEnabled,
  initRepoLog,
  getRepoLogPath,
  clearLogHistory,
  hasDiskFullMessageInHistory,
  progressRuntime,
  lifecycle,
  wantsSqlite,
  backendList,
  lockMode,
  lockWaitMs,
  lockStaleMs
});

const output = await buildReportOutput({
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

const outputPath = argv.out ? path.resolve(argv.out) : null;
if (outputPath) {
  await fsPromises.mkdir(path.dirname(outputPath), { recursive: true });
  await fsPromises.writeFile(outputPath, JSON.stringify(output, null, 2));
}

if (argv.json) {
  display.close();
  console.log(JSON.stringify(output, null, 2));
} else {
  appendLog(`Completed ${results.length} benchmark runs.`);
  if (outputPath) {
    appendLog(`[summary] written (${path.basename(outputPath)})`, 'info', {
      fileOnlyLine: `Summary written to ${outputPath}`
    });
  }
  display.close();
}
