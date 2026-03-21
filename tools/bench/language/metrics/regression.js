import { isValidThroughputLedger } from './stage-ledger.js';

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

const toFiniteRate = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, Math.min(1, parsed));
};

const toFiniteNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export const getBestHitRate = (summary) => {
  if (!summary || typeof summary !== 'object') return null;
  const candidates = [];
  const collectRateValues = (value) => {
    if (!value || typeof value !== 'object') return;
    for (const candidate of Object.values(value)) {
      const normalized = toFiniteRate(candidate);
      if (Number.isFinite(normalized)) candidates.push(normalized);
    }
  };
  collectRateValues(summary.hitRate);
  collectRateValues(summary.hitRates);
  collectRateValues(summary.hitRateByBackend);
  for (const field of ['hitRateMemory', 'hitRateSqlite', 'hitRateSqliteFts']) {
    const normalized = toFiniteRate(summary?.[field]);
    if (Number.isFinite(normalized)) candidates.push(normalized);
  }
  if (!candidates.length) return null;
  return Math.max(...candidates);
};

export const computeLowHitSeverity = ({
  summary,
  lowHitThreshold = 0.82
} = {}) => {
  const bestHitRate = getBestHitRate(summary);
  const resultCountAvg = [
    ...Object.values(summary?.resultCountAvg || {}),
    summary?.resultCountMemory,
    summary?.resultCountSqlite,
    summary?.resultCountSqliteFts
  ]
    .map(toFiniteNumber)
    .filter(Number.isFinite);
  const avgResultCount = resultCountAvg.length
    ? resultCountAvg.reduce((sum, value) => sum + value, 0) / resultCountAvg.length
    : null;
  const queryWallMsPerSearch = toFiniteNumber(summary?.queryWallMsPerSearch);
  const queryWallMsPerQuery = toFiniteNumber(summary?.queryWallMsPerQuery);
  const hitGap = Number.isFinite(bestHitRate)
    ? Math.max(0, lowHitThreshold - bestHitRate)
    : null;
  const scarcityPressure = Number.isFinite(avgResultCount)
    ? Math.max(0, 1.5 - avgResultCount) / 1.5
    : 0;
  const latencyPressure = Number.isFinite(queryWallMsPerSearch)
    ? Math.max(0, queryWallMsPerSearch - 120) / 480
    : 0;
  const severityScore = Number.isFinite(hitGap)
    ? Math.max(0, Math.min(1, (hitGap / Math.max(0.01, lowHitThreshold)) + (0.2 * scarcityPressure) + (0.1 * latencyPressure)))
    : null;
  return {
    lowHitThreshold,
    bestHitRate,
    hitGap,
    avgResultCount,
    queryWallMsPerSearch,
    queryWallMsPerQuery,
    scarcityPressure,
    latencyPressure,
    severityScore
  };
};

const meanNumeric = (values) => {
  const numeric = (Array.isArray(values) ? values : [])
    .map((value) => Number(value))
    .filter(Number.isFinite);
  if (!numeric.length) return null;
  return numeric.reduce((sum, value) => sum + value, 0) / numeric.length;
};

const sortNumeric = (values) => (Array.isArray(values) ? values : [])
  .map((value) => Number(value))
  .filter(Number.isFinite)
  .sort((left, right) => left - right);

const quantileSorted = (sortedValues, percentile) => {
  const values = Array.isArray(sortedValues) ? sortedValues : [];
  if (!values.length) return null;
  const p = Number(percentile);
  if (!Number.isFinite(p)) return null;
  const clamped = Math.max(0, Math.min(1, p));
  if (values.length === 1) return values[0];
  const position = clamped * (values.length - 1);
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);
  const lower = values[lowerIndex];
  const upper = values[upperIndex];
  if (!Number.isFinite(lower) || !Number.isFinite(upper)) return null;
  if (lowerIndex === upperIndex) return lower;
  return lower + ((upper - lower) * (position - lowerIndex));
};

