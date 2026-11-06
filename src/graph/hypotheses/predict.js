import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { canonicalSemanticJson, semanticHash } from '../../index/semantic/identity.js';
import { captureSemanticRequest } from '../../semantic/request-snapshot.js';
import { createSemanticContinuationBudget, isSemanticContinuationBudget } from '../../semantic/continuation-budget.js';
import { stageSemanticPagePublication } from '../../semantic/page-publication.js';
import { throwIfAborted } from '../../shared/abort.js';
import { FINITE_CAUSAL_QUERY_SCHEMAS } from '../../contracts/schemas/finite-causal-query.js';
import { assertFiniteCausalQuery } from '../../contracts/validators/finite-causal-query.js';
import { evaluateFiniteCausalModel, readFiniteCausalModelInput, finiteCausalModelWork } from './finite-model.js';
import { captureFiniteCausalQuery, finiteCausalQueryId } from './query.js';
import { finiteCausalSupportOrder } from './support-traversal.js';
import { rationalZero, readRational, addRationals, divideRationals, encodeRational } from './rational.js';

const owned = new WeakMap(), RETAINED_BYTES = 16 * 1024 * 1024;
const key = value => canonicalSemanticJson(value, { maxBytes: 2 * 1024 * 1024 });
const hash = (kind, value) => semanticHash('finite-causal.' + kind + '.v1', value, { maxBytes: 2 * 1024 * 1024 });
const fail = (suffix, message) => Object.assign(new Error(message), { code: 'ERR_FINITE_CAUSAL_' + suffix });
const immutable = value => {
  if (value && typeof value === 'object') { for (const child of Object.values(value)) immutable(child); Object.freeze(value); } return value;
};
const retire = (entries, token) => () => entries.delete(token);
const publication = (owner, token, entry, signal) => () => { throwIfAborted(signal); if (entry) owner.install(token, entry); };
const outcome = (group, complete, mass) => ({ outcomeId: group.outcomeId, values: group.values, assignmentCount: group.assignmentCount,
  unnormalizedMass: group.mass ? encodeRational(group.mass) : null,
  probability: group.mass && complete && mass.numerator > 0n ? encodeRational(divideRationals(group.mass, mass)) : null, witness: group.witness });
const score = state => ({ checkedAssignments: state.nextIndex, factualMatches: state.factualMatches,
  positiveMassMatches: state.positiveMassMatches, zeroWeightSkipped: state.zeroWeightSkipped });

/** Bounded abduction/action/prediction in a declared finite model. Factual and
 * counterfactual passes use the same original exogenous assignment. A prefix
 * never certifies an omitted outcome impossible or invents a prior.
 */
