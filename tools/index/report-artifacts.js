#!/usr/bin/env node
import fs from 'node:fs';
import { readRuntimeReceipt, listRuntimeReceipts, formatRuntimeReceiptSummary } from '../../src/shared/runtime-envelope/read-receipt.js';
import { resolveRepoCacheRootPath, getIndexDir } from '../../src/shared/repo-paths.js';
import path from 'node:path';
import { INDEX_REPORT_OPTIONS } from '../../src/shared/index-tool-options.js';
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

const argv = createCli({
  scriptName: 'report-artifacts',
  options: INDEX_REPORT_OPTIONS
}).parse();

// Explicit roots are forensic reads: do not reload current config first.
if (argv.runtime || argv['index-root'] || argv.build || argv.attempt || argv.explain) {
  const options = { attemptId: argv.attempt, mode: argv.mode, explain: argv.explain, redactPaths: argv['redact-paths'] };
  let runtimeReport;
  if (argv['index-root']) {
    runtimeReport = { schemaVersion: 1, receipts: [await readRuntimeReceipt({ ...options, buildRoot: argv['index-root'] })], truncated: false };
  } else {
    const { repoRoot, userConfig: config } = resolveRepoConfig(argv.repo);
    const repoCacheRoot = resolveRepoCacheRootPath(repoRoot, config);
    if (argv.build) {
      if (!/^[^\\/]+$/u.test(argv.build) || argv.build === '.' || argv.build === '..') throw new Error('Invalid --build identifier.');
      runtimeReport = { schemaVersion: 1, receipts: [await readRuntimeReceipt({ ...options, buildRoot: path.join(repoCacheRoot, 'builds', argv.build), selection: 'explicit-build-id' })], truncated: false };
    } else {
      const modes = argv.mode ? [argv.mode] : ['code', 'prose', 'extracted-prose', 'records'];
      const publishedRoots = Array.from(new Set(modes.map((mode) => path.dirname(getIndexDir(repoRoot, mode, config)))));
      runtimeReport = await listRuntimeReceipts({ ...options, repoCacheRoot, publishedRoots });
    }
  }
  if (argv.json) console.log(JSON.stringify(runtimeReport, null, 2));
  else {
    for (const receipt of runtimeReport.receipts) console.error(formatRuntimeReceiptSummary(receipt).join('\n'));
    if (runtimeReport.truncated) console.error('Candidate list bounded; use --index-root or --build for an explicit selection.');
  }
  process.exit(0);
}

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
for (const [key, mode] of Object.entries({ code: 'code', prose: 'prose', extractedProse: 'extracted-prose', records: 'records' })) {
  const selected = status.repo?.indexDirs?.[mode];
  if (!selected || typeof indexMetrics[key]?.indexDir !== 'string'
    || path.resolve(indexMetrics[key].indexDir) !== path.resolve(selected)) indexMetrics[key] = null;
}
const lmdbMetrics = {
  code: readJson(path.join(metricsDir, 'lmdb-code.json')),
  prose: readJson(path.join(metricsDir, 'lmdb-prose.json'))
};
for (const mode of ['code', 'prose']) {
  if (!status.repo?.indexDirs?.[mode] || typeof lmdbMetrics[mode]?.indexDir !== 'string'
    || path.resolve(lmdbMetrics[mode].indexDir) !== path.resolve(status.repo.indexDirs[mode])) lmdbMetrics[mode] = null;
}
let featureMetrics = readJson(path.join(metricsDir, 'feature-metrics-run.json'))
  || readJson(path.join(metricsDir, 'feature-metrics.json'));
const selectedBuildRoots = [...new Set(Object.values(status.repo?.indexDirs || {}).map(directory => path.dirname(directory)))];
if (selectedBuildRoots.length !== 1 || typeof featureMetrics?.buildRoot !== 'string'
  || path.resolve(featureMetrics.buildRoot) !== path.resolve(selectedBuildRoots[0])) featureMetrics = null;

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

const resolveModeIndexDir = ({ artifactReport, modeKey }) => artifactReport?.repo?.indexDirs?.[modeKey] || null;

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
  const roots = [...new Set(Object.values(artifactReport?.repo?.indexDirs || {}).map(directory => path.dirname(directory)))];
  if (!roots.length) return null;
  const buildRoot = roots.length === 1 ? roots[0] : null;
  const modes = {};
  const totals = createAstGraphTotals();
  for (const modeKey of ANALYSIS_MODE_KEYS) {
    const modeDir = resolveModeIndexDir({ artifactReport, modeKey });
    const modeRoot = modeDir ? path.dirname(modeDir) : null;
    const buildState = modeRoot ? readJson(path.join(modeRoot, 'build_state.json')) : null;
    const modeAnalysis = await buildModeAnalysis({
      artifactReport,
      buildRoot: modeRoot,
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
  await new Promise((resolve, reject) => {
    process.stdout.write(`${JSON.stringify(status, null, 2)}\n`, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
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
for (const [mode, coverage] of Object.entries(status.coverage?.modes || {})) {
  console.error(`- ${mode} coverage: ${coverage.status}; scanned ${coverage.files?.scanned ?? 'unknown'}, skipped ${coverage.files?.skipped ?? 'unknown'}, chunks ${coverage.chunks ?? 'unknown'}; recorded ${coverage.generatedAt || 'unknown'}`);
  if (coverage.provenance?.head) console.error(`  indexed revision: ${JSON.stringify(coverage.provenance.head)}`);
  console.error(`  revision comparison: ${coverage.revisionComparison}`);
  if (coverage.files?.skippedByReason) console.error(`  skipped reasons: ${JSON.stringify(coverage.files.skippedByReason)}`);
}
console.error(`- working-tree freshness: bounded indexed-file comparison and new-file discovery (${status.coverage?.discovery?.status || 'unknown'})`);
for (const [mode, coverage] of Object.entries(status.coverage?.modes || {})) {
  const comparison = coverage.workingTree;
  if (!comparison) continue;
  console.error(`  ${mode}: ${comparison.status}; ${comparison.unchanged} unchanged; changed ${JSON.stringify(comparison.changed)}; missing ${JSON.stringify(comparison.missing)}; added ${JSON.stringify(comparison.added)}; unknown ${JSON.stringify(comparison.unknown)}${comparison.truncated ? '; truncated' : ''}`);
}
if (status.coverage?.watcher) console.error(`- watcher (last recorded): ${status.coverage.watcher.consistency}; backlog ${status.coverage.watcher.backlogDepth ?? 'unknown'}; process ${status.coverage.watcher.processStatus}; recorded ${status.coverage.watcher.recordedAt || 'unknown'}`);
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
