#!/usr/bin/env node
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import readline from 'node:readline';
import { execa, execaSync } from 'execa';
import { createCli } from '../src/shared/cli.js';
import { fileURLToPath } from 'node:url';
import { getRepoCacheRoot, getRuntimeConfig, loadUserConfig, resolveNodeOptions } from './dict-utils.js';
import { buildIgnoreMatcher } from '../src/indexer/build/ignore.js';
import { discoverFilesForModes } from '../src/indexer/build/discover.js';
import { toPosix } from '../src/shared/files.js';

const argv = createCli({
  scriptName: 'bench-language',
  options: {
    json: { type: 'boolean', default: false },
    list: { type: 'boolean', default: false },
    clone: { type: 'boolean', default: true },
    'no-clone': { type: 'boolean', default: false },
    build: { type: 'boolean', default: false },
    'build-index': { type: 'boolean', default: false },
    'build-sqlite': { type: 'boolean', default: false },
    incremental: { type: 'boolean', default: false },
    'benchmark-profile': { type: 'boolean', default: true },
    ann: { type: 'boolean' },
    'no-ann': { type: 'boolean' },
    'stub-embeddings': { type: 'boolean', default: false },
    'dry-run': { type: 'boolean', default: false },
    'cache-run': { type: 'boolean', default: false },
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
    queries: { type: 'string' },
    backend: { type: 'string' },
    out: { type: 'string' },
    top: { type: 'number' },
    limit: { type: 'number' },
    'bm25-k1': { type: 'number' },
    'bm25-b': { type: 'number' },
    'fts-profile': { type: 'string' },
    'fts-weights': { type: 'string' },
    'log-lines': { type: 'number' },
    'heap-mb': { type: 'number' },
    threads: { type: 'number' },
    'lock-mode': { type: 'string' },
    'lock-wait-ms': { type: 'number' },
    'lock-stale-ms': { type: 'number' }
  }
}).parse();

const scriptRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const configPath = path.resolve(argv.config || path.join(scriptRoot, 'benchmarks', 'repos.json'));
const reposRoot = path.resolve(argv.root || path.join(scriptRoot, 'benchmarks', 'repos'));
const cacheRootBase = path.resolve(argv['cache-root'] || path.join(scriptRoot, 'benchmarks', 'cache'));
const cacheSuffixRaw = typeof argv['cache-suffix'] === 'string' ? argv['cache-suffix'].trim() : '';
const cacheRun = argv['cache-run'] === true;
const cacheSuffix = cacheSuffixRaw || (cacheRun ? buildRunSuffix() : '');
const cacheRoot = cacheSuffix ? path.resolve(cacheRootBase, cacheSuffix) : cacheRootBase;
const resultsRoot = path.resolve(argv.results || path.join(scriptRoot, 'benchmarks', 'results'));
const logPath = path.resolve(argv.log || path.join(resultsRoot, 'bench-language.log'));
const baseEnv = { ...process.env };

const cloneEnabled = argv['no-clone'] ? false : argv.clone !== false;
const dryRun = argv['dry-run'] === true;
const quietMode = argv.json === true;
const interactive = !quietMode && process.stdout.isTTY;

const logLineArg = Number.parseInt(argv['log-lines'], 10);
const logWindowSize = Number.isFinite(logLineArg)
  ? Math.max(3, Math.min(50, logLineArg))
  : 20;
const logHistorySize = 50;
const logLines = Array(logWindowSize).fill('');
const logHistory = [];
let metricsLine = '';
let progressLine = '';
let fileProgressLine = '';
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
  label: '',
  mode: null,
  lineTotals: { code: 0, prose: 0 },
  linesProcessed: { code: 0, prose: 0 },
  linesByFile: { code: new Map(), prose: new Map() },
  filesSeen: { code: new Set(), prose: new Set() },
  currentFile: null,
  currentLine: 0,
  currentLineTotal: 0
};
const buildProgressRegex = /^\s*(Files|Imports)\s+(\d+)\/(\d+)\s+\((\d+(?:\.\d+)?)%\)/i;
const buildFileRegex = /^\s*Files\s+\d+\/\d+\s+\(\d+(?:\.\d+)?%\)\s+File\s+\d+\/\d+\s+(.+)$/i;
const buildScanRegex = /Scanning\s+(code|prose)/i;
const buildLineRegex = /^\s*Line\s+(\d+)\s*\/\s*(\d+)/i;
const statusLines = logWindowSize + 3;
const cacheConfig = { cache: { root: cacheRoot } };
const benchmarkProfileEnabled = argv['benchmark-profile'] !== false;
const lockMode = normalizeLockMode(
  argv['lock-mode']
  || ((argv.build || argv['build-index'] || argv['build-sqlite']) ? 'stale-clear' : '')
);
const lockWaitMs = parseMs(argv['lock-wait-ms'], 5 * 60 * 1000);
const lockStaleMs = parseMs(argv['lock-stale-ms'], 30 * 60 * 1000);
const backendList = resolveBackendList(argv.backend);
const wantsSqlite = backendList.includes('sqlite') || backendList.includes('sqlite-fts') || backendList.includes('fts');
const heapArgRaw = argv['heap-mb'];
const heapArg = Number.isFinite(Number(heapArgRaw)) ? Math.floor(Number(heapArgRaw)) : null;
const heapRecommendation = getRecommendedHeapMb();
let heapLogged = false;

