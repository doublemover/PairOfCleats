import { performance } from 'node:perf_hooks';
import { randomUUID } from 'node:crypto';
import { canonicalSemanticJson, semanticHash } from '../../index/semantic/identity.js';
import { captureSemanticRequest } from '../../semantic/request-snapshot.js';
import { throwIfAborted } from '../../shared/abort.js';
import { FINITE_MODEL_INTERVENTION_SCHEMA } from '../../contracts/schemas/finite-model-intervention.js';
import { assertFiniteModelIntervention } from '../../contracts/validators/finite-model-intervention.js';
import { readFiniteCausalModelInput, finiteCausalModelWork, evaluateFiniteCausalModel } from './finite-model.js';
import { captureFiniteCausalQuery } from './query.js';

const plans = new WeakMap(), pairs = new WeakMap();
const key = value => canonicalSemanticJson(value, { maxBytes: 131072 });
const hash = (kind, value) => semanticHash('finite-model-intervention.' + kind + '.v1', value, { maxBytes: 131072 });
const order = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const fail = (suffix, message) => Object.assign(new Error(message), { code: 'ERR_FINITE_MODEL_INTERVENTION_' + suffix });
const immutable = value => {
  if (value && typeof value === 'object') { for (const child of Object.values(value)) immutable(child); Object.freeze(value); } return value;
};
const assignmentKey = rows => key([...rows].sort((a, b) => order(a.variableId, b.variableId)));
const getPlan = plan => {
  const value = plan && typeof plan === 'object' ? plans.get(plan) : null;
  if (!value) throw fail('HANDLE', 'Original finite intervention plan required.'); return value;
};
const admitBindings = (rows, input) => {
  const seen = new Set();
  for (const row of rows) {
    const variable = input.variables.find(variable => variable.id === row.variableId);
    if (!variable || seen.has(row.variableId) || row.operationalDefinitionId !== variable.operationalDefinitionId
      || !variable.domain.some(value => key(value) === key(row.value))) throw fail('CONTRACT', 'Intervention conditions require unique, exactly defined model values.');
    seen.add(row.variableId);
  }
};

/** Registered finite-lookup profile for #1526. Planning is inert and never
 * opens a workspace or grants execution of source, commands or model providers.
 */
export const planFiniteModelIntervention = ({ model, spec }, { signal = null } = {}) => {
  const began = performance.now(); throwIfAborted(signal); const input = readFiniteCausalModelInput(model);
  spec = captureSemanticRequest(spec, FINITE_MODEL_INTERVENTION_SCHEMA); assertFiniteModelIntervention(spec); key(spec);
  if (spec.worldId !== model.worldId || spec.questionId !== model.questionId) throw fail('SCOPE', 'Intervention world or question differs from the pinned model.');
  captureFiniteCausalQuery(model, { modelId: model.modelId, worldId: spec.worldId, questionId: spec.questionId, context: spec.context,
    outcomeVariables: spec.outcomeVariables, factualEvidence: [], evidenceStatus: 'supplied-values', intervention: spec.assignedIntervention });
  for (const rows of [spec.heldFixed, spec.expectedTreatmentOutcome]) admitBindings(rows, input);
  if (spec.expectedRelation === 'directed-change' && (spec.expectedTreatmentOutcome.length !== spec.outcomeVariables.length
    || spec.expectedTreatmentOutcome.some(row => !spec.outcomeVariables.some(variable => variable.variableId === row.variableId)))
    || spec.expectedRelation !== 'directed-change' && spec.expectedTreatmentOutcome.length) throw fail('CONTRACT', 'Directed-change controls require the complete declared expected outcome; other controls carry none.');
  const exogenous = input.variables.filter(variable => variable.kind === 'exogenous');
  if (spec.exogenousAssignment.length !== exogenous.length || new Set(spec.exogenousAssignment.map(row => row.variableId)).size !== exogenous.length
    || !input.exogenousSupport.assignments.some(row => assignmentKey(row.values) === assignmentKey(spec.exogenousAssignment))) throw fail('CONTRACT', 'Paired execution requires one exact original support assignment.');
  const requiredSteps = input.equations.length * 2;
  if (requiredSteps > spec.executionProfile.maxEquationSteps) throw fail('WORK_LIMIT', 'Paired equation traversal cannot fit the declared aggregate work allowance.');
  const assigned = [...spec.assignedIntervention].sort((a, b) => order(a.variableId, b.variableId));
  const assignedInterventionId = hash('assignment', { modelId: model.modelId, assigned });
  const report = immutable({ schemaVersion: 1, kind: 'finite-model-intervention-plan', planId: hash('plan', { modelId: model.modelId, spec }),
    modelId: model.modelId, questionId: model.questionId, worldId: model.worldId, pairId: spec.pairId,
    taskSpecId: spec.taskSpecId, splitManifestId: spec.splitManifestId, context: spec.context, assignedInterventionId,
    estimand: spec.estimand, executionProfile: spec.executionProfile, requiredEquationSteps: requiredSteps,
    sourceExecutionAuthority: 'none', execution: 'none' });
  plans.set(report, { model, input, spec, assigned, preparationMs: performance.now() - began }); return report;
};

