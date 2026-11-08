import { randomUUID } from 'node:crypto';
import { setImmediate as yieldNow } from 'node:timers/promises';
import { prepareFiniteFeasibilitySlice, fail } from '../index/semantic/feasibility/slice.js';
import { interpretFiniteFeasibility } from '../index/semantic/feasibility/interpret.js';
import { checkFiniteFeasibilityAssignment } from '../index/semantic/feasibility/check.js';
import { canonicalSemanticJson, semanticHash } from '../index/semantic/identity.js';
import { throwIfAborted } from '../shared/abort.js';
import { FINITE_FEASIBILITY_PROFILE, FINITE_FEASIBILITY_VERSION } from '../contracts/schemas/finite-feasibility.js';
import { assertFiniteFeasibilityResult, captureFiniteFeasibilityClaimRequest, assertFiniteFeasibilityClaim } from '../contracts/validators/finite-feasibility.js';

const targets = new WeakMap(), cursors = new WeakMap(), results = new WeakMap(), claims = new WeakMap();
const freeze = value => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) { for (const child of Object.values(value)) freeze(child); Object.freeze(value); } return value;
};
const owner = target => {
  const state = target && typeof target === 'object' ? targets.get(target) : null;
  if (!state || state.retired || state.invalidation) throw Object.assign(new Error('Original active finite feasibility target required.'), { code: 'ERR_SEMANTIC_GENERATION_MISMATCH' });
  return state;
};

/** Heap-free in-memory producer only. Owning actual source bytes proves anchor
 * identity, not the declared translation's execution preservation or live build.
 */