const summarizeNumeric = (values) => {
  const sorted = sortNumeric(values);
  if (!sorted.length) return null;
  const meanValue = meanNumeric(sorted);
  const variance = Number.isFinite(meanValue)
    ? (sorted.reduce((sum, value) => sum + ((value - meanValue) ** 2), 0) / sorted.length)
    : null;
  const stdDev = Number.isFinite(variance) ? Math.sqrt(variance) : null;
  return {
    count: sorted.length,
    mean: meanValue,
    median: quantileSorted(sorted, 0.5),
    min: sorted[0],
    max: sorted[sorted.length - 1],
    p95: quantileSorted(sorted, 0.95),
    stdDev,
    coefficientOfVariation: (Number.isFinite(stdDev) && Number.isFinite(meanValue) && meanValue !== 0)
      ? (stdDev / Math.abs(meanValue))
      : null
  };
};

const resolveBaselineConfidence = (summary) => {
  const count = Number(summary?.count);
  const coefficientOfVariation = Number(summary?.coefficientOfVariation);
  if (!Number.isFinite(count) || count <= 0) return 'none';
  if (count < 2) return 'low';
  if (count < 4) return 'medium';
  if (Number.isFinite(coefficientOfVariation) && coefficientOfVariation > 0.25) return 'medium';
  return 'high';
};

const buildRegressionSummary = ({
  currentLedger,
  baselineEntries,
  metricConfig
}) => {
  const metric = metricConfig?.key || 'chunksPerSec';
  const baselineMap = new Map();
  for (const baseline of baselineEntries) {
    for (const [modeKey, modeEntry] of Object.entries(baseline.modalities || {})) {
      for (const [stageKey, stageEntry] of Object.entries(modeEntry?.stages || {})) {
        const rate = Number(stageEntry?.[metric]);
        if (!Number.isFinite(rate) || rate <= 0) continue;
        const key = `${modeKey}:${stageKey}`;
        if (!baselineMap.has(key)) baselineMap.set(key, []);
        baselineMap.get(key).push(rate);
      }
    }
  }

  const regressions = [];
  const improvements = [];
  let comparedEntries = 0;
  const resolvedThreshold = Number(metricConfig?.regressionThresholdPct);
  const threshold = Number.isFinite(resolvedThreshold)
    ? resolvedThreshold
    : (metricConfig?.kind === 'duration' ? 0.08 : -0.08);

  for (const [modeKey, modeEntry] of Object.entries(currentLedger.modalities || {})) {
    for (const [stageKey, stageEntry] of Object.entries(modeEntry?.stages || {})) {
      const currentRate = Number(stageEntry?.[metric]);
      if (!Number.isFinite(currentRate) || currentRate <= 0) continue;
      const key = `${modeKey}:${stageKey}`;
      const baselineRates = baselineMap.get(key) || [];
      const baselineSummary = summarizeNumeric(baselineRates);
      const baselineRate = Number(baselineSummary?.median);
      if (!Number.isFinite(baselineRate) || baselineRate <= 0) continue;
      const deltaRate = currentRate - baselineRate;
      const deltaPct = deltaRate / baselineRate;
      comparedEntries += 1;
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
  if (!baselineEntries.length) {
    const metrics = Object.fromEntries(metricConfigs.map((config) => [
      config.key,
      {
        metric: config.key,
        metricKind: config.kind,
        metricLabel: config.label,
        baselineCount: 0,
        comparedEntries: 0,
        regressionThresholdPct: config.key === metric ? regressionThresholdPct : config.regressionThresholdPct,
        regressions: [],
        improvements: []
      }
    ]));
    return {
      schemaVersion: THROUGHPUT_LEDGER_DIFF_SCHEMA_VERSION,
      metric,
      baselineCount: 0,
      comparedEntries: 0,
      regressionThresholdPct,
      regressions: [],
      improvements: [],
      metrics
    };
  }
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
    regressionThresholdPct: primary.regressionThresholdPct,
    regressions: primary.regressions,
    improvements: primary.improvements,
    metrics
  };
};
