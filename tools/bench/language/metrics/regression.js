import { isValidThroughputLedger } from './stage-ledger.js';

export const THROUGHPUT_LEDGER_DIFF_SCHEMA_VERSION = 1;

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

export const computeThroughputLedgerRegression = ({
  currentLedger = null,
  baselineLedgers = [],
  metric = 'chunksPerSec',
  regressionThresholdPct = -0.08
} = {}) => {
  if (!isValidThroughputLedger(currentLedger)) return null;
  const baselineEntries = (Array.isArray(baselineLedgers) ? baselineLedgers : [])
    .filter((entry) => isValidThroughputLedger(entry));
  if (!baselineEntries.length) {
    return {
      schemaVersion: THROUGHPUT_LEDGER_DIFF_SCHEMA_VERSION,
      metric,
      baselineCount: 0,
      comparedEntries: 0,
      regressionThresholdPct,
      regressions: [],
      improvements: []
    };
  }

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
  const threshold = Number(regressionThresholdPct);
  const resolvedThreshold = Number.isFinite(threshold) ? threshold : -0.08;

  for (const [modeKey, modeEntry] of Object.entries(currentLedger.modalities || {})) {
    for (const [stageKey, stageEntry] of Object.entries(modeEntry?.stages || {})) {
      const currentRate = Number(stageEntry?.[metric]);
      if (!Number.isFinite(currentRate) || currentRate <= 0) continue;
      const key = `${modeKey}:${stageKey}`;
      const baselineRates = baselineMap.get(key) || [];
      const baselineRate = meanNumeric(baselineRates);
      if (!Number.isFinite(baselineRate) || baselineRate <= 0) continue;
      const deltaRate = currentRate - baselineRate;
      const deltaPct = deltaRate / baselineRate;
      comparedEntries += 1;
      const row = {
        modality: modeKey,
        stage: stageKey,
        metric,
        currentRate,
        baselineRate,
        deltaRate,
        deltaPct,
        baselineSamples: baselineRates.length
      };
      if (deltaPct <= resolvedThreshold) {
        regressions.push(row);
      } else if (deltaPct >= Math.abs(resolvedThreshold)) {
        improvements.push(row);
      }
    }
  }

  regressions.sort((left, right) => (
    Number(left.deltaPct) - Number(right.deltaPct)
  ) || left.modality.localeCompare(right.modality) || left.stage.localeCompare(right.stage));
  improvements.sort((left, right) => (
    Number(right.deltaPct) - Number(left.deltaPct)
  ) || left.modality.localeCompare(right.modality) || left.stage.localeCompare(right.stage));

  return {
    schemaVersion: THROUGHPUT_LEDGER_DIFF_SCHEMA_VERSION,
    metric,
    baselineCount: baselineEntries.length,
    comparedEntries,
    regressionThresholdPct: resolvedThreshold,
    regressions,
    improvements
  };
};