function parseList(value) {
  if (!value) return [];
  return String(value)
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function buildRunSuffix() {
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
}

function parseMs(value, fallback) {
  const parsed = Number(value);
  if (Number.isFinite(parsed) && parsed >= 0) return Math.floor(parsed);
  return fallback;
}

function normalizeLockMode(value) {
  if (!value) return 'fail-fast';
  const raw = String(value).trim().toLowerCase();
  if (raw === 'wait' || raw === 'retry') return 'wait';
  if (raw === 'stale-clear' || raw === 'stale') return 'stale-clear';
  return 'fail-fast';
}

function isProcessAlive(pid) {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err?.code === 'EPERM';
  }
}

async function readLockInfo(lockPath) {
  try {
    const raw = await fsPromises.readFile(lockPath, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

async function getLockAgeMs(lockPath, info) {
  if (info?.startedAt) {
    const started = Date.parse(info.startedAt);
    if (Number.isFinite(started)) return Math.max(0, Date.now() - started);
  }
  try {
    const stat = await fsPromises.stat(lockPath);
    return Math.max(0, Date.now() - stat.mtimeMs);
  } catch {
    return null;
  }
}

function formatLockDetail(detail) {
  if (!detail) return '';
  const parts = [];
  if (Number.isFinite(detail.ageMs)) {
    parts.push(`age ${formatDuration(detail.ageMs)}`);
  }
  if (Number.isFinite(detail.pid)) {
    parts.push(`pid ${detail.pid}`);
  }
  return parts.length ? `(${parts.join(', ')})` : '';
}

async function checkIndexLock(repoCacheRoot, repoLabel) {
  const lockPath = path.join(repoCacheRoot, 'locks', 'index.lock');
  if (!fs.existsSync(lockPath)) return { ok: true };
  const readDetail = async () => {
    const info = await readLockInfo(lockPath);
    const ageMs = await getLockAgeMs(lockPath, info);
    const pid = Number.isFinite(Number(info?.pid)) ? Number(info.pid) : null;
    const alive = pid ? isProcessAlive(pid) : null;
    const detail = { lockPath, ageMs, pid, alive };
    const isStale = (Number.isFinite(ageMs) && ageMs > lockStaleMs) || (pid && !alive);
    return { detail, isStale };
  };

  const clearIfStale = async (detail) => {
    try {
      await fsPromises.rm(lockPath, { force: true });
      appendLog(`[lock] cleared stale lock for ${repoLabel} ${formatLockDetail(detail)}`);
      return true;
    } catch (err) {
      appendLog(`[lock] failed to clear stale lock for ${repoLabel}: ${err?.message || err}`);
      return false;
    }
  };

  const initial = await readDetail();
  if (initial.isStale) {
    const cleared = await clearIfStale(initial.detail);
    if (cleared) return { ok: true, cleared: true, detail: initial.detail };
  }

  if (lockMode === 'wait') {
    const deadline = Date.now() + lockWaitMs;
    while (Date.now() < deadline) {
      if (!fs.existsSync(lockPath)) return { ok: true };
      const current = await readDetail();
      if (current.isStale) {
        const cleared = await clearIfStale(current.detail);
        if (cleared) return { ok: true, cleared: true, detail: current.detail };
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  return { ok: false, detail: initial.detail };
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
  try {
    const result = execaSync(cmd, args, { encoding: 'utf8', reject: false });
    return result.exitCode === 0;
  } catch {
    return false;
  }
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
    try {
      execaSync('git', ['config', '--global', 'core.longpaths', 'true'], { stdio: 'ignore', reject: false });
    } catch {}
  }
  let regResult;
  try {
    regResult = execaSync(
      'reg',
      ['query', 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\FileSystem', '/v', 'LongPathsEnabled'],
      { encoding: 'utf8', reject: false }
    );
  } catch {
    regResult = null;
  }
  if (!regResult || regResult.exitCode !== 0) {
    console.warn('Warning: Unable to confirm Windows long path setting. Enable LongPathsEnabled=1 if clones fail.');
    return;
  }
  const match = String(regResult.stdout || '').match(/LongPathsEnabled\\s+REG_DWORD\\s+0x([0-9a-f]+)/i);
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
      execaSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', reject: false });
      return;
    }
    process.kill(pid, 'SIGTERM');
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

function truncateDisplay(line) {
  if (!line) return '';
  const width = Number.isFinite(process.stdout.columns) ? process.stdout.columns : 120;
  if (line.length <= width) return line;
  return `${line.slice(0, Math.max(0, width - 1))}…`;
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
  lines.push(fileProgressLine);
  lines.push(progressLine);
  for (const line of lines) {
    readline.clearLine(process.stdout, 0);
    process.stdout.write(truncateDisplay(line || ''));
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

function updateFileProgressLine() {
  const file = buildProgressState.currentFile;
  const current = buildProgressState.currentLine;
  const total = buildProgressState.currentLineTotal;
  if (!file) {
    fileProgressLine = '';
    renderStatus();
    return;
  }
  const lineSegment = total > 0 ? ` [${current}/${total}]` : '';
  fileProgressLine = `File: ${file}${lineSegment}`;
  renderStatus();
}

function appendLog(line) {
  const cleaned = line.replace(/\r/g, '').trimEnd();
  if (!cleaned) return;
  if (buildLineRegex.test(cleaned)) {
    handleBuildLineProgress(cleaned);
    handleBuildProgress(cleaned);
    return;
  }
  pushHistory(cleaned);
  writeLog(cleaned);
  handleBuildMode(cleaned);
  handleBuildFileLine(cleaned);
  handleBuildLineProgress(cleaned);
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
  buildProgressState.mode = null;
  buildProgressState.lineTotals = { code: 0, prose: 0 };
  buildProgressState.linesByFile = { code: new Map(), prose: new Map() };
  buildProgressState.linesProcessed = { code: 0, prose: 0 };
  buildProgressState.filesSeen = { code: new Set(), prose: new Set() };
  buildProgressState.currentFile = null;
  buildProgressState.currentLine = 0;
  buildProgressState.currentLineTotal = 0;
  updateFileProgressLine();
}

function handleBuildMode(line) {
  const match = buildScanRegex.exec(line);
  if (!match) return;
  const mode = match[1].toLowerCase();
  if (mode === 'code' || mode === 'prose') {
    buildProgressState.mode = mode;
  }
}

function handleBuildFileLine(line) {
  const match = buildFileRegex.exec(line);
  if (!match) return;
  const mode = buildProgressState.mode;
  if (!mode || !buildProgressState.linesByFile[mode]) return;
  const rawPath = match[1].trim();
  if (!rawPath) return;
  const rel = toPosix(rawPath);
  buildProgressState.currentFile = rel;
  buildProgressState.currentLineTotal = buildProgressState.linesByFile[mode].get(rel) || 0;
  buildProgressState.currentLine = 0;
  updateFileProgressLine();
  const seen = buildProgressState.filesSeen[mode];
  if (seen.has(rel)) return;
  const lineCount = buildProgressState.linesByFile[mode].get(rel);
  if (!Number.isFinite(lineCount)) return;
  seen.add(rel);
  buildProgressState.linesProcessed[mode] += lineCount;
}

function handleBuildLineProgress(line) {
  const match = buildLineRegex.exec(line);
  if (!match) return;
  const current = Number.parseInt(match[1], 10);
  const total = Number.parseInt(match[2], 10);
  if (!Number.isFinite(current) || !Number.isFinite(total) || total <= 0) return;
  buildProgressState.currentLine = current;
  buildProgressState.currentLineTotal = total;
  updateFileProgressLine();
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
  let etaMs = rate > 0 && remaining > 0 ? (remaining / rate) * 1000 : 0;
  let lineRate = 0;
  let remainingLines = 0;
  let totalLines = 0;
  if (step.toLowerCase() === 'files' && buildProgressState.mode) {
    const mode = buildProgressState.mode;
    totalLines = buildProgressState.lineTotals[mode] || 0;
    const processedLines = buildProgressState.linesProcessed[mode] || 0;
    if (elapsedMs > 0 && processedLines > 0) {
      lineRate = processedLines / (elapsedMs / 1000);
    }
    remainingLines = totalLines - processedLines;
    if (lineRate > 0 && remainingLines > 0) {
      etaMs = (remainingLines / lineRate) * 1000;
    }
  }
  const pctDelta = pct - buildProgressState.lastPct;
  const countDelta = count - buildProgressState.lastCount;
  const shouldLog =
    count === total ||
    now - buildProgressState.lastLoggedMs >= 5000 ||
    pctDelta >= 1 ||
    countDelta >= 500;
  if (shouldLog) {
    const rateText = rate > 0 ? `${rate.toFixed(1)}/s` : 'n/a';
    const lineRateText = lineRate > 0 ? `${Math.round(lineRate).toLocaleString()}/s` : null;
    const etaText = etaMs > 0 ? formatDuration(etaMs) : 'n/a';
    const labelText = label ? ` ${label}` : '';
    const lineRateSegment = lineRateText ? ` | lines ${lineRateText}` : '';
    const totalLinesText = totalLines > 0 ? `${formatLoc(totalLines)}` : null;
    const processedLinesText = totalLines > 0
      ? `${formatLoc(totalLines - remainingLines)}/${totalLinesText}`
      : null;
    const linesElapsedSegment = processedLinesText ? ` (${processedLinesText})` : '';
    const remainingLinesText = remainingLines > 0 ? formatLoc(remainingLines) : null;
    const etaSegment = remainingLinesText ? `${etaText} (${remainingLinesText} rem)` : etaText;
    const currentLineSegment = (buildProgressState.currentLineTotal > 0)
      ? ` [${buildProgressState.currentLine}/${buildProgressState.currentLineTotal}]`
      : '';
    const message = `Indexing${labelText} ${step} ${count}/${total} (${pct.toFixed(
      1
    )}%)${currentLineSegment} | rate ${rateText}${lineRateSegment} | elapsed ${formatDuration(
      elapsedMs
    )}${linesElapsedSegment} | eta ${etaSegment}`;
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

function formatGb(mb) {
  return `${(mb / 1024).toFixed(1)} GB`;
}

function formatLoc(value) {
  if (!Number.isFinite(value)) return 'n/a';
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return `${Math.floor(value)}`;
}

async function countLines(filePath) {
  try {
    const buf = await fsPromises.readFile(filePath);
    if (!buf || !buf.length) return 0;
    let count = 0;
    for (const byte of buf) {
      if (byte === 10) count += 1;
    }
    return count + 1;
  } catch {
    return 0;
  }
}

function resolveMaxFileBytes(userConfig) {
  const raw = userConfig?.indexing?.maxFileBytes;
  const parsed = Number(raw);
  if (raw === false || raw === 0) return null;
  if (Number.isFinite(parsed) && parsed > 0) return Math.floor(parsed);
  return 5 * 1024 * 1024;
}

async function buildLineStats(repoPath, userConfig) {
  const modes = ['code', 'prose'];
  const { ignoreMatcher } = await buildIgnoreMatcher({ root: repoPath, userConfig });
  const skippedByMode = { code: [], prose: [] };
  const maxFileBytes = resolveMaxFileBytes(userConfig);
  const entriesByMode = await discoverFilesForModes({
    root: repoPath,
    modes,
    ignoreMatcher,
    skippedByMode,
    maxFileBytes
  });
  const linesByFile = { code: new Map(), prose: new Map() };
  const totals = { code: 0, prose: 0 };
  const concurrency = 8;
  for (const mode of modes) {
    const entries = entriesByMode[mode] || [];
    for (let i = 0; i < entries.length; i += concurrency) {
      const batch = entries.slice(i, i + concurrency);
      const counts = await Promise.all(batch.map(async (entry) => {
        const lines = await countLines(entry.abs);
        return { rel: toPosix(entry.rel), lines };
      }));
      for (const item of counts) {
        linesByFile[mode].set(item.rel, item.lines);
        totals[mode] += item.lines;
      }
    }
  }
  return { totals, linesByFile };
}

function stripMaxOldSpaceFlag(options) {
  if (!options) return '';
  return options
    .replace(/--max-old-space-size=\d+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function getRecommendedHeapMb() {
  const totalMb = Math.floor(os.totalmem() / (1024 * 1024));
  const recommended = Math.max(4096, Math.floor(totalMb * 0.75));
  const rounded = Math.floor(recommended / 256) * 256;
  return {
    totalMb,
    recommendedMb: Math.max(4096, rounded)
  };
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
  const spawnOptions = {
    ...options,
    stdio: ['ignore', 'pipe', 'pipe'],
    reject: false
  };
  const child = execa(cmd, args, spawnOptions);
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
  child.stdout?.on('data', (chunk) => handleChunk(chunk, 'stdout'));
  child.stderr?.on('data', (chunk) => handleChunk(chunk, 'stderr'));
  try {
    const result = await child;
    if (carry.stdout) appendLog(carry.stdout);
    if (carry.stderr) appendLog(carry.stderr);
    const code = result.exitCode;
    writeLog(`[finish] ${label} code=${code}`);
    clearActiveChild(child);
    if (code === 0) {
      return { ok: true };
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
  } catch (err) {
    const message = err?.shortMessage || err?.message || err;
    writeLog(`[error] ${label} spawn failed: ${message}`);
    clearActiveChild(child);
    console.error(`Failed: ${label}`);
    if (logHistory.length) {
      console.error('Last log lines:');
      logHistory.slice(-10).forEach((line) => console.error(`- ${line}`));
      logHistory.slice(-10).forEach((line) => writeLog(`[error] ${line}`));
    }
    logExit('failure', err?.exitCode ?? 1);
    process.exit(err?.exitCode ?? 1);
  }
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
    && !process.env.PAIROFCLEATS_MAX_OLD_SPACE_MB
    && !hasHeapFlag
  ) {
    heapOverride = heapRecommendation.recommendedMb;
    if (!heapLogged) {
      appendLog(
        `[auto-heap] Using ${formatGb(heapOverride)} (${heapOverride} MB) for Node heap. ` +
          'Override with --heap-mb or PAIROFCLEATS_MAX_OLD_SPACE_MB.'
      );
      heapLogged = true;
    }
  }
  const runtimeConfigForRun = heapOverride
    ? { ...repoRuntimeConfig, maxOldSpaceMb: heapOverride }
    : repoRuntimeConfig;
  const repoNodeOptions = resolveNodeOptions(runtimeConfigForRun, baseNodeOptions);
  const repoEnvBase = repoNodeOptions
    ? { ...baseEnv, NODE_OPTIONS: repoNodeOptions }
    : { ...baseEnv };
  if (heapOverride) {
    repoEnvBase.PAIROFCLEATS_MAX_OLD_SPACE_MB = String(heapOverride);
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

  const shouldBuildIndex = argv.build || argv['build-index'] || autoBuildIndex;
  if (shouldBuildIndex && !dryRun) {
    try {
      appendLog(`[metrics] Collecting line counts for ${repoLabel}...`);
      const stats = await buildLineStats(repoPath, repoUserConfig);
      buildProgressState.lineTotals = stats.totals;
      buildProgressState.linesByFile = stats.linesByFile;
      appendLog(
        `[metrics] Line totals: code=${stats.totals.code.toLocaleString()} prose=${stats.totals.prose.toLocaleString()}`
      );
    } catch (err) {
      appendLog(`[metrics] Line counts unavailable: ${err?.message || err}`);
    }
  }

  const lockCheck = await checkIndexLock(repoCacheRoot, repoLabel);
  if (!lockCheck.ok) {
    const detail = formatLockDetail(lockCheck.detail);
    const message = `Skipping ${repoLabel}: index lock held ${detail}`.trim();
    appendLog(`[lock] ${message}`);
    if (!quietMode) console.error(message);
    completed += 1;
    updateProgress(`Progress: ${completed}/${tasks.length} | skipped ${phaseLabel} | elapsed ${formatDuration(Date.now() - startTime)}`);
    updateMetrics('Metrics: skipped (lock)');
    const entry = {
      ...task,
      repoPath,
      outFile,
      summary: null,
      skipped: true,
      skipReason: 'lock',
      lock: lockCheck.detail || null
    };
    results.push(entry);
    if (!groupedResults.has(task.language)) groupedResults.set(task.language, []);
    groupedResults.get(task.language).push(entry);
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
  if (argv.threads) benchArgs.push('--threads', String(argv.threads));
  if (benchmarkProfileEnabled) {
    benchArgs.push('--benchmark-profile');
  } else {
    benchArgs.push('--no-benchmark-profile');
  }

  updateProgress(`Progress: ${completed}/${tasks.length} | bench ${phaseLabel} | elapsed ${formatDuration(Date.now() - startTime)}`);

  let summary = null;
  if (dryRun) {
    appendLog(`[dry-run] node ${benchArgs.join(' ')}`);
  } else {
    await runProcess(`bench ${repoLabel}`, process.execPath, benchArgs, {
      cwd: scriptRoot,
      env: {
        ...repoEnvBase,
        PAIROFCLEATS_CACHE_ROOT: cacheRoot,
        PAIROFCLEATS_BENCH_PROFILE: benchmarkProfileEnabled ? '1' : '0',
        PAIROFCLEATS_PROGRESS_FILES: '1',
        PAIROFCLEATS_PROGRESS_LINES: '1'
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
