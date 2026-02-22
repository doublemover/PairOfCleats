#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { color } from '../../src/retrieval/cli/ansi.js';
import { getMetricsDir, loadUserConfig } from '../shared/dict-utils.js';

const resultsRoot = path.join(process.cwd(), 'benchmarks', 'results');
const refreshJson = process.argv.includes('--refresh-json');
const deepAnalysis = process.argv.includes('--deep-analysis') || refreshJson;
const includeUsrGuardrails = process.argv.includes('--include-usr');
const NON_REPO_RESULTS_FOLDERS = new Set(['logs', 'usr']);

const listDirs = (root) => fs.existsSync(root)
  ? fs.readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory())
  : [];

/**
 * Throughput aggregates are repo/language focused, so auxiliary benchmark
 * folders (for example USR guardrail snapshots) are excluded by default.
 *
 * @param {string} folderName
 * @returns {boolean}
 */
const includeResultsFolder = (folderName) => {
  if (folderName === 'usr' && includeUsrGuardrails) return true;
  return !NON_REPO_RESULTS_FOLDERS.has(folderName);
};

const formatNumber = (value, digits = 1) => (
  Number.isFinite(value) ? value.toFixed(digits) : 'n/a'
);

const formatCount = (value) => (
  Number.isFinite(value) ? value.toLocaleString() : 'n/a'
);

const formatMs = (value) => {
  if (!Number.isFinite(value)) return 'n/a';
  if (value < 1000) return `${Math.round(value)}ms`;
  const seconds = value / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  const rem = (seconds % 60).toFixed(0);
  return `${minutes}m ${rem}s`;
};

