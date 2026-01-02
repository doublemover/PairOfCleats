#!/usr/bin/env node
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';
import { spawn, spawnSync } from 'node:child_process';
import minimist from 'minimist';
import { fileURLToPath } from 'node:url';
import { getRepoCacheRoot, getRuntimeConfig, loadUserConfig, resolveNodeOptions } from './dict-utils.js';

const argv = minimist(process.argv.slice(2), {
  boolean: [
    'json',
    'list',
    'clone',
    'no-clone',
    'build',
    'build-index',
    'build-sqlite',
    'incremental',
    'ann',
    'no-ann',
    'stub-embeddings',
    'dry-run'
  ],
  string: [
    'config',
    'root',
    'cache-root',
    'results',
    'log',
    'language',
    'languages',
    'tier',
    'repos',
    'only',
    'queries',
    'backend',
    'out',
    'top',
    'limit',
    'bm25-k1',
    'bm25-b',
    'fts-profile',
    'fts-weights',
    'log-lines'
  ],
  default: {
    json: false,
    list: false,
    clone: true,
    'dry-run': false
  }
});

const scriptRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const configPath = path.resolve(argv.config || path.join(scriptRoot, 'benchmarks', 'repos.json'));
const reposRoot = path.resolve(argv.root || path.join(scriptRoot, 'benchmarks', 'repos'));
const cacheRoot = path.resolve(argv['cache-root'] || path.join(scriptRoot, 'benchmarks', 'cache'));
const resultsRoot = path.resolve(argv.results || path.join(scriptRoot, 'benchmarks', 'results'));
const logPath = path.resolve(argv.log || path.join(resultsRoot, 'bench-language.log'));
const runtimeConfig = getRuntimeConfig(scriptRoot, loadUserConfig(scriptRoot));
const resolvedNodeOptions = resolveNodeOptions(runtimeConfig, process.env.NODE_OPTIONS || '');
const baseEnv = resolvedNodeOptions
  ? { ...process.env, NODE_OPTIONS: resolvedNodeOptions }
  : { ...process.env };

const cloneEnabled = argv['no-clone'] ? false : argv.clone !== false;
const dryRun = argv['dry-run'] === true;
const quietMode = argv.json === true;
const interactive = !quietMode && process.stdout.isTTY;

const logLineArg = Number.parseInt(argv['log-lines'], 10);
const logWindowSize = Number.isFinite(logLineArg)
  ? Math.max(3, Math.min(5, logLineArg))
  : 4;
const logHistorySize = 50;
const logLines = Array(logWindowSize).fill('');
const logHistory = [];
let metricsLine = '';
let progressLine = '';
let statusRendered = false;
let cloneTool = null;
let logStream = null;
let lastProgressLogged = '';
let lastMetricsLogged = '';
let activeChild = null;
let activeLabel = '';
let exitLogged = false;
let currentRepoLabel = '';
const buildProgressState = {
  step: null,
  total: 0,
  startMs: 0,
  lastLoggedMs: 0,
  lastCount: 0,
  lastPct: 0,
  label: ''
};
const buildProgressRegex = /^\s*(Files|Imports)\s+(\d+)\/(\d+)\s+\((\d+(?:\.\d+)?)%\)/i;
const statusLines = logWindowSize + 2;
const cacheConfig = { cache: { root: cacheRoot } };
const backendList = resolveBackendList(argv.backend);
const wantsSqlite = backendList.includes('sqlite') || backendList.includes('sqlite-fts') || backendList.includes('fts');

function parseList(value) {
  if (!value) return [];
  return String(value)
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (err) {
    console.error(`Failed to read ${configPath}`);
    if (err && err.message) console.error(err.message);
    process.exit(1);
  }
}

function canRun(cmd, args) {
  const result = spawnSync(cmd, args, { encoding: 'utf8' });
  return result.status === 0;
}

function resolveCloneTool() {
  const gitAvailable = canRun('git', ['--version']);
  const ghAvailable = canRun('gh', ['--version']);
  const preferGit = process.platform === 'win32' && gitAvailable;
  if (preferGit) {
    return {
      label: 'git',
      buildArgs: (repo, repoPath) => ['-c', 'core.longpaths=true', 'clone', `https://github.com/${repo}.git`, repoPath]
    };
  }
  if (ghAvailable) {
    return {
      label: 'gh',
      buildArgs: (repo, repoPath) => ['repo', 'clone', repo, repoPath]
    };
  }
  if (gitAvailable) {
    return {
      label: 'git',
      buildArgs: (repo, repoPath) => ['clone', `https://github.com/${repo}.git`, repoPath]
    };
  }
  console.error('GitHub CLI (gh) or git is required to clone benchmark repos.');
  process.exit(1);
}

