#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { isAbsolutePathNative } from '../src/shared/files.js';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadRunConfig, loadRunRules } from './runner/run-config.js';
import {
  applyFilters,
  assignLane,
  buildTags,
  compileMatchers,
  discoverTests,
  listLanes,
  listTags,
  resolveLanes,
  splitCsv
} from './runner/run-discovery.js';
import { parseArgs } from './runner/run-args.js';
import {
  mergeNodeOptions,
  normalizeLaneArgs,
  resolveLogDir,
  resolvePhysicalCores,
  resolveRetries,
  resolveTimeout
} from './runner/run-helpers.js';
import { runTests } from './runner/run-execution.js';
import { summarizeResults } from './runner/run-results.js';
import {
  buildJsonReport,
  createInitReporter,
  createOrderedReporter,
  renderHeader,
  renderSummary,
  reportTestResult,
  writeJUnit,
  writeLatestLogPointer,
  writeTestRunTimes,
  writeTimings
} from './runner/run-reporting.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TESTS_DIR = path.join(ROOT, 'tests');
const DEFAULT_TIMEOUT_MS = 30000;
const MAX_OUTPUT_BYTES = 5 * 1024 * 1024;
const SKIP_EXIT_CODE = 77;
const REDO_EXIT_CODES = [3221226356, 3221225477];
const DEFAULT_TIMEOUT_GRACE_MS = 2000;
const DEFAULT_LOG_DIR = path.join(ROOT, '.testLogs');
const ORDERED_LANES = new Set([
  'ci-lite',
  'ci',
  'ci-long'
]);
const INHERITED_PAIROFCLEATS_ENV_ALLOWLIST = new Set([
  'PAIROFCLEATS_TEST_API_STARTUP_TIMEOUT_MS',
  'PAIROFCLEATS_TEST_CACHE_SUFFIX',
  'PAIROFCLEATS_TEST_ALLOW_MISSING_COMPAT_KEY',
  'PAIROFCLEATS_TEST_LOG_SILENT',
  'PAIROFCLEATS_TEST_ALLOW_TIMEOUT_TARGET',
  'PAIROFCLEATS_TEST_PID_FILE'
]);

const scrubInheritedPairOfCleatsEnv = (env) => {
  if (!env || typeof env !== 'object') return;
  for (const key of Object.keys(env)) {
    if (!key.startsWith('PAIROFCLEATS_')) continue;
    if (INHERITED_PAIROFCLEATS_ENV_ALLOWLIST.has(key)) continue;
    delete env[key];
  }
};

const BORDER_PATTERN = '╶╶╴-╴-╶-╶╶╶-=---╶---=--╶--=---=--=-=-=--=---=--╶--=---╶---=-╴╴╴-╴-╶-╶╴╴';