const formatBytes = (value) => {
  if (!Number.isFinite(value)) return 'n/a';
  const abs = Math.abs(value);
  if (abs < 1024) return `${Math.round(value)} B`;
  const kb = value / 1024;
  if (Math.abs(kb) < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  if (Math.abs(mb) < 1024) return `${mb.toFixed(1)} MB`;
  const gb = mb / 1024;
  return `${gb.toFixed(2)} GB`;
};

const formatBytesPerSec = (value) => {
  if (!Number.isFinite(value)) return 'n/a';
  const mb = value / (1024 * 1024);
  if (mb < 1024) return `${mb.toFixed(1)} MB/s`;
  return `${(mb / 1024).toFixed(2)} GB/s`;
};

const mean = (values) => {
  if (!values.length) return null;
  return values.reduce((sum, val) => sum + val, 0) / values.length;
};

const collect = (items, selector) => items
  .map((item) => selector(item))
  .filter((value) => Number.isFinite(value));

const MODE_METRICS = [
  ['code', 'Code'],
  ['prose', 'Prose'],
  ['extracted-prose', 'Extracted Prose'],
  ['records', 'Records']
];
const LANGUAGE_KEY_ALIASES = new Map([
  ['js', 'javascript'],
  ['mjs', 'javascript'],
  ['cjs', 'javascript'],
  ['ts', 'typescript'],
  ['py', 'python'],
  ['rb', 'ruby'],
  ['sh', 'shell'],
  ['bash', 'shell'],
  ['zsh', 'shell'],
  ['yml', 'yaml'],
  ['md', 'markdown'],
  ['htm', 'html'],
  ['cs', 'csharp'],
  ['kt', 'kotlin'],
  ['hbs', 'handlebars'],
  ['jinja2', 'jinja'],
  ['cshtml', 'razor'],
  ['hs', 'haskell']
]);
const THROUGHPUT_GROUPS = [
  { label: 'Code throughput', pick: (throughput) => throughput?.code || null },
  { label: 'Prose throughput', pick: (throughput) => throughput?.prose || null },
  { label: 'Extracted prose throughput', pick: (throughput) => throughput?.extractedProse || null },
  { label: 'Records throughput', pick: (throughput) => throughput?.records || null },
  { label: 'LMDB code throughput', pick: (throughput) => throughput?.lmdb?.code || null },
  { label: 'LMDB prose throughput', pick: (throughput) => throughput?.lmdb?.prose || null }
];

const createRateTotals = () => ({ files: 0, chunks: 0, tokens: 0, bytes: 0, totalMs: 0 });
const createModeTotals = () => ({ repos: 0, files: 0, lines: 0, bytes: 0, durationMs: 0 });

const mergeTotals = (target, entry) => {
  if (!entry) return;
  if (Number.isFinite(entry.files)) target.files += entry.files;
  if (Number.isFinite(entry.chunks)) target.chunks += entry.chunks;
  if (Number.isFinite(entry.tokens)) target.tokens += entry.tokens;
  if (Number.isFinite(entry.bytes)) target.bytes += entry.bytes;
  if (Number.isFinite(entry.totalMs)) target.totalMs += entry.totalMs;
};

const createModeTotalsMap = () => new Map(
  MODE_METRICS.map(([key]) => [key, createModeTotals()])
);

const mergeModeTotalsFromFeatureMetrics = (metrics, totalsMap) => {
  if (!metrics || !metrics.modes || !totalsMap) return;
  for (const [modeKey] of MODE_METRICS) {
    const totals = metrics?.modes?.[modeKey]?.totals;
    if (!totals) continue;
    const lines = toFiniteOrNull(totals.lines);
    const files = toFiniteOrNull(totals.count);
    const bytes = toFiniteOrNull(totals.bytes);
    const durationMs = toFiniteOrNull(totals.durationMs);
    if (!Number.isFinite(lines) && !Number.isFinite(files) && !Number.isFinite(bytes) && !Number.isFinite(durationMs)) {
      continue;
    }
    const bucket = totalsMap.get(modeKey);
    if (!bucket) continue;
    bucket.repos += 1;
    if (Number.isFinite(files)) bucket.files += files;
    if (Number.isFinite(lines)) bucket.lines += lines;
    if (Number.isFinite(bytes)) bucket.bytes += bytes;
    if (Number.isFinite(durationMs) && Number.isFinite(lines) && lines > 0) bucket.durationMs += durationMs;
  }
};

const hasModeTotals = (totals) => (
  Number.isFinite(totals?.lines) && totals.lines > 0
) || (
  Number.isFinite(totals?.files) && totals.files > 0
);

const rateFromTotals = (totals, key) => {
  if (!Number.isFinite(totals.totalMs) || totals.totalMs <= 0) return null;
  const value = totals[key];
  if (!Number.isFinite(value)) return null;
  return value / (totals.totalMs / 1000);
};

const sumRates = (...values) => {
  let sum = 0;
  let found = false;
  for (const value of values) {
    if (!Number.isFinite(value)) continue;
    sum += value;
    found = true;
  }
  return found ? sum : null;
};

const THROUGHPUT_TOTAL_LABEL_WIDTH = 10;
const MODE_THROUGHPUT_TOTALS = [
  { label: 'Code', pick: (totals) => totals?.code || null, modeKey: 'code' },
  { label: 'Prose', pick: (totals) => totals?.prose || null, modeKey: 'prose' },
  { label: 'XProse', pick: (totals) => totals?.extractedProse || null, modeKey: 'extracted-prose' },
  { label: 'Records', pick: (totals) => totals?.records || null, modeKey: 'records' }
];

const printAlignedTotalLine = (label, value) => {
  console.error(`  ${label.padStart(THROUGHPUT_TOTAL_LABEL_WIDTH)}: ${value}`);
};

const formatFixed = (value, { digits = 1, width = 5 } = {}) => (
  Number.isFinite(value) ? value.toFixed(digits).padStart(width) : 'n/a'.padStart(width)
);

const formatModeThroughputLine = ({ label, entry }) => {
  const chunks = formatFixed(entry?.chunksPerSec, { digits: 1, width: 5 });
  const tokens = formatFixed(entry?.tokensPerSec, { digits: 1, width: 7 });
  const mb = Number.isFinite(entry?.bytesPerSec) ? (entry.bytesPerSec / (1024 * 1024)) : null;
  const bytes = formatFixed(mb, { digits: 1, width: 4 });
  const files = formatFixed(entry?.filesPerSec, { digits: 1, width: 5 });
  return (
    `${label.padStart(8)}: ${chunks} chunks/s  | ` +
    `${tokens} tokens/s  | ${bytes} MB/s | ${files} files/s`
  );
};
const SECTION_META_LEFT_WIDTH = `${formatFixed(0, { digits: 1, width: 5 })} chunks/s  `.length;
const formatSectionMetaLine = ({ label, left, right }) => (
  `  ${label.padStart(8)}: ${String(left || '').padEnd(SECTION_META_LEFT_WIDTH)}| ${String(right || '')}`
);

const MODE_SHORT_LABEL = {
  code: 'Code',
  prose: 'Prose',
  'extracted-prose': 'XProse',
  records: 'Records'
};

const buildIndexedTotalsRows = (modeTotalsMap) => {
  const ordered = ['code', 'prose', 'extracted-prose', 'records'];
  return ordered.map((modeKey) => {
    const totals = modeTotalsMap.get(modeKey);
    if (!Number.isFinite(totals?.lines) || totals.lines <= 0) return null;
    const linesPerSec = (Number.isFinite(totals.durationMs) && totals.durationMs > 0)
      ? (totals.lines / (totals.durationMs / 1000))
      : null;
    const msPerLine = (Number.isFinite(totals.durationMs) && totals.durationMs > 0 && totals.lines > 0)
      ? (totals.durationMs / totals.lines)
      : null;
    return {
      modeKey,
      label: MODE_SHORT_LABEL[modeKey] || modeKey,
      linesText: `${formatCount(totals.lines)} lines`,
      filesText: `${formatCount(totals.files)} files`,
      bytesText: formatBytes(totals.bytes),
      linesPerSecText: `${formatNumber(linesPerSec)} lines/s`,
      msPerLineText: `${formatNumber(msPerLine, 3)} ms/line`
    };
  }).filter(Boolean);
};

const meanThroughput = (throughputs, pick) => {
  const entries = throughputs.map((item) => pick(item)).filter(Boolean);
  if (!entries.length) return null;
  return {
    chunksPerSec: mean(collect(entries, (entry) => entry.chunksPerSec)),
    tokensPerSec: mean(collect(entries, (entry) => entry.tokensPerSec)),
    bytesPerSec: mean(collect(entries, (entry) => entry.bytesPerSec)),
    filesPerSec: mean(collect(entries, (entry) => entry.filesPerSec))
  };
};

const formatThroughputTotalsCell = (value, unit, width) => (
  `${formatFixed(value, { digits: 1, width })} ${unit}`
);

const loadJson = (filePath) => {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
};

const loadFeatureMetrics = (repoRoot) => {
  if (!repoRoot) return null;
  const userConfig = loadUserConfig(repoRoot);
  const metricsDir = getMetricsDir(repoRoot, userConfig);
  const runPath = path.join(metricsDir, 'feature-metrics-run.json');
  const mergedPath = path.join(metricsDir, 'feature-metrics.json');
  return loadJson(runPath) || loadJson(mergedPath);
};

const featureMetricsCache = new Map();
const loadFeatureMetricsCached = (repoRoot) => {
  if (!repoRoot) return null;
  if (featureMetricsCache.has(repoRoot)) return featureMetricsCache.get(repoRoot);
  const metrics = loadFeatureMetrics(repoRoot);
  featureMetricsCache.set(repoRoot, metrics || null);
  return metrics || null;
};

const extractPandocFenceLanguage = (value) => {
  const match = String(value || '').match(/^\{([^}]*)\}$/);
  if (!match) return null;
  const body = String(match[1] || '').trim();
  if (!body) return null;
  const tokens = body.split(/\s+/).filter(Boolean);
  for (const token of tokens) {
    const normalized = String(token || '').trim().toLowerCase();
    if (!normalized) continue;
    if (normalized.startsWith('.')) {
      const className = normalized.slice(1);
      if (className) return className;
    }
    if (normalized.startsWith('class=')) {
      const className = normalized.slice('class='.length).replace(/^['"]|['"]$/g, '');
      if (className) return className.replace(/^\./, '');
    }
  }
  return null;
};

const normalizeMetricsLanguageKey = (rawLanguage) => {
  let normalized = String(rawLanguage || '').trim().toLowerCase();
  if (!normalized) return 'unknown';
  const pandocFenceLanguage = extractPandocFenceLanguage(normalized);
  if (pandocFenceLanguage) normalized = pandocFenceLanguage;
  normalized = normalized
    .replace(/^`+|`+$/g, '')
    .replace(/^\./, '')
    .replace(/^\{+|\}+$/g, '')
    .trim();
  if (!normalized) return 'unknown';
  if (normalized === 'unknown' || normalized === 'n/a' || normalized === 'none' || normalized === 'null') {
    return 'unknown';
  }
  const alias = LANGUAGE_KEY_ALIASES.get(normalized);
  return alias || normalized;
};

const collectLanguageLines = (metrics, totals) => {
  if (!metrics || !metrics.modes) return;
  for (const modeEntry of Object.values(metrics.modes)) {
    const languages = modeEntry?.languages || {};
    for (const [language, bucket] of Object.entries(languages)) {
      const lines = Number(bucket?.lines) || 0;
      if (!lines) continue;
      const normalizedLanguage = normalizeMetricsLanguageKey(language);
      totals.set(normalizedLanguage, (totals.get(normalizedLanguage) || 0) + lines);
    }
  }
};

const INDEXING_SCHEMA_VERSION = 1;
const buildModeIndexingSummary = (totals) => {
  const files = toFiniteOrNull(totals?.count);
  const lines = toFiniteOrNull(totals?.lines);
  const bytes = toFiniteOrNull(totals?.bytes);
  const durationMs = toFiniteOrNull(totals?.durationMs);
  const linesPerSec = (Number.isFinite(lines) && Number.isFinite(durationMs) && durationMs > 0)
    ? (lines / (durationMs / 1000))
    : null;
  return {
    files,
    lines,
    bytes,
    durationMs,
    linesPerSec
  };
};

const buildIndexingSummaryFromFeatureMetrics = (metrics) => {
  if (!metrics || typeof metrics !== 'object') return null;
  const modes = {};
  const totals = { files: 0, lines: 0, bytes: 0, durationMs: 0 };
  const languageLines = {};
  let hasData = false;

  for (const [modeKey] of MODE_METRICS) {
    const modeEntry = metrics?.modes?.[modeKey];
    const modeTotals = buildModeIndexingSummary(modeEntry?.totals || null);
    modes[modeKey] = modeTotals;
    if (Number.isFinite(modeTotals.files)) totals.files += modeTotals.files;
    if (Number.isFinite(modeTotals.lines)) totals.lines += modeTotals.lines;
    if (Number.isFinite(modeTotals.bytes)) totals.bytes += modeTotals.bytes;
    if (Number.isFinite(modeTotals.durationMs)) totals.durationMs += modeTotals.durationMs;
    if (hasModeTotals(modeTotals)) hasData = true;
    const languages = modeEntry?.languages || {};
    for (const [language, bucket] of Object.entries(languages)) {
      const lines = Number(bucket?.lines);
      if (!Number.isFinite(lines) || lines <= 0) continue;
      const normalizedLanguage = normalizeMetricsLanguageKey(language);
      languageLines[normalizedLanguage] = (languageLines[normalizedLanguage] || 0) + lines;
    }
  }

  if (!hasData) return null;
  const totalLinesPerSec = totals.durationMs > 0 ? (totals.lines / (totals.durationMs / 1000)) : null;
  return {
    schemaVersion: INDEXING_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    source: 'feature-metrics',
    modes,
    totals: {
      ...totals,
      linesPerSec: totalLinesPerSec
    },
    languageLines
  };
};

const THROUGHPUT_KEY_BY_MODE = {
  code: 'code',
  prose: 'prose',
  'extracted-prose': 'extractedProse',
  records: 'records'
};

const buildIndexingSummaryFromThroughput = (throughput) => {
  if (!throughput || typeof throughput !== 'object') return null;
  const modes = {};
  const totals = { files: 0, lines: 0, bytes: 0, durationMs: 0 };
  let hasData = false;
  for (const [modeKey] of MODE_METRICS) {
    const throughputKey = THROUGHPUT_KEY_BY_MODE[modeKey];
    const entry = throughput?.[throughputKey];
    const files = toFiniteOrNull(entry?.files);
    const bytes = toFiniteOrNull(entry?.bytes);
    const durationMs = toFiniteOrNull(entry?.totalMs);
    const modeTotals = {
      files,
      lines: null,
      bytes,
      durationMs,
      linesPerSec: null
    };
    modes[modeKey] = modeTotals;
    if (Number.isFinite(files)) totals.files += files;
    if (Number.isFinite(bytes)) totals.bytes += bytes;
    if (Number.isFinite(durationMs)) totals.durationMs += durationMs;
    if (hasModeTotals(modeTotals)) hasData = true;
  }
  if (!hasData) return null;
  return {
    schemaVersion: INDEXING_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    source: 'throughput',
    modes,
    totals: {
      ...totals,
      linesPerSec: null
    },
    languageLines: {}
  };
};

const isValidIndexingSummary = (indexingSummary) => {
  if (!indexingSummary || typeof indexingSummary !== 'object') return false;
  if (indexingSummary.schemaVersion !== INDEXING_SCHEMA_VERSION) return false;
  return MODE_METRICS.some(([modeKey]) => hasModeTotals(indexingSummary?.modes?.[modeKey]));
};

const mergeModeTotalsFromIndexingSummary = (indexingSummary, totalsMap) => {
  if (!isValidIndexingSummary(indexingSummary) || !totalsMap) return;
  for (const [modeKey] of MODE_METRICS) {
    const totals = indexingSummary?.modes?.[modeKey];
    if (!totals) continue;
    const lines = toFiniteOrNull(totals.lines);
    const files = toFiniteOrNull(totals.files);
    const bytes = toFiniteOrNull(totals.bytes);
    const durationMs = toFiniteOrNull(totals.durationMs);
    if (!Number.isFinite(lines) && !Number.isFinite(files) && !Number.isFinite(bytes) && !Number.isFinite(durationMs)) {
      continue;
    }
    const bucket = totalsMap.get(modeKey);
    if (!bucket) continue;
    bucket.repos += 1;
    if (Number.isFinite(files)) bucket.files += files;
    if (Number.isFinite(lines)) bucket.lines += lines;
    if (Number.isFinite(bytes)) bucket.bytes += bytes;
    if (Number.isFinite(durationMs) && Number.isFinite(lines) && lines > 0) bucket.durationMs += durationMs;
  }
};

const collectLanguageLinesFromSummary = (indexingSummary, totals) => {
  if (!isValidIndexingSummary(indexingSummary) || !totals) return;
  const languageLines = indexingSummary?.languageLines || {};
  for (const [language, linesValue] of Object.entries(languageLines)) {
    const lines = Number(linesValue);
    if (!Number.isFinite(lines) || lines <= 0) continue;
    const normalizedLanguage = normalizeMetricsLanguageKey(language);
    totals.set(normalizedLanguage, (totals.get(normalizedLanguage) || 0) + lines);
  }
};

const ANALYSIS_SCHEMA_VERSION = 1;
const REPO_MAP_KIND_PATTERN = /"kind":"([^"]+)"/g;
const REPO_MAP_KIND_CACHE = new Map();
const ANALYSIS_MODE_KEYS = ['code', 'prose', 'extracted-prose', 'records'];