function ensureLongPathsSupport() {
  if (process.platform !== 'win32') return;
  if (canRun('git', ['--version'])) {
    spawnSync('git', ['config', '--global', 'core.longpaths', 'true'], { stdio: 'ignore' });
  }
  const regResult = spawnSync(
    'reg',
    ['query', 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\FileSystem', '/v', 'LongPathsEnabled'],
    { encoding: 'utf8' }
  );
  if (regResult.status !== 0) {
    console.warn('Warning: Unable to confirm Windows long path setting. Enable LongPathsEnabled=1 if clones fail.');
    return;
  }
  const match = regResult.stdout.match(/LongPathsEnabled\\s+REG_DWORD\\s+0x([0-9a-f]+)/i);
  if (!match) return;
  const value = Number.parseInt(match[1], 16);
  if (value === 0) {
    console.warn('Warning: Windows long paths are disabled. Enable LongPathsEnabled=1 to avoid clone failures.');
  }
}

function resolveRepoDir(repo, language) {
  const safeName = repo.replace('/', '__');
  return path.join(reposRoot, language, safeName);
}

function initLog() {
  if (logStream) return;
  logStream = fs.createWriteStream(logPath, { flags: 'a' });
  logStream.write(`\n=== Bench run ${new Date().toISOString()} ===\n`);
  logStream.write(`Config: ${configPath}\n`);
  logStream.write(`Repos: ${reposRoot}\n`);
  logStream.write(`Cache: ${cacheRoot}\n`);
  logStream.write(`Results: ${resultsRoot}\n`);
}

function writeLog(line) {
  if (!logStream) initLog();
  if (!logStream) return;
  logStream.write(`${line}\n`);
}

function writeLogSync(line) {
  try {
    fs.appendFileSync(logPath, `${line}\n`);
  } catch {}
}

function setActiveChild(child, label) {
  activeChild = child;
  activeLabel = label;
}

function clearActiveChild(child) {
  if (activeChild === child) {
    activeChild = null;
    activeLabel = '';
  }
}

function killProcessTree(pid) {
  if (!Number.isFinite(pid)) return;
  try {
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
      return;
    }
    process.kill(-pid, 'SIGTERM');
  } catch {}
}

function logExit(reason, code) {
  if (exitLogged) return;
  writeLogSync(`[exit] ${reason}${Number.isFinite(code) ? ` code=${code}` : ''}`);
  exitLogged = true;
}

function pushHistory(line) {
  if (!line) return;
  logHistory.push(line);
  if (logHistory.length > logHistorySize) logHistory.shift();
}

function renderStatus() {
  if (!interactive) return;
  if (!statusRendered) {
    process.stdout.write('\n'.repeat(statusLines));
    statusRendered = true;
  }
  readline.moveCursor(process.stdout, 0, -statusLines);
  const lines = [...logLines];
  while (lines.length < logWindowSize) lines.push('');
  lines.push(metricsLine);
  lines.push(progressLine);
  for (const line of lines) {
    readline.clearLine(process.stdout, 0);
    process.stdout.write(line || '');
    process.stdout.write('\n');
  }
}

let lastProgressMessage = '';
function updateProgress(message) {
  progressLine = message;
  renderStatus();
  if (message && message !== lastProgressLogged) {
    writeLog(`[progress] ${message}`);
    lastProgressLogged = message;
  }
  if (!interactive && !quietMode && message !== lastProgressMessage) {
    console.log(message);
    lastProgressMessage = message;
  }
}

function updateMetrics(message) {
  metricsLine = message;
  renderStatus();
  if (message && message !== lastMetricsLogged) {
    writeLog(`[metrics] ${message}`);
    lastMetricsLogged = message;
  }
  if (!interactive && !quietMode && message) {
    console.log(message);
  }
}

function appendLog(line) {
  const cleaned = line.replace(/\r/g, '').trimEnd();
  if (!cleaned) return;
  pushHistory(cleaned);
  writeLog(cleaned);
  handleBuildProgress(cleaned);
  if (interactive) {
    logLines.push(cleaned);
    if (logLines.length > logWindowSize) logLines.shift();
    renderStatus();
  } else if (!quietMode) {
    console.log(cleaned);
  }
}

