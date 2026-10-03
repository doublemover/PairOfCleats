#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { createCli } from '../../src/shared/cli.js';
import { formatBytes } from '../../src/shared/disk-space.js';
import { getStatus } from '../../src/integrations/core/status.js';
import { validateIndexArtifacts } from '../../src/index/validate.js';
import { loadJsonArrayArtifactRows } from '../../src/shared/artifact-io/loaders.js';
import { readJsonFileSyncSafe } from '../../src/shared/file-read.js';
import { getMetricsDir, resolveRepoConfig } from '../shared/dict-utils.js';
import { buildScanProfile } from './report-artifacts/scan-profile.js';
import {
  buildIndexingSummaryFromFeatureMetrics,
  buildIndexingSummaryFromThroughput,
  toFiniteOrNull
} from '../reports/show-throughput/aggregate.js';
import {
  createAstGraphTotals,
  mergeAstGraphTotals,
  sumKindsByPattern,
  sumKindCounts
} from '../reports/show-throughput/ast-summary.js';
import { resolveBuildRootFromSqliteArtifacts } from '../reports/show-throughput/build-root.js';

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
  return readJsonFileSyncSafe(targetPath, null);
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

const resolveBuildRootFromStatus = (artifactReport) => {
  const repo = artifactReport?.repo || {};
  const sqliteBuildRoot = resolveBuildRootFromSqliteArtifacts(artifactReport, { requireExisting: false });
  if (sqliteBuildRoot && fs.existsSync(sqliteBuildRoot)) return sqliteBuildRoot;
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
const scanProfile = buildScanProfile({
  artifactReport: status,
  indexMetrics,
  featureMetrics,
  throughput
});
const indexing = buildIndexingSummaryFromFeatureMetrics(featureMetrics, { normalizeLanguageKeys: false })
  || buildIndexingSummaryFromThroughput(throughput);
const analysis = await buildAnalysis({ artifactReport: status, indexingSummary: indexing });
status.throughput = throughput;
status.scanProfile = scanProfile;
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
