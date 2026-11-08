import { throwIfAborted } from '../../../src/shared/abort.js';
import { revisionScenarioId } from './scenario.js';
import { addStorageFailureContext } from '../../../src/shared/storage/operation-error.js';

const immutable = value => {
  if (value && typeof value === 'object') { Object.values(value).forEach(immutable); Object.freeze(value); } return value;
};

/** Internal shared deletion engine. Hooks are closed reviewed adapter code, never
 * callbacks/scripts supplied by a scenario record. A complete matching failure
 * must recur; an invalid, unknown or different failure cannot shrink the witness. */
const proposals = function* (owner, { checkpointId, maxAttempts = 32, maxMs = 1000, signal = null } = {}) {
  const began = performance.now(); throwIfAborted(signal);
  const maximumMs = owner.maximumMs ?? 1000;
  if (!Number.isSafeInteger(maximumMs) || maximumMs < 1 || maximumMs > 25000) throw new RangeError('Invalid owner minimization allowance.');
  if (typeof checkpointId !== 'string' || !checkpointId.length || checkpointId.length > 128
    || !Number.isSafeInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 64
    || !Number.isSafeInteger(maxMs) || maxMs < 1 || maxMs > maximumMs) throw new RangeError('Invalid revision minimization allowance or checkpoint.');
  if (!owner.matches(owner.originalReceipt)) throw new TypeError('Original execution has no matching independent failure.');
  let scenario = owner.originalScenario, witness = owner.captureWitness?.(owner.originalReceipt); const attempts = [];
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
    throwIfAborted(signal);
    const trialMs = Math.floor(maxMs - (performance.now() - began)); if (trialMs < 1) break;
    const receipt = yield { candidate, options: { maxMs: Math.min(trialMs, maximumMs), signal } };
    const accepted = owner.matches(receipt);
    attempts.push({ removedRevisionId, executionId: receipt.executionId, scenarioId: receipt.scenarioId, outcome: receipt.outcome, accepted });
    if (accepted) { scenario = candidate; witness = owner.captureWitness?.(receipt); }
  }
  throwIfAborted(signal);
  return immutable({ schemaVersion: 1, kind: owner.kind, originalExecutionId: owner.originalReceipt.executionId,
    originalScenarioId: revisionScenarioId(owner.originalScenario), minimizedScenarioId: revisionScenarioId(scenario),
    ...owner.selection, scenario, attempts, changed: revisionScenarioId(scenario) !== revisionScenarioId(owner.originalScenario), predicate: owner.predicate,
    ...(owner.captureWitness ? { witness } : {}),
    scope: 'revision-deletion-only; no-source-or-program-minimality', elapsedMs: performance.now() - began });
};

const retirementFailure = (primary, cleanup) => addStorageFailureContext(primary, {}, cleanup,
  { secondaryPresent: true, forceAggregate: true, ownerMessage: 'Revision trial failed and its original retirement also failed.' });

/** Synchronous finite owners and asynchronous physical worlds use the same
 * proposal/admission/predicate engine. A trial is retired before its outcome
 * can admit another proposal. Independent retirement failures remain binding. */
export const minimizeRevisionSequence = (owner, options) => {
  const sequence = proposals(owner, options); let step = sequence.next();
  while (!step.done) {
    const { candidate, options: budget } = step.value, trial = owner.run(candidate, budget);
    let receipt, primary, failed = false;
    try { receipt = owner.read(trial); }
    catch (error) { primary = error; failed = true; }
    try { owner.dispose(trial); }
    catch (cleanup) { throw failed ? retirementFailure(primary, cleanup) : cleanup; }
    if (failed) throw primary;
    step = sequence.next(receipt);
  }
  return step.value;
};

export const minimizeRevisionSequenceAsync = async (owner, options) => {
  const sequence = proposals(owner, options); let step = sequence.next();
  while (!step.done) {
    const { candidate, options: budget } = step.value, trial = await owner.run(candidate, budget);
    let receipt, primary, failed = false;
    try { receipt = await owner.read(trial); }
    catch (error) { primary = error; failed = true; }
    try { await owner.dispose(trial); }
    catch (cleanup) { throw failed ? retirementFailure(primary, cleanup) : cleanup; }
    if (failed) throw primary;
    step = sequence.next(receipt);
  }
  return step.value;
};