const KIND_CLASS_PATTERNS = [
  'classdeclaration',
  'structdeclaration',
  'interfacedeclaration',
  'enumdeclaration',
  'traitdeclaration',
  'typealiasdeclaration',
  'moduledeclaration'
];
const KIND_FUNCTION_PATTERNS = [
  'functiondeclaration',
  'methoddeclaration',
  'constructordeclaration',
  'callabledeclaration'
];
const KIND_IMPORT_PATTERNS = ['import', 'include', 'require'];

const toFiniteOrNull = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

const readRepoMapKindCountsSync = (repoMapPath) => {
  if (!repoMapPath || !fs.existsSync(repoMapPath)) return null;
  if (REPO_MAP_KIND_CACHE.has(repoMapPath)) return REPO_MAP_KIND_CACHE.get(repoMapPath);
  const counts = {};
  let fd = null;
  try {
    fd = fs.openSync(repoMapPath, 'r');
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    let tail = '';
    while (true) {
      const bytesRead = fs.readSync(fd, buffer, 0, buffer.length, null);
      if (!bytesRead) break;
      const chunk = tail + buffer.toString('utf8', 0, bytesRead);
      REPO_MAP_KIND_PATTERN.lastIndex = 0;
      let match = REPO_MAP_KIND_PATTERN.exec(chunk);
      while (match) {
        const kind = String(match[1] || '').trim();
        if (kind) counts[kind] = (counts[kind] || 0) + 1;
        match = REPO_MAP_KIND_PATTERN.exec(chunk);
      }
      tail = chunk.slice(Math.max(0, chunk.length - 256));
    }
  } catch {
    REPO_MAP_KIND_CACHE.set(repoMapPath, null);
    if (fd != null) {
      try { fs.closeSync(fd); } catch {}
    }
    return null;
  }
  if (fd != null) {
    try { fs.closeSync(fd); } catch {}
  }
  REPO_MAP_KIND_CACHE.set(repoMapPath, counts);
  return counts;
};