function resetBuildProgress(label = '') {
  buildProgressState.step = null;
  buildProgressState.total = 0;
  buildProgressState.startMs = 0;
  buildProgressState.lastLoggedMs = 0;
  buildProgressState.lastCount = 0;
  buildProgressState.lastPct = 0;
  buildProgressState.label = label;
}

function handleBuildProgress(line) {
  const match = buildProgressRegex.exec(line);
  if (!match) return false;
  const step = match[1];
  const count = Number.parseInt(match[2], 10);
  const total = Number.parseInt(match[3], 10);
  const pct = Number.parseFloat(match[4]);
  if (
    !Number.isFinite(count) ||
    !Number.isFinite(total) ||
    !Number.isFinite(pct) ||
    total <= 0
  ) {
    return true;
  }
  const label = currentRepoLabel || activeLabel || '';
  const now = Date.now();
  if (
    buildProgressState.step !== step ||
    buildProgressState.total !== total ||
    count < buildProgressState.lastCount ||
    buildProgressState.label !== label
  ) {
    buildProgressState.step = step;
    buildProgressState.total = total;
    buildProgressState.startMs = now;
    buildProgressState.lastLoggedMs = 0;
    buildProgressState.lastCount = 0;
    buildProgressState.lastPct = 0;
    buildProgressState.label = label;
  }
  if (!buildProgressState.startMs) buildProgressState.startMs = now;
  const elapsedMs = now - buildProgressState.startMs;
  const rate = elapsedMs > 0 ? count / (elapsedMs / 1000) : 0;
  const remaining = total - count;
  const etaMs = rate > 0 && remaining > 0 ? (remaining / rate) * 1000 : 0;
  const pctDelta = pct - buildProgressState.lastPct;
  const countDelta = count - buildProgressState.lastCount;
  const shouldLog =
    count === total ||
    now - buildProgressState.lastLoggedMs >= 5000 ||
    pctDelta >= 1 ||
    countDelta >= 500;
  if (shouldLog) {
    const rateText = rate > 0 ? `${rate.toFixed(1)}/s` : 'n/a';
    const etaText = etaMs > 0 ? formatDuration(etaMs) : 'n/a';
    const labelText = label ? ` ${label}` : '';
    const message = `Indexing${labelText} ${step} ${count}/${total} (${pct.toFixed(
      1
    )}%) | rate ${rateText} | elapsed ${formatDuration(elapsedMs)} | eta ${etaText}`;
    updateMetrics(message);
    buildProgressState.lastLoggedMs = now;
    buildProgressState.lastCount = count;
    buildProgressState.lastPct = pct;
  }
  return true;
}