export const createFiniteFeasibilityTarget = ({ request, sourceSnapshots }) => {
  const began = performance.now(), slice = prepareFiniteFeasibilitySlice(request, sourceSnapshots);
  const target = freeze({ schemaVersion: FINITE_FEASIBILITY_VERSION, profile: FINITE_FEASIBILITY_PROFILE,
    targetIdentity: slice.targetIdentity, sourceSetId: slice.sourceSetId, world: slice.request.world });
  targets.set(target, { slice, target, executionId: randomUUID(), epoch: 0, currentCursor: null, busy: false, retired: false, invalidation: null,
    progress: { phase: slice.cyclic ? 'unsupported' : 'explore', next: 0, checked: 0, unknown: 0, witness: null,
      unsupportedRows: [], unsupportedOmitted: 0 },
    work: { preparationMs: performance.now() - began, sourceBytesVerified: slice.sourceBytes, producerAssignments: 0,
      checkerAssignments: 0, producerSteps: 0, checkerSteps: 0, advanceCalls: 0, canceledCalls: 0, advanceMs: 0 } });
  return target;
};
const validateBudget = limits => {
  const budget = { assignments: 64, workMs: 100, ...limits };
  for (const [key, value] of Object.entries(budget)) {
    const maximum = key === 'assignments' ? 256 : key === 'workMs' ? 250 : 0;
    if (!Number.isSafeInteger(value) || value < 1 || value > maximum) throw fail('Invalid finite feasibility work bound.');
  }
  return budget;
};
const publish = (state, progress) => {
  const epoch = state.epoch + 1;
  const complete = ['witness', 'refutation', 'unsupported', 'unknown', 'checker-rejected'].includes(progress.phase);
  const semanticOutcome = progress.phase === 'witness' ? 'inModelWitness' : progress.phase === 'refutation' ? 'inModelRefutation' : 'unknown';
  const cursor = complete ? null : freeze({ targetIdentity: state.target.targetIdentity, observationEpoch: epoch, token: randomUUID() });
  const result = freeze({ schemaVersion: FINITE_FEASIBILITY_VERSION, kind: 'finite-boolean-feasibility',
    executionId: state.executionId,
    targetIdentity: state.target.targetIdentity, observationEpoch: epoch, sourceSetId: state.target.sourceSetId,
    world: state.target.world, anchors: state.slice.request.anchors,
    solverOutcome: semanticOutcome === 'inModelWitness' ? 'sat' : semanticOutcome === 'inModelRefutation' ? 'unsat' : 'unknown',
    semanticOutcome, profile: FINITE_FEASIBILITY_PROFILE, approximationKind: semanticOutcome === 'inModelWitness'
      ? 'witnessed-supplied-finite-path' : semanticOutcome === 'inModelRefutation' ? 'exact-supplied-finite-slice' : 'unqualified',
    sourceMapping: 'verified-source-bytes-and-spans; execution-translation-not-qualified',
    exploration: { phase: progress.phase, totalAssignments: 2 ** state.slice.freeInputs.length,
      exploredAssignments: progress.next, checkedAssignments: progress.checked, unknownAssignments: progress.unknown },
    unsupported: { observations: progress.unsupportedRows, omitted: progress.unsupportedOmitted },
    witness: semanticOutcome === 'inModelWitness' ? { input: progress.witness.checked.input,
      trace: progress.witness.checked.trace, terminal: progress.witness.checked.terminal } : null,
    verification: semanticOutcome === 'unknown' ? 'not-established' : 'independent-finite-forward-replay-v1',
    frontier: complete && semanticOutcome !== 'unknown' ? [] : [{ reason: progress.phase === 'unsupported' ? 'cyclic-control-flow-unsupported'
      : progress.phase === 'unknown' ? 'encountered-unsupported-operation' : progress.phase === 'checker-rejected' ? 'independent-checker-rejected' : 'work-budget',
    nextAssignment: progress.next, nextCheck: progress.checked }],
    closure: { sourceProgram: 'not-established', finitePredicate: semanticOutcome === 'unknown' ? 'unknown' : 'checked-in-supplied-model',
      heap: 'unsupported', calls: 'unsupported', solver: 'finite-enumeration-no-smt' }, cursor, work: { ...state.work } });
  assertFiniteFeasibilityResult(result);
  canonicalSemanticJson(result, { maxBytes: 1024 * 1024 + 65536 });
  state.progress = progress; state.epoch = epoch; state.currentCursor = cursor;
  if (cursor) cursors.set(cursor, state);
  results.set(result, state); return result;
};
const advance = async (state, { limits = {}, signal = null } = {}) => {
  owner(state.target); const budget = validateBudget(limits);
  if (state.busy) throw fail('Finite feasibility target already has outstanding work.');
  const progress = { ...state.progress, unsupportedRows: [...state.progress.unsupportedRows] }, began = performance.now();
  let accounted = false;
  state.busy = true; state.work.advanceCalls++;
  try {
    throwIfAborted(signal);
    const total = 2 ** state.slice.freeInputs.length;
    let visits = 0;
    while (visits < budget.assignments && performance.now() - began < budget.workMs) {
      owner(state.target); throwIfAborted(signal);
      if (progress.phase === 'explore') {
        const index = progress.next, packet = interpretFiniteFeasibility(state.slice, index);
        state.work.producerAssignments++; state.work.producerSteps += packet.steps; progress.next++; visits++;
        if (packet.matches === true) { progress.witness = { index, packet }; progress.phase = 'check-witness'; }
        else if (packet.matches === null) {
          progress.unknown++;
          if (progress.unsupportedRows.length < 16) progress.unsupportedRows.push({ assignmentIndex: index, block: packet.trace.at(-1), reason: packet.unknown });
          else progress.unsupportedOmitted++;
        }
        if (progress.phase === 'explore' && progress.next === total) progress.phase = progress.unknown ? 'unknown' : 'check-refutation';
      } else if (progress.phase === 'check-witness') {
        const checked = checkFiniteFeasibilityAssignment(state.slice.request, progress.witness.index);
        state.work.checkerAssignments++; state.work.checkerSteps += checked.steps; progress.checked++; visits++;
        progress.phase = checked.matches === true && canonicalSemanticJson(checked.trace) === canonicalSemanticJson(progress.witness.packet.trace)
          && canonicalSemanticJson(checked.terminal) === canonicalSemanticJson(progress.witness.packet.terminal) ? 'witness' : 'checker-rejected';
        if (progress.phase === 'witness') progress.witness = { ...progress.witness, checked };
      } else if (progress.phase === 'check-refutation') {
        const checked = checkFiniteFeasibilityAssignment(state.slice.request, progress.checked);
        state.work.checkerAssignments++; state.work.checkerSteps += checked.steps; progress.checked++; visits++;
        if (checked.matches !== false) progress.phase = 'checker-rejected';
        else if (progress.checked === total) progress.phase = 'refutation';
      } else break;
      await yieldNow();
    }
    owner(state.target); throwIfAborted(signal);
    state.work.advanceMs += performance.now() - began;
    accounted = true;
    return publish(state, progress);
  } catch (error) {
    if (!accounted) state.work.advanceMs += performance.now() - began;
    if (signal?.aborted) state.work.canceledCalls++;
    // Commit only published progress. Original cursors remain resumable after
    // cancellation; actual discarded/repeated work remains in the cost ledger.
    throw error;
  } finally { state.busy = false; }
};
export const refinePredicate = (target, options) => {
  const state = owner(target);
  if (state.epoch) throw fail('Use the original current refinement cursor.');
  return advance(state, options);
};
export const resumeRefinement = (cursor, options) => {
  const state = cursor && typeof cursor === 'object' ? cursors.get(cursor) : null;
  if (!state || state.currentCursor !== cursor) throw Object.assign(new Error('Original current refinement cursor required.'), { code: 'ERR_SEMANTIC_CURSOR_EXPIRED' });
  return advance(state, options);
};
export const explainRefinement = result => {
  const state = result && typeof result === 'object' ? results.get(result) : null;
  if (!state) throw fail('Original finite feasibility result required.');
  return freeze({ result, targetState: state.retired ? 'retired' : state.invalidation ? 'stale' : 'active',
    invalidation: state.invalidation, world: state.target.world, anchors: state.slice?.request.anchors ?? null,
    history: 'analysis-event-instrumentation-unavailable', programExecution: 'none' });
};
/** Named finite-model claims require original checked observations and exact
 * consumer scope. Serialized reports or solver labels grant no such admission.
 */