const sumKindsByPattern = (kindCounts, patterns) => {
  if (!kindCounts || !patterns?.length) return 0;
  let total = 0;
  for (const [kind, count] of Object.entries(kindCounts)) {
    const lowerKind = kind.toLowerCase();
    if (!patterns.some((pattern) => lowerKind.includes(pattern))) continue;
    if (Number.isFinite(Number(count))) total += Number(count);
  }
  return total;
};

const sumKindCounts = (kindCounts) => {
  if (!kindCounts) return 0;
  let total = 0;
  for (const value of Object.values(kindCounts)) {
    if (Number.isFinite(Number(value))) total += Number(value);
  }
  return total;
};

const topKinds = (kindCounts, limit = 8) => {
  if (!kindCounts) return [];
  return Object.entries(kindCounts)
    .filter(([, count]) => Number.isFinite(Number(count)) && Number(count) > 0)
    .sort((a, b) => Number(b[1]) - Number(a[1]))
    .slice(0, limit)
    .map(([kind, count]) => ({ kind, count: Number(count) }));
};

const resolveBuildRootFromArtifactReport = (artifactReport) => {
  const repo = artifactReport?.repo || {};
  const sqlite = repo.sqlite || {};
  const sqliteCandidates = [
    sqlite?.code?.path,
    sqlite?.prose?.path,
    sqlite?.extractedProse?.path,
    sqlite?.records?.path
  ].filter((value) => typeof value === 'string' && value.trim());
  for (const sqlitePath of sqliteCandidates) {
    const sqliteDir = path.dirname(sqlitePath);
    if (path.basename(sqliteDir).toLowerCase() === 'index-sqlite') {
      const buildRoot = path.dirname(sqliteDir);
      if (fs.existsSync(buildRoot)) return buildRoot;
    }
  }
  const cacheRoot = typeof repo?.cacheRoot === 'string' ? repo.cacheRoot : '';
  if (!cacheRoot) return null;
  const buildsRoot = path.join(cacheRoot, 'builds');
  if (!fs.existsSync(buildsRoot)) return null;
  const buildDirs = fs.readdirSync(buildsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(buildsRoot, entry.name))
    .sort((a, b) => b.localeCompare(a));
  return buildDirs[0] || null;
};

const createAstGraphTotals = () => ({
  symbols: 0,
  classes: 0,
  functions: 0,
  imports: 0,
  fileLinks: 0,
  graphLinks: 0
});
const createAstGraphObserved = () => ({
  symbols: 0,
  classes: 0,
  functions: 0,
  imports: 0,
  fileLinks: 0,
  graphLinks: 0
});

const mergeAstGraphTotals = (target, source) => {
  if (!target || !source) return;
  for (const key of Object.keys(target)) {
    const value = Number(source[key]);
    if (!Number.isFinite(value)) continue;
    target[key] += value;
  }
};

const hasObservedAstField = (analysis, key) => ANALYSIS_MODE_KEYS.some((modeKey) => (
  Number.isFinite(Number(analysis?.modes?.[modeKey]?.[key]))
));

const mergeAstGraphObserved = (target, analysis) => {
  if (!target || !analysis) return;
  for (const key of Object.keys(target)) {
    if (!hasObservedAstField(analysis, key)) continue;
    target[key] += 1;
  }
};

const formatAstField = ({ totals, observed }, key) => (
  (Number(observed?.[key]) || 0) > 0 ? formatCount(totals?.[key]) : 'n/a'
);

const hasAstGraphValues = (totals) => {
  if (!totals) return false;
  return ['symbols', 'classes', 'functions', 'imports', 'fileLinks', 'graphLinks']
    .some((key) => Number.isFinite(Number(totals[key])) && Number(totals[key]) > 0);
};

const loadBuildState = (buildRoot) => {
  if (!buildRoot) return null;
  const statePath = path.join(buildRoot, 'build_state.json');
  return loadJson(statePath);
};

const loadStage2Artifacts = (buildState, modeKey) => {
  return buildState?.orderingLedger?.stages?.[`stage2:${modeKey}`]?.artifacts || {};
};

const analysisCountFromArtifacts = (artifacts, key) => {
  const value = Number(artifacts?.[key]?.count);
  return Number.isFinite(value) ? value : null;
};

const buildModeAstGraphStats = ({
  buildRoot,
  modeKey,
  buildState,
  featureTotals,
  includeKindCounts = false
}) => {
  const artifacts = loadStage2Artifacts(buildState, modeKey);
  const indexDir = path.join(buildRoot, `index-${modeKey}`);
  const repoMapPath = path.join(indexDir, 'repo_map.json');
  const kindCounts = includeKindCounts ? readRepoMapKindCountsSync(repoMapPath) : null;
  const symbolCountFromKinds = sumKindCounts(kindCounts);
  const symbols = analysisCountFromArtifacts(artifacts, 'repo_map') ?? (symbolCountFromKinds || null);
  const fileLinks = analysisCountFromArtifacts(artifacts, 'file_relations');
  const graphLinks = analysisCountFromArtifacts(artifacts, 'graph_relations');
  const classes = kindCounts ? sumKindsByPattern(kindCounts, KIND_CLASS_PATTERNS) : null;
  const functions = kindCounts ? sumKindsByPattern(kindCounts, KIND_FUNCTION_PATTERNS) : null;
  const importKinds = kindCounts ? sumKindsByPattern(kindCounts, KIND_IMPORT_PATTERNS) : 0;
  const imports = importKinds > 0 ? importKinds : fileLinks;
  const files = toFiniteOrNull(buildState?.counts?.[modeKey]?.files);
  const chunks = toFiniteOrNull(buildState?.counts?.[modeKey]?.chunks);
  const lines = toFiniteOrNull(featureTotals?.lines);
  const durationMs = toFiniteOrNull(featureTotals?.durationMs);
  const linesPerSec = (Number.isFinite(lines) && Number.isFinite(durationMs) && durationMs > 0)
    ? (lines / (durationMs / 1000))
    : null;
  return {
    mode: modeKey,
    files,
    chunks,
    lines,
    durationMs,
    linesPerSec,
    symbols,
    classes: Number.isFinite(classes) ? classes : null,
    functions: Number.isFinite(functions) ? functions : null,
    imports: Number.isFinite(imports) ? imports : null,
    fileLinks,
    graphLinks,
    topKinds: topKinds(kindCounts)
  };
};