function formatDuration(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function formatMetricSummary(summary) {
  if (!summary) return 'Metrics: pending';
  const backends = summary.backends || Object.keys(summary.latencyMsAvg || {});
  const parts = [];
  for (const backend of backends) {
    const latency = summary.latencyMsAvg?.[backend];
    const hitRate = summary.hitRate?.[backend];
    const latencyText = Number.isFinite(latency) ? `${latency.toFixed(1)}ms` : 'n/a';
    const hitText = Number.isFinite(hitRate) ? `${(hitRate * 100).toFixed(1)}%` : 'n/a';
    parts.push(`${backend} ${latencyText} hit ${hitText}`);
  }
  return parts.length ? `Metrics: ${parts.join(' | ')}` : 'Metrics: pending';
}

function resolveBackendList(value) {
  if (!value) return ['memory', 'sqlite'];
  const trimmed = String(value).trim().toLowerCase();
  if (!trimmed) return ['memory', 'sqlite'];
  if (trimmed === 'all') return ['memory', 'sqlite', 'sqlite-fts'];
  return trimmed
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function resolveRepoCache(repoPath) {
  return getRepoCacheRoot(repoPath, cacheConfig);
}

function needsIndexArtifacts(repoCacheRoot) {
  const codeMeta = path.join(repoCacheRoot, 'index-code', 'chunk_meta.json');
  const proseMeta = path.join(repoCacheRoot, 'index-prose', 'chunk_meta.json');
  return !fs.existsSync(codeMeta) || !fs.existsSync(proseMeta);
}

function needsSqliteArtifacts(repoCacheRoot) {
  const codeDb = path.join(repoCacheRoot, 'index-sqlite', 'index-code.db');
  const proseDb = path.join(repoCacheRoot, 'index-sqlite', 'index-prose.db');
  return !fs.existsSync(codeDb) || !fs.existsSync(proseDb);
}

async function runProcess(label, cmd, args, options = {}) {
  return await new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], ...options });
    setActiveChild(child, label);
    writeLog(`[start] ${label}`);
    const carry = { stdout: '', stderr: '' };
    const handleChunk = (chunk, key) => {
      const text = carry[key] + chunk.toString('utf8');
      const normalized = text.replace(/\r/g, '\n');
      const parts = normalized.split('\n');
      carry[key] = parts.pop() || '';
      for (const line of parts) appendLog(line);
    };
    child.stdout.on('data', (chunk) => handleChunk(chunk, 'stdout'));
    child.stderr.on('data', (chunk) => handleChunk(chunk, 'stderr'));
    child.on('error', (err) => {
      writeLog(`[error] ${label} spawn failed: ${err?.message || err}`);
    });
    child.on('close', (code) => {
      if (carry.stdout) appendLog(carry.stdout);
      if (carry.stderr) appendLog(carry.stderr);
      writeLog(`[finish] ${label} code=${code}`);
      clearActiveChild(child);
      if (code === 0) {
        resolve({ ok: true });
        return;
      }
      console.error(`Failed: ${label}`);
      writeLog(`[error] Failed: ${label}`);
      if (logHistory.length) {
        console.error('Last log lines:');
        logHistory.slice(-10).forEach((line) => console.error(`- ${line}`));
        logHistory.slice(-10).forEach((line) => writeLog(`[error] ${line}`));
      }
      if (logHistory.some((line) => line.toLowerCase().includes('filename too long'))) {
        console.error('Hint: On Windows, enable long paths and set `git config --global core.longpaths true` or use a shorter --root path.');
        writeLog('[hint] Enable Windows long paths and set `git config --global core.longpaths true` or use a shorter --root path.');
      }
      logExit('failure', code ?? 1);
      process.exit(code ?? 1);
    });
  });
}

function summarizeResults(items) {
  const valid = items.filter((entry) => entry.summary);
  if (!valid.length) return null;
  const backendSet = new Set();
  for (const entry of valid) {
    const summary = entry.summary;
    const backends = summary.backends || Object.keys(summary.latencyMsAvg || {});
    for (const backend of backends) backendSet.add(backend);
  }
  const backends = Array.from(backendSet);
  const latencyMsAvg = {};
  const hitRate = {};
  const resultCountAvg = {};
  const memoryRssAvgMb = {};
  const buildMsAvg = {};
  for (const backend of backends) {
    const latencies = valid.map((entry) => entry.summary?.latencyMsAvg?.[backend]).filter(Number.isFinite);
    const hits = valid.map((entry) => entry.summary?.hitRate?.[backend]).filter(Number.isFinite);
    const results = valid.map((entry) => entry.summary?.resultCountAvg?.[backend]).filter(Number.isFinite);
    const mem = valid
      .map((entry) => entry.summary?.memoryRss?.[backend]?.mean)
      .filter(Number.isFinite)
      .map((value) => value / (1024 * 1024));
    if (latencies.length) latencyMsAvg[backend] = latencies.reduce((a, b) => a + b, 0) / latencies.length;
    if (hits.length) hitRate[backend] = hits.reduce((a, b) => a + b, 0) / hits.length;
    if (results.length) resultCountAvg[backend] = results.reduce((a, b) => a + b, 0) / results.length;
    if (mem.length) memoryRssAvgMb[backend] = mem.reduce((a, b) => a + b, 0) / mem.length;
  }
  for (const entry of valid) {
    const build = entry.summary?.buildMs;
    if (!build) continue;
    for (const [key, value] of Object.entries(build)) {
      if (!Number.isFinite(value)) continue;
      if (!buildMsAvg[key]) buildMsAvg[key] = [];
      buildMsAvg[key].push(value);
    }
  }
  const buildMs = Object.fromEntries(
    Object.entries(buildMsAvg).map(([key, values]) => [
      key,
      values.reduce((a, b) => a + b, 0) / values.length
    ])
  );
  return {
    backends,
    latencyMsAvg,
    hitRate,
    resultCountAvg,
    memoryRssAvgMb,
    buildMs: Object.keys(buildMs).length ? buildMs : null
  };
}