const main = async () => {
  const argv = parseArgs();
  // yargs prints help, but we disable its auto-exit to control failure modes.
  // Ensure `--help` doesn't fall through and start running tests.
  if (argv.help) return;
  const hasLogTimesFlag = process.argv.includes('--log-times');
  const selectors = argv._.map((value) => String(value));
  const includePatterns = [...selectors, ...argv.match];
  const excludePatterns = [...argv.exclude];
  const tagInclude = splitCsv(argv.tag);
  const laneInfo = normalizeLaneArgs(argv.lane);
  const requestedLanes = laneInfo.requested;
  const runRules = loadRunRules({ root: ROOT });
  const ciLiteOrderPath = path.join(TESTS_DIR, 'ci-lite', 'ci-lite.order.txt');
  let ciLiteOrderSet = new Set();
  try {
    const ciLiteRaw = await fsPromises.readFile(ciLiteOrderPath, 'utf8');
    ciLiteOrderSet = new Set(
      ciLiteRaw
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith('#'))
    );
  } catch {}

  const resolveLaneDefaultTimeout = (lanes) => {
    const laneDefaults = new Map([
      ['ci-lite', 15000],
      ['ci', 60000],
      ['ci-long', 240000]
    ]);
    const normalized = lanes.filter((lane) => lane && lane !== 'all');
    if (normalized.length === 1 && laneDefaults.has(normalized[0])) {
      return laneDefaults.get(normalized[0]);
    }
    if (normalized.includes('ci-long')) return laneDefaults.get('ci-long');
    if (normalized.includes('ci')) return laneDefaults.get('ci');
    if (normalized.includes('ci-lite')) return laneDefaults.get('ci-lite');
    return DEFAULT_TIMEOUT_MS;
  };

  const isCiLiteOnly = requestedLanes.length === 1 && requestedLanes[0] === 'ci-lite';
  const isCiOnly = requestedLanes.length === 1 && requestedLanes[0] === 'ci';
  const isCiLongOnly = requestedLanes.length === 1 && requestedLanes[0] === 'ci-long';
  const orderedLane = (() => {
    const normalized = requestedLanes.filter((lane) => lane && lane !== 'all');
    if (normalized.length !== 1) {
      return '';
    }
    const lane = normalized[0];
    return ORDERED_LANES.has(lane) ? lane : '';
  })();
  if (requestedLanes.includes('ci-long') && !tagInclude.includes('long')) {
    tagInclude.push('long');
  }

  if (argv['list-lanes'] || argv['list-tags']) {
    const payload = {};
    if (argv['list-lanes']) payload.lanes = listLanes(runRules);
    if (argv['list-tags']) payload.tags = listTags(runRules);
    if (argv.json) {
      process.stdout.write(`${JSON.stringify(payload)}\n`);
    } else {
      if (payload.lanes) {
        for (const lane of payload.lanes) process.stdout.write(`${lane}\n`);
      }
      if (payload.tags) {
        if (payload.lanes) process.stdout.write('\n');
        for (const tag of payload.tags) process.stdout.write(`${tag}\n`);
      }
    }
    return;
  }

  const lanes = resolveLanes(requestedLanes, runRules.knownLanes);
  const lanesList = Array.from(lanes).sort();
  const configOverride = typeof argv.config === 'string' && argv.config.trim() ? argv.config.trim() : '';
  const runConfig = loadRunConfig({ root: ROOT, configPath: configOverride || undefined });
  const timeoutOverrides = runConfig.timeoutOverrides && typeof runConfig.timeoutOverrides === 'object'
    ? runConfig.timeoutOverrides
    : {};
  const tagExclude = splitCsv(argv['exclude-tag']);
  const ignoreConfigExcludes = laneInfo.includeAll || isCiLiteOnly;
  const configExclude = new Set();
  if (!ignoreConfigExcludes) {
    const baseExcludes = Array.isArray(runConfig.excludeTags)
      ? runConfig.excludeTags.map((tag) => String(tag))
      : [];
    baseExcludes.forEach((tag) => configExclude.add(tag));
  } else if (!laneInfo.includeDestructive) {
    configExclude.add('destructive');
  }
  const laneConfig = runConfig.lanes && typeof runConfig.lanes === 'object' ? runConfig.lanes : {};
  for (const lane of requestedLanes) {
    if (lane === 'all' || ignoreConfigExcludes) continue;
    const entry = laneConfig[lane];
    if (!entry || typeof entry !== 'object') continue;
    const laneExcludes = Array.isArray(entry.excludeTags)
      ? entry.excludeTags.map((tag) => String(tag))
      : [];
    laneExcludes.forEach((tag) => configExclude.add(tag));
  }
  if (laneInfo.includeDestructive) {
    configExclude.delete('destructive');
  }
  for (const tag of configExclude) {
    if (!tag || tagInclude.includes(tag) || tagExclude.includes(tag)) continue;
    tagExclude.push(tag);
  }
  const dropTags = [];
  const dropLongFromCi = requestedLanes.includes('ci')
    && !requestedLanes.includes('ci-long')
    && !tagInclude.includes('long')
    && tagExclude.includes('long');
  if (dropLongFromCi) dropTags.push('long');

  const tests = (await discoverTests({
    testsDir: TESTS_DIR,
    excludedDirs: runRules.excludedDirs,
    excludedFiles: runRules.excludedFiles
  })).map((test) => {
    const lane = assignLane(test.id, runRules.laneRules);
    const adjustedLane = ciLiteOrderSet.has(test.id) ? 'ci-lite' : lane;
    return { ...test, lane: adjustedLane, tags: buildTags(test.id, adjustedLane, runRules.tagRules) };
  });

  const includeMatchers = compileMatchers(includePatterns, 'match');
  const excludeMatchers = compileMatchers(excludePatterns, 'exclude');

  let selection = null;

  if (orderedLane) {
    const orderPath = path.join(TESTS_DIR, orderedLane, `${orderedLane}.order.txt`);
    const orderLane = orderedLane;
    let orderRaw = '';
    try {
      orderRaw = await fsPromises.readFile(orderPath, 'utf8');
    } catch (error) {
      console.error(`${orderLane} lane requires an order file at ${path.relative(ROOT, orderPath)}.`);
      console.error('Create the file with one test id per line (e.g., "run-results").');
      process.exit(2);
    }

    const orderIds = orderRaw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'));

    if (!orderIds.length) {
      console.error(`${orderLane} order file is empty: ${path.relative(ROOT, orderPath)}`);
      process.exit(2);
    }

    const byId = new Map(tests.map((test) => [test.id, test]));
    const seen = new Map();
    const missing = [];
    const ordered = [];
    for (const id of orderIds) {
      const test = byId.get(id);
      if (!test) {
        missing.push(id);
        continue;
      }
      const count = (seen.get(id) || 0) + 1;
      seen.set(id, count);
      ordered.push(count === 1 ? test : { ...test, id: `${id}#${count}` });
    }

    if (missing.length) {
      console.error(`${orderLane} order file references missing tests (${missing.length}):`);
      for (const id of missing.slice(0, 50)) console.error(`- ${id}`);
      if (missing.length > 50) console.error(`...and ${missing.length - 50} more`);
      process.exit(2);
    }

    const matchesAny = (value, matchers) => matchers.some((matcher) => matcher.test(value));

    selection = ordered
      .filter((test) => (
        (!tagInclude.length || tagInclude.some((tag) => test.tags.includes(tag)))
        && (!includeMatchers.length || matchesAny(test.id, includeMatchers) || matchesAny(test.relPath, includeMatchers))
        && (!excludeMatchers.length || !(matchesAny(test.id, excludeMatchers) || matchesAny(test.relPath, excludeMatchers)))
      ))
      .map((test) => {
        if (!tagExclude.length) return test;
        const excluded = test.tags.filter((tag) => tagExclude.includes(tag));
        if (!excluded.length) return test;
        return {
          ...test,
          presetStatus: 'skipped',
          skipReason: `excluded tag: ${excluded.join(', ')}`
        };
      });
  } else {
    const { selected, skipped } = applyFilters({
      tests,
      lanes,
      includeMatchers,
      excludeMatchers,
      tagInclude,
      tagExclude,
      dropTags
    });
    selection = [...selected, ...skipped];
  }

  if (!selection.length) {
    console.error('No tests matched the selected filters.');
    process.exit(2);
  }

  if (!orderedLane) {
    selection = selection.slice().sort((a, b) => a.id.localeCompare(b.id));
  }

  if (argv.list) {
    if (argv.json) {
      const payload = { total: selection.length, tests: selection.map((test) => ({
        id: test.id,
        path: test.relPath,
        lane: test.lane,
        tags: test.tags
      })) };
      process.stdout.write(`${JSON.stringify(payload)}\n`);
      return;
    }
    for (const test of selection) {
      process.stdout.write(`${test.id}\n`);
    }
    return;
  }

  const envRetries = Number.parseInt(
    process.env.PAIROFCLEATS_TEST_RETRIES ?? process.env.npm_config_test_retries ?? '',
    10
  );
  const envTimeout = Number.parseInt(
    process.env.PAIROFCLEATS_TEST_TIMEOUT_MS ?? process.env.npm_config_test_timeout_ms ?? '',
    10
  );
  const envLogDir = process.env.PAIROFCLEATS_TEST_LOG_DIR ?? process.env.npm_config_test_log_dir ?? '';
  const envNodeOptions = process.env.PAIROFCLEATS_TEST_NODE_OPTIONS ?? '';
  const envMaxOldSpace = Number.parseInt(
    process.env.PAIROFCLEATS_TEST_MAX_OLD_SPACE_MB ?? '',
    10
  );
  const envThreads = Number.parseInt(
    process.env.PAIROFCLEATS_TEST_THREADS ?? '',
    10
  );

  const defaultRetries = process.env.CI ? 1 : 0;
  const retries = resolveRetries({ cli: argv.retries, env: envRetries, defaultRetries });
  const timeoutMs = resolveTimeout({
    cli: argv['timeout-ms'],
    env: envTimeout,
    defaultTimeout: resolveLaneDefaultTimeout(requestedLanes)
  });
  const logDir = resolveLogDir({ cli: argv['log-dir'], env: envLogDir, defaultDir: DEFAULT_LOG_DIR, root: ROOT });
  const resolveLaneLabel = (lanes) => {
    const normalized = lanes.filter((lane) => lane && lane !== 'all');
    if (normalized.length === 1) return normalized[0];
    if (!normalized.length) return 'tests';
    return 'multi';
  };
  const laneLabel = resolveLaneLabel(requestedLanes);
  const logTimesArg = argv['log-times'];
  let logTimesPath = '';
  if (hasLogTimesFlag || (logTimesArg !== null && logTimesArg !== undefined && logTimesArg !== false)) {
    const raw = typeof logTimesArg === 'string' ? logTimesArg.trim() : '';
    if (raw) {
      logTimesPath = isAbsolutePathNative(raw) ? raw : path.resolve(ROOT, raw);
    } else {
      logTimesPath = path.join(ROOT, '.testLogs', `${laneLabel}-testRunTimes.txt`);
    }
  }
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const runLogDir = logDir ? path.join(logDir, `run-${runId}`) : '';
  const timingsPath = argv['timings-file'] ? path.resolve(ROOT, argv['timings-file']) : '';
  const defaultJobs = Math.max(1, resolvePhysicalCores());
  const jobs = Number.isFinite(argv.jobs)
    ? Math.max(1, Math.floor(argv.jobs))
    : defaultJobs;
  const passThrough = Array.isArray(argv['--']) ? argv['--'].map(String) : [];

  if (runLogDir) {
    await fsPromises.mkdir(runLogDir, { recursive: true });
    await writeLatestLogPointer({ root: ROOT, runLogDir });
  }

  const baseEnv = { ...process.env };
  scrubInheritedPairOfCleatsEnv(baseEnv);
  baseEnv.PAIROFCLEATS_TESTING = '1';
  if (!baseEnv.PAIROFCLEATS_CACHE_ROOT) {
    baseEnv.PAIROFCLEATS_CACHE_ROOT = path.join(ROOT, '.testCache');
  }
  if (Number.isFinite(argv.retries) || !baseEnv.PAIROFCLEATS_TEST_RETRIES) {
    baseEnv.PAIROFCLEATS_TEST_RETRIES = String(retries);
  }
  if (Number.isFinite(argv['timeout-ms']) || !baseEnv.PAIROFCLEATS_TEST_TIMEOUT_MS) {
    baseEnv.PAIROFCLEATS_TEST_TIMEOUT_MS = String(timeoutMs);
  }
  if ((argv['log-dir'] && argv['log-dir'].trim()) || !baseEnv.PAIROFCLEATS_TEST_LOG_DIR) {
    if (runLogDir) baseEnv.PAIROFCLEATS_TEST_LOG_DIR = runLogDir;
  }
  const threadsOverride = Number.isFinite(argv['pairofcleats-threads'])
    ? Math.max(1, Math.floor(argv['pairofcleats-threads']))
    : (Number.isFinite(envThreads) ? Math.max(1, Math.floor(envThreads)) : null);
  if (Number.isFinite(threadsOverride)) {
    baseEnv.PAIROFCLEATS_THREADS = String(threadsOverride);
  }
  const maxOldSpaceMb = Number.isFinite(argv['max-old-space-mb'])
    ? Math.max(256, Math.floor(argv['max-old-space-mb']))
    : (Number.isFinite(envMaxOldSpace) ? Math.max(256, Math.floor(envMaxOldSpace)) : null);
  const nodeOptionsExtraRaw = typeof argv['node-options'] === 'string' && argv['node-options'].trim()
    ? argv['node-options'].trim()
    : String(envNodeOptions || '').trim();
  const nodeOptionsParts = [];
  if (Number.isFinite(maxOldSpaceMb)) {
    nodeOptionsParts.push(`--max-old-space-size=${maxOldSpaceMb}`);
  }
  if (nodeOptionsExtraRaw) nodeOptionsParts.push(nodeOptionsExtraRaw);
  const testEnvImport = `--import ${pathToFileURL(path.join(TESTS_DIR, 'helpers', 'test-env.js')).href}`;
  const existingNodeOptions = mergeNodeOptions(baseEnv.NODE_OPTIONS, nodeOptionsExtraRaw);
  if (!existingNodeOptions.includes(testEnvImport)) {
    nodeOptionsParts.push(testEnvImport);
  }
  if (nodeOptionsParts.length) {
    baseEnv.NODE_OPTIONS = mergeNodeOptions(baseEnv.NODE_OPTIONS, nodeOptionsParts.join(' '));
  }

  const captureOutput = argv.json || argv.quiet || Boolean(runLogDir) || jobs > 1 || Boolean(argv.junit);
  const consoleStream = argv.json ? process.stderr : process.stdout;
  const showPreamble = !argv.quiet;
  const showPass = !argv.quiet;
  const showSkip = !argv.quiet;
  const showFailures = true;
  const showSummary = true;
  const useColor = !argv.json && consoleStream.isTTY && !argv['no-color'] && !process.env.NO_COLOR;
  const startedAt = Date.now();
  const testsCount = String(selection.length).padStart(4);

  const context = {
    argv,
    root: ROOT,
    testsDir: TESTS_DIR,
    runRules,
    runConfig,
    timeoutOverrides,
    consoleStream,
    useColor,
    outputIgnorePatterns: runRules.outputIgnorePatterns,
    showPreamble,
    showPass,
    showSkip,
    showFailures,
    showSummary,
    captureOutput,
    jobs,
    retries,
    timeoutMs,
    runLogDir,
    passThrough,
    baseEnv,
    failFast: argv['fail-fast'],
    timeoutGraceMs: DEFAULT_TIMEOUT_GRACE_MS,
    skipExitCode: SKIP_EXIT_CODE,
    redoExitCodes: REDO_EXIT_CODES,
    maxOutputBytes: MAX_OUTPUT_BYTES,
    borderPattern: BORDER_PATTERN,
    laneLabel
  };

  context.initReporter = createInitReporter({ context });

  const { border, innerPadding } = renderHeader({
    context,
    lanesList,
    testsCount,
    jobs
  });

  const ordered = context.initReporter ? null : createOrderedReporter({
    size: selection.length,
    onReport: (result) => reportTestResult({ context, result })
  });
  const reportResult = ordered
    ? ordered.report
    : ((result) => reportTestResult({ context, result }));
  const reportDirect = ordered
    ? ((result) => reportTestResult({ context, result }))
    : null;

  const results = await runTests({
    selection,
    context,
    reportResult,
    reportDirect
  });

  const finalResults = ordered ? ordered.results : results;
  const totalMs = Date.now() - startedAt;
  const summary = summarizeResults(finalResults, totalMs);
  if (showSummary) {
    renderSummary({
      context,
      summary,
      results: finalResults,
      runLogDir,
      border,
      innerPadding
    });
  }

  if (argv.json) {
    const payload = buildJsonReport({
      summary,
      results: finalResults,
      root: ROOT,
      runLogDir,
      junitPath: argv.junit || ''
    });
    process.stdout.write(`${JSON.stringify(payload)}\n`);
  }

  if (argv.junit) {
    const junitPath = path.resolve(ROOT, argv.junit);
    await writeJUnit({ junitPath, results: finalResults, totalMs });
  }

  if (timingsPath) {
    await writeTimings({ timingsPath, results: finalResults, totalMs, runId });
  }
  if (logTimesPath) {
    await writeTestRunTimes({ logTimesPath, results: finalResults });
  }

  const timeoutCount = finalResults.filter((result) => result.timedOut).length;
  const failCount = finalResults.filter((result) => result.status === 'failed' && !result.timedOut).length;
  const exitCode = argv['allow-timeouts']
    ? (failCount > 0 ? 1 : 0)
    : (summary.failed > 0 ? 1 : 0);
  process.exit(exitCode);
};

main();
