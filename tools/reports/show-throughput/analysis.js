import { resolveRecordedMeasurementInputs, recordedLedgerProvenance, canReuseRecordedLedger, BENCH_MEASUREMENT_DERIVATION_VERSION } from '../../bench/language/metrics/recorded-evidence.js';
import fs from 'node:fs';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import {
  buildThroughputLedgerForTask,
  computeThroughputLedgerRegression,
  isValidThroughputLedger
} from '../../bench/language/metrics.js';
import {
  MODE_METRICS,
  toFiniteOrNull,
  isValidScanProfile,
  isValidIndexingSummary,
  buildIndexingSummaryFromScanProfile,
  buildIndexingSummaryFromFeatureMetrics,
  buildIndexingSummaryFromThroughput
} from './aggregate.js';
import {
  loadJson,
  loadFeatureMetricsForPayload
} from './load.js';
import { readFileStamp, toCachePathKey } from './cache-identity.js';
import { resolveBuildRootFromArtifactReport } from './build-root.js';
import {
  createAstGraphTotals,
  mergeAstGraphTotals,
  sumKindsByPattern,
  sumKindCounts
} from './ast-summary.js';

export {
  createAstGraphTotals,
  mergeAstGraphTotals
} from './ast-summary.js';

const ANALYSIS_SCHEMA_VERSION = 1;
const MATERIALIZATION_SCHEMA_VERSION = 1;
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
  const cacheKey = toCachePathKey(repoMapPath);
  const signature = readFileStamp(repoMapPath);
  const cached = REPO_MAP_KIND_CACHE.get(cacheKey);
  if (cached && cached.signature === signature) return cached.counts;
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
    REPO_MAP_KIND_CACHE.set(cacheKey, { signature, counts: null });
    if (fd != null) {
      try { fs.closeSync(fd); } catch {}
    }
    return null;
  }
  if (fd != null) {
    try { fs.closeSync(fd); } catch {}
  }
  REPO_MAP_KIND_CACHE.set(cacheKey, { signature, counts });
  return counts;
};

const topKinds = (kindCounts, limit = 8) => {
  if (!kindCounts) return [];
  return Object.entries(kindCounts)
    .filter(([, count]) => Number.isFinite(Number(count)) && Number(count) > 0)
    .sort((a, b) => Number(b[1]) - Number(a[1]))
    .slice(0, limit)
    .map(([kind, count]) => ({ kind, count: Number(count) }));
};

export const createAstGraphObserved = () => ({
  symbols: 0,
  classes: 0,
  functions: 0,
  imports: 0,
  fileLinks: 0,
  graphLinks: 0
});

