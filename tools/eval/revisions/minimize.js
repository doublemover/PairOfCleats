import { throwIfAborted } from '../../../src/shared/abort.js';
import { revisionScenarioId } from './scenario.js';

const immutable = value => {
  if (value && typeof value === 'object') { Object.values(value).forEach(immutable); Object.freeze(value); } return value;
};

/** Internal shared deletion engine. Hooks are closed reviewed adapter code, never
 * callbacks/scripts supplied by a scenario record. A complete matching failure
 * must recur; an invalid, unknown or different failure cannot shrink the witness. */
export const minimizeRevisionSequence = (owner, { checkpointId, maxAttempts = 32, maxMs = 1000, signal = null } = {}) => {
  const began = performance.now(); throwIfAborted(signal);
  if (typeof checkpointId !== 'string' || !checkpointId.length || checkpointId.length > 128
    || !Number.isSafeInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 64
    || !Number.isSafeInteger(maxMs) || maxMs < 1 || maxMs > 1000) throw new RangeError('Invalid revision minimization allowance or checkpoint.');
  if (!owner.matches(owner.originalReceipt)) throw new TypeError('Original execution has no matching independent failure.');
  let scenario = owner.originalScenario; const attempts = [];
  for (let index = scenario.revisions.length - 1; index >= 0 && attempts.length < maxAttempts; index--) {
    throwIfAborted(signal);
    const remainingMs = Math.floor(maxMs - (performance.now() - began)); if (remainingMs < 1) break;
    if (scenario.revisions[index].id === checkpointId) continue;
    const removedRevisionId = scenario.revisions[index].id;
    let candidate;
    try { candidate = owner.seal(scenario, scenario.revisions.filter((_, position) => position !== index)); }
    catch (error) {
      if (!owner.invalidScenario(error)) throw error;
      attempts.push({ removedRevisionId, outcome: 'invalid-precondition', accepted: false }); continue;
    }
    const trial = owner.run(candidate, { maxMs: Math.min(remainingMs, 1000), signal });
    try {
      const receipt = owner.read(trial), accepted = owner.matches(receipt);
      attempts.push({ removedRevisionId, executionId: receipt.executionId, scenarioId: receipt.scenarioId, outcome: receipt.outcome, accepted });
      if (accepted) scenario = candidate;
    } finally { owner.dispose(trial); }
  }
  return immutable({ schemaVersion: 1, kind: owner.kind, originalExecutionId: owner.originalReceipt.executionId,
    originalScenarioId: revisionScenarioId(owner.originalScenario), minimizedScenarioId: revisionScenarioId(scenario),
    ...owner.selection, scenario, attempts, changed: revisionScenarioId(scenario) !== revisionScenarioId(owner.originalScenario), predicate: owner.predicate,
    scope: 'revision-deletion-only; no-source-or-program-minimality', elapsedMs: performance.now() - began });
};