const computeBenchAnalysis = (
  payload,
  { includeKindCounts = false, featureMetrics = null, indexingSummary = null } = {}
) => {
  const artifactReport = payload?.artifacts;
  if (!artifactReport || typeof artifactReport !== 'object') return null;
  const buildRoot = resolveBuildRootFromArtifactReport(artifactReport);
  if (!buildRoot) return null;
  const buildState = loadBuildState(buildRoot);
  if (!buildState) return null;
  const repoRoot = payload?.repo?.root || artifactReport?.repo?.root || null;
  const resolvedFeatureMetrics = featureMetrics || (repoRoot ? loadFeatureMetricsCached(repoRoot) : null);
  const modes = {};
  const totals = createAstGraphTotals();
  for (const modeKey of ANALYSIS_MODE_KEYS) {
    const featureTotals = indexingSummary?.modes?.[modeKey]
      || resolvedFeatureMetrics?.modes?.[modeKey]?.totals
      || null;
    const stats = buildModeAstGraphStats({
      buildRoot,
      modeKey,
      buildState,
      featureTotals,
      includeKindCounts
    });
    modes[modeKey] = stats;
    mergeAstGraphTotals(totals, stats);
  }
  return {
    schemaVersion: ANALYSIS_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    buildRoot,
    modes,
    totals
  };
};

const hasKindBreakdown = (analysis) => ANALYSIS_MODE_KEYS.some((modeKey) => {
  const mode = analysis?.modes?.[modeKey];
  return Number.isFinite(Number(mode?.classes))
    || Number.isFinite(Number(mode?.functions));
});

const featureMetricsByCacheRoot = new Map();
const loadFeatureMetricsForPayload = (payload) => {
  const repoRoot = payload?.repo?.root || payload?.artifacts?.repo?.root || null;
  const repoMetrics = repoRoot ? loadFeatureMetricsCached(repoRoot) : null;
  if (repoMetrics) return repoMetrics;
  const cacheRoot = payload?.artifacts?.repo?.cacheRoot;
  if (!cacheRoot || typeof cacheRoot !== 'string') return null;
  if (featureMetricsByCacheRoot.has(cacheRoot)) return featureMetricsByCacheRoot.get(cacheRoot);
  const runPath = path.join(cacheRoot, 'metrics', 'feature-metrics-run.json');
  const mergedPath = path.join(cacheRoot, 'metrics', 'feature-metrics.json');
  const metrics = loadJson(runPath) || loadJson(mergedPath) || null;
  featureMetricsByCacheRoot.set(cacheRoot, metrics);
  return metrics;
};

const loadOrComputeIndexingSummary = ({ payload, featureMetrics }) => {
  const existing = payload?.artifacts?.indexing;
  if (isValidIndexingSummary(existing)) {
    return { indexingSummary: existing, changed: false, featureMetrics };
  }
  if (!refreshJson) {
    return { indexingSummary: null, changed: false, featureMetrics };
  }
  const metrics = featureMetrics || loadFeatureMetricsForPayload(payload);
  const computed = buildIndexingSummaryFromFeatureMetrics(metrics)
    || buildIndexingSummaryFromThroughput(payload?.artifacts?.throughput);
  if (!computed) {
    return { indexingSummary: null, changed: false, featureMetrics: metrics };
  }
  if (!payload.artifacts || typeof payload.artifacts !== 'object') payload.artifacts = {};
  payload.artifacts.indexing = computed;
  return { indexingSummary: computed, changed: true, featureMetrics: metrics };
};

const loadOrComputeBenchAnalysis = ({ payload, featureMetrics, indexingSummary }) => {
  const existing = payload?.artifacts?.analysis;
  if (existing
    && typeof existing === 'object'
    && existing.schemaVersion === ANALYSIS_SCHEMA_VERSION
    && hasAstGraphValues(existing.totals)
    && (!deepAnalysis || hasKindBreakdown(existing))) {
    return { analysis: existing, changed: false };
  }
  if (!refreshJson) {
    return { analysis: null, changed: false };
  }
  const computed = computeBenchAnalysis(payload, {
    includeKindCounts: deepAnalysis,
    featureMetrics,
    indexingSummary
  });
  if (!computed) return { analysis: null, changed: false };
  if (!payload.artifacts || typeof payload.artifacts !== 'object') payload.artifacts = {};
  payload.artifacts.analysis = computed;
  return { analysis: computed, changed: true };
};

if (!fs.existsSync(resultsRoot)) {
  console.error(`No benchmark results found at ${resultsRoot}`);
  process.exit(1);
}

const folders = listDirs(resultsRoot).filter((dir) => includeResultsFolder(dir.name));
if (!folders.length) {
  console.error('No benchmark results folders found.');
  process.exit(0);
}

const totalThroughput = {
  code: createRateTotals(),
  prose: createRateTotals(),
  extractedProse: createRateTotals(),
  records: createRateTotals(),
  lmdb: {
    code: createRateTotals(),
    prose: createRateTotals()
  }
};
const languageTotals = new Map();
const modeTotalsGlobal = createModeTotalsMap();
const reposWithMetrics = new Set();
const astGraphTotalsGlobal = { repos: 0, totals: createAstGraphTotals(), observed: createAstGraphObserved() };

console.error(color.bold(color.cyan('Benchmark Performance Overview')));
console.error(color.gray(`Root: ${resultsRoot}`));
if (refreshJson) {
  const depthLabel = deepAnalysis ? 'deep analysis enabled' : 'deep analysis disabled';
  console.error(color.gray(`Refresh mode: writing benchmark JSON summaries (${depthLabel}).`));
}

