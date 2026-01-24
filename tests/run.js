#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import yargs from 'yargs/yargs';
import { hideBin } from 'yargs/helpers';
import PQueue from 'p-queue';
import { killProcessTree } from './helpers/kill-tree.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TESTS_DIR = path.join(ROOT, 'tests');
const DEFAULT_TIMEOUT_MS = 120000;
const MAX_OUTPUT_BYTES = 5 * 1024 * 1024;
const SKIP_EXIT_CODE = 77;
const DEFAULT_TIMEOUT_GRACE_MS = 2000;

const EXCLUDED_DIRS = new Set([
  'fixtures',
  'script-coverage',
  'helpers',
  '.logs',
  '.cache',
  '.worktrees',
  'worktree',
  'worktrees'
]);
const EXCLUDED_FILES = new Set(['run.js', 'all.js', 'script-coverage.js', 'api-server-stream.js']);
const KNOWN_LANES = new Set(['smoke', 'unit', 'integration', 'services', 'storage', 'perf', 'ci']);

const LANE_RULES = [
  { lane: 'perf', match: [/^perf\//, /^bench/, /-perf-/, /^kotlin-perf-guard/] },
  { lane: 'smoke', match: [/^smoke(?:-|$)/, /^harness\/smoke\//] },
  { lane: 'services', match: [/^services\//, /^api-server/, /^mcp/, /^indexer-service/, /^service-queue/] },
  { lane: 'storage', match: [/^storage\//, /^sqlite/, /^lmdb/, /^vector-extension/] },
  { lane: 'unit', match: [/^unit\//, /\.unit(\.|$)/, /^harness\//, /^jsonrpc-/, /^json-stream/, /^tokenize-/, /^tokenization-/, /^dict-/, /^cache-lru/, /^build-runtime\//, /^test-runner$/] }
];

const TAG_RULES = [
  { tag: 'perf', match: /^perf\// },
  { tag: 'services', match: /^services\// },
  { tag: 'storage', match: /^storage\// },
  { tag: 'indexing', match: /^indexing\// },
  { tag: 'retrieval', match: /^retrieval\// },
  { tag: 'lang', match: /^lang\// },
  { tag: 'tooling', match: /^tooling\// },
  { tag: 'harness', match: /^harness\// },
  { tag: 'bench', match: /^bench/ },
  { tag: 'smoke', match: /^smoke/ },
  { tag: 'sqlite', match: /sqlite/ },
  { tag: 'lmdb', match: /lmdb/ },
  { tag: 'mcp', match: /mcp/ },
  { tag: 'api', match: /^api-server/ },
  { tag: 'watch', match: /^watch-/ },
  { tag: 'embeddings', match: /embeddings/ },
  { tag: 'tooling', match: /tooling|lsp|type-inference/ }
];

const parseArgs = () => {
  const parser = yargs(hideBin(process.argv))
    .scriptName('pairofcleats test')
    .parserConfiguration({
      'camel-case-expansion': false,
      'dot-notation': false,
      'populate--': true
    })
    .usage('pairofcleats test [selectors...] [options] [-- <pass-through args>]')
    .option('lane', { type: 'string', array: true, default: [] })
    .option('tag', { type: 'string', array: true, default: [] })
    .option('exclude-tag', { type: 'string', array: true, default: [] })
    .option('match', { type: 'string', array: true, default: [] })
    .option('exclude', { type: 'string', array: true, default: [] })
    .option('list', { type: 'boolean', default: false })
    .option('jobs', { type: 'number', default: 1 })
    .option('retries', { type: 'number' })
    .option('timeout-ms', { type: 'number' })
    .option('fail-fast', { type: 'boolean', default: false })
    .option('quiet', { type: 'boolean', default: false })
    .option('json', { type: 'boolean', default: false })
    .option('junit', { type: 'string', default: '' })
    .option('log-dir', { type: 'string', default: '' })
    .option('timings-file', { type: 'string', default: '' })
    .option('node-options', { type: 'string', default: '' })
    .option('max-old-space-mb', { type: 'number' })
    .option('pairofcleats-threads', { type: 'number' })
    .help()
    .alias('h', 'help')
    .strictOptions()
    .exitProcess(false)
    .fail((msg, err, y) => {
      const message = msg || err?.message;
      if (message) console.error(message);
      y.showHelp();
      process.exit(2);
    });
  return parser.parse();
};

const normalizeSegments = (value) => value.split(path.sep).join('/');

const hasExcludedSegment = (relPath) => {
  const parts = relPath.split('/');
  return parts.some((part) => EXCLUDED_DIRS.has(part));
};

const isExcludedFile = (relPath) => {
  if (hasExcludedSegment(relPath)) return true;
  const base = path.basename(relPath);
  return EXCLUDED_FILES.has(base);
};

const discoverTests = async () => {
  const results = [];
  const walk = async (dir, relDir) => {
    const entries = await fsPromises.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const relPath = relDir ? `${relDir}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (hasExcludedSegment(relPath)) continue;
        await walk(path.join(dir, entry.name), relPath);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith('.js')) continue;
      if (isExcludedFile(relPath)) continue;
      results.push({
        path: path.join(dir, entry.name),
        relPath
      });
    }
  };
  await walk(TESTS_DIR, '');
  results.sort((a, b) => a.relPath.localeCompare(b.relPath));
  return results.map((entry) => ({
    ...entry,
    id: entry.relPath.replace(/\.js$/, ''),
    relPath: normalizeSegments(entry.relPath)
  }));
};

const assignLane = (id) => {
  for (const rule of LANE_RULES) {
    if (rule.match.some((regex) => regex.test(id))) return rule.lane;
  }
  return 'integration';
};

const buildTags = (id, lane) => {
  const tags = new Set([lane]);
  for (const rule of TAG_RULES) {
    if (rule.match.test(id)) tags.add(rule.tag);
  }
  return Array.from(tags).sort();
};

const splitCsv = (values) => values.flatMap((value) => String(value).split(',')).map((value) => value.trim()).filter(Boolean);

const mergeNodeOptions = (base, extra) => {
  const baseText = typeof base === 'string' ? base.trim() : '';
  const extraText = typeof extra === 'string' ? extra.trim() : '';
  if (!extraText) return baseText;
  if (!baseText) return extraText;
  return `${baseText} ${extraText}`.trim();
};

const parseRegexLiteral = (raw) => {
  if (!raw.startsWith('/')) return null;
  const lastSlash = raw.lastIndexOf('/');
  if (lastSlash <= 0) return null;
  return {
    source: raw.slice(1, lastSlash),
    flags: raw.slice(lastSlash + 1)
  };
};

const compileMatchers = (patterns, label) => {
  const matchers = [];
  for (const rawPattern of patterns) {
    const pattern = String(rawPattern).trim();
    if (!pattern) continue;
    const literal = parseRegexLiteral(pattern);
    if (literal) {
      try {
        const regex = new RegExp(literal.source, literal.flags);
        matchers.push({ raw: pattern, test: (value) => regex.test(value) });
        continue;
      } catch (error) {
        console.error(`Invalid ${label} regex: ${pattern}`);
        console.error(String(error?.message || error));
        process.exit(2);
      }
    }
    const lowered = pattern.toLowerCase();
    matchers.push({ raw: pattern, test: (value) => value.toLowerCase().includes(lowered) });
  }
  return matchers;
};

const matchesAny = (value, matchers) => matchers.some((matcher) => matcher.test(value));

const applyFilters = ({ tests, lanes, includeMatchers, excludeMatchers, tagInclude, tagExclude }) => {
  let filtered = tests.filter((test) => lanes.has(test.lane));
  if (tagInclude.length) {
    filtered = filtered.filter((test) => tagInclude.some((tag) => test.tags.includes(tag)));
  }
  if (tagExclude.length) {
    filtered = filtered.filter((test) => !tagExclude.some((tag) => test.tags.includes(tag)));
  }
  if (includeMatchers.length) {
    filtered = filtered.filter((test) => (
      matchesAny(test.id, includeMatchers) || matchesAny(test.relPath, includeMatchers)
    ));
  }
  if (excludeMatchers.length) {
    filtered = filtered.filter((test) => !(
      matchesAny(test.id, excludeMatchers) || matchesAny(test.relPath, excludeMatchers)
    ));
  }
  return filtered;
};

const resolveRetries = ({ cli, env, defaultRetries }) => {
  if (Number.isFinite(cli)) return Math.max(0, Math.floor(cli));
  if (Number.isFinite(env)) return Math.max(0, Math.floor(env));
  return defaultRetries;
};

const resolveTimeout = ({ cli, env, defaultTimeout }) => {
  if (Number.isFinite(cli)) return Math.max(1000, Math.floor(cli));
  if (Number.isFinite(env)) return Math.max(1000, Math.floor(env));
  return defaultTimeout;
};

const resolveLogDir = ({ cli, env }) => {
  const raw = String(cli || env || '').trim();
  return raw ? path.resolve(ROOT, raw) : '';
};

const formatDuration = (ms) => {
  if (!Number.isFinite(ms)) return '0ms';
  if (ms >= 10000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)}s`;
  return `${Math.round(ms)}ms`;
};

const extractSkipReason = (stdout, stderr) => {
  const pickLine = (text) => {
    if (!text) return '';
    return text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean) || '';
  };
  return pickLine(stdout) || pickLine(stderr) || 'skipped';
};

const sanitizeId = (value) => value.replace(/[^a-z0-9-_]+/gi, '_').slice(0, 120) || 'test';

const writeLogFile = async ({ logDir, test, attempt, stdout, stderr, status, exitCode, signal, timedOut, skipReason, termination }) => {
  if (!logDir) return '';
  const safeId = sanitizeId(test.id);
  const filePath = path.join(logDir, `${safeId}.attempt-${attempt}.log`);
  const lines = [
    `id: ${test.id}`,
    `path: ${test.relPath}`,
    `attempt: ${attempt}`,
    `status: ${status}`,
    `exit: ${exitCode ?? 'null'}`,
    `signal: ${signal ?? 'null'}`,
    `timedOut: ${timedOut ? 'true' : 'false'}`,
    `skipReason: ${skipReason || ''}`,
    `termination: ${termination ? JSON.stringify(termination) : ''}`,
    ''
  ];
  if (stdout) {
    lines.push('--- stdout ---', stdout);
  }
  if (stderr) {
    lines.push('--- stderr ---', stderr);
  }
  await fsPromises.writeFile(filePath, lines.join('\n'), 'utf8');
  return filePath;
};

const collectOutput = (stream, limit, onChunk) => {
  let size = 0;
  let data = '';
  if (!stream) return () => data;
  stream.on('data', (chunk) => {
    if (typeof chunk !== 'string') chunk = chunk.toString('utf8');
    size += chunk.length;
    if (size <= limit) {
      data += chunk;
    } else if (size - chunk.length < limit) {
      data += chunk.slice(0, Math.max(0, limit - (size - chunk.length)));
    }
    if (onChunk) onChunk(chunk);
  });
  return () => data;
};

const runTestOnce = async ({ test, passThrough, env, cwd, timeoutMs, captureOutput }) => new Promise((resolve) => {
  const start = Date.now();
  const args = [test.path, ...passThrough];
  const child = spawn(process.execPath, args, {
    cwd,
    env,
    detached: process.platform !== 'win32',
    stdio: captureOutput ? ['ignore', 'pipe', 'pipe'] : 'inherit'
  });
  let timedOut = false;
  let timeoutHandle = null;
  let resolved = false;
  let termination = null;
  const stopTimer = () => {
    if (timeoutHandle) clearTimeout(timeoutHandle);
    timeoutHandle = null;
  };
  const finish = (result) => {
    if (resolved) return;
    resolved = true;
    stopTimer();
    resolve(result);
  };
  if (timeoutMs > 0) {
    timeoutHandle = setTimeout(async () => {
      timedOut = true;
      try {
        termination = await killProcessTree(child.pid, { graceMs: DEFAULT_TIMEOUT_GRACE_MS });
      } catch (error) {
        termination = { error: error?.message || String(error) };
      }
    }, timeoutMs);
  }
  const getStdout = collectOutput(child.stdout, MAX_OUTPUT_BYTES);
  const getStderr = collectOutput(child.stderr, MAX_OUTPUT_BYTES);
  child.on('error', (error) => {
    const durationMs = Date.now() - start;
    finish({
      status: 'failed',
      exitCode: null,
      signal: null,
      timedOut: false,
      durationMs,
      stdout: captureOutput ? getStdout() : '',
      stderr: captureOutput ? `${getStderr()}\n${error?.message || error}`.trim() : '',
      termination
    });
  });
  child.on('close', (code, signal) => {
    const durationMs = Date.now() - start;
    const stdout = captureOutput ? getStdout() : '';
    const stderr = captureOutput ? getStderr() : '';
    const skipped = !timedOut && code === SKIP_EXIT_CODE;
    finish({
      status: timedOut ? 'failed' : (code === 0 ? 'passed' : (skipped ? 'skipped' : 'failed')),
      exitCode: code,
      signal,
      timedOut,
      durationMs,
      stdout,
      stderr,
      skipReason: skipped ? extractSkipReason(stdout, stderr) : '',
      termination
    });
  });
});

const runTestWithRetries = async ({ test, passThrough, env, cwd, timeoutMs, captureOutput, retries, logDir }) => {
  const maxAttempts = retries + 1;
  const logs = [];
  let lastResult = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const result = await runTestOnce({ test, passThrough, env, cwd, timeoutMs, captureOutput });
    lastResult = result;
    const logPath = await writeLogFile({
      logDir,
      test,
      attempt,
      stdout: result.stdout,
      stderr: result.stderr,
      status: result.status,
      exitCode: result.exitCode,
      signal: result.signal,
      timedOut: result.timedOut,
      skipReason: result.skipReason,
      termination: result.termination
    });
    if (logPath) logs.push(logPath);
    if (result.status === 'passed' || result.status === 'skipped') {
      return { ...result, attempts: attempt, logs };
    }
  }
  return { ...(lastResult || { status: 'failed' }), attempts: maxAttempts, logs };
};

const summarizeResults = (results, totalMs) => {
  const summary = {
    total: results.length,
    passed: 0,
    failed: 0,
    skipped: 0,
    durationMs: totalMs
  };
  for (const result of results) {
    if (result.status === 'passed') summary.passed += 1;
    else if (result.status === 'failed') summary.failed += 1;
    else summary.skipped += 1;
  }
  return summary;
};

const resolveLanes = (argvLanes) => {
  const raw = splitCsv(argvLanes.length ? argvLanes : ['ci']);
  for (const lane of raw) {
    if (!KNOWN_LANES.has(lane)) {
      console.error(`Unknown lane: ${lane}`);
      process.exit(2);
    }
  }
  const resolved = new Set();
  for (const lane of raw) {
    if (lane === 'ci') {
      resolved.add('unit');
      resolved.add('integration');
      resolved.add('services');
      continue;
    }
    resolved.add(lane);
  }
  return resolved;
};

const formatFailure = (result) => {
  if (result.timedOut) return 'timeout';
  if (result.signal) return `signal ${result.signal}`;
  if (Number.isFinite(result.exitCode)) return `exit ${result.exitCode}`;
  return 'failed';
};

const writeJUnit = async ({ junitPath, results, totalMs }) => {
  if (!junitPath) return;
  await fsPromises.mkdir(path.dirname(junitPath), { recursive: true });
  const escapeXml = (value) => String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\"/g, '&quot;')
    .replace(/\'/g, '&apos;');
  const durationSeconds = (totalMs / 1000).toFixed(3);
  const summary = summarizeResults(results, totalMs);
  const cases = results.map((result) => {
    const time = ((result.durationMs || 0) / 1000).toFixed(3);
    const name = escapeXml(result.id);
    if (result.status === 'passed') {
      return `  <testcase classname="pairofcleats" name="${name}" time="${time}"/>`;
    }
    if (result.status === 'skipped') {
      const skipMessage = result.skipReason ? ` message="${escapeXml(result.skipReason)}"` : '';
      return `  <testcase classname="pairofcleats" name="${name}" time="${time}"><skipped${skipMessage}/></testcase>`;
    }
    const message = escapeXml(formatFailure(result));
    return `  <testcase classname="pairofcleats" name="${name}" time="${time}"><failure message="${message}"/></testcase>`;
  });
  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<testsuite name="pairofcleats" tests="${summary.total}" failures="${summary.failed}" skipped="${summary.skipped}" time="${durationSeconds}">`,
    ...cases,
    '</testsuite>',
    ''
  ].join('\n');
  await fsPromises.writeFile(junitPath, xml, 'utf8');
};

const writeTimings = async ({ timingsPath, results, totalMs, runId }) => {
  if (!timingsPath) return;
  await fsPromises.mkdir(path.dirname(timingsPath), { recursive: true });
  const payload = {
    runId,
    totalMs,
    tests: results.map((result) => ({
      id: result.id,
      lane: result.lane,
      status: result.status,
      durationMs: result.durationMs
    }))
  };
  await fsPromises.writeFile(timingsPath, `${JSON.stringify(payload)}\n`, 'utf8');
};

const main = async () => {
  const argv = parseArgs();
  const selectors = argv._.map((value) => String(value));
  const includePatterns = [...selectors, ...argv.match];
  const excludePatterns = [...argv.exclude];
  const tagInclude = splitCsv(argv.tag);
  const tagExclude = splitCsv(argv['exclude-tag']);
  const lanes = resolveLanes(argv.lane);

  const tests = (await discoverTests()).map((test) => {
    const lane = assignLane(test.id);
    return { ...test, lane, tags: buildTags(test.id, lane) };
  });

  const includeMatchers = compileMatchers(includePatterns, 'match');
  const excludeMatchers = compileMatchers(excludePatterns, 'exclude');
  let selection = applyFilters({ tests, lanes, includeMatchers, excludeMatchers, tagInclude, tagExclude });

  if (!selection.length) {
    console.error('No tests matched the selected filters.');
    process.exit(2);
  }

  selection = selection.slice().sort((a, b) => a.id.localeCompare(b.id));

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
  const timeoutMs = resolveTimeout({ cli: argv['timeout-ms'], env: envTimeout, defaultTimeout: DEFAULT_TIMEOUT_MS });
  const logDir = resolveLogDir({ cli: argv['log-dir'], env: envLogDir });
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const runLogDir = logDir ? path.join(logDir, `run-${runId}`) : '';
  const timingsPath = argv['timings-file'] ? path.resolve(ROOT, argv['timings-file']) : '';
  const jobs = Math.max(1, Math.floor(argv.jobs || 1));
  const passThrough = Array.isArray(argv['--']) ? argv['--'].map(String) : [];

  if (runLogDir) {
    await fsPromises.mkdir(runLogDir, { recursive: true });
  }

  const baseEnv = { ...process.env };
  baseEnv.PAIROFCLEATS_TESTING = '1';
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
  const startedAt = Date.now();
  const preamble = [
    `Lanes: ${Array.from(lanes).sort().join(', ')}`,
    `Tests: ${selection.length}`,
    includePatterns.length ? `Match: ${includePatterns.join(', ')}` : '',
    tagInclude.length ? `Tags: ${tagInclude.join(', ')}` : '',
    tagExclude.length ? `Exclude tags: ${tagExclude.join(', ')}` : '',
    excludePatterns.length ? `Exclude: ${excludePatterns.join(', ')}` : '',
    jobs > 1 ? `Jobs: ${jobs}` : ''
  ].filter(Boolean).join(' | ');

  if (showPreamble) {
    consoleStream.write(`${preamble}\n`);
  }

  const results = new Array(selection.length);
  let nextToReport = 0;
  let failFastTriggered = false;

  const reportResult = (result, index) => {
    results[index] = result;
    while (nextToReport < results.length && results[nextToReport]) {
      const current = results[nextToReport];
      if (current.status === 'failed' && showFailures) {
        if (captureOutput && !argv.json) {
          if (current.stdout) consoleStream.write(current.stdout);
          if (current.stderr) consoleStream.write(current.stderr);
        }
        const duration = formatDuration(current.durationMs);
        const detail = formatFailure(current);
        const attemptInfo = current.attempts > 1 ? ` after ${current.attempts} attempts` : '';
        consoleStream.write(`FAIL ${current.id} (${duration}) ${detail}${attemptInfo}\n`);
        if (current.logs && current.logs.length) {
          consoleStream.write(`Log: ${current.logs[current.logs.length - 1]}\n`);
        }
      } else if (current.status === 'passed' && showPass) {
        const duration = formatDuration(current.durationMs);
        consoleStream.write(`PASS ${current.id} (${duration})\n`);
      } else if (current.status === 'skipped' && showSkip) {
        const reason = current.skipReason ? ` (${current.skipReason})` : '';
        consoleStream.write(`SKIP ${current.id}${reason}\n`);
      }
      nextToReport += 1;
    }
  };

  const queue = new PQueue({ concurrency: jobs });
  selection.forEach((test, index) => {
    queue.add(async () => {
      if (argv['fail-fast'] && failFastTriggered) {
        reportResult({ ...test, id: test.id, status: 'skipped', durationMs: 0 }, index);
        return;
      }
      const result = await runTestWithRetries({
        test,
        passThrough,
        env: baseEnv,
        cwd: ROOT,
        timeoutMs,
        captureOutput,
        retries,
        logDir: runLogDir
      });
      const fullResult = { ...test, ...result };
      if (fullResult.status === 'failed' && argv['fail-fast']) {
        failFastTriggered = true;
      }
      reportResult(fullResult, index);
    });
  });

  await queue.onIdle();
  const totalMs = Date.now() - startedAt;
  const summary = summarizeResults(results, totalMs);
  if (showSummary) {
    consoleStream.write(`Summary: ${summary.passed} passed, ${summary.failed} failed, ${summary.skipped} skipped\n`);
    if (summary.failed) {
      const failures = results.filter((result) => result.status === 'failed');
      consoleStream.write('Failures:\n');
      for (const failure of failures) {
        consoleStream.write(`  - ${failure.id} (${formatFailure(failure)})\n`);
      }
    }
    if (runLogDir) {
      consoleStream.write(`Logs: ${runLogDir}\n`);
    }
  }

  if (argv.json) {
    const payload = {
      summary,
      logDir: runLogDir || null,
      junit: argv.junit ? path.resolve(ROOT, argv.junit) : null,
      tests: results.map((result) => ({
        id: result.id,
        path: result.relPath,
        lane: result.lane,
        tags: result.tags,
        status: result.status,
        durationMs: result.durationMs,
        attempts: result.attempts,
        exitCode: result.exitCode ?? null,
        signal: result.signal ?? null,
        timedOut: result.timedOut ?? false,
        skipReason: result.skipReason || null,
        termination: result.termination || null,
        logs: result.logs || []
      }))
    };
    process.stdout.write(`${JSON.stringify(payload)}\n`);
  }

  if (argv.junit) {
    const junitPath = path.resolve(ROOT, argv.junit);
    await writeJUnit({ junitPath, results, totalMs });
  }

  if (timingsPath) {
    await writeTimings({ timingsPath, results, totalMs, runId });
  }

  process.exit(summary.failed > 0 ? 1 : 0);
};

main();
