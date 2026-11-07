import assert from 'node:assert/strict';
import { causalValue, causalBinding, causalVariable, causalEquation, finiteCausalInput } from '../../helpers/finite-causal-model.js';
import { createFiniteCausalModel } from '../../../src/graph/hypotheses/finite-model.js';
import { createFiniteCausalPredictionService, readFiniteCausalPrediction, projectFiniteCausalOutcomes } from '../../../src/graph/hypotheses/predict.js';
import { compareFiniteCausalEvidence } from '../../../src/graph/hypotheses/compatibility.js';
import { createSemanticContinuationBudget } from '../../../src/semantic/continuation-budget.js';
import { publishSemanticPage } from '../../../src/semantic/page-publication.js';

const mode = process.env.PAIROFCLEATS_TEST_ID?.split('graph/hypotheses/finite-causal-prediction/')[1];
assert.ok(['common-cause-counterfactual', 'collider-conditioning', 'weights-and-incomplete-support', 'factorized-support-parity', 'scope-and-cursor-ownership'].includes(mode));
const definitionId = '1'.repeat(64);
const reference = variableId => ({ variableId, operationalDefinitionId: definitionId });
const binding = (variableId, value) => ({ ...reference(variableId), value: causalValue(value) });
const queryFor = (model, factualEvidence = [], intervention = [], outcomes = ['Y']) => ({ modelId: model.modelId, worldId: model.worldId,
  questionId: model.questionId, context: { taskRevision: 'revision-1', branchId: 'branch-1', assumptionSetId: 'assumptions-1' },
  outcomeVariables: outcomes.map(reference), factualEvidence, evidenceStatus: 'supplied-values', intervention });
const page = (service, model, query, cursor = null, limits = {}, options = {}) => service({ model, query, request: { cursor, limits }, ...options });
const finish = (service, model, query) => {
  let result = page(service, model, query); let pages = 1;
  while (result.cursor) { assert.ok(pages++ < 32); result = page(service, model, query, result.cursor); } return result;
};
const allowed = result => readFiniteCausalPrediction(result).outcomes.map(row => row.values.map(value => value.value.value).join(',')).sort();
const observe = (result, values, extra = {}) => compareFiniteCausalEvidence(result, { predictionId: result.predictionId, worldId: result.worldId,
  questionId: result.questionId, context: result.context, kind: 'value', coverage: 'complete', values,
  observationReceiptIds: ['a'.repeat(64)], ...extra });