function printSummary(label, summary, count) {
  if (!summary || quietMode) return;
  console.log(`\n${label} summary (${count} repos)`);
  for (const backend of summary.backends) {
    const latency = summary.latencyMsAvg?.[backend];
    const hit = summary.hitRate?.[backend];
    const results = summary.resultCountAvg?.[backend];
    const mem = summary.memoryRssAvgMb?.[backend];
    const latencyText = Number.isFinite(latency) ? `${latency.toFixed(1)}ms` : 'n/a';
    const hitText = Number.isFinite(hit) ? `${(hit * 100).toFixed(1)}%` : 'n/a';
    const resultText = Number.isFinite(results) ? results.toFixed(1) : 'n/a';
    const memText = Number.isFinite(mem) ? `${mem.toFixed(1)} MB` : 'n/a';
    console.log(`- ${backend} avg ${latencyText} | hit ${hitText} | avg hits ${resultText} | rss ${memText}`);
  }
  if (summary.buildMs) {
    for (const [key, value] of Object.entries(summary.buildMs)) {
      if (!Number.isFinite(value)) continue;
      console.log(`- build ${key} avg ${(value / 1000).toFixed(1)}s`);
    }
  }
}

const config = loadConfig();
const languageFilter = parseList(argv.languages || argv.language).map((entry) => entry.toLowerCase());
const tierFilter = parseList(argv.tier).map((entry) => entry.toLowerCase());
const repoFilter = parseList(argv.only || argv.repos).map((entry) => entry.toLowerCase());

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

if (cloneEnabled && !dryRun) {
  ensureLongPathsSupport();
  cloneTool = resolveCloneTool();
  if (!quietMode) console.log(`Clone tool: ${cloneTool.label}`);
}
await fsPromises.mkdir(reposRoot, { recursive: true });
await fsPromises.mkdir(resultsRoot, { recursive: true });
await fsPromises.mkdir(cacheRoot, { recursive: true });
initLog();
process.on('exit', (code) => {
  logExit('exit', code);
  if (logStream) logStream.end();
});
process.on('SIGINT', () => {
  writeLogSync('[signal] SIGINT received');
  if (activeChild) {
    writeLogSync(`[signal] terminating ${activeLabel}`);
    killProcessTree(activeChild.pid);
  }
  logExit('SIGINT', 130);
  process.exit(130);
});
process.on('SIGTERM', () => {
  writeLogSync('[signal] SIGTERM received');
  if (activeChild) {
    writeLogSync(`[signal] terminating ${activeLabel}`);
    killProcessTree(activeChild.pid);
  }
  logExit('SIGTERM', 143);
  process.exit(143);
});
process.on('uncaughtException', (err) => {
  writeLogSync(`[error] uncaughtException: ${err?.stack || err}`);
  logExit('uncaughtException', 1);
  process.exit(1);
});
process.on('unhandledRejection', (err) => {
  writeLogSync(`[error] unhandledRejection: ${err?.stack || err}`);
  logExit('unhandledRejection', 1);
  process.exit(1);
});
writeLog(`Clone tool: ${cloneTool ? cloneTool.label : 'disabled'}`);

const benchScript = path.join(scriptRoot, 'tests', 'bench.js');
const results = [];
const groupedResults = new Map();
const startTime = Date.now();
let completed = 0;

updateMetrics('Metrics: pending');
updateProgress(`Progress: 0/${tasks.length} | elapsed ${formatDuration(0)}`);

