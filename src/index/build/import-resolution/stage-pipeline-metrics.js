import { isKnownResolverStage } from './reason-codes.js';

const sortStrings = (a, b) => (a < b ? -1 : (a > b ? 1 : 0));

const toNonNegativeInt = (value) => Math.floor(Math.max(0, Number(value) || 0));
const toNonNegativeMs = (value) => Number(Math.max(0, Number(value) || 0).toFixed(3));

const toEntries = (stages) => (
  Object.entries(stages || {})
    .filter(([stage]) => stage && typeof stage === 'string' && isKnownResolverStage(stage))
    .map(([stage, entry]) => ({
      stage,
      attempts: toNonNegativeInt(entry?.attempts),
      hits: toNonNegativeInt(entry?.hits),
      misses: toNonNegativeInt(entry?.misses),
      elapsedMs: toNonNegativeMs(entry?.elapsedMs),
      budgetExhausted: toNonNegativeInt(entry?.budgetExhausted),
      degraded: toNonNegativeInt(entry?.degraded)
    }))
);

export const resolveResolverPipelineStageHighlights = (stages) => {
  const entries = toEntries(stages);
  const topByElapsed = entries
    .filter((entry) => entry.elapsedMs > 0)
    .sort((a, b) => (
      b.elapsedMs !== a.elapsedMs
        ? b.elapsedMs - a.elapsedMs
        : sortStrings(a.stage, b.stage)
    ))[0] || null;
  const topByBudgetExhausted = entries
    .filter((entry) => entry.budgetExhausted > 0)
    .sort((a, b) => (
      b.budgetExhausted !== a.budgetExhausted
        ? b.budgetExhausted - a.budgetExhausted
        : sortStrings(a.stage, b.stage)
    ))[0] || null;
  const topByDegraded = entries
    .filter((entry) => entry.degraded > 0)
    .sort((a, b) => (
      b.degraded !== a.degraded
        ? b.degraded - a.degraded
        : sortStrings(a.stage, b.stage)
    ))[0] || null;
  return {
    topByElapsed: topByElapsed ? { stage: topByElapsed.stage, elapsedMs: topByElapsed.elapsedMs } : null,
    topByBudgetExhausted: topByBudgetExhausted
      ? { stage: topByBudgetExhausted.stage, budgetExhausted: topByBudgetExhausted.budgetExhausted }
      : null,
    topByDegraded: topByDegraded ? { stage: topByDegraded.stage, degraded: topByDegraded.degraded } : null
  };
};

export const formatResolverPipelineStageSummary = (stages, { maxEntries = 6 } = {}) => {
  const entries = toEntries(stages)
    .filter((entry) => entry.attempts > 0 || entry.elapsedMs > 0 || entry.budgetExhausted > 0 || entry.degraded > 0)
    .sort((a, b) => sortStrings(a.stage, b.stage))
    .slice(0, Math.max(0, Math.floor(Number(maxEntries) || 0)));
  if (!entries.length) return 'none';
  return entries
    .map((entry) => (
      `${entry.stage}=a${entry.attempts}/h${entry.hits}/m${entry.misses}` +
      `/b${entry.budgetExhausted}/d${entry.degraded}/t${entry.elapsedMs.toFixed(3)}ms`
    ))
    .join(', ');
};