for (const dir of folders) {
  const folderPath = path.join(resultsRoot, dir.name);
  const files = fs.readdirSync(folderPath).filter((name) => name.endsWith('.json'));
  const runs = [];
  const throughputs = [];
  const modeTotalsFolder = createModeTotalsMap();
  const folderReposWithMetrics = new Set();
  const astGraphTotalsFolder = { repos: 0, totals: createAstGraphTotals(), observed: createAstGraphObserved() };

  for (const file of files) {
    const resultPath = path.join(folderPath, file);
    const payload = loadJson(resultPath);
    if (!payload) continue;
    const summary = payload.summary || payload.runs?.[0] || null;
    const throughput = payload.artifacts?.throughput || {};
    let dirty = false;
    const featureMetrics = loadFeatureMetricsForPayload(payload);
    const {
      indexingSummary,
      changed: indexingChanged,
      featureMetrics: resolvedFeatureMetrics
    } = loadOrComputeIndexingSummary({
      payload,
      featureMetrics
    });
    if (indexingChanged) dirty = true;
    const { analysis, changed: analysisChanged } = loadOrComputeBenchAnalysis({
      payload,
      featureMetrics: resolvedFeatureMetrics,
      indexingSummary
    });
    if (analysisChanged) dirty = true;
    if (dirty && refreshJson) {
      try {
        fs.writeFileSync(resultPath, JSON.stringify(payload, null, 2));
      } catch {}
    }
    runs.push({ file, summary, throughput, analysis, indexingSummary });
    throughputs.push(throughput);
    mergeTotals(totalThroughput.code, throughput.code);
    mergeTotals(totalThroughput.prose, throughput.prose);
    mergeTotals(totalThroughput.extractedProse, throughput.extractedProse);
    mergeTotals(totalThroughput.records, throughput.records);
    mergeTotals(totalThroughput.lmdb.code, throughput?.lmdb?.code);
    mergeTotals(totalThroughput.lmdb.prose, throughput?.lmdb?.prose);
    const repoIdentity = payload.repo?.root
      || payload?.artifacts?.repo?.root
      || payload?.artifacts?.repo?.cacheRoot
      || null;
    if (isValidIndexingSummary(indexingSummary)) {
      if (repoIdentity && !folderReposWithMetrics.has(repoIdentity)) {
        mergeModeTotalsFromIndexingSummary(indexingSummary, modeTotalsFolder);
        folderReposWithMetrics.add(repoIdentity);
      }
      if (repoIdentity && !reposWithMetrics.has(repoIdentity)) {
        mergeModeTotalsFromIndexingSummary(indexingSummary, modeTotalsGlobal);
        collectLanguageLinesFromSummary(indexingSummary, languageTotals);
        reposWithMetrics.add(repoIdentity);
      }
    } else if (repoIdentity && !folderReposWithMetrics.has(repoIdentity)) {
      const metrics = resolvedFeatureMetrics || loadFeatureMetricsForPayload(payload);
      if (metrics) {
        mergeModeTotalsFromFeatureMetrics(metrics, modeTotalsFolder);
        folderReposWithMetrics.add(repoIdentity);
      }
    }
    if (repoIdentity && !reposWithMetrics.has(repoIdentity) && !isValidIndexingSummary(indexingSummary)) {
      const metrics = resolvedFeatureMetrics || loadFeatureMetricsForPayload(payload);
      if (metrics) {
        collectLanguageLines(metrics, languageTotals);
        mergeModeTotalsFromFeatureMetrics(metrics, modeTotalsGlobal);
      }
      reposWithMetrics.add(repoIdentity);
    }
    if (analysis && hasAstGraphValues(analysis.totals)) {
      astGraphTotalsFolder.repos += 1;
      astGraphTotalsGlobal.repos += 1;
      mergeAstGraphTotals(astGraphTotalsFolder.totals, analysis.totals);
      mergeAstGraphTotals(astGraphTotalsGlobal.totals, analysis.totals);
      mergeAstGraphObserved(astGraphTotalsFolder.observed, analysis);
      mergeAstGraphObserved(astGraphTotalsGlobal.observed, analysis);
    }
  }

  const header = `${dir.name}`;
  console.error('');
  console.error(color.bold(color.blue(header)));

  if (!runs.length) {
    console.error(color.gray('  No benchmark JSON files found.'));
    continue;
  }

  const avgCode = meanThroughput(throughputs, (throughput) => throughput?.code || null);
  const avgProse = meanThroughput(throughputs, (throughput) => throughput?.prose || null);
  const avgXProse = meanThroughput(throughputs, (throughput) => throughput?.extractedProse || null);
  const avgRecords = meanThroughput(throughputs, (throughput) => throughput?.records || null);
  console.error(`  ${formatModeThroughputLine({ label: 'Code', entry: avgCode })}`);
  console.error(`  ${formatModeThroughputLine({ label: 'Prose', entry: avgProse })}`);
  console.error(`  ${formatModeThroughputLine({ label: 'XProse', entry: avgXProse })}`);
  console.error(`  ${formatModeThroughputLine({ label: 'Records', entry: avgRecords })}`);

  const indexedRows = buildIndexedTotalsRows(modeTotalsFolder);
  if (indexedRows.length) {
    const lineWidth = Math.max(...indexedRows.map((row) => row.linesText.length));
    const fileWidth = Math.max(...indexedRows.map((row) => row.filesText.length));
    const bytesWidth = Math.max(...indexedRows.map((row) => row.bytesText.length));
    const rateWidth = Math.max(...indexedRows.map((row) => row.linesPerSecText.length));
    console.error(`  ${color.bold('Indexed totals')}:`);
    for (const row of indexedRows) {
      console.error(
        `    ${row.label.padStart(8)}: ${row.linesText.padStart(lineWidth)} | ` +
        `${row.filesText.padStart(fileWidth)} | ` +
        `${row.bytesText.padStart(bytesWidth)} | ` +
        `${row.linesPerSecText.padStart(rateWidth)} | ` +
        `${row.msPerLineText}`
      );
    }

    const aggregate = Array.from(modeTotalsFolder.values()).reduce(
      (acc, entry) => {
        acc.lines += Number.isFinite(entry.lines) ? entry.lines : 0;
        acc.files += Number.isFinite(entry.files) ? entry.files : 0;
        acc.bytes += Number.isFinite(entry.bytes) ? entry.bytes : 0;
        acc.durationMs += Number.isFinite(entry.durationMs) ? entry.durationMs : 0;
        return acc;
      },
      { lines: 0, files: 0, bytes: 0, durationMs: 0 }
    );
    const aggregateLinesPerSec = aggregate.durationMs > 0 ? (aggregate.lines / (aggregate.durationMs / 1000)) : null;
    const aggregateMsPerLine = (aggregate.durationMs > 0 && aggregate.lines > 0)
      ? (aggregate.durationMs / aggregate.lines)
      : null;
    const aggregateLinesText = `${formatCount(aggregate.lines)} lines`;
    const aggregateFilesText = `${formatCount(aggregate.files)} files`;
    const aggregateBytesText = formatBytes(aggregate.bytes);
    const aggregateRateText = `${formatNumber(aggregateLinesPerSec)} lines/s`;
    const aggregateMsPerLineText = `${formatNumber(aggregateMsPerLine, 3)} ms/line`;
    console.error(
      `     Aggregate: ` +
      `${aggregateLinesText.padStart(lineWidth)} | ` +
      `${aggregateFilesText.padStart(fileWidth)} | ` +
      `${aggregateBytesText.padStart(bytesWidth)} | ` +
      `${aggregateRateText.padStart(rateWidth)} | ` +
      `${aggregateMsPerLineText}`
    );
  }

  const summaries = runs.map((r) => r.summary).filter(Boolean);
  if (summaries.length) {
    const buildIndexMs = mean(collect(summaries, (s) => s.buildMs?.index));
    const buildSqliteMs = mean(collect(summaries, (s) => s.buildMs?.sqlite));
    console.error(
      formatSectionMetaLine({
        label: 'Build',
        left: `index ${formatMs(buildIndexMs)}`,
        right: `sqlite ${formatMs(buildSqliteMs)}`
      })
    );

    const wallPerQuery = mean(collect(summaries, (s) => s.queryWallMsPerQuery));
    const wallPerSearch = mean(collect(summaries, (s) => s.queryWallMsPerSearch));
    console.error(
      formatSectionMetaLine({
        label: 'Query',
        left: `avg/q ${formatMs(wallPerQuery)}`,
        right: `avg/search ${formatMs(wallPerSearch)}`
      })
    );

    const backendLatency = {};
    for (const summary of summaries) {
      const latency = summary.latencyMs || {};
      for (const [backend, stats] of Object.entries(latency)) {
        if (!backendLatency[backend]) backendLatency[backend] = { mean: [], p95: [] };
        if (Number.isFinite(stats?.mean)) backendLatency[backend].mean.push(stats.mean);
        if (Number.isFinite(stats?.p95)) backendLatency[backend].p95.push(stats.p95);
      }
    }
    const memoryMean = mean(backendLatency.memory?.mean || []);
    const memoryP95 = mean(backendLatency.memory?.p95 || []);
    const sqliteMean = mean(backendLatency.sqlite?.mean || []);
    const sqliteP95 = mean(backendLatency.sqlite?.p95 || []);
    console.error('  Latency');
    console.error(
      `      mem: ${formatNumber(memoryMean)}ms` +
      ` | sqlite: ${formatNumber(sqliteMean)}ms`
    );
    console.error(
      `      (p95 ${formatNumber(memoryP95)}ms)` +
      ` | (p95 ${formatNumber(sqliteP95)}ms)`
    );
  }

  if (hasAstGraphValues(astGraphTotalsFolder.totals)) {
    const coverage = runs.length ? `${astGraphTotalsFolder.repos}/${runs.length}` : `${astGraphTotalsFolder.repos}/0`;
    console.error(
      `  ${color.bold(`AST/Graph (${coverage} runs)`)}: ` +
      `symbols ${formatAstField(astGraphTotalsFolder, 'symbols')} | ` +
      `classes ${formatAstField(astGraphTotalsFolder, 'classes')} | ` +
      `functions ${formatAstField(astGraphTotalsFolder, 'functions')} | ` +
      `imports ${formatAstField(astGraphTotalsFolder, 'imports')} | ` +
      `file links ${formatAstField(astGraphTotalsFolder, 'fileLinks')} | ` +
      `graph links ${formatAstField(astGraphTotalsFolder, 'graphLinks')}`
    );
  }

  const runRows = runs.map((run) => {
    const repoLabel = run.file.replace(/\.json$/, '').replace(/__/g, '/');
    const codeText = `${formatNumber(run.throughput?.code?.chunksPerSec)} ch/s`;
    const proseText = `${formatNumber(run.throughput?.prose?.chunksPerSec)} ch/s`;
    const xproseText = `${formatNumber(run.throughput?.extractedProse?.chunksPerSec)} ch/s`;
    const recordsText = `${formatNumber(run.throughput?.records?.chunksPerSec)} ch/s`;
    const queryText = formatMs(run.summary?.queryWallMsPerQuery);
    return {
      repoLabel,
      codeText,
      proseText,
      xproseText,
      recordsText,
      queryText
    };
  });
  const repoWidth = Math.max('repo'.length, ...runRows.map((row) => row.repoLabel.length));
  const codeWidth = Math.max('code'.length, ...runRows.map((row) => row.codeText.length));
  const proseWidth = Math.max('prose'.length, ...runRows.map((row) => row.proseText.length));
  const xproseWidth = Math.max('xprose'.length, ...runRows.map((row) => row.xproseText.length));
  const recordsWidth = Math.max('records'.length, ...runRows.map((row) => row.recordsText.length));
  const queryWidth = Math.max('query'.length, ...runRows.map((row) => row.queryText.length));

  console.error('');
  console.error(color.gray(
    `${`(${runs.length} run${runs.length === 1 ? '' : 's'})`.padStart(repoWidth)}` +
    ` | ${'code'.padStart(codeWidth)}` +
    ` | ${'prose'.padStart(proseWidth)}` +
    ` | ${'xprose'.padStart(xproseWidth)}` +
    ` | ${'records'.padStart(recordsWidth)}` +
    ` | ${'query'.padStart(queryWidth)}`
  ));
  for (const row of runRows) {
    console.error(
      `${row.repoLabel.padEnd(repoWidth)} | ` +
      `${row.codeText.padStart(codeWidth)} | ` +
      `${row.proseText.padStart(proseWidth)} | ` +
      `${row.xproseText.padStart(xproseWidth)} | ` +
      `${row.recordsText.padStart(recordsWidth)} | ` +
      `${row.queryText.padStart(queryWidth)}`
    );
  }
}

