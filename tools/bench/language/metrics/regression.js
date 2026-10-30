import { isValidThroughputLedger } from './stage-ledger.js';
import { summarizeNumericDistribution } from '../../../shared/numeric-distribution.js';

export const THROUGHPUT_LEDGER_DIFF_SCHEMA_VERSION = 1;
export const THROUGHPUT_LEDGER_REGRESSION_METRICS = Object.freeze([
  {
    key: 'chunksPerSec',
    label: 'chunks/s',
    kind: 'rate',
    regressionThresholdPct: -0.08
  },
  {
    key: 'filesPerSec',
    label: 'files/s',
    kind: 'rate',
    regressionThresholdPct: -0.08
  },
  {
    key: 'tokensPerSec',
    label: 'tokens/s',
    kind: 'rate',
    regressionThresholdPct: -0.08
  },
  {
    key: 'bytesPerSec',
    label: 'bytes/s',
    kind: 'rate',
    regressionThresholdPct: -0.08
  },
  {
    key: 'durationMs',
    label: 'duration',
    kind: 'duration',
    regressionThresholdPct: 0.08
  }
]);

export { getBestHitRate, computeLowHitSeverity } from '../remediation.js';

const resolveBaselineConfidence = (summary) => {
  const count = Number(summary?.count);
  const coefficientOfVariation = Number(summary?.coefficientOfVariation);
  if (!Number.isFinite(count) || count <= 0) return 'none';
  if (count < 2) return 'low';
  if (count < 4) return 'medium';
  if (Number.isFinite(coefficientOfVariation) && coefficientOfVariation > 0.25) return 'medium';
  return 'high';
};

const measuredValue = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
const DIAGNOSTIC_ROWS = 16;

