import { sortStrings } from './path-utils.js';

const toNonNegativeInt = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return 0;
  return Math.floor(numeric);
};

const toNonNegativeMs = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return 0;
  return Number(numeric.toFixed(3));
};

const toSortedCountObject = (counts) => {
  const entries = Object.entries(counts || {})
    .filter(([key, value]) => key && Number.isFinite(Number(value)) && Number(value) > 0)
    .sort((a, b) => sortStrings(a[0], b[0]));
  const output = Object.create(null);
  for (const [key, value] of entries) {
    output[key] = toNonNegativeInt(value);
  }
  return output;
};

const createEmptyStageEntry = () => ({
  attempts: 0,
  hits: 0,
  misses: 0,
  elapsedMs: 0,
  budgetExhausted: 0,
  degraded: 0,
  reasonCodes: Object.create(null)
});

const getOrCreate = (store, stage) => {
  if (!store[stage]) store[stage] = createEmptyStageEntry();
  return store[stage];
};

/**
 * Track import-resolution stage counters and elapsed runtime per stage.
 */
export const createImportResolutionStageTracker = ({ now = () => Date.now() } = {}) => {
  const stages = Object.create(null);

  const markAttempt = (stage) => {
    if (!stage) return;
    const entry = getOrCreate(stages, stage);
    entry.attempts += 1;
  };

  const markHit = (stage) => {
    if (!stage) return;
    const entry = getOrCreate(stages, stage);
    entry.hits += 1;
  };

  const markMiss = (stage) => {
    if (!stage) return;
    const entry = getOrCreate(stages, stage);
    entry.misses += 1;
  };

  const markBudgetExhausted = (stage, amount = 1) => {
    if (!stage) return;
    const entry = getOrCreate(stages, stage);
    entry.budgetExhausted += Math.max(0, Math.floor(Number(amount) || 0));
  };

  const markDegraded = (stage, amount = 1) => {
    if (!stage) return;
    const entry = getOrCreate(stages, stage);
    entry.degraded += Math.max(0, Math.floor(Number(amount) || 0));
  };

  const markReasonCode = (stage, reasonCode, amount = 1) => {
    if (!stage || typeof reasonCode !== 'string') return;
    const normalizedCode = reasonCode.trim();
    if (!normalizedCode) return;
    const entry = getOrCreate(stages, stage);
    const existing = Number(entry.reasonCodes[normalizedCode]) || 0;
    entry.reasonCodes[normalizedCode] = existing + Math.max(0, Math.floor(Number(amount) || 0));
  };

  const withStage = (stage, fn) => {
    markAttempt(stage);
    const started = now();
    try {
      const result = fn();
      const entry = getOrCreate(stages, stage);
      entry.elapsedMs += Math.max(0, Number(now()) - Number(started));
      return result;
    } catch (error) {
      const entry = getOrCreate(stages, stage);
      entry.elapsedMs += Math.max(0, Number(now()) - Number(started));
      throw error;
    }
  };

  const snapshot = () => {
    const ordered = Object.keys(stages).sort(sortStrings);
    const output = Object.create(null);
    for (const stage of ordered) {
      const entry = stages[stage];
      output[stage] = {
        attempts: toNonNegativeInt(entry?.attempts),
        hits: toNonNegativeInt(entry?.hits),
        misses: toNonNegativeInt(entry?.misses),
        elapsedMs: toNonNegativeMs(entry?.elapsedMs),
        budgetExhausted: toNonNegativeInt(entry?.budgetExhausted),
        degraded: toNonNegativeInt(entry?.degraded),
        reasonCodes: toSortedCountObject(entry?.reasonCodes)
      };
    }
    return output;
  };

  return Object.freeze({
    markAttempt,
    markHit,
    markMiss,
    markBudgetExhausted,
    markDegraded,
    markReasonCode,
    withStage,
    snapshot
  });
};