const totalFilesPerSec = sumRates(
  rateFromTotals(totalThroughput.code, 'files'),
  rateFromTotals(totalThroughput.prose, 'files'),
  rateFromTotals(totalThroughput.extractedProse, 'files'),
  rateFromTotals(totalThroughput.records, 'files')
);
const totalChunksPerSec = sumRates(
  rateFromTotals(totalThroughput.code, 'chunks'),
  rateFromTotals(totalThroughput.prose, 'chunks'),
  rateFromTotals(totalThroughput.extractedProse, 'chunks'),
  rateFromTotals(totalThroughput.records, 'chunks')
);
const totalTokensPerSec = sumRates(
  rateFromTotals(totalThroughput.code, 'tokens'),
  rateFromTotals(totalThroughput.prose, 'tokens'),
  rateFromTotals(totalThroughput.extractedProse, 'tokens'),
  rateFromTotals(totalThroughput.records, 'tokens')
);
const totalBytesPerSec = sumRates(
  rateFromTotals(totalThroughput.code, 'bytes'),
  rateFromTotals(totalThroughput.prose, 'bytes'),
  rateFromTotals(totalThroughput.extractedProse, 'bytes'),
  rateFromTotals(totalThroughput.records, 'bytes')
);

const aggregateModeTotalsGlobal = Array.from(modeTotalsGlobal.values()).reduce(
  (acc, entry) => {
    acc.lines += Number.isFinite(entry.lines) ? entry.lines : 0;
    acc.durationMs += Number.isFinite(entry.durationMs) ? entry.durationMs : 0;
    return acc;
  },
  { lines: 0, durationMs: 0 }
);
const totalLinesPerSec = (aggregateModeTotalsGlobal.durationMs > 0)
  ? (aggregateModeTotalsGlobal.lines / (aggregateModeTotalsGlobal.durationMs / 1000))
  : null;

const modeRows = MODE_THROUGHPUT_TOTALS.map(({ label, pick, modeKey }) => {
  const entry = pick(totalThroughput);
  const chunksRate = rateFromTotals(entry, 'chunks');
  const tokensRate = rateFromTotals(entry, 'tokens');
  const bytesRate = rateFromTotals(entry, 'bytes');
  const filesRate = rateFromTotals(entry, 'files');
  const bytesMbRate = Number.isFinite(bytesRate) ? (bytesRate / (1024 * 1024)) : null;
  const linesBucket = modeTotalsGlobal.get(modeKey);
  const linesPerSec = (Number.isFinite(linesBucket?.durationMs) && linesBucket.durationMs > 0 && Number.isFinite(linesBucket?.lines))
    ? (linesBucket.lines / (linesBucket.durationMs / 1000))
    : null;
  return {
    label,
    chunksCell: formatThroughputTotalsCell(chunksRate, 'chunks/s', 4),
    tokensCell: formatThroughputTotalsCell(tokensRate, 'tokens/s', 7),
    bytesCell: formatThroughputTotalsCell(bytesMbRate, 'MB/s', 3),
    filesCell: formatThroughputTotalsCell(filesRate, 'files/s', 4),
    linesCell: Number.isFinite(linesPerSec)
      ? formatThroughputTotalsCell(linesPerSec, 'lines/s', 6)
      : '',
    linesPerSec
  };
});

