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

const createEmptyStageEntry = () => ({
  attempts: 0,
  hits: 0,
  misses: 0,
  elapsedMs: 0
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
        elapsedMs: toNonNegativeMs(entry?.elapsedMs)
      };
    }
    return output;
  };

  return Object.freeze({
    markAttempt,
    markHit,
    markMiss,
    withStage,
    snapshot
  });
};
