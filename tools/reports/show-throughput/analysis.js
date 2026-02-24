import fs from 'node:fs';
import path from 'node:path';
import {
  buildThroughputLedgerForTask,
  computeThroughputLedgerRegression,
  isValidThroughputLedger
} from '../../bench/language/metrics.js';
import {
  MODE_METRICS,
  toFiniteOrNull,
  isValidIndexingSummary,
  buildIndexingSummaryFromFeatureMetrics,
  buildIndexingSummaryFromThroughput
} from './aggregate.js';
import {
  loadJson,
  loadFeatureMetricsCached,
  loadFeatureMetricsForPayload
} from './load.js';

const ANALYSIS_SCHEMA_VERSION = 1;
const REPO_MAP_KIND_PATTERN = /"kind":"([^"]+)"/g;
const REPO_MAP_KIND_SCAN_TAIL_BYTES = 256;
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

const appendRepoMapKindCounts = (counts, text) => {
  if (!text) return;
  REPO_MAP_KIND_PATTERN.lastIndex = 0;
  let match = REPO_MAP_KIND_PATTERN.exec(text);
  while (match) {
    const kind = String(match[1] || '').trim();
    if (kind) counts[kind] = (counts[kind] || 0) + 1;
    match = REPO_MAP_KIND_PATTERN.exec(text);
  }
};

export const readRepoMapKindCountsSync = (repoMapPath) => {
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
      const scanUpto = Math.max(0, chunk.length - REPO_MAP_KIND_SCAN_TAIL_BYTES);
      appendRepoMapKindCounts(counts, chunk.slice(0, scanUpto));
      tail = chunk.slice(scanUpto);
    }
    appendRepoMapKindCounts(counts, tail);
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

export const createAstGraphTotals = () => ({
  symbols: 0,
  classes: 0,
  functions: 0,
  imports: 0,
  fileLinks: 0,
  graphLinks: 0
});

export const createAstGraphObserved = () => ({
  symbols: 0,
  classes: 0,
  functions: 0,
  imports: 0,
  fileLinks: 0,
  graphLinks: 0
});

export const mergeAstGraphTotals = (target, source) => {
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

export const mergeAstGraphObserved = (target, analysis) => {
  if (!target || !analysis) return;
  for (const key of Object.keys(target)) {
    if (!hasObservedAstField(analysis, key)) continue;
    target[key] += 1;
  }
};

export const hasAstGraphValues = (totals) => {
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

export const loadOrComputeIndexingSummary = ({
  payload,
  featureMetrics,
  refreshJson = false
}) => {
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

export const loadOrComputeBenchAnalysis = ({
  payload,
  featureMetrics,
  indexingSummary,
  refreshJson = false,
  deepAnalysis = false
}) => {
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

const GENERIC_PATH_SEGMENTS = new Set([
  'usr',
  'users',
  'home',
  'var',
  'tmp',
  'private',
  'opt',
  'mnt',
  'repos',
  'repo',
  'cache',
  'caches',
  'builds',
  'current'
]);

const normalizeRepoIdentityValue = (value, fallback = '') => {
  const candidate = String(value || '').trim();
  const fallbackText = String(fallback || '').trim();
  if (!candidate) return fallbackText;
  if (!candidate.includes('/') && !candidate.includes('\\')) return candidate;
  const normalized = candidate.replace(/[\\/]+/g, '/').replace(/\/+$/g, '');
  const segments = normalized.split('/').filter(Boolean);
  for (let i = segments.length - 1; i >= 0; i -= 1) {
    const segment = segments[i];
    const lower = segment.toLowerCase();
    if (!segment || GENERIC_PATH_SEGMENTS.has(lower)) continue;
    if (/^[a-z]:$/i.test(segment)) continue;
    return segment;
  }
  return fallbackText || candidate;
};

const normalizeRepoHistoryKeyValue = (value, fallback = '') => {
  const candidate = String(value || '').trim();
  const fallbackText = String(fallback || '').trim();
  if (!candidate) return fallbackText || 'unknown';
  if (!candidate.includes('/') && !candidate.includes('\\')) return candidate;
  const normalized = candidate.replace(/[\\/]+/g, '/').replace(/\/+$/g, '');
  return normalized || fallbackText || 'unknown';
};

export const resolveRepoIdentity = ({ payload, file }) => {
  const fileFallback = String(file || '').replace(/\.json$/i, '').trim();
  const candidate = payload?.repo?.root
    || payload?.artifacts?.repo?.root
    || fileFallback
    || payload?.artifacts?.repo?.cacheRoot
    || '';
  return normalizeRepoIdentityValue(candidate, fileFallback || 'unknown');
};

export const resolveRepoHistoryKey = ({ payload, file }) => {
  const fileFallback = String(file || '').replace(/\.json$/i, '').trim();
  const candidate = payload?.repo?.root
    || payload?.artifacts?.repo?.root
    || payload?.artifacts?.repo?.cacheRoot
    || fileFallback
    || '';
  return normalizeRepoHistoryKeyValue(candidate, fileFallback || 'unknown');
};

export const loadOrComputeThroughputLedger = ({ payload, indexingSummary }) => {
  const existing = payload?.artifacts?.throughputLedger;
  if (isValidThroughputLedger(existing)) {
    return { throughputLedger: existing, changed: false };
  }
  const computed = buildThroughputLedgerForTask({
    repoPath: payload?.repo?.root || payload?.artifacts?.repo?.root || null,
    summary: payload?.summary || payload?.runs?.[0] || null,
    throughput: payload?.artifacts?.throughput || null,
    indexingSummary: indexingSummary || payload?.artifacts?.indexing || null
  });
  if (!isValidThroughputLedger(computed)) {
    return { throughputLedger: null, changed: false };
  }
  if (!payload.artifacts || typeof payload.artifacts !== 'object') payload.artifacts = {};
  payload.artifacts.throughputLedger = computed;
  return { throughputLedger: computed, changed: true };
};

export const applyRunThroughputLedgerDiffs = (runs) => {
  const historyByRepo = new Map();
  for (const run of runs) {
    if (!isValidThroughputLedger(run?.throughputLedger)) {
      run.throughputLedgerDiff = null;
      continue;
    }
    const historyKey = String(run.repoHistoryKey || run.repoIdentity || '');
    const history = historyByRepo.get(historyKey) || [];
    run.throughputLedgerDiff = computeThroughputLedgerRegression({
      currentLedger: run.throughputLedger,
      baselineLedgers: history.slice(-3),
      metric: 'chunksPerSec'
    });
    history.push(run.throughputLedger);
    historyByRepo.set(historyKey, history);
  }
};

export const collectRunLedgerRegressions = (runs) => {
  const rows = [];
  for (const run of runs) {
    const regressions = run?.throughputLedgerDiff?.regressions || [];
    for (const regression of regressions.slice(0, 3)) {
      rows.push({
        file: run.file,
        repoIdentity: run.repoIdentity,
        modality: regression.modality,
        stage: regression.stage,
        deltaPct: regression.deltaPct,
        deltaRate: regression.deltaRate,
        currentRate: regression.currentRate,
        baselineRate: regression.baselineRate
      });
    }
  }
  rows.sort((left, right) => (
    Number(left.deltaPct) - Number(right.deltaPct)
  ) || String(left.repoIdentity || '').localeCompare(String(right.repoIdentity || '')));
  return rows;
};
