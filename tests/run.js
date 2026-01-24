#!/usr/bin/env node
import fsSync from 'node:fs';
import fsPromises from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import yargs from 'yargs/yargs';
import { hideBin } from 'yargs/helpers';
import PQueue from 'p-queue';
import { killProcessTree } from './helpers/kill-tree.js';
import { parse as parseJsonc } from 'jsonc-parser';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TESTS_DIR = path.join(ROOT, 'tests');
const RUN_CONFIG_PATH = path.join(TESTS_DIR, 'run.config.jsonc');
const DEFAULT_TIMEOUT_MS = 30000;
const MAX_OUTPUT_BYTES = 5 * 1024 * 1024;
const SKIP_EXIT_CODE = 77;
const DEFAULT_TIMEOUT_GRACE_MS = 2000;
const ANSI = {
  reset: '\x1b[0m',
  fgGreen: '\x1b[32m',
  fgRed: '\x1b[31m',
  fgYellow: '\x1b[33m',
  fgCyan: '\x1b[36m',
  fgLight: '\x1b[37m',
  fgBlue: '\x1b[34m',
  fgLightBlue: '\x1b[94m',
  fgBrightWhite: '\x1b[97m',
  fgDarkGray: '\x1b[90m',
  fgSoftBlue: '\x1b[38;5;117m',
  fgPink: '\x1b[38;5;213m',
  fgPinkMuted: '\x1b[38;5;176m',
  fgPinkDark: '\x1b[38;5;168m',
  fgDarkGreen: '\x1b[38;5;22m',
  fgOrange: '\x1b[38;5;214m',
  fgDarkOrange: '\x1b[38;5;172m',
  fgBrown: '\x1b[38;5;130m',
  fgBrownDark: '\x1b[38;5;94m',
  bgBlack: '\x1b[40m',
  bgDarkPurple: '\x1b[48;5;18m',
  dim: '\x1b[2m',
  bold: '\x1b[1m'
};
const TIME_LABEL_COLOR = ANSI.fgDarkGray;
const TIME_BRACKET_COLOR = `${ANSI.dim}${ANSI.fgDarkGray}`;

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
const KNOWN_LANES = new Set(['smoke', 'unit', 'integration', 'services', 'api', 'storage', 'perf', 'ci']);