export const createFiniteCausalPredictionService = ({ supportTraversal = 'enumeration', retentionBudget = null,
  maxContinuations = 32, ttlMs = 300000 } = {}) => {
  if (!['enumeration', 'factorized'].includes(supportTraversal) || retentionBudget !== null && !isSemanticContinuationBudget(retentionBudget)
    || !Number.isSafeInteger(maxContinuations) || maxContinuations < 1 || maxContinuations > 256
    || !Number.isSafeInteger(ttlMs) || ttlMs < 1 || ttlMs > 86400000) throw new TypeError('Invalid finite prediction owner or bounds.');
  retentionBudget ||= createSemanticContinuationBudget();
  const entries = new Map(); let disposed = false;
  const owner = { install(token, entry) {
    if (disposed) throw fail('CURSOR_EXPIRED', 'Finite prediction service retired.');
    const expires = Date.now() + ttlMs, lease = retentionBudget.retain(RETAINED_BYTES, expires, retire(entries, token));
    entries.set(token, { ...entry, expires, lease });
    while (entries.size > maxContinuations) entries.get(entries.keys().next().value).lease.release();
  } };
  const service = ({ model, query, request = { cursor: null }, signal = null, deferPublication = false }) => {
    const began = performance.now(); throwIfAborted(signal);
    const input = readFiniteCausalModelInput(model); query = captureFiniteCausalQuery(model, query);
    request = captureSemanticRequest(request, FINITE_CAUSAL_QUERY_SCHEMAS.page); assertFiniteCausalQuery('page', request);
    if (disposed) throw fail('CURSOR_EXPIRED', 'Finite prediction service retired.');
    const queryId = finiteCausalQueryId(query); retentionBudget.sweep();
    const saved = request.cursor ? entries.get(request.cursor) : null;
    if (request.cursor && (!saved || saved.model !== model || saved.queryId !== queryId || saved.expires <= Date.now())) throw fail('CURSOR_EXPIRED', 'Prediction cursor expired or differs in model, world, definitions, evidence, intervention or task revision.');
    const state = saved ? structuredClone(saved.state) : { nextIndex: 0, factualMatches: 0, positiveMassMatches: 0, zeroWeightSkipped: 0,
      mass: rationalZero(), groups: new Map(), work: { factualEvaluations: 0, interventionEvaluations: 0, equationSteps: 0,
        supportConstructionMs: 0, supportTraversalMs: 0, occurrenceWork: 0, pageElapsedMs: 0 } };
    const limits = { assignments: 32, outcomes: 32, workMs: 250, bytes: 131072, ...request.limits };
    const traversal = finiteCausalSupportOrder(model, supportTraversal, signal);
    state.work.supportConstructionMs += traversal.work.constructionMs; state.work.supportTraversalMs += traversal.work.traversalMs;
    state.work.occurrenceWork += traversal.work.occurrenceWork;
    const weighted = input.exogenousSupport.weighting === 'normalized-rational', updates = new Set();
    const intervention = query.intervention.map(({ variableId, value }) => ({ variableId, value }));
    let progressed = 0;
    while (state.nextIndex < traversal.indices.length && progressed < limits.assignments
      && (!progressed || performance.now() - began < limits.workMs)) {
      throwIfAborted(signal);
      const supportIndex = traversal.indices[state.nextIndex], assignment = input.exogenousSupport.assignments[supportIndex];
      const factual = evaluateFiniteCausalModel(model, { modelId: model.modelId, exogenousAssignment: assignment.values, intervention: [] }, { signal });
      state.work.factualEvaluations++; state.work.equationSteps += factual.work.equationSteps;
      const valuation = new Map(factual.values.map(row => [row.variableId, row.value]));
      const matches = query.factualEvidence.every(row => key(valuation.get(row.variableId)) === key(row.value));
      const weight = weighted ? readRational(assignment.weight) : null;
      if (!matches || weighted && weight.numerator === 0n) {
        if (matches) state.factualMatches++;
        if (weighted && weight.numerator === 0n) state.zeroWeightSkipped++;
        state.nextIndex++; progressed++; continue;
      }
      const counterfactual = intervention.length ? evaluateFiniteCausalModel(model,
        { modelId: model.modelId, exogenousAssignment: assignment.values, intervention }, { signal }) : factual;
      if (intervention.length) { state.work.interventionEvaluations++; state.work.equationSteps += counterfactual.work.equationSteps; }
      const counterValues = new Map(counterfactual.values.map(row => [row.variableId, row.value]));
      const values = query.outcomeVariables.map(row => ({ ...row, value: counterValues.get(row.variableId) }));
      const outcomeId = hash('outcome', { queryId, values });
      if (!updates.has(outcomeId) && updates.size === limits.outcomes) break;
      const group = state.groups.get(outcomeId) || { outcomeId, values, assignmentCount: 0, mass: weighted ? rationalZero() : null,
        witness: { supportIndex, assignmentId: hash('assignment', { modelId: model.modelId, supportIndex, values: assignment.values }),
          factualValuationId: factual.valuationId, counterfactualValuationId: counterfactual.valuationId } };
      group.assignmentCount++; if (weighted) { group.mass = addRationals(group.mass, weight); state.mass = addRationals(state.mass, weight); }
      state.groups.set(outcomeId, group); updates.add(outcomeId); state.factualMatches++; state.positiveMassMatches++;
      state.nextIndex++; progressed++;
    }
    const traversed = state.nextIndex === traversal.indices.length, supportComplete = input.exogenousSupport.state === 'complete';
    const status = !traversed ? 'partial' : !supportComplete ? 'partial-support' : !state.factualMatches ? 'inconsistent-with-evidence'
      : weighted && !state.positiveMassMatches ? 'zero-conditioning-mass' : 'complete-in-declared-model';
    const complete = status === 'complete-in-declared-model';
    const outcomes = [...state.groups.values()].map(group => outcome(group, complete, state.mass));
    const completion = { declaredSupportTraversal: traversed ? 'complete' : 'partial', support: input.exogenousSupport.state,
      outcomeSet: complete ? 'complete-in-declared-model' : 'unresolved', causalTruth: 'not-established' };
    const counts = score(state), conditioningMass = weighted ? encodeRational(state.mass) : null;
    const snapshot = { query, modelWorld: input.worldRef, variables: input.variables, outcomes, status, completion,
      counts, conditioningMass, weighted, assumptions: input.assumptions, inputAuthority: 'supplied-model-and-evidence-not-revalidated' };
    const predictionId = hash('prediction', { queryId, counts, completion, outcomes, conditioningMass }); key(snapshot);
    state.work.pageElapsedMs += performance.now() - began;
    const result = { schemaVersion: 1, kind: 'finite-causal-prediction-page', modelId: model.modelId, worldId: model.worldId,
      questionId: model.questionId, queryId, predictionId, context: query.context, status, completion, counts,
      outcomeUpdates: [...updates].map(id => outcome(state.groups.get(id), complete, state.mass)), knownOutcomes: outcomes.length,
      selection: 'updates-to-owned-cumulative-outcome-set', conditioningMass, massMeaning: weighted ? 'unnormalized-through-checked-prefix' : 'no-implied-distribution',
      evidence: query.evidenceStatus, frontier: { declaredAssignmentsRemaining: traversal.indices.length - state.nextIndex,
        additionalSupport: supportComplete ? 'none-in-declared-model' : 'unknown' },
      cursor: traversed ? null : randomUUID(), verification: 'supplied-finite-model', execution: 'none',
      work: { ...state.work, progressedThisPage: progressed, traversal: traversal.work, modelPreparation: finiteCausalModelWork(model),
        elapsedMs: performance.now() - began, serializationElapsedMs: 0, serializedByteUpperBound: 0 } };
    const serializationBegan = performance.now(), bytes = Buffer.byteLength(JSON.stringify(result)) + 1;
    result.work.serializationElapsedMs = performance.now() - serializationBegan;
    result.work.elapsedMs = performance.now() - began; result.work.serializedByteUpperBound = bytes + 128;
    if (bytes + 128 > limits.bytes) throw fail('OUTPUT_LIMIT', 'Finite prediction page exceeds its byte allowance; request fewer outcome updates.');
    throwIfAborted(signal);
    owned.set(result, immutable(snapshot)); immutable(result);
    return stageSemanticPagePublication(result, publication(owner, result.cursor,
      traversed ? null : { model, queryId, state }, signal), deferPublication);
  };
  service.dispose = () => { disposed = true; for (const entry of [...entries.values()]) entry.lease.release(); };
  service.continuationStats = () => ({ cursors: entries.size, ...retentionBudget.stats() }); return service;
};

