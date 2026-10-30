import { performance } from 'node:perf_hooks';
import { createWorkBudget } from './work-budget.js';

export const admitSuggestionWallClockMs = value => {
  if (value == null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || !Number.isSafeInteger(Math.floor(value))) {
    throw new TypeError('Suggest-tests maxWallClockMs must be a finite non-negative number within the safe integer range.');
  }
  return Math.floor(value);
};

/** One monotonic computation allowance, shared by every phase and seed. Native
 * operations/sorts are cooperative units; cleanup remains mandatory afterward. */
export const createSuggestionBudget = ({ limitMs = null, clock = () => performance.now(), preparationElapsedMs = null, onStop } = {}) => {
  let observedAt = 0;
  const readClock = () => { observedAt = clock(); return observedAt; };
  const guard = limitMs === null ? null : createWorkBudget({ maxWallClockMs: limitMs, checkEvery: 1, now: readClock });
  const completed = [], observed = { directoryOpens: 0, directoryReads: 0, directoryCloses: 0,
    inventoryEntries: 0, graphNodes: 0, graphEdges: 0, neighborReads: 0, candidateChecks: 0, fallbackChecks: 0, witnessLinks: 0 };
  let stopPhase = null, elapsedMs = 0;
  const check = phase => {
    if (stopPhase !== null) return false;
    if (!guard) return true;
    const result = guard.consume();
    if (!result.stop) return true;
    elapsedMs = Math.max(0, result.elapsedMs);
    stopPhase = phase;
    onStop?.({ phase, elapsedMs, limitMs });
    return false;
  };
  return Object.freeze({
    check,
    count: guard ? key => { observed[key] += 1; } : () => {},
    complete: phase => { if (stopPhase === null && !completed.includes(phase)) completed.push(phase); },
    stopped: () => stopPhase !== null,
    finish: () => {
      const wasStopped = stopPhase !== null;
      check('finalization');
      if (!guard) return null;
      const settledAt = wasStopped ? readClock() : observedAt;
      const settledElapsed = Math.max(elapsedMs, settledAt - guard.getStartedAt(), 0);
      return { schemaVersion: 1, scope: 'suggestion-computation', clock: 'monotonic',
        excluded: ['configuration-and-input-loading', 'graph-artifact-preparation', 'rendering-and-serialization'],
        limitMs, elapsedMs: settledElapsed, preparationElapsedMs,
        state: stopPhase === null ? 'complete' : 'deadline-limited', phaseAtStop: stopPhase,
        completedPhases: completed.slice(), observed: { ...observed }, settlement: 'confirmed',
        interruptibility: 'cooperative-between-synchronous-operations-and-sorts',
        overrunMs: Math.max(0, settledElapsed - limitMs) };
    }
  });
};