const chunksWidth = Math.max(...modeRows.map((row) => row.chunksCell.length));
const tokensWidth = Math.max(...modeRows.map((row) => row.tokensCell.length));
const bytesWidth = Math.max(...modeRows.map((row) => row.bytesCell.length));
const filesWidth = Math.max(...modeRows.map((row) => row.filesCell.length));
const linesWidth = Math.max(0, ...modeRows.map((row) => row.linesCell.length));

console.error('');
console.error(color.bold(color.green('Throughput Totals')));
printAlignedTotalLine('Files', `${formatNumber(totalFilesPerSec)} files/s`);
printAlignedTotalLine('Chunks', `${formatNumber(totalChunksPerSec)} chunks/s`);
printAlignedTotalLine('Tokens', `${formatNumber(totalTokensPerSec)} tokens/s`);
printAlignedTotalLine('Bytes', formatBytesPerSec(totalBytesPerSec));
if (Number.isFinite(totalLinesPerSec)) {
  printAlignedTotalLine('Lines', `${formatNumber(totalLinesPerSec)} lines/s`);
}
for (const row of modeRows) {
  const linesText = row.linesCell ? row.linesCell.padStart(linesWidth) : '';
  printAlignedTotalLine(
    row.label,
    `${row.chunksCell.padStart(chunksWidth)} | ` +
    `${row.tokensCell.padStart(tokensWidth)} | ` +
    `${row.bytesCell.padStart(bytesWidth)} | ` +
    `${row.filesCell.padStart(filesWidth)} | ` +
    `${linesText}`
  );
}
for (const { label, pick } of THROUGHPUT_GROUPS) {
  if (['Code throughput', 'Prose throughput', 'Extracted prose throughput', 'Records throughput']
    .some((entry) => entry.toLowerCase() === label.toLowerCase())) {
    continue;
  }
  const entry = pick(totalThroughput);
  const chunksPerSec = rateFromTotals(entry, 'chunks');
  const tokensPerSec = rateFromTotals(entry, 'tokens');
  const bytesPerSec = rateFromTotals(entry, 'bytes');
  const filesPerSec = rateFromTotals(entry, 'files');
  if (!Number.isFinite(chunksPerSec)
    && !Number.isFinite(tokensPerSec)
    && !Number.isFinite(bytesPerSec)
    && !Number.isFinite(filesPerSec)) {
    continue;
  }
  printAlignedTotalLine(
    label,
    `${formatNumber(chunksPerSec)} chunks/s | ` +
    `${formatNumber(tokensPerSec)} tokens/s | ` +
    `${formatBytesPerSec(bytesPerSec)} | ` +
    `${formatNumber(filesPerSec)} files/s`
  );
}
if (hasAstGraphValues(astGraphTotalsGlobal.totals)) {
  const astPairs = [
    ['Symbols', formatAstField(astGraphTotalsGlobal, 'symbols'), 'Classes', formatAstField(astGraphTotalsGlobal, 'classes')],
    ['Functions', formatAstField(astGraphTotalsGlobal, 'functions'), 'Imports', formatAstField(astGraphTotalsGlobal, 'imports')],
    ['File links', formatAstField(astGraphTotalsGlobal, 'fileLinks'), 'Graph links', formatAstField(astGraphTotalsGlobal, 'graphLinks')]
  ];
  const astLabelWidth = Math.max(...astPairs.flatMap(([leftLabel, , rightLabel]) => [leftLabel.length, rightLabel.length]));
  const astValueWidth = Math.max(...astPairs.flatMap(([, leftValue, , rightValue]) => [String(leftValue).length, String(rightValue).length]));
  console.error(color.bold('AST/Graph Totals'));
  for (const [leftLabel, leftValue, rightLabel, rightValue] of astPairs) {
    console.error(
      `  ${leftLabel.padStart(astLabelWidth)}: ${String(leftValue).padStart(astValueWidth)} | ` +
      `${rightLabel.padStart(astLabelWidth)}: ${String(rightValue).padStart(astValueWidth)}`
    );
  }
}

const totalsByModeRows = [
  { modeKey: 'code', label: 'Code' },
  { modeKey: 'prose', label: 'Prose' },
  { modeKey: 'extracted-prose', label: 'XProse' },
  { modeKey: 'records', label: 'Records' }
].map(({ modeKey, label }) => {
  const totals = modeTotalsGlobal.get(modeKey);
  if (!Number.isFinite(totals?.lines) || totals.lines <= 0) return null;
  const linesText = `${formatCount(totals.lines)} lines`;
  const filesText = `${formatCount(totals.files)} files`;
  const bytesText = formatBytes(totals.bytes);
  const linesPerSec = (Number.isFinite(totals.durationMs) && totals.durationMs > 0)
    ? (totals.lines / (totals.durationMs / 1000))
    : null;
  const lineRateText = `${formatNumber(linesPerSec)} lines/s`;
  const msPerLine = (Number.isFinite(totals.durationMs) && totals.durationMs > 0 && totals.lines > 0)
    ? (totals.durationMs / totals.lines)
    : null;
  const msPerLineText = `${formatNumber(msPerLine, 3)} ms/line`;
  return {
    label,
    linesText,
    filesText,
    bytesText,
    lineRateText,
    msPerLineText
  };
}).filter(Boolean);

if (totalsByModeRows.length) {
  const lineWidth = Math.max(...totalsByModeRows.map((row) => row.linesText.length));
  const fileWidth = Math.max(...totalsByModeRows.map((row) => row.filesText.length));
  const bytesWidth = Math.max(...totalsByModeRows.map((row) => row.bytesText.length));
  const rateWidth = Math.max(...totalsByModeRows.map((row) => row.lineRateText.length));
  console.error('');
  console.error('  Totals by Mode:');
  for (const row of totalsByModeRows) {
    console.error(
      `  ${row.label.padStart(8)}: ${row.linesText.padStart(lineWidth)} | ` +
      `${row.filesText.padStart(fileWidth)} | ` +
      `${row.bytesText.padStart(bytesWidth)} | ` +
      `${row.lineRateText.padStart(rateWidth)} | ` +
      `${row.msPerLineText}`
    );
  }
}
if (languageTotals.size) {
  const sortedLanguages = Array.from(languageTotals.entries())
    .sort((a, b) => b[1] - a[1]);
  const languageWidth = Math.max(...sortedLanguages.map(([language]) => language.length));
  const countWidth = Math.max(...sortedLanguages.map(([, lines]) => formatCount(lines).length));
  console.error('');
  console.error('Lines by Language:');
  for (const [language, lines] of sortedLanguages) {
    console.error(`  ${language.padStart(languageWidth)}: ${formatCount(lines).padStart(countWidth)} `);
  }
}