const buildRegressionSummary = ({
  currentLedger,
  baselineEntries,
  metricConfig
}) => {
  const metric = metricConfig?.key || 'chunksPerSec';
  const baselineMap = new Map();
  const eligible = new Set();
  for (const ledger of [currentLedger, ...baselineEntries]) {
    for (const [modeKey, modeEntry] of Object.entries(ledger.modalities || {})) {
      for (const [stageKey, stageEntry] of Object.entries(modeEntry?.stages || {})) {
        // The ledger intentionally supplies only total counters today. An
        // all-unobserved non-total metric is not a failed stage measurement.
        if (stageKey === 'total' || measuredValue(stageEntry?.[metric]) !== null) eligible.add(JSON.stringify([modeKey, stageKey]));
      }
    }
  }
  const dimensions = [...eligible].map(key => { const [modeKey, stageKey] = JSON.parse(key); return { key, modeKey, stageKey }; });
  const exclusions = [];
  let excludedEntries = 0;
  const exclude = (modality, stage, reason, baseline = null) => {
    excludedEntries++;
    if (exclusions.length < DIAGNOSTIC_ROWS) exclusions.push({ modality, stage, reason, baseline });
  };
  for (const [baselineIndex, baseline] of baselineEntries.entries()) {
    for (const { key, modeKey, stageKey } of dimensions) {
      const rate = measuredValue(baseline.modalities?.[modeKey]?.stages?.[stageKey]?.[metric]);
      if (rate === null) { exclude(modeKey, stageKey, 'baseline-observation-unavailable', baselineIndex); continue; }
      if (!baselineMap.has(key)) baselineMap.set(key, []);
      baselineMap.get(key).push(rate);
    }
  }

  const regressions = [];
  const improvements = [];
  const zeroBaselines = [];
  let comparedEntries = 0;
  let observedCurrentEntries = 0, unavailableCurrentEntries = 0, missingBaselineEntries = 0, zeroBaselineEntries = 0;
  const resolvedThreshold = Number(metricConfig?.regressionThresholdPct);
  const threshold = Number.isFinite(resolvedThreshold)
    ? resolvedThreshold
    : (metricConfig?.kind === 'duration' ? 0.08 : -0.08);

  for (const { key, modeKey, stageKey } of dimensions) {
    const currentRate = measuredValue(currentLedger.modalities?.[modeKey]?.stages?.[stageKey]?.[metric]);
    if (currentRate === null) {
      unavailableCurrentEntries++;
      exclude(modeKey, stageKey, 'current-observation-unavailable');
      continue;
    }
    observedCurrentEntries++;
    const baselineRates = baselineMap.get(key) || [];
    const baselineSummary = summarizeNumericDistribution(baselineRates);
    const baselineRate = measuredValue(baselineSummary?.median);
    if (baselineRate === null) {
      missingBaselineEntries++;
      exclude(modeKey, stageKey, 'baseline-observation-unavailable');
      continue;
    }
    const deltaRate = currentRate - baselineRate;
    const deltaPct = baselineRate === 0 ? null : deltaRate / baselineRate;
    const row = {
      modality: modeKey,
      stage: stageKey,
      metric,
      metricKind: metricConfig?.kind || 'rate',
      metricLabel: metricConfig?.label || metric,
      currentRate,
      baselineRate,
      baselineMean: baselineSummary?.mean ?? null,
      baselineMedian: baselineSummary?.median ?? null,
      baselineMin: baselineSummary?.min ?? null,
      baselineMax: baselineSummary?.max ?? null,
      baselineP95: baselineSummary?.p95 ?? null,
      baselineStdDev: baselineSummary?.stdDev ?? null,
      baselineCv: baselineSummary?.coefficientOfVariation ?? null,
      baselineConfidence: resolveBaselineConfidence(baselineSummary),
      deltaRate,
      deltaPct,
      baselineSamples: baselineRates.length
    };
    if (baselineRate === 0) {
      zeroBaselineEntries++;
      if (zeroBaselines.length < DIAGNOSTIC_ROWS) zeroBaselines.push({ ...row, outcome: currentRate === 0 ? 'both-zero' : 'zero-baseline' });
      continue;
    }
    comparedEntries += 1;
    const isRegression = metricConfig?.kind === 'duration'
      ? deltaPct >= Math.abs(threshold)
      : deltaPct <= threshold;
    const isImprovement = metricConfig?.kind === 'duration'
      ? deltaPct <= -Math.abs(threshold)
      : deltaPct >= Math.abs(threshold);
    if (isRegression) {
      regressions.push(row);
    } else if (isImprovement) {
      improvements.push(row);
    }
  }

  regressions.sort((left, right) => (
    metricConfig?.kind === 'duration'
      ? (Number(right.deltaPct) - Number(left.deltaPct))
      : (Number(left.deltaPct) - Number(right.deltaPct))
  ) || left.modality.localeCompare(right.modality) || left.stage.localeCompare(right.stage));
  improvements.sort((left, right) => (
    metricConfig?.kind === 'duration'
      ? (Number(left.deltaPct) - Number(right.deltaPct))
      : (Number(right.deltaPct) - Number(left.deltaPct))
  ) || left.modality.localeCompare(right.modality) || left.stage.localeCompare(right.stage));

  return {
    metric,
    metricKind: metricConfig?.kind || 'rate',
    metricLabel: metricConfig?.label || metric,
    baselineCount: baselineEntries.length,
    comparedEntries,
    status: !baselineEntries.length ? 'no-baseline'
      : comparedEntries ? (excludedEntries || unavailableCurrentEntries || missingBaselineEntries || zeroBaselineEntries ? 'partial' : 'compared')
        : zeroBaselineEntries ? 'zero-baseline' : 'unavailable',
    coverage: { observedCurrentEntries, unavailableCurrentEntries, missingBaselineEntries, zeroBaselineEntries },
    zeroBaselines,
    excludedEntries,
    exclusions,
    omittedExclusions: Math.max(0, excludedEntries - exclusions.length),
    regressionThresholdPct: threshold,
    regressions,
    improvements
  };
};

export const computeThroughputLedgerRegression = ({
  currentLedger = null,
  baselineLedgers = [],
  metric = 'chunksPerSec',
  regressionThresholdPct = -0.08
} = {}) => {
  if (!isValidThroughputLedger(currentLedger)) return null;
  const baselineEntries = (Array.isArray(baselineLedgers) ? baselineLedgers : [])
    .filter((entry) => isValidThroughputLedger(entry));
  const metricConfigs = THROUGHPUT_LEDGER_REGRESSION_METRICS.map((config) => (
    config.key === metric
      ? { ...config, regressionThresholdPct }
      : config
  ));
  const metrics = Object.fromEntries(metricConfigs.map((config) => [
    config.key,
    buildRegressionSummary({
      currentLedger,
      baselineEntries,
      metricConfig: config
    })
  ]));
  const primary = metrics[metric] || {
    baselineCount: baselineEntries.length,
    comparedEntries: 0,
    regressionThresholdPct,
    regressions: [],
    improvements: []
  };

  return {
    schemaVersion: THROUGHPUT_LEDGER_DIFF_SCHEMA_VERSION,
    metric,
    baselineCount: primary.baselineCount,
    comparedEntries: primary.comparedEntries,
    status: primary.status || 'unavailable',
    coverage: primary.coverage || null,
    zeroBaselines: primary.zeroBaselines || [],
    exclusions: primary.exclusions || [],
    excludedEntries: primary.excludedEntries || 0,
    omittedExclusions: primary.omittedExclusions || 0,
    regressionThresholdPct: primary.regressionThresholdPct,
    regressions: primary.regressions,
    improvements: primary.improvements,
    metrics
  };
};
