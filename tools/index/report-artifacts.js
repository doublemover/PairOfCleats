#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { createCli } from '../../src/shared/cli.js';
import { formatBytes } from '../../src/shared/disk-space.js';
import { getStatus } from '../../src/integrations/core/status.js';
import { validateIndexArtifacts } from '../../src/index/validate.js';
import { loadJsonArrayArtifactRows } from '../../src/shared/artifact-io/loaders.js';
import { getMetricsDir, resolveRepoConfig } from '../shared/dict-utils.js';

const argv = createCli({
  scriptName: 'report-artifacts',
  options: {
    json: { type: 'boolean', default: false },
    all: { type: 'boolean', default: false },
    repo: { type: 'string' }
  }
}).parse();

const { repoRoot: root, userConfig } = resolveRepoConfig(argv.repo);
const metricsDir = getMetricsDir(root, userConfig);
const status = await getStatus({ repoRoot: root, includeAll: argv.all });

const readJson = (targetPath) => {
  if (!fs.existsSync(targetPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(targetPath, 'utf8'));
  } catch {
    return null;
  }
};

const indexMetrics = {
  code: readJson(path.join(metricsDir, 'index-code.json')),
  prose: readJson(path.join(metricsDir, 'index-prose.json')),
  extractedProse: readJson(path.join(metricsDir, 'index-extracted-prose.json')),
  records: readJson(path.join(metricsDir, 'index-records.json'))
};
const lmdbMetrics = {
  code: readJson(path.join(metricsDir, 'lmdb-code.json')),
  prose: readJson(path.join(metricsDir, 'lmdb-prose.json'))
};
const featureMetrics = readJson(path.join(metricsDir, 'feature-metrics-run.json'))
  || readJson(path.join(metricsDir, 'feature-metrics.json'));

