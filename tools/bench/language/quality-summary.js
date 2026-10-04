import { resolveTaskLowYieldBailout } from '../../../src/shared/extraction-quality.js';

const bumpMapCount = (map, key, count = 1) => {
  if (!(map instanceof Map) || !key) return;
  map.set(key, (map.get(key) || 0) + count);
};

const sortMapObject = (map) => Object.fromEntries(
  Array.from((map instanceof Map ? map : new Map()).entries())
    .sort(([left], [right]) => String(left).localeCompare(String(right)))
);

const EXTRACTED_PROSE_QUALITY_BUDGET_SCHEMA_VERSION = 1;

export const buildBenchQualityBudgetSummary = (tasks) => {
  const validTasks = Array.isArray(tasks) ? tasks : [];
  const countsByRepoYieldClass = new Map();
  const countsByOpportunityClass = new Map();
  const countsByRecallClass = new Map();
  const countsByRecallConfidence = new Map();
  const countsByQualityImpact = new Map();
  let observedTaskCount = 0;
  let reducedRecallCount = 0;
  let skippedFiles = 0;
  let estimatedSuppressedFiles = 0;
  let weightedRecallLossTotal = 0;
  let weightedRecallLossWeight = 0;

  for (const task of validTasks) {
    const lowYield = resolveTaskLowYieldBailout(task?.payload || null);
    if (!lowYield || typeof lowYield !== 'object') continue;
    observedTaskCount += 1;
    if (lowYield.repoYieldClass) bumpMapCount(countsByRepoYieldClass, lowYield.repoYieldClass);
    if (lowYield.opportunityCost?.class) bumpMapCount(countsByOpportunityClass, lowYield.opportunityCost.class);
    if (lowYield.recallCost?.class) bumpMapCount(countsByRecallClass, lowYield.recallCost.class);
    if (lowYield.recallCost?.estimatedRecallLossConfidence) {
      bumpMapCount(countsByRecallConfidence, lowYield.recallCost.estimatedRecallLossConfidence);
    }
    if (lowYield.recallCost?.qualityImpact) {
      bumpMapCount(countsByQualityImpact, lowYield.recallCost.qualityImpact);
    }
    if (lowYield.triggered === true) reducedRecallCount += 1;
    skippedFiles += Number(lowYield.opportunityCost?.skippedFiles ?? lowYield.skippedFiles) || 0;
    estimatedSuppressedFiles += Number(
      lowYield.opportunityCost?.estimatedSuppressedFiles ?? lowYield.estimatedSuppressedFiles
    ) || 0;
    const repoEntries = Number(lowYield?.repoFingerprint?.totalEntries);
    const recallLossRatio = Number(
      lowYield.recallCost?.estimatedRecallLossRatio ?? lowYield.estimatedRecallLossRatio
    );
    if (Number.isFinite(repoEntries) && repoEntries > 0 && Number.isFinite(recallLossRatio) && recallLossRatio >= 0) {
      weightedRecallLossTotal += recallLossRatio * repoEntries;
      weightedRecallLossWeight += repoEntries;
    }
  }

  return {
    schemaVersion: EXTRACTED_PROSE_QUALITY_BUDGET_SCHEMA_VERSION,
    taskCount: validTasks.length,
    observedTaskCount,
    unknownTaskCount: validTasks.length - observedTaskCount,
    observation: observedTaskCount === validTasks.length && validTasks.length > 0 ? 'complete'
      : observedTaskCount > 0 ? 'partial' : 'unknown',
    reducedRecallCount,
    skippedFiles,
    estimatedSuppressedFiles,
    weightedRecallLossRatio: weightedRecallLossWeight > 0 ? weightedRecallLossTotal / weightedRecallLossWeight : 0,
    countsByRepoYieldClass: sortMapObject(countsByRepoYieldClass),
    countsByOpportunityClass: sortMapObject(countsByOpportunityClass),
    countsByRecallClass: sortMapObject(countsByRecallClass),
    countsByRecallConfidence: sortMapObject(countsByRecallConfidence),
    countsByQualityImpact: sortMapObject(countsByQualityImpact)
  };
};