for (const task of tasks) {
  const repoPath = resolveRepoDir(task.repo, task.language);
  await fsPromises.mkdir(path.dirname(repoPath), { recursive: true });
  const repoLabel = `${task.language}/${task.repo}`;
  const phaseLabel = `repo ${repoLabel} (${task.tier})`;
  currentRepoLabel = repoLabel;
  resetBuildProgress(repoLabel);

  if (!fs.existsSync(repoPath)) {
    if (!cloneEnabled && !dryRun) {
      console.error(`Missing repo ${task.repo} at ${repoPath}. Re-run with --clone.`);
      process.exit(1);
    }
    updateProgress(`Progress: ${completed}/${tasks.length} | cloning ${phaseLabel} | elapsed ${formatDuration(Date.now() - startTime)}`);
    if (!dryRun && cloneEnabled && cloneTool) {
      const args = cloneTool.buildArgs(task.repo, repoPath);
      await runProcess(`clone ${task.repo}`, cloneTool.label, args, {
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }
      });
    }
  }

  const outDir = path.join(resultsRoot, task.language);
  const outFile = path.join(outDir, `${task.repo.replace('/', '__')}.json`);
  await fsPromises.mkdir(outDir, { recursive: true });

  const repoCacheRoot = resolveRepoCache(repoPath);
  const missingIndex = needsIndexArtifacts(repoCacheRoot);
  const missingSqlite = wantsSqlite && needsSqliteArtifacts(repoCacheRoot);
  let autoBuildIndex = false;
  let autoBuildSqlite = false;
  const buildIndexRequested = argv.build || argv['build-index'];
  const buildSqliteRequested = argv.build || argv['build-sqlite'];
  if (buildSqliteRequested && !buildIndexRequested && missingIndex) {
    autoBuildIndex = true;
    appendLog('[auto-build] sqlite build requires index artifacts; enabling build-index.');
  }
  if (!argv.build && !argv['build-index'] && !argv['build-sqlite']) {
    if (missingIndex) autoBuildIndex = true;
    if (missingSqlite) autoBuildSqlite = true;
    if (autoBuildIndex || autoBuildSqlite) {
      appendLog(
        `[auto-build] missing artifacts${autoBuildIndex ? ' index' : ''}${autoBuildSqlite ? ' sqlite' : ''}; enabling build.`
      );
    }
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
  if (argv.build) {
    benchArgs.push('--build');
  } else {
    if (argv['build-index'] || autoBuildIndex) benchArgs.push('--build-index');
    if (argv['build-sqlite'] || autoBuildSqlite) benchArgs.push('--build-sqlite');
  }
  if (argv.incremental) benchArgs.push('--incremental');
  if (argv['stub-embeddings']) benchArgs.push('--stub-embeddings');
  if (argv.ann) benchArgs.push('--ann');
  if (argv['no-ann']) benchArgs.push('--no-ann');
  if (argv.backend) benchArgs.push('--backend', String(argv.backend));
  if (argv.top) benchArgs.push('--top', String(argv.top));
  if (argv.limit) benchArgs.push('--limit', String(argv.limit));
  if (argv['bm25-k1']) benchArgs.push('--bm25-k1', String(argv['bm25-k1']));
  if (argv['bm25-b']) benchArgs.push('--bm25-b', String(argv['bm25-b']));
  if (argv['fts-profile']) benchArgs.push('--fts-profile', String(argv['fts-profile']));
  if (argv['fts-weights']) benchArgs.push('--fts-weights', String(argv['fts-weights']));

  updateProgress(`Progress: ${completed}/${tasks.length} | bench ${phaseLabel} | elapsed ${formatDuration(Date.now() - startTime)}`);

  let summary = null;
  if (dryRun) {
    appendLog(`[dry-run] node ${benchArgs.join(' ')}`);
  } else {
    await runProcess(`bench ${repoLabel}`, process.execPath, benchArgs, {
      cwd: scriptRoot,
      env: {
        ...baseEnv,
        PAIROFCLEATS_CACHE_ROOT: cacheRoot,
        PAIROFCLEATS_PROGRESS_FILES: '1'
      }
    });
    try {
      const raw = await fsPromises.readFile(outFile, 'utf8');
      summary = JSON.parse(raw).summary || null;
    } catch (err) {
      console.error(`Failed to read bench report ${outFile}`);
      if (err && err.message) console.error(err.message);
      process.exit(1);
    }
  }

  completed += 1;
  updateProgress(`Progress: ${completed}/${tasks.length} | finished ${phaseLabel} | elapsed ${formatDuration(Date.now() - startTime)}`);
  updateMetrics(formatMetricSummary(summary));

  const entry = { ...task, repoPath, outFile, summary };
  results.push(entry);
  if (!groupedResults.has(task.language)) groupedResults.set(task.language, []);
  groupedResults.get(task.language).push(entry);

}

const groupedSummary = {};
for (const [language, items] of groupedResults.entries()) {
  groupedSummary[language] = {
    label: config[language]?.label || language,
    count: items.length,
    summary: summarizeResults(items)
  };
}
const overallSummary = summarizeResults(results);

if (!quietMode) {
  if (interactive) {
    renderStatus();
    process.stdout.write('\n');
  }
  console.log('\nGrouped summary');
  for (const [language, payload] of Object.entries(groupedSummary)) {
    if (!payload.summary) continue;
    printSummary(payload.label, payload.summary, payload.count);
  }
  printSummary('Overall', overallSummary, results.length);
}

const output = {
  generatedAt: new Date().toISOString(),
  config: configPath,
  cacheRoot,
  resultsRoot,
  tasks: results,
  groupedSummary,
  overallSummary
};

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