const LANE_RULES = [
  { lane: 'perf', match: [/^perf\//, /^bench/, /-perf-/, /^kotlin-perf-guard/] },
  { lane: 'smoke', match: [/^smoke(?:-|$)/, /^harness\/smoke\//] },
  { lane: 'api', match: [/^services\/api\//] },
  { lane: 'services', match: [/^services\//, /^api-server/, /^mcp/, /^indexer-service/, /^service-queue/] },
  { lane: 'storage', match: [/^storage\//, /^sqlite/, /^lmdb/, /^vector-extension/] },
  { lane: 'unit', match: [/^unit\//, /\.unit(\.|$)/, /^harness\//, /^jsonrpc-/, /^json-stream/, /^tokenize-/, /^tokenization-/, /^dict-/, /^cache-lru/, /^build-runtime\//, /^test-runner$/] }
];

const TAG_RULES = [
  { tag: 'perf', match: /^perf\// },
  { tag: 'services', match: /^services\// },
  { tag: 'api', match: /^services\/api\// },
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
  { tag: 'tooling', match: /tooling|lsp|type-inference/ },
  { tag: 'context-pack', match: /^tooling\/triage\/context-pack/ },
  { tag: 'summary-report', match: /^summary-report/ },
  { tag: 'search-tie-order', match: /^search-tie-order/ },
  { tag: 'search-explain', match: /^search-explain/ },
  { tag: 'search-rrf', match: /^search-rrf/ },
  { tag: 'records-index-and-search', match: /^tooling\/triage\/records-index-and-search\.test$/ },
  { tag: 'tool-build-index-progress', match: /^services\/mcp\/tool-build-index-progress\.test$/ },
  { tag: 'file-selector-case', match: /^retrieval\/filters\/file-and-token\/file-selector-case\.test$/ },
  { tag: 'type-signature-decorator', match: /^retrieval\/filters\/type-signature-decorator\.test$/ },
  { tag: 'parity', match: /parity/ },
  { tag: 'lancedb-ann', match: /^lancedb-ann/ },
  { tag: 'incremental-tokenization-cache', match: /^incremental-tokenization-cache/ },
  { tag: 'incremental-cache-signature', match: /^incremental-cache-signature/ },
  { tag: 'hnsw-ann', match: /^hnsw-ann/ },
  { tag: 'fixture-parity', match: /^fixture-parity/ },
  { tag: 'fixture-eval', match: /^fixture-eval/ },
  { tag: 'artifact-size-guardrails', match: /^artifact-size-guardrails/ },
  { tag: 'churn-filter', match: /^churn-filter/ },
  { tag: 'comment-join', match: /^comment-join/ },
  { tag: 'extracted-prose', match: /^extracted-prose/ },
  { tag: 'timeout-target', match: /^harness\/timeout-target/ },
  { tag: 'python-metadata', match: /^lang\/fixtures-sample\/python-metadata\.test$/ },
  { tag: 'query-cache', match: /^query-cache(?:-|$)/ },
  { tag: 'shard-merge', match: /^shard-merge/ },
  { tag: 'destructive', match: /^uninstall/ }
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
  const hasExcludedTag = (test) => tagExclude.some((tag) => test.tags.includes(tag));
  const skipped = tagExclude.length
    ? filtered.filter((test) => hasExcludedTag(test)).map((test) => ({
      ...test,
      presetStatus: 'skipped',
      skipReason: `excluded tag: ${test.tags.filter((tag) => tagExclude.includes(tag)).join(', ')}`
    }))
    : [];
  const selected = tagExclude.length
    ? filtered.filter((test) => !hasExcludedTag(test))
    : filtered;
  return { selected, skipped };
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

const formatDurationCell = (ms) => {
  const text = formatDuration(ms);
  const width = 6;
  if (text.length >= width) return text;
  return `${' '.repeat(width - text.length)}${text}`;
};

const formatLabel = (label, { useColor = false, mode = 'plain' } = {}) => {
  if (!useColor) return label;
  if (mode === 'pass') return `${ANSI.bgBlack}${ANSI.fgGreen}${label}${ANSI.reset}`;
  if (mode === 'fail') return `${ANSI.bgBlack}${ANSI.fgRed}${label}${ANSI.reset}`;
  if (mode === 'warn') return `${ANSI.fgYellow}${label}${ANSI.reset}`;
  if (mode === 'log') return `${ANSI.bgBlack}${ANSI.fgLightBlue}${label}${ANSI.reset}`;
  if (mode === 'skip') return `${ANSI.bgBlack}${ANSI.fgPink}${label}${ANSI.reset}`;
  return label;
};

const extractOutputLines = (text) => {
  if (!text) return [];
  const normalized = text.replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  return lines.map((line) => line.trimEnd()).filter((line) => line.trim() !== '');
};

const formatOutputLines = (lines, { useColor = false, columns = 0 } = {}) => {
  if (!lines.length) return '';
  const indented = lines.map((line) => `  ${line}`);
  const colored = indented.map((line) => {
    if (!useColor) return line;
    const tinted = `${ANSI.fgSoftBlue}${line}${ANSI.reset}`;
    return applyLineBackground(tinted, { useColor, columns, bg: ANSI.bgDarkPurple });
  }).join('\n');
  const output = useColor ? colored : indented.join('\n');
  return `${output}\n`;
};

const selectOutputLines = ({ stdout, stderr, mode }) => {
  const lines = [...extractOutputLines(stdout), ...extractOutputLines(stderr)];
  if (!lines.length) return [];
  if (mode === 'success') return [];
  if (mode === 'failure') {
    const matches = lines.filter((line) => /\[error\]|Failed\b/i.test(line));
    return matches.length ? matches : lines.slice(-3);
  }
  return lines.slice(-3);
};

const formatCapturedOutput = ({ stdout, stderr, mode, useColor = false, columns = 0 } = {}) => {
  const lines = selectOutputLines({ stdout, stderr, mode });
  return formatOutputLines(lines, { useColor, columns });
};

const formatLogPath = (value) => {
  if (!value) return '';
  const relative = path.isAbsolute(value) ? path.relative(ROOT, value) : value;
  const normalized = String(relative || '').replace(/\\/g, '/');
  if (!normalized) return './';
  if (normalized.startsWith('./') || normalized.startsWith('../')) return normalized;
  return `./${normalized}`;
};

const formatLogLine = (value, { useColor = false } = {}) => {
  const label = formatLabel('LOG:', { useColor, mode: 'log' });
  const resolved = formatLogPath(value);
  const pad = ' '.repeat(10);
  if (!useColor) return `${label}${pad}${resolved}`;
  return `${label}${pad}${ANSI.fgBrightWhite}${resolved}${ANSI.reset}`;
};

const formatSummaryLogLine = (value, { useColor = false } = {}) => {
  const label = formatLabel('LOG:', { useColor, mode: 'log' });
  const resolved = formatLogPath(value);
  if (!useColor) return `${label} ${resolved}`;
  return `${label} ${ANSI.fgBrightWhite}${resolved}${ANSI.reset}`;
};

const formatSkipReason = (reason, { useColor = false } = {}) => {
  if (!reason) return '';
  const prefix = 'excluded tag:';
  const trimmed = String(reason).trim();
  if (!useColor) return ` (${trimmed})`;
  if (!trimmed.toLowerCase().startsWith(prefix)) {
    return `${ANSI.fgDarkGray} (${trimmed})${ANSI.reset}`;
  }
  const tagsPart = trimmed.slice(prefix.length).trim();
  return `${ANSI.fgDarkGray} (${prefix} ${ANSI.reset}${ANSI.fgPinkDark}${tagsPart}${ANSI.reset}${ANSI.fgDarkGray})${ANSI.reset}`;
};

const stripAnsi = (text) => String(text).replace(/\x1b\[[0-9;]*m/g, '');

const colorize = (text, color, useColor) => (useColor ? `${color}${text}${ANSI.reset}` : text);

const applyLineBackground = (text, { useColor = false, columns = 0, bg = ANSI.bgBlack } = {}) => {
  if (!useColor) return text;
  const visible = stripAnsi(text).length;
  const width = Number.isFinite(columns) ? columns : 0;
  let padded = text;
  if (width && visible < width) {
    padded = `${text}${' '.repeat(width - visible)}`;
  }
  const withBg = `${bg}${padded}`.replaceAll(ANSI.reset, `${ANSI.reset}${bg}`);
  return `${withBg}${ANSI.reset}`;
};

const padEndRaw = (text, width) => {
  if (text.length >= width) return text;
  return `${text}${' '.repeat(width - text.length)}`;
};

const padEndVisible = (text, width) => {
  const visible = stripAnsi(text).length;
  if (visible >= width) return text;
  return `${text}${' '.repeat(width - visible)}`;
};

const wrapList = (items, maxLen) => {
  const lines = [];
  let current = [];
  let currentLen = 0;
  for (const item of items) {
    const itemText = String(item);
    const addLen = (current.length ? 2 : 0) + itemText.length;
    if (current.length && (currentLen + addLen) > maxLen) {
      lines.push(current);
      current = [itemText];
      currentLen = itemText.length;
      continue;
    }
    current.push(itemText);
    currentLen += addLen;
  }
  if (current.length) lines.push(current);
  return lines;
};

const loadRunConfig = () => {
  try {
    if (!fsSync.existsSync(RUN_CONFIG_PATH)) return {};
    const raw = fsSync.readFileSync(RUN_CONFIG_PATH, 'utf8');
    const parsed = parseJsonc(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
};

const BORDER_PATTERN = '╶╶╴-╴-╶-╶╶╶-=---╶---=--╶--=---=--=-=-=--=---=--╶--=---╶---=-╴╴╴-╴-╶-╶╴╴';

const buildBorder = (length) => {
  if (length <= 0) return '';
  let out = '';
  while (out.length < length) out += BORDER_PATTERN;
  return out.slice(0, length);
};

const colorizeBorder = (border, useColor) => {
  if (!useColor) return border;
  return Array.from(border).map((ch) => {
    const dashLike = ch === '-' || ch === '╶' || ch === '╴';
    const color = dashLike ? `${ANSI.dim}${ANSI.fgDarkGray}` : ANSI.fgDarkGray;
    return `${color}${ch}${ANSI.reset}`;
  }).join('');
};

const formatDurationBadge = (ms, { useColor = false } = {}) => {
  const inner = formatDurationCell(ms);
  const trimmed = inner.trim();
  const unit = trimmed.endsWith('ms') ? 'ms' : 's';
  const numberPart = inner.slice(0, inner.length - unit.length);
  if (!useColor) return `[${inner}]`;
  const bracketColor = TIME_BRACKET_COLOR;
  const suffixColor = TIME_LABEL_COLOR;
  return `${ANSI.bgBlack}${bracketColor}[${ANSI.fgBrightWhite}${numberPart}${suffixColor}${unit}` +
    `${ANSI.reset}${ANSI.bgBlack}${bracketColor}]${ANSI.reset}`;
};

const formatDurationValue = (ms, { useColor = false } = {}) => {
  const text = formatDuration(ms);
  if (!useColor) return text;
  const unit = text.endsWith('ms') ? 'ms' : 's';
  const numberPart = text.slice(0, text.length - unit.length);
  return `${ANSI.fgBrightWhite}${numberPart}${TIME_LABEL_COLOR}${unit}${ANSI.reset}`;
};

const resolveSlowestColor = (ms) => {
  const seconds = Number(ms) / 1000;
  if (!Number.isFinite(seconds) || seconds <= 2) return ANSI.fgGreen;
  if (seconds <= 4) return ANSI.fgDarkGreen;
  if (seconds <= 7) return ANSI.fgYellow;
  if (seconds <= 10) return ANSI.fgOrange;
  if (seconds <= 13) return ANSI.fgDarkOrange;
  if (seconds <= 16) return ANSI.fgBrown;
  if (seconds <= 19.5) return ANSI.fgBrownDark;
  return ANSI.fgRed;
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
  const testEnv = { ...env };
  if (!testEnv.PAIROFCLEATS_TEST_CACHE_SUFFIX) {
    testEnv.PAIROFCLEATS_TEST_CACHE_SUFFIX = sanitizeId(test.id);
  }
  if (!testEnv.PAIROFCLEATS_TEST_PID_FILE && test.id === 'harness/timeout-target') {
    testEnv.PAIROFCLEATS_TEST_PID_FILE = path.join(os.tmpdir(), `pairofcleats-timeout-${process.pid}.json`);
  }
  const child = spawn(process.execPath, args, {
    cwd,
    env: testEnv,
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
  const requestedLanes = splitCsv(argv.lane.length ? argv.lane : ['ci']);
  const lanes = resolveLanes(requestedLanes);
  const lanesList = Array.from(lanes).sort();
  const runConfig = loadRunConfig();
  const tagExclude = splitCsv(argv['exclude-tag']);
  const configExclude = new Set(
    Array.isArray(runConfig.excludeTags) ? runConfig.excludeTags.map((tag) => String(tag)) : []
  );
  const laneConfig = runConfig.lanes && typeof runConfig.lanes === 'object' ? runConfig.lanes : {};
  for (const lane of requestedLanes) {
    const entry = laneConfig[lane];
    if (!entry || typeof entry !== 'object') continue;
    const laneExcludes = Array.isArray(entry.excludeTags)
      ? entry.excludeTags.map((tag) => String(tag))
      : [];
    laneExcludes.forEach((tag) => configExclude.add(tag));
  }
  for (const tag of configExclude) {
    if (!tag || tagInclude.includes(tag) || tagExclude.includes(tag)) continue;
    tagExclude.push(tag);
  }

  const tests = (await discoverTests()).map((test) => {
    const lane = assignLane(test.id);
    return { ...test, lane, tags: buildTags(test.id, lane) };
  });

  const includeMatchers = compileMatchers(includePatterns, 'match');
  const excludeMatchers = compileMatchers(excludePatterns, 'exclude');
  const { selected, skipped } = applyFilters({ tests, lanes, includeMatchers, excludeMatchers, tagInclude, tagExclude });
  let selection = [...selected, ...skipped];

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
  const useColor = !argv.json && consoleStream.isTTY;
  const startedAt = Date.now();
  const headerIndent = '         ';
  const innerPadding = '      ';
  const lineIndent = `${headerIndent}${innerPadding}`;
  const prefix = 'Lanes: ';
  const testsCount = String(selection.length).padStart(4);
  const testsRaw = `Tests: ${testsCount}`;
  const showJobs = jobs > 1;
  const jobsCount = String(jobs).padStart(2);
  const jobsRaw = `Jobs: ${jobsCount}`;
  const rightRaw = showJobs ? `${testsRaw} | ${jobsRaw}` : testsRaw;
  const rightRawWithPipe = `| ${rightRaw}`;
  const maxWidth = Math.max(
    60,
    Math.min((consoleStream.isTTY && consoleStream.columns ? consoleStream.columns : 80) - headerIndent.length, 120)
  );
  const laneMaxLen = Math.max(10, maxWidth - prefix.length - 1 - rightRawWithPipe.length);
  const laneLines = wrapList(lanesList, laneMaxLen);
  const laneLineTexts = laneLines.map((line, idx) => {
    const text = line.join(', ');
    return idx < laneLines.length - 1 ? `${text},` : text;
  });
  const maxLaneLineLen = laneLineTexts.reduce((max, text) => Math.max(max, text.length), 0);
  const leftWidth = prefix.length + maxLaneLineLen;
  const rightPipe = useColor ? `${ANSI.fgLight}|${ANSI.reset}` : '|';

  const lanesLabel = colorize('Lanes:', ANSI.fgLightBlue, useColor);
  const lanesLineColored = laneLines.map((line, idx) => {
    const colored = line.map((lane) => colorize(lane, ANSI.fgLight, useColor)).join(', ');
    return idx < laneLines.length - 1 ? `${colored},` : colored;
  });
  const testsLabel = colorize('Tests:', ANSI.fgGreen, useColor);
  const testsValue = colorize(testsCount, ANSI.fgLight, useColor);
  const jobsLabel = colorize('Jobs:', ANSI.fgOrange, useColor);
  const jobsValue = colorize(jobsCount, ANSI.fgLight, useColor);
  const rightColored = showJobs
    ? `${rightPipe} ${testsLabel} ${testsValue} ${rightPipe} ${jobsLabel} ${jobsValue}`
    : `${rightPipe} ${testsLabel} ${testsValue}`;

  const contentLinesRaw = [];
  const contentLinesColored = [];

  if (laneLineTexts.length) {
    const leftRaw = padEndRaw(`${prefix}${laneLineTexts[0]}`, leftWidth);
    const leftColored = padEndVisible(`${lanesLabel} ${lanesLineColored[0]}`, leftWidth);
    contentLinesRaw.push(`${leftRaw} ${rightRawWithPipe}`);
    contentLinesColored.push(`${leftColored} ${rightColored}`);
    for (let i = 1; i < laneLineTexts.length; i += 1) {
      const leftRawLine = padEndRaw(laneLineTexts[i], maxLaneLineLen);
      const leftColoredLine = padEndVisible(lanesLineColored[i], maxLaneLineLen);
      contentLinesRaw.push(`${' '.repeat(prefix.length)}${leftRawLine}${rightRawWithPipe.slice(0, 1)}`);
      contentLinesColored.push(`${' '.repeat(prefix.length)}${leftColoredLine}${rightPipe}`);
    }
  }

  const contentWidth = contentLinesRaw.reduce((max, line) => Math.max(max, line.length), 0);
  const maxContentLength = Math.max(contentWidth, BORDER_PATTERN.length);
  const paddedLinesColored = contentLinesColored.map((line) => padEndVisible(line, maxContentLength));
  const borderRaw = buildBorder(maxContentLength);
  const border = `${headerIndent}${colorizeBorder(borderRaw, useColor)}`;
  const headerBg = { useColor, columns: consoleStream.columns };
  const blankLine = applyLineBackground('', headerBg);

  if (showPreamble) {
    consoleStream.write(`${blankLine}\n`);
    consoleStream.write(`${applyLineBackground(border, headerBg)}\n`);
    for (const line of paddedLinesColored) {
      consoleStream.write(`${applyLineBackground(`${lineIndent}${line}`, headerBg)}\n`);
    }
    consoleStream.write(`${applyLineBackground(border, headerBg)}\n`);
    consoleStream.write(`${blankLine}\n`);
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
          const output = formatCapturedOutput({
            stdout: current.stdout,
            stderr: current.stderr,
            mode: 'failure',
            useColor,
            columns: consoleStream.columns
          });
          if (output) {
            consoleStream.write(`${applyLineBackground('', { useColor, columns: consoleStream.columns })}\n`);
            consoleStream.write(output);
          }
        }
        const duration = formatDurationBadge(current.durationMs, { useColor });
        const detail = formatFailure(current);
        const attemptInfo = current.attempts > 1 ? ` after ${current.attempts} attempts` : '';
        const label = formatLabel('FAIL', { useColor, mode: 'fail' });
        const gap = useColor ? `${ANSI.bgBlack} ${ANSI.reset}` : ' ';
        const failLine = `${label}${gap}${duration} ${current.id} ${detail}${attemptInfo}`;
        consoleStream.write(`${applyLineBackground(failLine, { useColor, columns: consoleStream.columns })}\n`);
        if (current.logs && current.logs.length) {
          const logLine = formatLogLine(current.logs[current.logs.length - 1], { useColor });
          consoleStream.write(`${applyLineBackground(logLine, { useColor, columns: consoleStream.columns })}\n`);
          consoleStream.write(`${applyLineBackground('', { useColor, columns: consoleStream.columns })}\n`);
        }
      } else if (current.status === 'passed' && showPass) {
        const duration = formatDurationBadge(current.durationMs, { useColor });
        const label = formatLabel('PASS', { useColor, mode: 'pass' });
        const gap = useColor ? `${ANSI.bgBlack} ${ANSI.reset}` : ' ';
        const passLine = `${label}${gap}${duration} ${current.id}`;
        consoleStream.write(`${applyLineBackground(passLine, { useColor, columns: consoleStream.columns })}\n`);
        if (captureOutput && !argv.json) {
          const output = formatCapturedOutput({
            stdout: current.stdout,
            stderr: current.stderr,
            mode: 'success',
            useColor,
            columns: consoleStream.columns
          });
          if (output) {
            consoleStream.write(`${applyLineBackground('', { useColor, columns: consoleStream.columns })}\n`);
            consoleStream.write(output);
          }
        }
      } else if (current.status === 'skipped' && showSkip) {
        const reason = formatSkipReason(current.skipReason, { useColor });
        const label = formatLabel('SKIP', { useColor, mode: 'skip' });
        const gap = useColor ? `${ANSI.bgBlack} ${ANSI.reset}` : ' ';
        const pad = ' '.repeat(10);
        const nameText = useColor ? `${ANSI.fgDarkGray}${current.id}${ANSI.reset}` : current.id;
        const skipLine = `${label}${gap}${pad}${nameText}${reason}`;
        consoleStream.write(`${applyLineBackground(skipLine, { useColor, columns: consoleStream.columns })}\n`);
      }
      nextToReport += 1;
    }
  };

  const queue = new PQueue({ concurrency: jobs });
  selection.forEach((test, index) => {
    queue.add(async () => {
      if (test.presetStatus === 'skipped') {
        reportResult({ ...test, id: test.id, status: 'skipped', durationMs: 0 }, index);
        return;
      }
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
    const summaryBg = { useColor, columns: consoleStream.columns };
    const summaryIndent = '     ' + '        ' + innerPadding;
    const sectionIndent = '  ';
    const itemIndent = '     ';
    const completeIndent = '                        ' + '        ' + innerPadding;
    const summaryLabel = colorize('Summary:', ANSI.fgLightBlue, useColor);
    const passedText = colorize('Passed', ANSI.fgGreen, useColor);
    const failedText = colorize('Failed', ANSI.fgRed, useColor);
    const timeoutsText = colorize('Timeouts', ANSI.fgOrange, useColor);
    const skippedText = colorize('Skipped', ANSI.fgPink, useColor);
    const passedValue = colorize(String(summary.passed), ANSI.fgBrightWhite, useColor);
    const timeouts = results.filter((result) => result.timedOut);
    const failedOnly = results.filter((result) => result.status === 'failed' && !result.timedOut);
    const excludedSkips = results.filter((result) => result.status === 'skipped'
      && String(result.skipReason || '').toLowerCase().startsWith('excluded tag:'));
    const skippedOnly = results.filter((result) => result.status === 'skipped'
      && !String(result.skipReason || '').toLowerCase().startsWith('excluded tag:'));
    const failedValue = colorize(String(failedOnly.length), ANSI.fgBrightWhite, useColor);
    const skippedValue = colorize(String(skippedOnly.length), ANSI.fgBrightWhite, useColor);
    const timeoutsValue = colorize(String(timeouts.length), ANSI.fgBrightWhite, useColor);
    const durationLabel = colorize('Duration:', TIME_LABEL_COLOR, useColor);
    const summaryLabelName = 'Summary';
    const durationLabelName = 'Duration';
    const slowestLabelName = 'Slowest';
    const labelWidth = Math.max(summaryLabelName.length, durationLabelName.length, slowestLabelName.length);
    const renderLabel = (label, color) => {
      const padded = label.padEnd(labelWidth);
      if (!useColor) return `${padded}:`;
      return `${color}${padded}:${ANSI.reset}`;
    };
    const resolveWord = (count, singular, plural) => (count === 1 ? singular : plural);
    const summaryFailedWord = resolveWord(failedOnly.length, 'Failure', 'Failed');
    const summaryTimeoutWord = resolveWord(timeouts.length, 'Timeout', 'Timeouts');
    const summarySkipWord = resolveWord(skippedOnly.length, 'Skip', 'Skipped');

    consoleStream.write(`${applyLineBackground('', summaryBg)}\n`);
    const completeText = useColor
      ? `${ANSI.bold}${ANSI.fgBrightWhite}Test Complete!${ANSI.reset}`
      : 'Test Complete!';
    consoleStream.write(`${applyLineBackground(`${completeIndent}${completeText}`, summaryBg)}\n`);
    consoleStream.write(`${applyLineBackground('', summaryBg)}\n`);
    consoleStream.write(`${applyLineBackground(border, summaryBg)}\n`);
    const summaryLine = `${summaryIndent}${renderLabel(summaryLabelName, ANSI.fgLightBlue)} ${passedValue} ${passedText} | ` +
      `${failedValue} ${colorize(summaryFailedWord, ANSI.fgRed, useColor)} | ` +
      `${timeoutsValue} ${colorize(summaryTimeoutWord, ANSI.fgOrange, useColor)} | ` +
      `${skippedValue} ${colorize(summarySkipWord, ANSI.fgPink, useColor)}`;
    consoleStream.write(`${applyLineBackground(summaryLine, summaryBg)}\n`);
    const durationLine = `${summaryIndent}${renderLabel(durationLabelName, TIME_LABEL_COLOR)} ${formatDurationValue(totalMs, { useColor })}`;
    consoleStream.write(`${applyLineBackground(durationLine, summaryBg)}\n`);
    const slowest = results.reduce((best, result) => {
      if (!Number.isFinite(result?.durationMs)) return best;
      if (!best || result.durationMs > best.durationMs) return result;
      return best;
    }, null);
    if (slowest) {
      const slowestColor = resolveSlowestColor(slowest.durationMs);
      const slowestLabel = useColor ? `${slowestColor}${slowestLabelName.padEnd(labelWidth)}:${ANSI.reset}` : `${slowestLabelName.padEnd(labelWidth)}:`;
      const slowestName = colorize(slowest.id, ANSI.fgBrightWhite, useColor);
      const slowestStatus = slowest.status === 'passed'
        ? colorize('PASS', ANSI.fgGreen, useColor)
        : (slowest.status === 'skipped'
          ? colorize('SKIP', ANSI.fgPink, useColor)
          : colorize('FAIL', ANSI.fgRed, useColor));
      const slowestTime = formatDurationBadge(slowest.durationMs, { useColor });
      const slowestLine = `${summaryIndent}${slowestLabel} ${slowestName} | ${slowestStatus} ${slowestTime}`;
      consoleStream.write(`${applyLineBackground(slowestLine, summaryBg)}\n`);
    }
    consoleStream.write(`${applyLineBackground(border, summaryBg)}\n`);
    consoleStream.write(`${applyLineBackground('', summaryBg)}\n`);
    if (excludedSkips.length) {
      const exclusions = new Set();
      for (const skip of excludedSkips) {
        const reason = String(skip.skipReason || '');
        const raw = reason.replace(/^excluded tag:/i, '').trim();
        if (!raw) continue;
        raw.split(',').map((value) => value.trim()).filter(Boolean).forEach((tag) => exclusions.add(tag));
      }
      const exclusionCount = exclusions.size;
      const testsCount = excludedSkips.length;
      const labelText = useColor
        ? `${ANSI.fgPinkDark}Excluded Tags${ANSI.reset}`
        : 'Excluded Tags';
      const exclusionValue = useColor ? `${ANSI.fgBrightWhite}${exclusionCount}${ANSI.reset}` : String(exclusionCount);
      const testsValue = useColor ? `${ANSI.fgBrightWhite}${testsCount}${ANSI.reset}` : String(testsCount);
      const headerLine = `${sectionIndent}${labelText} - ${exclusionValue} Exclusions bypassing ${testsValue} Tests`;
      consoleStream.write(`${applyLineBackground(headerLine, summaryBg)}\n`);
      const tagsList = Array.from(exclusions).sort((a, b) => a.localeCompare(b));
      if (tagsList.length) {
        const maxWidth = Math.max(20, (consoleStream.columns || 100) - sectionIndent.length - 2);
        const wrapped = wrapList(tagsList, maxWidth);
        for (const lineItems of wrapped) {
          const lineText = lineItems.join(', ');
          const coloredText = useColor ? `${ANSI.fgPinkDark}${lineText}${ANSI.reset}` : lineText;
          consoleStream.write(`${applyLineBackground(`${itemIndent}${coloredText}`, summaryBg)}\n`);
        }
      }
      consoleStream.write(`${applyLineBackground('', summaryBg)}\n`);
    }
    if (skippedOnly.length) {
      const skipHeaderText = resolveWord(skippedOnly.length, 'Skip', 'Skips');
      const skipHeader = useColor
        ? `${sectionIndent}${ANSI.fgPink}${skipHeaderText}${ANSI.reset}${ANSI.fgBrightWhite}:${ANSI.reset}`
        : `${sectionIndent}${skipHeaderText}:`;
      consoleStream.write(`${applyLineBackground(skipHeader, summaryBg)}\n`);
      for (const skip of skippedOnly) {
        const reason = skip.skipReason ? ` (${skip.skipReason})` : '';
        const bullet = useColor ? `${ANSI.fgBrightWhite}- ${ANSI.reset}` : '- ';
        const lineText = `${itemIndent}${bullet}${skip.id}${reason}`;
        const coloredLine = useColor ? `${ANSI.fgBrightWhite}${lineText}${ANSI.reset}` : lineText;
        consoleStream.write(`${applyLineBackground(coloredLine, summaryBg)}\n`);
      }
      consoleStream.write(`${applyLineBackground('', summaryBg)}\n`);
    }
    if (timeouts.length) {
      const timeoutHeaderText = resolveWord(timeouts.length, 'Timeout', 'Timeouts');
      const timeoutHeader = useColor
        ? `${sectionIndent}${ANSI.fgOrange}${timeoutHeaderText}${ANSI.reset}${ANSI.fgBrightWhite}:${ANSI.reset}`
        : `${sectionIndent}${timeoutHeaderText}:`;
      consoleStream.write(`${applyLineBackground(timeoutHeader, summaryBg)}\n`);
      for (const timeout of timeouts) {
        const bullet = useColor ? `${ANSI.fgBrightWhite}- ${ANSI.reset}` : '- ';
        const timeoutLine = `${itemIndent}${bullet}${timeout.id} ${formatDurationBadge(timeout.durationMs, { useColor })}`;
        const coloredLine = useColor ? `${ANSI.fgDarkOrange}${timeoutLine}${ANSI.reset}` : timeoutLine;
        consoleStream.write(`${applyLineBackground(coloredLine, summaryBg)}\n`);
      }
      consoleStream.write(`${applyLineBackground('', summaryBg)}\n`);
    }
    if (failedOnly.length) {
      const failureHeaderText = resolveWord(failedOnly.length, 'Failure', 'Failures');
      const failureHeader = useColor
        ? `${sectionIndent}${ANSI.fgRed}${failureHeaderText}${ANSI.reset}${ANSI.fgBrightWhite}:${ANSI.reset}`
        : `${sectionIndent}${failureHeaderText}:`;
      consoleStream.write(`${applyLineBackground(failureHeader, summaryBg)}\n`);
      for (const failure of failedOnly) {
        const detail = formatFailure(failure);
        const detailText = useColor
          ? `${ANSI.bold}${ANSI.fgBrightWhite}${detail}${ANSI.reset}`
          : detail;
        const bullet = useColor ? `${ANSI.fgBrightWhite}- ${ANSI.reset}` : '- ';
        const nameText = useColor ? `${ANSI.fgRed}${failure.id}${ANSI.reset}` : failure.id;
        const duration = formatDurationBadge(failure.durationMs, { useColor });
        const lineText = `${itemIndent}${bullet}${duration} ${nameText} (${detailText})`;
        consoleStream.write(`${applyLineBackground(lineText, summaryBg)}\n`);
        const outputLines = selectOutputLines({
          stdout: failure.stdout,
          stderr: failure.stderr,
          mode: 'failure'
        });
        const hasLogs = failure.logs && failure.logs.length;
        const hasDetails = outputLines.length || hasLogs;
        if (outputLines.length) {
          const subIndent = `${itemIndent}    `;
          for (const line of outputLines) {
            const subLine = `${subIndent}${line}`;
            const coloredSubLine = useColor ? `${ANSI.fgDarkGray}${subLine}${ANSI.reset}` : subLine;
            consoleStream.write(`${applyLineBackground(coloredSubLine, summaryBg)}\n`);
          }
        }
        if (hasLogs) {
          const subIndent = `${itemIndent}    `;
          const logPath = formatLogPath(failure.logs[failure.logs.length - 1]);
          const logLine = `${subIndent}LOG: ${logPath}`;
          const coloredLogLine = useColor ? `${ANSI.fgDarkGray}${logLine}${ANSI.reset}` : logLine;
          consoleStream.write(`${applyLineBackground(coloredLogLine, summaryBg)}\n`);
        }
        if (hasDetails) {
          consoleStream.write(`${applyLineBackground('', summaryBg)}\n`);
        }
      }
      consoleStream.write(`${applyLineBackground('', summaryBg)}\n`);
    }
    consoleStream.write(`${applyLineBackground(border, summaryBg)}\n`);
    if (runLogDir) {
      consoleStream.write(`${applyLineBackground('', summaryBg)}\n`);
      const logsLine = `${formatLabel('LOGS:', { useColor, mode: 'log' })} ${formatLogPath(runLogDir)}`;
      consoleStream.write(`${applyLineBackground(logsLine, summaryBg)}\n`);
      consoleStream.write(`${applyLineBackground('', summaryBg)}\n`);
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