const INDEXING_SCHEMA_VERSION = 1;
const ANALYSIS_SCHEMA_VERSION = 1;
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
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const hasModeTotals = (totals) => (
  Number.isFinite(totals?.lines) && totals.lines > 0
) || (
  Number.isFinite(totals?.files) && totals.files > 0
);

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
  for (const modeKey of ANALYSIS_MODE_KEYS) {
    const modeEntry = metrics?.modes?.[modeKey];
    const modeTotals = buildModeIndexingSummary(modeEntry?.totals || null);
    modes[modeKey] = modeTotals;
    if (Number.isFinite(modeTotals.files)) totals.files += modeTotals.files;
    if (Number.isFinite(modeTotals.lines)) totals.lines += modeTotals.lines;
    if (Number.isFinite(modeTotals.bytes)) totals.bytes += modeTotals.bytes;
    if (Number.isFinite(modeTotals.durationMs)) totals.durationMs += modeTotals.durationMs;
    if (hasModeTotals(modeTotals)) hasData = true;
    for (const [language, bucket] of Object.entries(modeEntry?.languages || {})) {
      const lines = Number(bucket?.lines);
      if (!Number.isFinite(lines) || lines <= 0) continue;
      languageLines[language] = (languageLines[language] || 0) + lines;
    }
  }
  if (!hasData) return null;
  const linesPerSec = totals.durationMs > 0 ? (totals.lines / (totals.durationMs / 1000)) : null;
  return {
    schemaVersion: INDEXING_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    source: 'feature-metrics',
    modes,
    totals: {
      ...totals,
      linesPerSec
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
  for (const modeKey of ANALYSIS_MODE_KEYS) {
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

const resolveBuildRootFromStatus = (artifactReport) => {
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

const mergeAstGraphTotals = (target, source) => {
  if (!target || !source) return;
  for (const key of Object.keys(target)) {
    const value = Number(source[key]);
    if (!Number.isFinite(value)) continue;
    target[key] += value;
  }
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

const resolveModeIndexDir = ({ artifactReport, buildRoot, modeKey }) => {
  const candidates = [
    buildRoot ? path.join(buildRoot, `index-${modeKey}`) : null,
    artifactReport?.repo?.cacheRoot ? path.join(artifactReport.repo.cacheRoot, `index-${modeKey}`) : null
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
};

const readArtifactMetaCount = (indexDir, baseName) => {
  if (!indexDir) return null;
  const directMetaPath = path.join(indexDir, `${baseName}.meta.json`);
  const directMeta = readJson(directMetaPath);
  if (Number.isFinite(Number(directMeta?.count))) return Number(directMeta.count);
  const manifest = readJson(path.join(indexDir, 'pieces', 'manifest.json'));
  const pieces = Array.isArray(manifest?.pieces) ? manifest.pieces : [];
  const metaEntry = pieces.find((entry) => entry?.name === `${baseName}_meta` && typeof entry?.path === 'string');
  if (!metaEntry) return null;
  const metaPath = path.join(indexDir, String(metaEntry.path));
  const manifestMeta = readJson(metaPath);
  const count = Number(manifestMeta?.count);
  return Number.isFinite(count) ? count : null;
};

const readRepoMapKindStats = async (indexDir) => {
  if (!indexDir) return null;
  const kindCounts = {};
  let rows = 0;
  try {
    for await (const row of loadJsonArrayArtifactRows(indexDir, 'repo_map', {
      strict: false,
      maxInFlight: 512
    })) {
      rows += 1;
      const kind = typeof row?.kind === 'string' ? row.kind.trim() : '';
      if (!kind) continue;
      kindCounts[kind] = (kindCounts[kind] || 0) + 1;
    }
  } catch {
    return null;
  }
  return { rows, kindCounts };
};

const loadStage2Artifacts = (buildState, modeKey) => (
  buildState?.orderingLedger?.stages?.[`stage2:${modeKey}`]?.artifacts || {}
);

const analysisCountFromArtifacts = (artifacts, key) => {
  const value = Number(artifacts?.[key]?.count);
  return Number.isFinite(value) ? value : null;
};

const buildModeAnalysis = async ({ artifactReport, buildRoot, buildState, modeKey, indexingSummary }) => {
  const artifacts = loadStage2Artifacts(buildState, modeKey);
  const modeTotals = indexingSummary?.modes?.[modeKey] || null;
  const lines = toFiniteOrNull(modeTotals?.lines);
  const durationMs = toFiniteOrNull(modeTotals?.durationMs);
  const linesPerSec = (Number.isFinite(lines) && Number.isFinite(durationMs) && durationMs > 0)
    ? (lines / (durationMs / 1000))
    : null;
  const indexDir = resolveModeIndexDir({ artifactReport, buildRoot, modeKey });
  const kindStats = await readRepoMapKindStats(indexDir);
  const symbolCountFromKinds = sumKindCounts(kindStats?.kindCounts || null);
  const fileLinks = analysisCountFromArtifacts(artifacts, 'file_relations')
    ?? readArtifactMetaCount(indexDir, 'file_relations');
  const graphLinks = analysisCountFromArtifacts(artifacts, 'graph_relations')
    ?? readArtifactMetaCount(indexDir, 'graph_relations');
  const classes = kindStats ? sumKindsByPattern(kindStats.kindCounts, KIND_CLASS_PATTERNS) : null;
  const functions = kindStats ? sumKindsByPattern(kindStats.kindCounts, KIND_FUNCTION_PATTERNS) : null;
  const importsFromKinds = kindStats ? sumKindsByPattern(kindStats.kindCounts, KIND_IMPORT_PATTERNS) : 0;
  const imports = importsFromKinds > 0 ? importsFromKinds : fileLinks;
  const symbols = analysisCountFromArtifacts(artifacts, 'repo_map')
    ?? readArtifactMetaCount(indexDir, 'repo_map')
    ?? (symbolCountFromKinds || null);
  return {
    mode: modeKey,
    files: toFiniteOrNull(buildState?.counts?.[modeKey]?.files) ?? toFiniteOrNull(modeTotals?.files),
    chunks: toFiniteOrNull(buildState?.counts?.[modeKey]?.chunks),
    lines,
    durationMs,
    linesPerSec,
    symbols,
    classes: Number.isFinite(classes) ? classes : null,
    functions: Number.isFinite(functions) ? functions : null,
    imports: Number.isFinite(imports) ? imports : null,
    fileLinks,
    graphLinks
  };
};

const buildAnalysis = async ({ artifactReport, indexingSummary }) => {
  const buildRoot = resolveBuildRootFromStatus(artifactReport);
  const buildState = buildRoot ? readJson(path.join(buildRoot, 'build_state.json')) : null;
  if (!buildRoot && !artifactReport?.repo?.cacheRoot) return null;
  const modes = {};
  const totals = createAstGraphTotals();
  for (const modeKey of ANALYSIS_MODE_KEYS) {
    const modeAnalysis = await buildModeAnalysis({
      artifactReport,
      buildRoot,
      buildState,
      modeKey,
      indexingSummary
    });
    modes[modeKey] = modeAnalysis;
    mergeAstGraphTotals(totals, modeAnalysis);
  }
  const hasValues = Object.values(totals).some((value) => Number.isFinite(Number(value)) && Number(value) > 0);
  if (!hasValues) return null;
  return {
    schemaVersion: ANALYSIS_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    buildRoot,
    modes,
    totals
  };
};

const computeRate = (count, ms) => {
  const total = Number(count);
  const elapsed = Number(ms);
  if (!Number.isFinite(total) || !Number.isFinite(elapsed) || elapsed <= 0) return null;
  return total / (elapsed / 1000);
};

const buildThroughput = (mode, metrics, bytes) => {
  if (!metrics) return null;
  const totalMs = Number(metrics?.timings?.totalMs);
  const writeMs = Number(metrics?.timings?.writeMs);
  const files = Number(metrics?.files?.candidates);
  const chunks = Number(metrics?.chunks?.total);
  const tokens = Number(metrics?.tokens?.total);
  const payload = {
    mode,
    totalMs: Number.isFinite(totalMs) ? totalMs : null,
    writeMs: Number.isFinite(writeMs) ? writeMs : null,
    files: Number.isFinite(files) ? files : null,
    chunks: Number.isFinite(chunks) ? chunks : null,
    tokens: Number.isFinite(tokens) ? tokens : null,
    bytes: Number.isFinite(Number(bytes)) ? Number(bytes) : null
  };
  payload.filesPerSec = computeRate(payload.files, payload.totalMs);
  payload.chunksPerSec = computeRate(payload.chunks, payload.totalMs);
  payload.tokensPerSec = computeRate(payload.tokens, payload.totalMs);
  payload.bytesPerSec = computeRate(payload.bytes, payload.totalMs);
  payload.writeBytesPerSec = computeRate(payload.bytes, payload.writeMs);
  return payload;
};

const throughput = {
  code: buildThroughput('code', indexMetrics.code, status.repo?.artifacts?.indexCode),
  prose: buildThroughput('prose', indexMetrics.prose, status.repo?.artifacts?.indexProse),
  extractedProse: buildThroughput('extracted-prose', indexMetrics.extractedProse, status.repo?.artifacts?.indexExtractedProse),
  records: buildThroughput('records', indexMetrics.records, status.repo?.artifacts?.indexRecords),
  lmdb: {
    code: buildThroughput('lmdb code', lmdbMetrics.code, status.repo?.lmdb?.code?.bytes),
    prose: buildThroughput('lmdb prose', lmdbMetrics.prose, status.repo?.lmdb?.prose?.bytes)
  }
};

const corruption = await validateIndexArtifacts({
  root,
  userConfig,
  modes: ['code', 'prose', 'extracted-prose', 'records']
});
const indexing = buildIndexingSummaryFromFeatureMetrics(featureMetrics)
  || buildIndexingSummaryFromThroughput(throughput);
const analysis = await buildAnalysis({ artifactReport: status, indexingSummary: indexing });
status.throughput = throughput;
status.indexing = indexing;
status.analysis = analysis;
status.corruption = corruption;

if (argv.json) {
  console.log(JSON.stringify(status, null, 2));
  process.exit(0);
}

const formatBytesWithRaw = (value) => {
  const bytes = Number(value);
  if (!Number.isFinite(bytes)) return 'missing';
  return `${formatBytes(bytes)} (${bytes.toLocaleString()} bytes)`;
};

const repo = status.repo;
const repoRoot = repo?.root || root;
const repoCacheRoot = repo?.cacheRoot || repoRoot;
const overall = status.overall;
const code = repo.sqlite?.code;
const prose = repo.sqlite?.prose;
const extractedProse = repo.sqlite?.extractedProse;
const records = repo.sqlite?.records;
const lmdbCode = repo.lmdb?.code;
const lmdbProse = repo.lmdb?.prose;

console.error('Repo artifacts');
console.error(`- cache root: ${formatBytes(repo.totalBytes)} (${repoCacheRoot})`);
if (repoRoot) {
  console.error(`- repo root: ${repoRoot}`);
}
console.error(`- index-code: ${formatBytesWithRaw(repo.artifacts.indexCode)}`);
console.error(`- index-prose: ${formatBytesWithRaw(repo.artifacts.indexProse)}`);
console.error(`- index-extracted-prose: ${formatBytesWithRaw(repo.artifacts.indexExtractedProse)}`);
console.error(`- index-records: ${formatBytesWithRaw(repo.artifacts.indexRecords)}`);
console.error(`- metrics: ${formatBytes(repo.artifacts.metrics)} (${path.join(repoCacheRoot, 'metrics')})`);
console.error(`- query-cache: ${formatBytes(repo.artifacts.queryCache)} (${path.join(repoCacheRoot, 'query-cache')})`);
console.error(`- incremental: ${formatBytes(repo.artifacts.incremental)} (${path.join(repoCacheRoot, 'incremental')})`);
console.error(`- sqlite code db: ${code ? formatBytesWithRaw(code.bytes) : 'missing'} (${code?.path || status.repo.sqlite?.code?.path || 'missing'})`);
console.error(`- sqlite prose db: ${prose ? formatBytesWithRaw(prose.bytes) : 'missing'} (${prose?.path || status.repo.sqlite?.prose?.path || 'missing'})`);
console.error(`- sqlite extracted-prose db: ${extractedProse ? formatBytesWithRaw(extractedProse.bytes) : 'missing'} (${extractedProse?.path || status.repo.sqlite?.extractedProse?.path || 'missing'})`);
console.error(`- sqlite records db: ${records ? formatBytesWithRaw(records.bytes) : 'missing'} (${records?.path || status.repo.sqlite?.records?.path || 'missing'})`);
console.error(`- lmdb code db: ${lmdbCode ? formatBytesWithRaw(lmdbCode.bytes) : 'missing'} (${lmdbCode?.path || status.repo.lmdb?.code?.path || 'missing'})`);
console.error(`- lmdb prose db: ${lmdbProse ? formatBytesWithRaw(lmdbProse.bytes) : 'missing'} (${lmdbProse?.path || status.repo.lmdb?.prose?.path || 'missing'})`);
if (repo.sqlite?.legacy) {
  console.error(`- legacy sqlite db: ${repo.sqlite.legacy.path}`);
}

console.error('\nOverall');
console.error(`- cache root: ${formatBytes(overall.cacheBytes)} (${overall.cacheRoot})`);
console.error(`- dictionaries: ${formatBytes(overall.dictionaryBytes)}`);
if (overall.sqliteOutsideCacheBytes) {
  console.error(`- sqlite outside cache: ${formatBytes(overall.sqliteOutsideCacheBytes)}`);
}
if (overall.lmdbOutsideCacheBytes) {
  console.error(`- lmdb outside cache: ${formatBytes(overall.lmdbOutsideCacheBytes)}`);
}
console.error(`- total: ${formatBytes(overall.totalBytes)}`);

if (status.health?.issues?.length) {
  console.error('\nHealth');
  status.health.issues.forEach((issue) => console.error(`- issue: ${issue}`));
  status.health.hints.forEach((hint) => console.error(`- hint: ${hint}`));
}

if (status.throughput) {
  const formatRate = (value, unit) => (Number.isFinite(value) ? `${value.toFixed(1)} ${unit}/s` : 'n/a');
  const formatMs = (value) => (Number.isFinite(value) ? `${value.toFixed(0)} ms` : 'n/a');
  console.error('\nThroughput');
  const entries = [
    ['code', status.throughput.code],
    ['prose', status.throughput.prose],
    ['extracted-prose', status.throughput.extractedProse],
    ['records', status.throughput.records],
    ['lmdb code', status.throughput.lmdb?.code],
    ['lmdb prose', status.throughput.lmdb?.prose]
  ];
  for (const [mode, entry] of entries) {
    if (!entry) continue;
    console.error(
      `- ${mode}: files ${formatRate(entry.filesPerSec, 'files')}, ` +
      `chunks ${formatRate(entry.chunksPerSec, 'chunks')}, ` +
      `tokens ${formatRate(entry.tokensPerSec, 'tokens')}, ` +
      `bytes ${formatRate(entry.bytesPerSec, 'bytes')} (total ${formatMs(entry.totalMs)})`
    );
  }
}

if (status.corruption) {
  const validation = status.corruption;
  const statusLabel = validation.ok ? 'ok' : 'issues';
  console.error('\nIntegrity');
  console.error(`- index-validate: ${statusLabel}`);
  if (!validation.ok && validation.issues?.length) {
    validation.issues.forEach((issue) => console.error(`- issue: ${issue}`));
  }
  if (validation.warnings?.length) {
    validation.warnings.forEach((warning) => console.error(`- warning: ${warning}`));
  }
}

if (status.allRepos) {
  const repos = status.allRepos.repos.slice().sort((a, b) => b.bytes - a.bytes);
  console.error('\nAll repos');
  console.error(`- root: ${status.allRepos.root}`);
  console.error(`- total: ${formatBytes(status.allRepos.totalBytes)}`);
  for (const repoEntry of repos) {
    console.error(`- ${repoEntry.id}: ${formatBytes(repoEntry.bytes)} (${repoEntry.path})`);
  }
}