if (mode === 'common-cause-counterfactual') {
  const direct = createFiniteCausalModel(finiteCausalInput()), commonInput = finiteCausalInput();
  commonInput.equations[1] = causalEquation('Y', ['U'], [[[false], false], [[true], true]]);
  const common = createFiniteCausalModel(commonInput), service = createFiniteCausalPredictionService();
  const factual = [binding('X', false), binding('Y', false)], change = [binding('X', true)];
  const first = finish(service, direct, queryFor(direct, factual, change)), second = finish(service, common, queryFor(common, factual, change));
  assert.deepEqual(allowed(first), ['true']); assert.deepEqual(allowed(second), ['false']);
  assert.equal(observe(second, [binding('Y', true)]).status, 'model-counterexample');
  const unconditioned = finish(service, common, queryFor(common, [], change));
  assert.deepEqual(allowed(unconditioned), ['false', 'true']);
  assert.equal(observe(unconditioned, [binding('Y', true)]).status, 'compatible-not-causal-confirmation');
  assert.equal(readFiniteCausalPrediction(unconditioned).outcomes[0].probability, null, 'unweighted support has no invented uniform prior');
  const partial = page(service, common, queryFor(common, [], change), null, { assignments: 1 });
  assert.equal(partial.status, 'partial'); assert.equal(observe(partial, [binding('Y', true)]).status, 'unresolved');
  assert.deepEqual(projectFiniteCausalOutcomes(second).outcomes[0].values, [binding('Y', false)]);
  service.dispose();
} else if (mode === 'collider-conditioning') {
  const input = finiteCausalInput();
  input.variables = [causalVariable('U', 'exogenous'), causalVariable('V', 'exogenous'), causalVariable('X', 'endogenous'),
    causalVariable('Z', 'endogenous'), causalVariable('C', 'endogenous')];
  input.equations = [causalEquation('X', ['U'], [[[false], false], [[true], true]]), causalEquation('Z', ['V'], [[[false], false], [[true], true]]),
    causalEquation('C', ['X', 'Z'], [false, true].flatMap(x => [false, true].map(z => [[x, z], x === z])))];
  input.admissibleInterventionVariables = ['X', 'Z', 'C'];
  input.exogenousSupport.assignments = [false, true].flatMap(u => [false, true].map(v => ({ values: [causalBinding('U', u), causalBinding('V', v)], weight: null })));
  const model = createFiniteCausalModel(input), service = createFiniteCausalPredictionService();
  const selected = finish(service, model, queryFor(model, [binding('C', true), binding('X', false)], [], ['Z']));
  assert.deepEqual(allowed(selected), ['false']);
  const counterfactual = finish(service, model, queryFor(model, [binding('C', true), binding('X', false)], [binding('X', true)], ['Z', 'C']));
  assert.deepEqual(allowed(counterfactual), ['false,false'], 'same exogenous assignment, with the collider recomputed after do(X)');
  const conditioned = finish(service, model, queryFor(model, [binding('C', true), binding('X', true)], [], ['Z']));
  assert.deepEqual(allowed(conditioned), ['true'], 'conditioning selects a different unit rather than the factual-conditioned counterfactual');
  const intervention = finish(service, model, queryFor(model, [], [binding('X', true)], ['Z']));
  assert.deepEqual(allowed(intervention), ['false', 'true']); service.dispose();
} else if (mode === 'weights-and-incomplete-support') {
  const input = finiteCausalInput(); input.exogenousSupport.weighting = 'normalized-rational';
  input.exogenousSupport.assignments.forEach((row, index) => { row.weight = { numerator: String(index + 1), denominator: '3' }; });
  const weighted = createFiniteCausalModel(input), service = createFiniteCausalPredictionService();
  const result = finish(service, weighted, queryFor(weighted)), knowledge = readFiniteCausalPrediction(result);
  assert.deepEqual(knowledge.outcomes.find(row => row.values[0].value.value === false).probability, { numerator: '1', denominator: '3' });
  assert.deepEqual(knowledge.outcomes.find(row => row.values[0].value.value === true).probability, { numerator: '2', denominator: '3' });
  const collapsed = finish(service, weighted, queryFor(weighted, [], [binding('Y', false)]));
  assert.equal(collapsed.knownOutcomes, 1); assert.equal(readFiniteCausalPrediction(collapsed).outcomes[0].assignmentCount, 2);
  assert.deepEqual(readFiniteCausalPrediction(collapsed).outcomes[0].probability, { numerator: '1', denominator: '1' });
  const impossible = finish(service, weighted, queryFor(weighted, [binding('X', false), binding('Y', true)]));
  assert.equal(impossible.status, 'inconsistent-with-evidence'); assert.equal(observe(impossible, [binding('Y', true)]).status, 'unresolved');
  input.exogenousSupport.assignments[0].weight = { numerator: '1', denominator: '1' };
  input.exogenousSupport.assignments[1].weight = { numerator: '0', denominator: '1' };
  const zero = createFiniteCausalModel(input), noMass = finish(service, zero, queryFor(zero, [binding('U', true)]));
  assert.equal(noMass.status, 'zero-conditioning-mass'); assert.equal(noMass.knownOutcomes, 0);
  const partialInput = finiteCausalInput(); partialInput.exogenousSupport.state = 'partial'; partialInput.exogenousSupport.assignments.pop();
  const partial = createFiniteCausalModel(partialInput), unknown = finish(service, partial, queryFor(partial));
  assert.equal(unknown.status, 'partial-support'); assert.equal(unknown.frontier.additionalSupport, 'unknown');
  assert.equal(observe(unknown, [binding('Y', true)]).status, 'unresolved');
  const full = createFiniteCausalModel(finiteCausalInput()), finite = finish(service, full, queryFor(full, [binding('U', false)]));
  assert.equal(observe(finite, [binding('Y', true)], { kind: 'absence', coverage: 'partial' }).status, 'premise-unverified');
  const unavailable = queryFor(full); unavailable.evidenceStatus = 'unavailable';
  assert.deepEqual(allowed(finish(service, full, unavailable)), ['false', 'true']);
  unavailable.factualEvidence = [binding('U', false)]; assert.throws(() => finish(service, full, unavailable)); service.dispose();
} else if (mode === 'factorized-support-parity') {
  const input = finiteCausalInput(), ids = Array.from({ length: 6 }, (_, index) => 'U' + index);
  input.variables = [...ids.map(id => causalVariable(id, 'exogenous')), causalVariable('Y', 'endogenous')];
  const assignments = Array.from({ length: 64 }, (_, mask) => ids.map((_, index) => Boolean(mask & (1 << index))));
  input.equations = [causalEquation('Y', ids, assignments.map(values => [values, values.filter(Boolean).length % 2 === 1]))];
  input.exogenousSupport.assignments = assignments.map(values => ({ values: ids.map((id, index) => causalBinding(id, values[index])), weight: { numerator: '1', denominator: '64' } }));
  input.exogenousSupport.weighting = 'normalized-rational'; input.admissibleInterventionVariables = ['Y'];
  const model = createFiniteCausalModel(input), direct = createFiniteCausalPredictionService(), factor = createFiniteCausalPredictionService({ supportTraversal: 'factorized' });
  for (const conditions of [[], [binding('U0', true)]]) for (const interventions of [[], [binding('Y', false)]]) {
    const query = queryFor(model, conditions, interventions), left = finish(direct, model, query), right = finish(factor, model, query);
    assert.deepEqual(readFiniteCausalPrediction(left), readFiniteCausalPrediction(right)); assert.equal(left.predictionId, right.predictionId);
    assert.equal(left.counts.checkedAssignments, 64); assert.ok(right.work.occurrenceWork > 0);
    assert.equal(readFiniteCausalPrediction(right).outcomes.reduce((sum, row) => sum + row.assignmentCount, 0), conditions.length ? 32 : 64,
      'physical sum choices never multiply original assignment counts');
    assert.equal(right.work.traversal.originalAssignments, 64);
  }
  direct.dispose(); factor.dispose();
} else {
  const model = createFiniteCausalModel(finiteCausalInput()), query = queryFor(model);
  const budget = createSemanticContinuationBudget({ maxBytes: 16 * 1024 * 1024 }), service = createFiniteCausalPredictionService({ retentionBudget: budget });
  const first = page(service, model, query, null, { assignments: 1 }, { deferPublication: true });
  assert.equal(service.continuationStats().cursors, 0);
  assert.throws(() => page(service, model, query, first.cursor), { code: 'ERR_FINITE_CAUSAL_CURSOR_EXPIRED' });
  publishSemanticPage(first); const final = page(service, model, query, first.cursor);
  assert.equal(final.status, 'complete-in-declared-model');
  assert.throws(() => readFiniteCausalPrediction({ ...final }), { code: 'ERR_FINITE_CAUSAL_PREDICTION_HANDLE' });
  assert.throws(() => { final.completion.outcomeSet = 'partial'; }, TypeError);
  assert.throws(() => observe(final, [binding('Y', true)], { worldId: '0'.repeat(64) }), { code: 'ERR_FINITE_CAUSAL_OBSERVATION_MISMATCH' });
  assert.throws(() => observe(final, [{ ...binding('Y', true), operationalDefinitionId: '0'.repeat(64) }]));
  assert.throws(() => observe(final, [binding('Y', true)], { context: { ...query.context, taskRevision: 'stale' } }));
  for (const mutate of [value => { value.worldId = '0'.repeat(64); }, value => { value.outcomeVariables[0].operationalDefinitionId = '0'.repeat(64); },
    value => { value.outcomeVariables.push(structuredClone(value.outcomeVariables[0])); }, value => { value.intervention = [binding('U', false)]; }]) {
    const invalid = structuredClone(query); mutate(invalid); assert.throws(() => page(service, model, invalid));
  }
  const stale = { ...query, context: { ...query.context, taskRevision: 'revision-2' } };
  assert.throws(() => page(service, model, stale, first.cursor), { code: 'ERR_FINITE_CAUSAL_CURSOR_EXPIRED' });
  const cursors = service.continuationStats().cursors;
  assert.throws(() => page(service, model, query, null, { bytes: 1024 }), { code: 'ERR_FINITE_CAUSAL_OUTPUT_LIMIT' });
  assert.equal(service.continuationStats().cursors, cursors);
  const controller = new AbortController(); controller.abort();
  assert.throws(() => page(service, model, query, null, {}, { signal: controller.signal }), { name: 'AbortError' });
  const replacement = page(service, model, query, null, { assignments: 1 }); assert.ok(replacement.cursor);
  assert.throws(() => page(service, model, query, first.cursor), { code: 'ERR_FINITE_CAUSAL_CURSOR_EXPIRED' });
  service.dispose(); assert.equal(budget.stats().retainedBytes, 0);
}
console.log('Finite predictions preserve factual assignments, exact mass, unknown support and independent observation premises.');