const hasObservedAstField = (analysis, key) => ANALYSIS_MODE_KEYS.some((modeKey) => (
  Number.isFinite(analysis?.modes?.[modeKey]?.[key])
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
  const value = artifacts?.[key]?.count;
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
  const resolvedFeatureMetrics = featureMetrics || loadFeatureMetricsForPayload(payload);
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

const hasKindBreakdown = (analysis) => {
  const modes = ANALYSIS_MODE_KEYS.map(key => analysis?.modes?.[key]).filter(Boolean);
  return modes.length > 0 && modes.every(mode => Number.isFinite(mode.classes) && Number.isFinite(mode.functions));
};

export const loadOrComputeIndexingSummary = ({
  payload,
  featureMetrics,
  refreshJson = false
}) => {
  return refreshJson
    ? materializeIndexingSummary({ payload, featureMetrics })
    : resolveIndexingSummary({ payload, featureMetrics });
};

const createProvenance = (section, source, category) => ({
  section,
  source,
  category
});

const ensureArtifactsObject = (payload) => {
  if (!payload.artifacts || typeof payload.artifacts !== 'object') payload.artifacts = {};
  return payload.artifacts;
};

const upsertMaterializationSection = (payload, section, provenance) => {
  const artifacts = ensureArtifactsObject(payload);
  const nextEntry = {
    source: provenance?.source || 'unknown',
    category: provenance?.category || 'unknown',
    reason: 'backfill-missing-or-invalid-benchmark-artifact',
    ...(provenance?.derivation ? { derivation: provenance.derivation } : {})
  };
  const previous = artifacts.materialization
    && typeof artifacts.materialization === 'object'
    && artifacts.materialization.schemaVersion === MATERIALIZATION_SCHEMA_VERSION
    ? artifacts.materialization
    : null;
  const next = {
    schemaVersion: MATERIALIZATION_SCHEMA_VERSION,
    sections: {
      ...(previous?.sections || {}),
      [section]: nextEntry
    }
  };
  const changed = JSON.stringify(previous || null) !== JSON.stringify(next);
  artifacts.materialization = next;
  return changed;
};

export const resolveIndexingSummary = ({ payload, featureMetrics, preferExisting = true, measurementEvidence = null }) => {
  const existing = payload?.artifacts?.indexing;
  const scanProfile = payload?.artifacts?.scanProfile;
  const previous = payload?.artifacts?.materialization?.sections?.indexing;
  const existingResult = () => {
    const derived = existing?.derivation || (previous?.category === 'fallback' ? { state: 'legacy-materialized-source-unqualified' } : null);
    return { indexingSummary: derived ? { ...existing, derivation: derived } : existing, changed: false, featureMetrics,
      provenance: derived || previous ? { section: 'indexing', source: previous?.source || 'fallback-indexing-derived',
        category: previous?.category || 'fallback', derivation: derived } : createProvenance('indexing', 'native-indexing-summary', 'native') };
  };
  if (isValidIndexingSummary(existing) && (existingResult().provenance.source === 'native-indexing-summary'
    || preferExisting && existing?.derivation?.derivationVersion === BENCH_MEASUREMENT_DERIVATION_VERSION)) return existingResult();
  const evidence = measurementEvidence || resolveRecordedMeasurementInputs({ payload });
  const metrics = featureMetrics || evidence.featureMetrics;
  const derivedResult = (indexingSummary, source, category) => {
    if (!indexingSummary) return null;
    indexingSummary.generatedAt = typeof payload?.generatedAt === 'string' ? payload.generatedAt : null;
    indexingSummary.derivation = { derivationVersion: BENCH_MEASUREMENT_DERIVATION_VERSION, measurementReceipt: evidence.receipt,
      source, scope: 'recorded-report-observations' };
    return { indexingSummary, changed: false, featureMetrics: metrics,
      provenance: { ...createProvenance('indexing', source, category), derivation: indexingSummary.derivation } };
  };
  return derivedResult(buildIndexingSummaryFromScanProfile(scanProfile), 'native-scan-profile', 'native-derived')
    || derivedResult(buildIndexingSummaryFromFeatureMetrics(metrics), 'fallback-feature-metrics', 'fallback')
    || derivedResult(buildIndexingSummaryFromThroughput(payload?.artifacts?.throughput), 'fallback-throughput', 'fallback')
    || (isValidIndexingSummary(existing) ? existingResult() : { indexingSummary: null, changed: false, featureMetrics: metrics,
      provenance: createProvenance('indexing', 'missing', 'missing') });
};

export const loadOrComputeBenchAnalysis = ({
  payload,
  featureMetrics,
  indexingSummary,
  refreshJson = false,
  deepAnalysis = false
}) => {
  return refreshJson
    ? materializeBenchAnalysis({
      payload,
      featureMetrics,
      indexingSummary,
      deepAnalysis
    })
    : resolveBenchAnalysis({
      payload,
      featureMetrics,
      indexingSummary,
      deepAnalysis
    });
};

export const resolveBenchAnalysis = ({
  payload,
  featureMetrics,
  indexingSummary,
  deepAnalysis = false,
  preferExisting = true
}) => {
  const existing = payload?.artifacts?.analysis;
  const previous = payload?.artifacts?.materialization?.sections?.analysis;
  const existingProvenance = previous || existing?.derivation
    ? { section: 'analysis', source: previous?.source || existing?.derivation?.source || 'fallback-build-state',
      category: previous?.category || 'fallback',
      ...(previous?.derivation || existing?.derivation ? { derivation: previous?.derivation || existing.derivation } : {}) }
    : createProvenance('analysis', 'native-analysis', 'native');
  if (preferExisting && existing
    && typeof existing === 'object'
    && existing.schemaVersion === ANALYSIS_SCHEMA_VERSION
    && hasAstGraphValues(existing.totals)
    && (!deepAnalysis || hasKindBreakdown(existing))) {
    return {
      analysis: existing,
      changed: false,
      provenance: existingProvenance
    };
  }
  const computed = computeBenchAnalysis(payload, {
    includeKindCounts: deepAnalysis,
    featureMetrics,
    indexingSummary
  });
  if (computed) {
    return {
      analysis: computed,
      changed: false,
      provenance: createProvenance('analysis', 'fallback-build-state', 'fallback')
    };
  }
  if (!preferExisting
    && existing
    && typeof existing === 'object'
    && existing.schemaVersion === ANALYSIS_SCHEMA_VERSION
    && hasAstGraphValues(existing.totals)
    && (!deepAnalysis || hasKindBreakdown(existing))) {
    return {
      analysis: existing,
      changed: false,
      provenance: existingProvenance,
      ...(existingProvenance.category !== 'native' ? { refresh: { state: 'source-unavailable', reason: 'analysis-reconstruction-unavailable' } } : {})
    };
  }
  return {
    analysis: null,
    changed: false,
    provenance: createProvenance('analysis', 'missing', 'missing')
  };
};

export { resolveRepoIdentity, resolveRepoHistoryKey } from './run-identity.js';

export const loadOrComputeThroughputLedger = ({ payload, indexingSummary, measurementEvidence }) => {
  return materializeOrResolveThroughputLedger({
    payload,
    indexingSummary, measurementEvidence,
    materialize: false
  });
};

export const resolveThroughputLedger = ({ payload, indexingSummary, measurementEvidence }) => {
  return materializeOrResolveThroughputLedger({
    payload,
    indexingSummary, measurementEvidence,
    materialize: false,
    preferExisting: true
  });
};

const materializeOrResolveThroughputLedger = ({
  payload,
  indexingSummary,
  materialize = false,
  preferExisting = true, measurementEvidence = null
}) => {
  const existing = payload?.artifacts?.throughputLedger;
  const previous = payload?.artifacts?.materialization?.sections?.throughputLedger;
  const existingProvenance = recordedLedgerProvenance(existing, previous);
  if (isValidThroughputLedger(existing) && canReuseRecordedLedger(existing, previous, { preferExisting })) {
    return {
      throughputLedger: existing,
      changed: false,
      provenance: existingProvenance
    };
  }
  const evidence = measurementEvidence || resolveRecordedMeasurementInputs({ payload });
  const computed = buildThroughputLedgerForTask({
    metricsByMode: evidence.metricsByMode, measurementReceipt: evidence.receipt,
    repoPath: payload?.repo?.root || payload?.artifacts?.repo?.root || null,
    summary: payload?.summary || payload?.runs?.[0] || null,
    throughput: payload?.artifacts?.throughput || null,
    indexingSummary: indexingSummary || payload?.artifacts?.indexing || null
  });
  if (!isValidThroughputLedger(computed)) {
    return {
      throughputLedger: null,
      changed: false,
      provenance: createProvenance('throughput-ledger', 'missing', 'missing')
    };
  }
  if (!materialize) {
    return {
      throughputLedger: computed,
      changed: false,
      provenance: recordedLedgerProvenance(computed)
    };
  }
  const artifacts = ensureArtifactsObject(payload);
  const changed = JSON.stringify(artifacts.throughputLedger || null) !== JSON.stringify(computed);
  artifacts.throughputLedger = computed;
  const metadataChanged = upsertMaterializationSection(
    payload,
    'throughputLedger',
    recordedLedgerProvenance(computed)
  );
  return {
    throughputLedger: computed,
    changed: changed || metadataChanged,
    provenance: recordedLedgerProvenance(computed)
  };
};

export const materializeIndexingSummary = ({
  payload,
  featureMetrics, measurementEvidence
}) => {
  const resolved = resolveIndexingSummary({ payload, featureMetrics, preferExisting: false, measurementEvidence });
  if (!resolved.indexingSummary) return resolved;
  if (resolved.provenance?.source === 'native-indexing-summary') return resolved;
  resolved.indexingSummary.generatedAt = typeof payload?.generatedAt === 'string' ? payload.generatedAt : null;
  const artifacts = ensureArtifactsObject(payload);
  const changed = JSON.stringify(artifacts.indexing || null) !== JSON.stringify(resolved.indexingSummary);
  artifacts.indexing = resolved.indexingSummary;
  const metadataChanged = upsertMaterializationSection(payload, 'indexing', resolved.provenance);
  return {
    ...resolved,
    changed: changed || metadataChanged
  };
};

export const materializeBenchAnalysis = ({
  payload,
  featureMetrics,
  indexingSummary,
  deepAnalysis = false
}) => {
  const resolved = resolveBenchAnalysis({
    payload,
    featureMetrics,
    indexingSummary,
    deepAnalysis,
    preferExisting: false
  });
  if (!resolved.analysis) return resolved;
  if (resolved.provenance?.source === 'native-analysis') return resolved;
  if (resolved.refresh?.state === 'source-unavailable') return resolved;
  const artifacts = ensureArtifactsObject(payload);
  // This producer owns generatedAt as reconstruction time. Reconstruct first,
  // compare every semantic field, and retain the original time only for equal
  // derived content. Historical measurement/source timestamps are untouched.
  const previous = artifacts.analysis;
  if (typeof previous?.generatedAt === 'string' && Number.isFinite(Date.parse(previous.generatedAt))
    && isDeepStrictEqual({ ...previous, generatedAt: null }, { ...resolved.analysis, generatedAt: null })) {
    resolved.analysis = previous;
  }
  const changed = JSON.stringify(artifacts.analysis || null) !== JSON.stringify(resolved.analysis);
  artifacts.analysis = resolved.analysis;
  const metadataChanged = upsertMaterializationSection(payload, 'analysis', resolved.provenance);
  return {
    ...resolved,
    changed: changed || metadataChanged
  };
};

export const materializeThroughputLedger = ({
  payload,
  indexingSummary, measurementEvidence
}) => materializeOrResolveThroughputLedger({
  payload,
  indexingSummary, measurementEvidence,
  materialize: true,
  preferExisting: false
});

export const applyRunThroughputLedgerDiffs = (runs) => {
  const historyByRepo = new Map();
  const historyWindow = 8;
  for (const run of runs) {
    if (!isValidThroughputLedger(run?.throughputLedger)) {
      run.throughputLedgerDiff = null;
      continue;
    }
    const historyKey = String(run.repoHistoryKey || run.repoIdentity || '');
    const history = historyByRepo.get(historyKey) || [];
    run.throughputLedgerDiff = computeThroughputLedgerRegression({
      currentLedger: run.throughputLedger,
      baselineLedgers: history.slice(-historyWindow),
      metric: 'chunksPerSec'
    });
    history.push(run.throughputLedger);
    historyByRepo.set(historyKey, history);
  }
};

export const compareLedgerRegressions = (left, right) => {
  const severity = row => Number.isFinite(row?.deltaPct)
    ? (row.metricKind === 'duration' ? row.deltaPct : -row.deltaPct) : -Infinity;
  if (severity(left) !== severity(right)) return severity(left) > severity(right) ? -1 : 1;
  for (const field of ['folder', 'repoIdentity', 'modality', 'stage', 'metric', 'metricKind', 'file']) {
    const order = String(left?.[field] || '').localeCompare(String(right?.[field] || ''));
    if (order) return order;
  }
  return 0;
};

export const collectRunLedgerRegressions = (runs) => {
  const rows = [];
  for (const run of runs) {
    const diffMetrics = run?.throughputLedgerDiff?.metrics || {};
    for (const [metricKey, metricSummary] of Object.entries(diffMetrics)) {
      const regressions = metricSummary?.regressions || [];
      for (const regression of regressions.slice(0, 2)) {
        rows.push({
          file: run.file,
          repoIdentity: run.repoIdentity,
          modality: regression.modality,
          stage: regression.stage,
          metric: metricKey,
          metricKind: regression.metricKind,
          metricLabel: regression.metricLabel,
          deltaPct: regression.deltaPct,
          deltaRate: regression.deltaRate,
          currentRate: regression.currentRate,
          baselineRate: regression.baselineRate,
          baselineSamples: regression.baselineSamples,
          baselineConfidence: regression.baselineConfidence
        });
      }
    }
  }
  rows.sort(compareLedgerRegressions);
  return rows;
};