export const readCheckedFiniteFeasibilityClaim = (result, input) => {
  const state = result && typeof result === 'object' ? results.get(result) : null;
  if (!state) throw fail('Original finite feasibility result required.');
  const request = captureFiniteFeasibilityClaimRequest(input);
  owner(state.target);
  if (request.targetIdentity !== result.targetIdentity || request.sourceSetId !== result.sourceSetId
    || canonicalSemanticJson(request.world) !== canonicalSemanticJson(state.target.world)) {
    throw Object.assign(new Error('Finite claim target/source/world differs from the consumer scope.'), { code: 'ERR_SEMANTIC_GENERATION_MISMATCH' });
  }
  if (canonicalSemanticJson(request.predicate) !== canonicalSemanticJson(state.slice.request.predicate)) throw fail('Finite claim predicate differs from the consumer predicate.');
  if (result.semanticOutcome === 'unknown' || result.verification !== 'independent-finite-forward-replay-v1') {
    throw Object.assign(new Error('No independently checked finite predicate claim is available.'), { code: 'ERR_SEMANTIC_UNAVAILABLE' });
  }
  if (!claims.has(result)) {
    const content = { schemaVersion: FINITE_FEASIBILITY_VERSION, kind: 'checked-finite-feasibility-claim',
      targetIdentity: result.targetIdentity, sourceSetId: result.sourceSetId, world: result.world, scope: request.scope,
      predicate: state.slice.request.predicate, inputs: state.slice.request.inputs, entryConditions: state.slice.request.entryConditions,
      outcome: result.semanticOutcome === 'inModelWitness' ? 'exists-in-finite-input-domain' : 'absent-in-finite-input-domain',
      totalAssignments: result.exploration.totalAssignments, witness: result.witness,
      verification: result.verification, sourceProgram: 'not-established' };
    const claimId = semanticHash('finite-feasibility.claim.v1', content);
    const receipt = freeze({ ...content, claimId, executionId: result.executionId, observationEpoch: result.observationEpoch,
      receiptId: semanticHash('finite-feasibility.receipt.v1', { claimId, executionId: result.executionId, observationEpoch: result.observationEpoch }) });
    assertFiniteFeasibilityClaim(receipt); claims.set(result, receipt);
  }
  return claims.get(result);
};
export const invalidateFiniteFeasibilityTarget = (target, { sourceUnitId, newSourceHash }) => {
  const state = owner(target), original = state.slice.sourceIdentities.find(row => row.sourceUnitId === sourceUnitId);
  if (!original || typeof newSourceHash !== 'string' || !/^[a-f0-9]{64}$/.test(newSourceHash) || newSourceHash === original.sourceHash) throw fail('A named original source must actually change.');
  state.invalidation = freeze({ sourceUnitId, previousSourceHash: original.sourceHash, newSourceHash,
    invalidationId: semanticHash('finite-feasibility.source-invalidation.v1', { targetIdentity: target.targetIdentity, sourceUnitId, newSourceHash }) });
  return state.invalidation;
};
export const retireFiniteFeasibilityTarget = target => {
  const state = target && typeof target === 'object' ? targets.get(target) : null;
  if (!state) throw fail('Original finite feasibility target required.');
  if (state.busy) throw fail('Outstanding feasibility work must settle before retirement.');
  state.retired = true; state.slice = null; state.currentCursor = null;
  return true;
};