/** Actual same-unit deterministic model executions. A realization receipt is
 * emitted only after both passes and every replaced/unreplaced trace step agree.
 * Equal output values can coexist with a successfully realized intervention.
 */
export const replayFiniteModelIntervention = (plan, { signal = null } = {}) => {
  const began = performance.now(), { model, input, spec, assigned, preparationMs } = getPlan(plan); throwIfAborted(signal);
  const executionRunId = randomUUID();
  const baseline = evaluateFiniteCausalModel(model, { modelId: model.modelId, exogenousAssignment: spec.exogenousAssignment, intervention: [] }, { signal });
  throwIfAborted(signal);
  const treatment = evaluateFiniteCausalModel(model, { modelId: model.modelId, exogenousAssignment: spec.exogenousAssignment,
    intervention: assigned.map(({ variableId, value }) => ({ variableId, value })) }, { signal });
  const replacements = new Map(assigned.map(row => [row.variableId, row.value]));
  for (const step of treatment.trace) {
    if (step.mechanism !== (replacements.has(step.variableId) ? 'replaced-by-intervention' : 'declared-lookup')
      || replacements.has(step.variableId) && key(step.value) !== key(replacements.get(step.variableId))) throw fail('INTEGRITY', 'Treatment trace did not realize the assigned mechanism replacements.');
  }
  if (treatment.trace.length !== input.equations.length || baseline.trace.length !== input.equations.length
    || assigned.some(row => !treatment.trace.some(step => step.variableId === row.variableId))) throw fail('INTEGRITY', 'Paired trace omitted an original mechanism or replacement.');
  const before = new Map(baseline.values.map(row => [row.variableId, row.value])), after = new Map(treatment.values.map(row => [row.variableId, row.value]));
  const projected = values => spec.outcomeVariables.map(row => ({ ...row, value: values.get(row.variableId) }));
  const baselineOutcome = projected(before), treatmentOutcome = projected(after);
  const violations = spec.heldFixed.filter(row => key(before.get(row.variableId)) !== key(row.value) || key(after.get(row.variableId)) !== key(row.value))
    .map(row => ({ variableId: row.variableId, reason: 'held-fixed-value-differs-in-baseline-or-treatment' }));
  const sameOutput = key(baselineOutcome) === key(treatmentOutcome);
  const expected = spec.expectedRelation === 'unknown' ? 'unknown' : spec.expectedRelation === 'invariant' ? sameOutput ? 'pass' : 'fail'
    : !sameOutput && spec.expectedTreatmentOutcome.every(row => key(after.get(row.variableId)) === key(row.value)) ? 'pass' : 'fail';
  const realizedBindings = treatment.trace.filter(step => step.mechanism === 'replaced-by-intervention').map(step => ({ variableId: step.variableId,
    operationalDefinitionId: input.variables.find(variable => variable.id === step.variableId).operationalDefinitionId, value: step.value }))
    .sort((a, b) => order(a.variableId, b.variableId));
  const realized = realizedBindings.map(row => ({ variableId: row.variableId, operationalDefinitionId: row.operationalDefinitionId, constant: row.value,
    originalMechanismId: hash('mechanism', input.equations.find(equation => equation.output === row.variableId)),
    replacementMechanismId: hash('constant-mechanism', row), factualValue: before.get(row.variableId), realizedValue: after.get(row.variableId) }));
  const comparisonId = hash('comparison', { planId: plan.planId,
    baselineValuationId: baseline.valuationId, treatmentValuationId: treatment.valuationId, realized, violations, expected });
  const result = { schemaVersion: 1, kind: 'finite-model-paired-intervention', executionRunId, comparisonId, receiptId: hash('receipt', { planId: plan.planId, executionRunId,
    baselineValuationId: baseline.valuationId, treatmentValuationId: treatment.valuationId, realized, violations, expected }),
  planId: plan.planId, modelId: model.modelId, questionId: model.questionId, worldId: model.worldId, pairId: spec.pairId,
  taskSpecId: spec.taskSpecId, splitManifestId: spec.splitManifestId, context: spec.context,
  assignedInterventionId: plan.assignedInterventionId, realizedInterventionId: hash('assignment', { modelId: model.modelId, assigned: realizedBindings }),
  realization: 'complete-in-declared-model', executionStatus: 'completed', admissibility: violations.length ? 'failed' : 'satisfied-in-declared-model',
  violations, estimand: spec.estimand, baselineOutcome, treatmentOutcome, sameOutput, expectedRelation: spec.expectedRelation,
  negativeControl: violations.length ? 'not-admissible' : expected, realized,
  baselineExecutionId: hash('execution', { executionRunId, role: 'baseline', modelId: model.modelId, assignment: spec.exogenousAssignment, intervention: [] }),
  treatmentExecutionId: hash('execution', { executionRunId, role: 'treatment', modelId: model.modelId, assignment: spec.exogenousAssignment, intervention: assigned }),
  causalStatus: violations.length ? 'unidentifiable' : input.assumptions.some(row => row.status === 'contradicted') ? 'assumption-dependent' : 'identified-in-declared-model',
  axes: { sourceSupport: 'not-assessed', provenanceIndependence: 'not-assessed', executorReliance: 'not-measured', taskOutcome: 'not-assessed',
    programCausalEffect: 'not-established', observedSourceExecution: false },
  work: { planningMs: preparationMs, modelPreparation: finiteCausalModelWork(model),
    baseline: baseline.work, treatment: treatment.work, actualEquationSteps: baseline.work.equationSteps + treatment.work.equationSteps,
    elapsedMs: performance.now() - began, serializationElapsedMs: 0, serializedByteUpperBound: 0 } };
  const serializationBegan = performance.now(), bytes = Buffer.byteLength(JSON.stringify(result)) + 1;
  result.work.serializationElapsedMs = performance.now() - serializationBegan;
  result.work.elapsedMs = performance.now() - began; result.work.serializedByteUpperBound = bytes + 128;
  if (bytes + 128 > spec.executionProfile.maxOutputBytes) throw fail('OUTPUT_LIMIT', 'Paired finite-model report exceeds its declared byte allowance.');
  throwIfAborted(signal); immutable(result);
  pairs.set(result, immutable({ spec, modelId: model.modelId, modelWorld: input.worldRef, factualValues: baseline.values,
    treatmentValues: treatment.values, realization: realized })); return result;
};
export const readFiniteModelIntervention = receipt => {
  const value = receipt && typeof receipt === 'object' ? pairs.get(receipt) : null;
  if (!value) throw fail('HANDLE', 'Original completed paired model execution required.'); return value;
};