export const readFiniteCausalPrediction = result => {
  const value = result && typeof result === 'object' ? owned.get(result) : null;
  if (!value) throw fail('PREDICTION_HANDLE', 'Original finite prediction receipt required.'); return value;
};
export const projectFiniteCausalOutcomes = (prediction, { offset = 0, limit = 16, maxBytes = 65536 } = {}) => {
  const knowledge = readFiniteCausalPrediction(prediction);
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 32
    || !Number.isSafeInteger(maxBytes) || maxBytes < 1024 || maxBytes > 131072) throw new TypeError('Invalid finite prediction projection allowance.');
  const end = Math.min(offset + limit, knowledge.outcomes.length);
  const result = { kind: 'finite-causal-outcome-window', predictionId: prediction.predictionId, queryId: prediction.queryId,
    modelId: prediction.modelId, worldId: prediction.worldId, outcomes: knowledge.outcomes.slice(offset, end),
    knownOutcomes: knowledge.outcomes.length, nextOffset: end < knowledge.outcomes.length ? end : null,
    completion: knowledge.completion, programSemantics: 'not-established' };
  if (Buffer.byteLength(JSON.stringify(result)) + 1 > maxBytes) throw fail('OUTPUT_LIMIT', 'Outcome window exceeds its byte allowance; request fewer outcomes.');
  return immutable(result);
};
